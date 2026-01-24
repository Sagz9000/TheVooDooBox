# Export Ghidra functions to JSON for AI Ingestion
# @author re-Brain
# @category Analysis
# @keybinding 
# @menupath 
# @toolbar 

import json
import os
import json
import os
# from ghidra.app.util.headless import HeadlessAnalyzer

def run():
    program = getCurrentProgram()
    fm = program.getFunctionManager()
    functions = fm.getFunctions(True) # True for forward iteration
    
    export_data = {
        "project": program.getDomainFile().getProjectLocator().getName(),
        "binary": program.getName(),
        "functions": []
    }
    
    for f in functions:
        func_info = {
            "name": f.getName(),
            "address": f.getEntryPoint().toString(),
            "signature": f.getPrototypeString(True, True),
            "comment": f.getComment()
        }
        export_data["functions"].append(func_info)
        
    # Standard export path for the watcher to pick up
    export_path = "/ghidra/jobs/export.json"
    with open(export_path, "w") as f:
        json.dump(export_data, f, indent=2)
    
    print("Successfully exported {} functions to {}".format(len(export_data["functions"]), export_path))

if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Export Script Error: {e}")
