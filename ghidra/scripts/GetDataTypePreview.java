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
//Export Data Type Preview
//@category AI

import ghidra.app.script.GhidraScript;
import ghidra.program.model.data.DataType;
import ghidra.program.model.data.DataTypeManager;
import ghidra.program.model.data.Structure;
import ghidra.program.model.data.Union;
import ghidra.program.model.data.Enum;
import ghidra.program.model.data.DataTypeComponent;
import ghidra.program.model.data.TypeDef;
import ghidra.program.model.data.Pointer;
import ghidra.program.model.data.Array;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Iterator;

public class GetDataTypePreview extends GhidraScript {

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        println("GetDataTypePreview Started.");
        if (args.length < 2) {
            println("Usage: GetDataTypePreview <output_file> <type_name> [category_path]");
            return;
        }
        String outputPath = args[0];
        String typeName = args[1];
        String categoryPath = args.length > 2 ? args[2] : "";

        println("Output Path: " + outputPath);
        println("Target Type: " + typeName);
        println("Category Filter: " + categoryPath);

        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        try {
            DataTypeManager dtm = currentProgram.getDataTypeManager();
            DataType targetType = null;
            DataType candidateType = null;

            Iterator<DataType> all = dtm.getAllDataTypes();
            println("Scanning data types...");
            int count = 0;
            while(all.hasNext()) {
                DataType dt = all.next();
                if (dt.getName().equals(typeName)) {
                     // println("Found candidate: " + dt.getName() + " in " + dt.getCategoryPath().getPath());
                     
                     // If we have a category filter, check it
                     if (categoryPath != null && !categoryPath.isEmpty() && !categoryPath.equals("/")) {
                         String dtPath = dt.getCategoryPath().getPath();
                         if (dtPath.contains(categoryPath)) {
                             targetType = dt;
                             println("Exact match found: " + dtPath);
                             break;
                         } else {
                             // Keep as candidate if we don't find a better one
                             if (candidateType == null) candidateType = dt;
                         }
                     } else {
                         // No filter, take first
                         targetType = dt;
                         break;
                     }
                }
                count++;
            }
            
            if (targetType == null) {
                if (candidateType != null) {
                    println("Exact category match not found, using candidate from: " + candidateType.getCategoryPath().getPath());
                    targetType = candidateType;
                } else {
                    throw new Exception("Data type '" + typeName + "' not found after scanning " + count + " types.");
                }
            }

            // 2. Generate Preview
            println("Generating preview...");
            String preview = generatePreview(targetType);
            
            Map<String, String> result = new HashMap<>();
            result.put("name", targetType.getName());
            result.put("preview", preview);

            println("Writing to file: " + outputPath);
            try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                gson.toJson(result, writer);
            }
            println("JSON written successfully.");

        } catch (Exception e) {
             println("ERROR: " + e.toString());
             Map<String, String> err = new HashMap<>();
             err.put("error", e.toString());
             try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                 gson.toJson(err, writer);
             } catch (Exception writeEx) {
                 println("CRITICAL: Failed to write error to file: " + writeEx.toString());
             }
        }
    }

    private String generatePreview(DataType dt) {
        StringBuilder sb = new StringBuilder();
        
        if (dt instanceof Structure) {
            Structure struct = (Structure) dt;
            sb.append("struct ").append(struct.getName()).append(" {\n");
            sb.append("    // Total Size: ").append(struct.getLength()).append(" bytes\n");
            
            DataTypeComponent[] comps = struct.getDefinedComponents();
            for (DataTypeComponent comp : comps) {
                sb.append("    ");
                DataType fieldType = comp.getDataType();
                String fieldName = comp.getFieldName();
                if (fieldName == null) fieldName = "field_" + Integer.toHexString(comp.getOffset());
                
                sb.append(fieldType.getDisplayName()).append(" ");
                sb.append(fieldName).append(";\n"); 
            }
            sb.append("};");
        } else if (dt instanceof Union) {
            Union union = (Union) dt;
            sb.append("union ").append(union.getName()).append(" {\n");
             DataTypeComponent[] comps = union.getComponents();
             for (DataTypeComponent comp : comps) {
                sb.append("    ");
                DataType fieldType = comp.getDataType();
                String fieldName = comp.getFieldName();
                if (fieldName == null) fieldName = "field_" + Integer.toHexString(comp.getOffset());
                sb.append(fieldType.getDisplayName()).append(" ").append(fieldName).append(";\n");
             }
            sb.append("};");
        } else if (dt instanceof Enum) {
            Enum en = (Enum) dt;
            sb.append("enum ").append(en.getName()).append(" {\n");
            long[] values = en.getValues();
            for(long v : values) {
                 sb.append("    ").append(en.getName(v)).append(" = ").append(v).append(",\n");
            }
            sb.append("};");
        } else if (dt instanceof TypeDef) {
            TypeDef td = (TypeDef) dt;
            sb.append("typedef ").append(td.getDataType().getDisplayName()).append(" ").append(td.getName()).append(";");
        } else {
            // Primitive or other
            sb.append("// ").append(dt.getDisplayName()).append("\n");
            sb.append("// Size: ").append(dt.getLength()).append(" bytes\n");
            sb.append("// Path: ").append(dt.getCategoryPath().getPath());
        }
        
        return sb.toString();
    }
}
