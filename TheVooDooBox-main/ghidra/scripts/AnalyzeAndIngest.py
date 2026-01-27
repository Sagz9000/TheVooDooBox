# AnalyzeAndIngest.py
# Decompiles all functions in the current program and sends them to the reAIghidra RAG API.
# @category AI_Analysis
# @keybinding 
# @menupath Tools.AI.Analyze and Ingest
# @toolbar 

import ghidra
from ghidra.app.decompiler import DecompInterface
from ghidra.util.task import ConsoleTaskMonitor
import json
import urllib2
import os

# Configuration
def get_api_urls():
    urls = []
    # 1. Try Docker Internal DNS first (most robust)
    urls.append("http://hyper-bridge:8080/ghidra/ingest")
    # 2. Try Host IP Fallback
    host_ip = os.getenv("HOST_IP", "hyper-bridge")
    if host_ip != "hyper-bridge":
        urls.append("http://{}:8080/ghidra/ingest".format(host_ip))
    return urls

API_URLS = get_api_urls()
TASK_ID = os.getenv("TASK_ID")

def get_decompiler_interface():
    di = DecompInterface()
    di.openProgram(currentProgram)
    return di

def send_to_api(payload):
    success = False
    errors = []
    
    # Add context
    payload["task_id"] = TASK_ID
    payload["binary_name"] = currentProgram.getName()

    for url in API_URLS:
        try:
            print("Attempting to send to: " + url)
            req = urllib2.Request(url)
            req.add_header('Content-Type', 'application/json')
            
            response = urllib2.urlopen(req, json.dumps(payload))
            print("Successfully sent batch to API (" + url + "): " + str(response.getcode()))
            success = True
            break
        except Exception as e:
            errors.append(str(e))
            print("Failed sending to " + url + ": " + str(e))
    
    if not success:
        print("CRITICAL: All API attempts failed. Errors: " + str(errors))

def analyze_and_ingest():
    print("Starting AI Ingestion for: " + currentProgram.getName() + " (Task: " + str(TASK_ID) + ")")
    
    di = get_decompiler_interface()
    monitor = ConsoleTaskMonitor()
    functions = currentProgram.getFunctionManager().getFunctions(True)
    
    batch = []
    batch_size = 10
    
    for func in functions:
        if monitor.isCancelled():
            break
            
        print("Processing: " + func.getName())
        
        # Decompile
        res = di.decompileFunction(func, 60, monitor)
        if not res.decompileCompleted():
            print("Failed to decompile: " + func.getName())
            continue
            
        decompiled_c = res.getDecompiledFunction().getC()
        
        # Get Assembly (Naive approach: iterate instructions)
        asm_lines = []
        inst = currentProgram.getListing().getInstructionAt(func.getEntryPoint())
        while inst is not None and func.getBody().contains(inst.getAddress()):
            asm_lines.append(str(inst))
            inst = inst.getNext()
            
        asm_content = "\n".join(asm_lines)
        
        func_data = {
            "function_name": func.getName(),
            "entry_point": str(func.getEntryPoint()),
            "decompiled_code": decompiled_c,
            "assembly": asm_content
        }
        
        batch.append(func_data)
        
        if len(batch) >= batch_size:
            send_to_api({"functions": batch})
            batch = []
            
    if len(batch) > 0:
        send_to_api({"functions": batch})
        
    # NEW: Send completion signal explicitly
    send_completion_signal()
        
    print("Ingestion Complete.")

def send_completion_signal():
    if not TASK_ID:
        print("No Task ID found, skipping completion signal.")
        return

    print("Sending Completion Signal for Task: " + str(TASK_ID))
    payload = {"task_id": TASK_ID}
    
    success = False
    for base_url in API_URLS:
        # API_URLS are like ".../ghidra/ingest"
        # We want ".../ghidra/ingest/complete"
        url = base_url + "/complete"
        try:
            print("Attempting to signal completion to: " + url)
            req = urllib2.Request(url)
            req.add_header('Content-Type', 'application/json')
            
            response = urllib2.urlopen(req, json.dumps(payload))
            print("Successfully signaled completion to API (" + url + "): " + str(response.getcode()))
            success = True
            break
        except Exception as e:
            print("Failed signaling completion to " + url + ": " + str(e))
            
    if not success:
        print("CRITICAL: Failed to signal completion to any endpoint.")

if __name__ == "__main__":
    analyze_and_ingest()
