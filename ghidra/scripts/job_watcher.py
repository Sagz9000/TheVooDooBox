import time
import os
import json
import subprocess
import shutil
import requests

PENDING_DIR = "/ghidra/jobs/pending"
PROCESSING_DIR = "/ghidra/jobs/processing"
COMPLETED_DIR = "/ghidra/jobs/completed"
FAILED_DIR = "/ghidra/jobs/failed"
LOG_FILE = "/ghidra/jobs/watcher.log"
GHIDRA_HOME = "/ghidra"
HEADLESS_SCRIPT = os.path.join(GHIDRA_HOME, "support", "analyzeHeadless")

def log_to_file(message):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    full_message = f"[{timestamp}] {message}"
    print(full_message)
    with open(LOG_FILE, "a") as f:
        f.write(full_message + "\n")

def ensure_dirs():
    for d in [PENDING_DIR, PROCESSING_DIR, COMPLETED_DIR, FAILED_DIR]:
        if not os.path.exists(d):
            os.makedirs(d)

def process_job(job_file):
    job_path = os.path.join(PENDING_DIR, job_file)
    processing_path = os.path.join(PROCESSING_DIR, job_file)
    
    # Move to processing
    shutil.move(job_path, processing_path)
    
    try:
        with open(processing_path, 'r') as f:
            job = json.load(f)
            
        log_to_file(f"Processing Job: {job}")
        
        project_name = job.get('project_name')
        file_path = job.get('file_path') 
        is_new = job.get('is_new', False)
        
        # Construct Headless Command
        # analyzeHeadless <project_location> <project_name> -import <file> [-createProject]
        
        cmd = [
            HEADLESS_SCRIPT,
            "/ghidra/projects",
            project_name
        ]
        
        # if is_new:
        #    cmd.append("-createProject")
           
        cmd.extend(["-import", file_path])
        
        log_to_file(f"Running Command: {' '.join(cmd)}")
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            log_to_file("Headless Analysis Successful. Starting Export...")
            
            # 2. Run Export Script
            # Use -process since the file is now imported in the project
            export_cmd = [
                HEADLESS_SCRIPT,
                "/ghidra/projects",
                project_name,
                "-process", os.path.basename(file_path),
                "-scriptPath", "/ghidra/scripts",
                "-postScript", "FunctionExport.java",
                "-noanalysis"
            ]
            
            log_to_file(f"Running Export: {' '.join(export_cmd)}")
            export_result = subprocess.run(export_cmd, capture_output=True, text=True)
            
            if export_result.returncode == 0:
                log_to_file("Export Successful. Sending to API...")
                log_to_file(f"Export STDOUT: {export_result.stdout}")
                
                # 3. Read and Send Data
                export_path = "/ghidra/jobs/export.json"
                if os.path.exists(export_path):
                    with open(export_path, 'r') as f:
                        export_data = json.load(f)
                    
                    try:
                        # re-api is at http://re-api:8000 inside the network
                        api_res = requests.post("http://re-api:8000/ingest/binary", json=export_data)
                        log_to_file(f"API Ingestion Response: {api_res.status_code}")
                    except Exception as e:
                        log_to_file(f"API Ingestion Failed: {e}")
                
                log_to_file("Job Completed Successfully")
                shutil.move(processing_path, os.path.join(COMPLETED_DIR, job_file))
            else:
                log_to_file(f"Export Failed: {export_result.stderr}")
                shutil.move(processing_path, os.path.join(FAILED_DIR, job_file))
        else:
            log_to_file(f"Job Failed with code {result.returncode}")
            log_to_file(f"STDOUT: {result.stdout}")
            log_to_file(f"STDERR: {result.stderr}")
            shutil.move(processing_path, os.path.join(FAILED_DIR, job_file))
            
    except Exception as e:
        log_to_file(f"Critical Error: {e}")
        if os.path.exists(processing_path):
             shutil.move(processing_path, os.path.join(FAILED_DIR, job_file))

def main():
    log_to_file("Starting Ghidra Job Watcher...")
    ensure_dirs()
    
    while True:
        pending_jobs = [f for f in os.listdir(PENDING_DIR) if f.endswith('.json')]
        
        if pending_jobs:
            for job in pending_jobs:
                process_job(job)
        
        time.sleep(2)

if __name__ == "__main__":
    main()
