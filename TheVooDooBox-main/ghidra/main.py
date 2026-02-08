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
    binary_path = os.path.join(BINARIES_DIR, binary_name)
    if not os.path.exists(binary_path):
        logger.error(f"Binary not found: {binary_path}")
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

    with ghidra_lock:
        result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    
    # Write raw output to shared volume for debugging
    try:
        debug_log_path = os.path.join(BINARIES_DIR, "ghidra_proc.log")
        with open(debug_log_path, "a") as f:
            f.write(f"\n--- Analysis Task: {task_id} --- {binary_name} ---\n")
            f.write(f"Command: {' '.join(cmd)}\n")
            if result.stdout:
                f.write(f"STDOUT:\n{result.stdout}\n")
            if result.stderr:
                f.write(f"STDERR:\n{result.stderr}\n")
            f.write(f"Return Code: {result.returncode}\n")
    except Exception as e:
        logger.error(f"Failed to write debug log: {e}")

    # Always log output for debugging
    if result.stdout:
        logger.info(f"Ghidra STDOUT:\n{result.stdout}")
    if result.stderr:
        logger.error(f"Ghidra STDERR:\n{result.stderr}")

    if result.returncode == 0:
        logger.info(f"Analysis complete for {binary_name}")
    else:
        logger.error(f"Analysis failed for {binary_name}: {result.stderr}")

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
