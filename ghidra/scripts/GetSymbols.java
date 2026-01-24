import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolType;
import ghidra.program.model.symbol.SymbolIterator;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.util.Iterator;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.io.FileWriter; // Added import for FileWriter

public class GetSymbols extends GhidraScript {

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1) {
            println("Usage: GetSymbols <output_file>");
            return;
        }
        String outputPath = args[0];

        Gson gson = new GsonBuilder().setPrettyPrinting().create(); // Changed to setPrettyPrinting
        try {
            Map<String, Object> root = new HashMap<>();

            // 1. Functions
            List<Map<String, Object>> funcList = new ArrayList<>();
            FunctionManager fm = currentProgram.getFunctionManager();
            Iterator<Function> functions = fm.getFunctions(true);
            int count = 0;
            while (functions.hasNext() && count < 200) {
                Function func = functions.next();
                Map<String, Object> fObj = new HashMap<>();
                fObj.put("name", func.getName());
                fObj.put("address", func.getEntryPoint().toString());
                fObj.put("size", func.getBody().getNumAddresses());
                funcList.add(fObj);
                count++;
            }
            root.put("functions", funcList);

            // 2. Imports
            List<Map<String, Object>> importList = new ArrayList<>(); // Changed name from impList to importList
            SymbolIterator extSyms = currentProgram.getSymbolTable().getExternalSymbols();
            count = 0;
            while (extSyms.hasNext() && count < 200) {
                 Symbol s = extSyms.next(); // Changed sym to s
                 Map<String, Object> iObj = new HashMap<>();
                 iObj.put("name", s.getName());
                 iObj.put("address", s.getAddress().toString());
                 importList.add(iObj);
                 count++;
            }
            root.put("imports", importList); // Changed name from impList to importList

            // 3. Exports
            List<Map<String, Object>> exportList = new ArrayList<>(); // Changed name from expList to exportList
            SymbolIterator definedSyms = currentProgram.getSymbolTable().getDefinedSymbols(); // Changed to getDefinedSymbols
            count = 0;
            while (definedSyms.hasNext() && count < 200) { // Changed count limit to 200
                Symbol s = definedSyms.next(); // Changed sym to s
                if (s.isExternal()) continue; // Added condition
                if (s.getSymbolType() == SymbolType.FUNCTION) continue; // Already handled, added condition
                
                if (s.isGlobal()) { // Simplified condition
                     Map<String, Object> eObj = new HashMap<>();
                     eObj.put("name", s.getName());
                     eObj.put("address", s.getAddress().toString());
                     eObj.put("type", s.getSymbolType().toString()); // Added type
                     exportList.add(eObj);
                     count++;
                }
            }
            root.put("exports", exportList); // Changed name from expList to exportList

            // Write to file
            try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                gson.toJson(root, writer);
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
