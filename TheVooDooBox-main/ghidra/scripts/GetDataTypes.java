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
//Export Data Types
//@category AI

import ghidra.app.script.GhidraScript;
import ghidra.program.model.data.DataType;
import ghidra.program.model.data.DataTypeManager;
import ghidra.program.model.data.Structure;
import ghidra.program.model.data.Union;
import ghidra.program.model.data.Category;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

public class GetDataTypes extends GhidraScript {

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1) {
            println("Usage: GetDataTypes <output_file>");
            return;
        }
        String outputPath = args[0];

        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        try {
            DataTypeManager dtm = currentProgram.getDataTypeManager();
            ghidra.program.model.data.Category rootCat = dtm.getRootCategory();
            
            Map<String, Object> rootMap = processCategory(rootCat);

            try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                gson.toJson(rootMap, writer);
            }
            println("JSON written to " + outputPath);
        } catch (Exception e) {
             // ... error handling ...
             Map<String, String> err = new HashMap<>();
             err.put("error", e.toString());
             try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                 gson.toJson(err, writer);
             }
        }
    }

    private Map<String, Object> processCategory(ghidra.program.model.data.Category cat) {
        Map<String, Object> map = new HashMap<>();
        map.put("name", cat.getName());
        
        List<Map<String, Object>> types = new ArrayList<>();
        ghidra.program.model.data.DataType[] dts = cat.getDataTypes();
        for (ghidra.program.model.data.DataType dt : dts) {
            Map<String, Object> tObj = new HashMap<>();
            tObj.put("name", dt.getName());
            tObj.put("size", dt.getLength());
            types.add(tObj);
        }
        map.put("types", types);
        
        List<Map<String, Object>> subs = new ArrayList<>();
        ghidra.program.model.data.Category[] subCats = cat.getCategories();
        for (ghidra.program.model.data.Category sc : subCats) {
             subs.add(processCategory(sc));
        }
        map.put("subcategories", subs);
        
        return map;
}
}
