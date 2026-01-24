/* ###
 * IP: GHIDRA
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *      http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
//Batch Decompile all functions and export as JSON
//@category AI

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Program;
import ghidra.util.task.TaskMonitor;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class BatchDecompile extends GhidraScript {

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1) {
            println("Usage: BatchDecompile <output_file>");
            return;
        }
        String outputPath = args[0];
        
        DecompInterface ifc = new DecompInterface();
        ifc.openProgram(currentProgram);

        FunctionIterator functions = currentProgram.getFunctionManager().getFunctions(true);
        List<Map<String, String>> exportList = new ArrayList<>();

        monitor.setMessage("Batch Decompiling...");
        int count = 0;
        
        while (functions.hasNext() && !monitor.isCancelled()) {
            Function func = functions.next();
            
            // Filter out small thunks if needed, or keeping all for now
            // if (func.isThunk()) continue;

            DecompileResults res = ifc.decompileFunction(func, 60, monitor);
            if (res != null && res.decompileCompleted()) {
                 Map<String, String> funcData = new HashMap<>();
                 funcData.put("name", func.getName());
                 funcData.put("address", func.getEntryPoint().toString());
                 funcData.put("code", res.getDecompiledFunction().getC());
                 exportList.add(funcData);
            }
            count++;
            if (count % 10 == 0) {
                monitor.setMessage("Decompiled " + count + " functions...");
            }
        }

        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
            gson.toJson(exportList, writer);
        }
        println("JSON written to " + outputPath);
    }
}
