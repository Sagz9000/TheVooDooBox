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
//Scan for Cipher/Obfuscation Logic
//@category AI

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import java.util.Arrays;

public class CipherScan extends GhidraScript {

    private static final Set<String> BITWISE_OPS = new HashSet<>(Arrays.asList(
        "XOR", "SHL", "SHR", "ROL", "ROR", "AND", "OR", "SAR"
    ));

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1) {
             println("Usage: CipherScan <output_file>");
             return;
        }
        String outputPath = args[0];
        
        DecompInterface ifc = new DecompInterface();
        ifc.openProgram(currentProgram);

        FunctionIterator functions = currentProgram.getFunctionManager().getFunctions(true);
        List<Map<String, Object>> suspiciousFunctions = new ArrayList<>();

        monitor.setMessage("Scanning for Ciphers...");
        int count = 0;
        
        while (functions.hasNext() && !monitor.isCancelled()) {
            Function func = functions.next();
            // Basic filtering
            if (func.getBody().getNumAddresses() < 20) continue; // Too small

            int bitwiseCount = 0;
            int totalCount = 0;
            
            InstructionIterator instructions = currentProgram.getListing().getInstructions(func.getBody(), true);
            while (instructions.hasNext()) {
                Instruction instr = instructions.next();
                String mnemonic = instr.getMnemonicString().toUpperCase();
                if (BITWISE_OPS.contains(mnemonic)) {
                    bitwiseCount++;
                }
                totalCount++;
            }

            if (totalCount == 0) continue;

            double ratio = (double) bitwiseCount / totalCount;
            // Heuristic: > 5% bitwise ops OR > 10 raw bitwise ops (loose filter)
            // We want to catch things like RC4 key scheduling or XOR loops.
            if (ratio > 0.05 || bitwiseCount > 10) {
                DecompileResults res = ifc.decompileFunction(func, 30, monitor);
                if (res != null && res.decompileCompleted()) {
                    Map<String, Object> data = new HashMap<>();
                    data.put("name", func.getName());
                    data.put("address", func.getEntryPoint().toString());
                    data.put("score", bitwiseCount); // Use raw count as simple score for now
                    data.put("ratio", ratio);
                    data.put("code", res.getDecompiledFunction().getC());
                    suspiciousFunctions.add(data);
                }
            }
            
            count++;
            if (count % 50 == 0) {
                monitor.setMessage("Scanned " + count + " functions...");
            }
        }

        // Sort by score (descending) and take top 10 to avoid overloading AI
        suspiciousFunctions.sort((a, b) -> Integer.compare((int)b.get("score"), (int)a.get("score")));
        List<Map<String, Object>> topResults = suspiciousFunctions.subList(0, Math.min(suspiciousFunctions.size(), 10));

        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
            gson.toJson(topResults, writer);
        }
        println("JSON written to " + outputPath);
    }
}
