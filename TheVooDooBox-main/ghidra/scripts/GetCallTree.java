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
//Export Call Tree
//@category AI

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class GetCallTree extends GhidraScript {

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1) {
            println("Usage: GetCallTree <output_file>");
            return;
        }
        String outputPath = args[0];

        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        try {
            List<Map<String, Object>> tree = new ArrayList<>();
            FunctionManager fm = currentProgram.getFunctionManager();
            Iterator<Function> functions = fm.getFunctions(true);
            
            int count = 0;
            while(functions.hasNext() && count < 200) {
                 Function func = functions.next();
                 Map<String, Object> fObj = new HashMap<>();
                 fObj.put("name", func.getName());
                 fObj.put("address", func.getEntryPoint().toString());
                 
                 Set<Function> called = func.getCalledFunctions(monitor);
                 List<Map<String, String>> calls = new ArrayList<>();
                 for (Function c : called) {
                     Map<String, String> cObj = new HashMap<>();
                     cObj.put("name", c.getName());
                     cObj.put("address", c.getEntryPoint().toString());
                     calls.add(cObj);
                 }
                 fObj.put("calls", calls);
                 
                 tree.add(fObj);
                 count++;
            }

            try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                gson.toJson(tree, writer);
            }
            println("JSON written to " + outputPath);
        } catch (Exception e) {
            Map<String, String> err = new HashMap<>();
            err.put("error", e.toString());
            try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                 gson.toJson(err, writer);
            }
        }
    }
}
