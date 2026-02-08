from fastapi import FastAPI, File, UploadFile, Form, BackgroundTasks
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import logging
import os
import json
import uuid
import shutil
import subprocess
import threading
import time
import sys

# Lock for Ghidra headless execution (only one at a time to prevent corruption)
ghidra_lock = threading.Lock()

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voodoobox-ghidra")

app = FastAPI(title="TheVooDooBox Ghidra Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Constants
PROJECTS_DIR = os.getenv("GHIDRA_PROJECTS_DIR", "/data/projects")
BINARIES_DIR = os.getenv("GHIDRA_BINARIES_DIR", "/data/binaries")
SCRIPTS_DIR = "/app/scripts"

# Ensure directories exist
for d in [PROJECTS_DIR, BINARIES_DIR, SCRIPTS_DIR]:
    os.makedirs(d, exist_ok=True)

class AnalysisRequest(BaseModel):
    binary_name: str
    task_id: Optional[str] = None
    project_name: Optional[str] = "voodoobox_default"

@app.on_event("startup")
async def startup_event():
    log_path = os.path.join(BINARIES_DIR, "ghidra_service_startup.log")
    try:
        with open(log_path, "w") as f:
            f.write(f"Service initialized at {time.ctime()}\n")
            f.write(f"BINARIES_DIR: {BINARIES_DIR}\n")
            f.write(f"PROJECTS_DIR: {PROJECTS_DIR}\n")
            f.write(f"Env HOST_IP: {os.getenv('HOST_IP')}\n")
        logger.info("Startup check: Wrote to volume successfully.")
    except Exception as e:
        logger.error(f"Startup check FAILED: {e}")

@app.get("/debug/logs")
def get_debug_logs():
    files = ["ghidra_proc.log", "ghidra_debug.log", "ghidra_service_startup.log"]
    logs = {}
    for filename in files:
        path = os.path.join(BINARIES_DIR, filename)
        if os.path.exists(path):
            try:
                with open(path, "r") as f:
                    logs[filename] = f.read()[-5000:] # Last 5000 chars
            except Exception as e:
                logs[filename] = f"Error reading file: {e}"
        else:
            logs[filename] = "File not found."
    return logs

@app.get("/health")
def health():
    return {"status": "online", "service": "ghidra-static-engine"}

@app.post("/upload")
async def upload_binary(file: UploadFile = File(...)):
    file_path = os.path.join(BINARIES_DIR, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {"status": "uploaded", "filename": file.filename, "path": file_path}

@app.post("/analyze")
def run_analysis(request: AnalysisRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(headless_analyze, request.binary_name, request.project_name, request.task_id)
    return {"status": "queued", "binary": request.binary_name, "task_id": request.task_id}

def headless_analyze(binary_name: str, project_name: str, task_id: Optional[str] = None):
    try:
        _headless_analyze_unsafe(binary_name, project_name, task_id)
    except Exception as e:
        logger.error(f"CRITICAL WORKER ERROR: {e}")
        # Try to log to file
        try:
            debug_log_path = os.path.join(BINARIES_DIR, "ghidra_proc.log")
            with open(debug_log_path, "a") as f:
                f.write(f"CRITICAL EXCEPTION IN WORKER: {e}\n")
        except:
            pass

def _headless_analyze_unsafe(binary_name: str, project_name: str, task_id: Optional[str] = None):
    binary_path = os.path.join(BINARIES_DIR, binary_name)
    
    # Debug log the path check
    try:
        with open(os.path.join(BINARIES_DIR, "ghidra_proc.log"), "a") as f:
             f.write(f"Checking for binary at: {binary_path}\n")
    except:
        pass

    if not os.path.exists(binary_path):
        logger.error(f"Binary not found: {binary_path}")
        try:
            with open(os.path.join(BINARIES_DIR, "ghidra_proc.log"), "a") as f:
                 f.write(f"ERROR: Binary path does not exist: {binary_path}\n")
        except:
            pass
        return

    # Clean up existing project to avoid conflicts
    project_path = os.path.join(PROJECTS_DIR, f"{project_name}.gpr")
    project_rep = os.path.join(PROJECTS_DIR, f"{project_name}.rep")
    if os.path.exists(project_path):
        os.remove(project_path)
    if os.path.exists(project_rep):
        shutil.rmtree(project_rep)

    cmd = [
        "/ghidra/support/analyzeHeadless",
        PROJECTS_DIR,
        project_name,
        "-import", binary_path,
        "-overwrite",
        "-noanalysis",
        "-analysisTimeoutPerFile", "300",
        "-scriptPath", SCRIPTS_DIR,
        "-loader-config", "PeLoader:Parse Resources=false",
        "-postScript", "AnalyzeAndIngest.py"
    ]

    logger.info(f"Starting analysis for {binary_name} (Task: {task_id})...")
    logger.info(f"Command: {' '.join(cmd)}")
    
    env = os.environ.copy()
    # Pass HOST_IP to script
    env["HOST_IP"] = os.getenv("HOST_IP", "hyper-bridge")
    if task_id:
        env["TASK_ID"] = task_id

    # Log pre-execution
    try:
        with open(os.path.join(BINARIES_DIR, "ghidra_proc.log"), "a") as f:
             f.write(f"\n[PRE-EXEC] Launching Ghidra for {binary_name}...\n")
             f.write(f"CMD: {' '.join(cmd)}\n")
    except:
        pass

    try:
        with ghidra_lock:
            # Use Popen to stream output
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, # Merge stderr into stdout
                env=env,
                text=True,
                bufsize=1 # Line buffered
            )

            # Stream output to log file
            log_path = os.path.join(BINARIES_DIR, "ghidra_proc.log")
            try:
                with open(log_path, "a") as f:
                    for line in process.stdout:
                        sys.stdout.write(line) # Echo to container logs
                        f.write(line)
            except Exception as e:
                logger.error(f"Error streaming logs: {e}")

            process.wait()

            if process.returncode != 0:
                 logger.error(f"Ghidra exited with code {process.returncode}")
                 try:
                    with open(log_path, "a") as f:
                        f.write(f"\n[ERROR] Process exited with code {process.returncode}\n")
                 except:
                    pass

    except Exception as e:
         logger.error(f"Subprocess failed: {e}")
         try:
            with open(os.path.join(BINARIES_DIR, "ghidra_proc.log"), "a") as f:
                 f.write(f"\n[ERROR] Subprocess Exception: {e}\n")
         except:
            pass
         return
    

@app.get("/binary/{name}/functions")
def get_functions(name: str):
    # This will call a headless script to extract functions
    return run_ghidra_script(name, "GetFunctions.java")

@app.get("/binary/{name}/decompile/{address}")
def decompile_function(name: str, address: str):
    return run_ghidra_script(name, "DecompileFunction.java", args=[address])

@app.get("/scripts")
def list_scripts():
    registry_path = os.path.join(SCRIPTS_DIR, "scripts_registry.json")
    if os.path.exists(registry_path):
        with open(registry_path, "r") as f:
            return json.load(f)
    return []

@app.post("/run-script")
def execute_ghidra_script(request: dict = None):
    # Flexible request handler for script execution
    # Expected: { "script_name": str, "task_id": str, "binary_name": str, "args": dict }
    script_name = request.get("script_name")
    task_id = request.get("task_id")
    binary_name = request.get("binary_name")
    args = request.get("args", {})
    
    if not script_name or not binary_name:
        return {"error": "Missing script_name or binary_name"}

    logger.info(f"Executing {script_name} on {binary_name} (Task: {task_id})")
    
    # Run headless
    env = os.environ.copy()
    if task_id: env["TASK_ID"] = task_id
    env["HOST_IP"] = os.getenv("HOST_IP", "hyper-bridge")
    
    cmd = [
        "/ghidra/support/analyzeHeadless",
        PROJECTS_DIR,
        "voodoobox_default",
        "-process", binary_name,
        "-scriptPath", SCRIPTS_DIR,
        "-postScript", script_name
    ]
    # Check if script has .java extension for specific handling if needed, 
    # but analyzeHeadless handles it via -postScript usually.

    with ghidra_lock:
        result = subprocess.run(cmd, capture_output=True, text=True, env=env)
        
    if result.returncode == 0:
         logger.info(f"Script success: {script_name}")
         return {"status": "success", "output": result.stdout}
    else:
         logger.error(f"Script failed: {result.stderr}")
         return {"status": "error", "error": result.stderr}

def run_ghidra_script(binary_name: str, script_name: str, args: list = None):
    # Helper for generic GET endpoints (deprecated/internal)
    cmd = [
        "/ghidra/support/analyzeHeadless",
        PROJECTS_DIR,
        "voodoobox_default",
        "-process", binary_name,
        "-scriptPath", SCRIPTS_DIR,
        "-postScript", script_name
    ]
    if args:
        cmd.extend(args)
    
    env = os.environ.copy()
    env["HOST_IP"] = os.getenv("HOST_IP", "hyper-bridge")

    with ghidra_lock:
        result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    
    if result.returncode == 0:
        return {"status": "success", "output": result.stdout}
    return {"status": "error", "error": result.stderr}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
