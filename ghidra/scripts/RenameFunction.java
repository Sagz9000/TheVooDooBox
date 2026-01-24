import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;
import ghidra.util.exception.DuplicateNameException;
import ghidra.util.exception.InvalidInputException;
import ghidra.program.model.address.Address;
import java.util.Map;
import java.util.HashMap;
import java.io.FileWriter;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

public class RenameFunction extends GhidraScript {

    private String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
    }

    @Override
    @SuppressWarnings({"deprecation", "removal"})
    public void run() throws Exception {
        String[] args = getScriptArgs();
        
        if (args.length < 3) {
            // Usage: <output> <oldName|address> <newName>
            // We can't easily print to file if we don't have the file arg, so we just return
             println("Usage: RenameFunction <output_file> <oldName|address> <newName>");
             return;
        }
        
        String outputPath = args[0];

        try {
            String target = args[1];
            String newName = args[2];
            boolean found = false;
            String realOldName = target;
            
            int tx = currentProgram.startTransaction("Rename Function");
            try {
                // 1. Try Address directly
                try {
                    Address addr = currentProgram.getAddressFactory().getAddress(target);
                    Function func = currentProgram.getFunctionManager().getFunctionAt(addr);
                    if (func != null) {
                       realOldName = func.getName();
                       func.setName(newName, SourceType.USER_DEFINED);
                       found = true;
                    }
                } catch (Exception e) {}

                // 2. Try Name lookup
                if (!found) {
                    for (Function func : currentProgram.getFunctionManager().getFunctions(true)) {
                        if (func.getName().equals(target)) {
                            realOldName = func.getName();
                            func.setName(newName, SourceType.USER_DEFINED);
                            found = true;
                            break;
                        }
                    }
                }
                
                Gson gson = new GsonBuilder().setPrettyPrinting().create();

                if (found) {
                    Map<String, String> res = new HashMap<>();
                    res.put("status", "success");
                    res.put("old_name", realOldName);
                    res.put("new_name", newName);
                    
                    try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                        gson.toJson(res, writer);
                    }
                    println("JSON written to " + outputPath);
                } else {
                     printError(outputPath, "Function not found: " + target);
                }

            } catch (DuplicateNameException e) {
                printError(outputPath, "Duplicate name: " + newName);
            } catch (InvalidInputException e) {
                 printError(outputPath, "Invalid name: " + newName);
            } catch (Exception e) {
                 printError(outputPath, "Error renaming: " + e.getMessage());
            } finally {
                currentProgram.endTransaction(tx, found);
            }
        } catch (Exception e) {
             printError(outputPath, "Critical error: " + e.getMessage());
        }
    }

    private void printError(String outputPath, String msg) {
        try {
            Gson gson = new GsonBuilder().setPrettyPrinting().create();
            Map<String, String> err = new HashMap<>();
            err.put("error", msg);
            try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                gson.toJson(err, writer);
            }
        } catch (Exception e) {
            println("Failed to write error to file: " + e.getMessage());
        }
    }
}
