//Export functions to JSON
//@author re-Brain
//@category Analysis
//@keybinding
//@menupath
//@toolbar

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import java.io.FileWriter;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

public class FunctionExport extends GhidraScript {
    @Override
    public void run() throws Exception {
        if (currentProgram == null) {
            println("No current program.");
            return;
        }

        FunctionManager fm = currentProgram.getFunctionManager();
        JsonObject exportData = new JsonObject();
        exportData.addProperty("project", currentProgram.getDomainFile().getProjectLocator().getName());
        exportData.addProperty("binary", currentProgram.getName());
        
        JsonArray functions = new JsonArray();
        for (Function f : fm.getFunctions(true)) {
            JsonObject funcInfo = new JsonObject();
            funcInfo.addProperty("name", f.getName());
            funcInfo.addProperty("address", f.getEntryPoint().toString());
            funcInfo.addProperty("signature", f.getPrototypeString(true, true));
            if (f.getComment() != null) {
                funcInfo.addProperty("comment", f.getComment());
            }
            functions.add(funcInfo);
        }
        exportData.add("functions", functions);
        
        String exportPath = "/ghidra/jobs/export.json";
        try (FileWriter writer = new FileWriter(exportPath)) {
            new GsonBuilder().setPrettyPrinting().create().toJson(exportData, writer);
        }
        println("Successfully exported " + functions.size() + " functions to " + exportPath);
    }
}
