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
//Batch Memory Analysis 
//@category AI

import ghidra.app.script.GhidraScript;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MemoryMapExport extends GhidraScript {

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1) {
            println("Usage: MemoryMapExport <output_file>");
            return;
        }
        String outputPath = args[0];
        
        Memory memory = currentProgram.getMemory();
        MemoryBlock[] blocks = memory.getBlocks();
        
        Map<String, Object> runData = new HashMap<>();
        List<Map<String, Object>> blockList = new ArrayList<>();
        
        // 1. Export Memory Blocks
        for (MemoryBlock block : blocks) {
            Map<String, Object> bData = new HashMap<>();
            bData.put("name", block.getName());
            bData.put("start", block.getStart().toString());
            bData.put("end", block.getEnd().toString());
            bData.put("size", block.getSize());
            bData.put("type", block.getType().toString());
            
            String perms = "";
            if (block.isRead()) perms += "R";
            if (block.isWrite()) perms += "W";
            if (block.isExecute()) perms += "X";
            bData.put("permissions", perms);
            
            blockList.add(bData);
        }
        runData.put("blocks", blockList);

        // 2. Export Defined Pointers (Sample)
        List<Map<String, String>> pointerList = new ArrayList<>();
        DataIterator dataIt = currentProgram.getListing().getDefinedData(true);
        int count = 0;
        
        while (dataIt.hasNext() && count < 200) { // Limit to 200 pointers
            Data d = dataIt.next();
            if (d.isPointer()) {
                Map<String, String> pData = new HashMap<>();
                pData.put("address", d.getAddress().toString());
                pData.put("label", d.getLabel());
                
                Object val = d.getValue();
                if (val != null) {
                    pData.put("target", val.toString());
                }
                pointerList.add(pData);
                count++;
            }
        }
        runData.put("pointers", pointerList);

        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
            gson.toJson(runData, writer);
        }
        println("JSON written to " + outputPath);
    }
}
