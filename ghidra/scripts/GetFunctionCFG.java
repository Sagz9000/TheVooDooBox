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
//Export Function CFG
//@category AI

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.block.BasicBlockModel;
import ghidra.program.model.block.CodeBlock;
import ghidra.program.model.block.CodeBlockIterator;
import ghidra.program.model.block.CodeBlockReference;
import ghidra.program.model.block.CodeBlockReferenceIterator;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class GetFunctionCFG extends GhidraScript {

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2) {
             println("Usage: GetFunctionCFG <output_file> <address>");
             return;
        }
        String outputPath = args[0];
        String addressStr = args[1];

        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        try {
            Address addr = currentProgram.getAddressFactory().getAddress(addressStr);
            Function func = currentProgram.getFunctionManager().getFunctionContaining(addr);
            
            if (func == null) {
                 Map<String, String> err = new HashMap<>();
                 err.put("error", "Function not found");
                 try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                     gson.toJson(err, writer);
                 }
                 return;
            }

            BasicBlockModel model = new BasicBlockModel(currentProgram);
            CodeBlockIterator iterator = model.getCodeBlocksContaining(func.getBody(), monitor);
            
            Map<String, Object> cfg = new HashMap<>();
            List<Map<String, Object>> blocks = new ArrayList<>();
            List<Map<String, String>> edges = new ArrayList<>();
            
            ghidra.program.model.listing.Listing listing = currentProgram.getListing();
            
            while(iterator.hasNext()) {
                CodeBlock block = iterator.next();
                Map<String, Object> bObj = new HashMap<>();
                String startAddr = block.getFirstStartAddress().toString();
                bObj.put("id", startAddr); // Use start address as ID
                bObj.put("start", startAddr);
                bObj.put("end", block.getFirstStartAddress().add(block.getNumAddresses()).toString());
                
                // Get instructions
                List<String> instrs = new ArrayList<>();
                ghidra.program.model.listing.InstructionIterator instIt = listing.getInstructions(block, true);
                while(instIt.hasNext()) {
                    ghidra.program.model.listing.Instruction inst = instIt.next();
                    instrs.add(inst.toString());
                }
                bObj.put("instructions", instrs);
                
                blocks.add(bObj);
                
                CodeBlockReferenceIterator refIt = block.getDestinations(monitor);
                while(refIt.hasNext()) {
                    CodeBlockReference ref = refIt.next();
                    Map<String, String> eObj = new HashMap<>();
                    eObj.put("from", startAddr);
                    eObj.put("to", ref.getDestinationAddress().toString());
                    eObj.put("type", ref.getFlowType().toString());
                    edges.add(eObj);
                }
            }
            

            
            cfg.put("name", func.getName());
            cfg.put("entry", func.getEntryPoint().toString());
            cfg.put("blocks", blocks);
            cfg.put("edges", edges);

            try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                gson.toJson(cfg, writer);
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
