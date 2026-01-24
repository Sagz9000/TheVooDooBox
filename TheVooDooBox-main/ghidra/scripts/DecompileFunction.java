import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.Function;
import ghidra.program.model.address.Address;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.util.HashMap;
import java.util.Map;

public class DecompileFunction extends GhidraScript {

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2) {
            println("Usage: DecompileFunction <output_file> <address>");
            return;
        }
        String outputPath = args[0];
        String addressStr = args[1];

        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        try {
            Address funcAddr = currentProgram.getAddressFactory().getAddress(addressStr);
            Function func = currentProgram.getFunctionManager().getFunctionContaining(funcAddr);

            if (func == null) {
                Map<String, String> err = new HashMap<>();
                err.put("error", "Function not found at " + addressStr);
                try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                    gson.toJson(err, writer);
                }
                return;
            }

            DecompInterface decomplib = new DecompInterface();
            decomplib.openProgram(currentProgram);

            DecompileResults res = decomplib.decompileFunction(func, 60, monitor);

            Map<String, String> root = new HashMap<>();
            if (res.decompileCompleted()) {
                root.put("name", func.getName());
                root.put("code", res.getDecompiledFunction().getC());
            } else {
                root.put("error", "Decompilation Failed: " + res.getErrorMessage());
            }

            try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                gson.toJson(root, writer);
            }
            println("JSON written to " + outputPath);

            decomplib.dispose();
        } catch (Exception e) {
            Map<String, String> err = new HashMap<>();
            err.put("error", e.toString());
            try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                 gson.toJson(err, writer);
            }
        }
    }
}
