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
//Export XRefs
//@category AI

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.symbol.ReferenceManager;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class GetXRefs extends GhidraScript {

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2) {
            println("Usage: GetXRefs <output_file> <address>");
            return;
        }
        String outputPath = args[0];
        String addressStr = args[1];

        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        try {
            Address addr = currentProgram.getAddressFactory().getAddress(addressStr);
            if (addr == null) {
                 Map<String, String> err = new HashMap<>();
                 err.put("error", "Invalid address");
                 try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                     gson.toJson(err, writer);
                 }
                 return;
            }

            List<Map<String, String>> xrefsList = new ArrayList<>();
            ReferenceManager rm = currentProgram.getReferenceManager();
            ReferenceIterator it = rm.getReferencesTo(addr);
            
            int count = 0;
            while(it.hasNext() && count < 200) {
                 Reference ref = it.next();
                 Map<String, String> xObj = new HashMap<>();
                 xObj.put("from", ref.getFromAddress().toString());
                 xObj.put("type", ref.getReferenceType().toString());
                 xObj.put("isPrimary", Boolean.toString(ref.isPrimary()));
                 
                 xrefsList.add(xObj);
                 count++;
            }

            try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                gson.toJson(xrefsList, writer);
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
