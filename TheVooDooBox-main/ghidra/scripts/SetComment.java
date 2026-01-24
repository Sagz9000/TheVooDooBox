import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import java.util.Map;
import java.util.HashMap;
import java.io.FileWriter;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

public class SetComment extends GhidraScript {

    private String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
    }

    @Override
    @SuppressWarnings({"deprecation", "removal"})
    public void run() throws Exception {
        String[] args = getScriptArgs();
        
        if (args.length < 3) {
            println("Usage: SetComment <output_file> <address> <comment> [type]");
            return;
        }
        String outputPath = args[0];

        try {
            String addressStr = args[1];
            String comment = args[2];
            String type = (args.length > 3) ? args[3].toLowerCase() : "plate";

            Address addr = currentProgram.getAddressFactory().getAddress(addressStr);
            if (addr == null) {
                printError(outputPath, "Invalid address: " + addressStr);
                return;
            }

            int tx = currentProgram.startTransaction("Set Comment");
            boolean success = false;
            try {
                // EOL=0, PRE=1, POST=2, PLATE=3
                int commentType = 3; // PLATE
                if (type.equals("plate")) {
                    commentType = 3;
                } else if (type.equals("pre")) {
                    commentType = 1;
                } else if (type.equals("post")) {
                    commentType = 2;
                } else if (type.equals("eol")) {
                    commentType = 0;
                } else {
                    printError(outputPath, "Invalid comment type: " + type);
                    return;
                }
                
                currentProgram.getListing().setComment(addr, commentType, comment);
                success = true;
                
                Gson gson = new GsonBuilder().setPrettyPrinting().create();
                Map<String, String> res = new HashMap<>();
                res.put("status", "success");
                res.put("address", addressStr);
                res.put("type", type);
                
                try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                    gson.toJson(res, writer);
                }
                println("JSON written to " + outputPath);

            } catch (Exception e) {
                printError(outputPath, "Error setting comment: " + e.getMessage());
            } finally {
                currentProgram.endTransaction(tx, success);
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
        } catch(Exception e) {
            println("Failed to write error to file: " + e.getMessage());
        }
    }
}
