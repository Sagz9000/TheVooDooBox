import ghidra.app.script.GhidraScript;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.data.DataTypeManager;
import ghidra.program.model.data.DataType;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.listing.Data;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.util.Iterator;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class GetMemoryBlocks extends GhidraScript {

    // Helper method to get permissions string
    private String getPermissions(MemoryBlock block) {
        String perms = "";
        if (block.isRead()) perms += "R";
        if (block.isWrite()) perms += "W";
        if (block.isExecute()) perms += "X";
        return perms;
    }

    @Override
    @SuppressWarnings({"deprecation", "removal"})
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1) {
            println("Usage: GetMemoryBlocks <output_file>");
            return;
        }
        String outputPath = args[0];

        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        try {
            List<Map<String, Object>> blockList = new ArrayList<>();
            Memory memory = currentProgram.getMemory();
            MemoryBlock[] blocks = memory.getBlocks();

            for (MemoryBlock block : blocks) {
                Map<String, Object> map = new HashMap<>();
                map.put("name", block.getName());
                map.put("start", block.getStart().toString());
                map.put("end", block.getEnd().toString());
                map.put("size", block.getSize());
                map.put("perms", getPermissions(block)); // Using name 'perms' to match frontend interface
                map.put("type", block.getType().toString());
                
                blockList.add(map);
            }
            // Add blockList to root map if needed, but the current structure implies a List<Map> is the root object being serialized.
            // Wait, looking at lines 39-50, we are building a blockList.
            // But lines 52-61 seem to be remnants of another script (GetSymbols or similar) that were accidentally pasted.
            // Lines 63-72 also look like partial copy-paste from GetDataTypes or similar.
            
            // The original intent of GetMemoryBlocks was just to output memory blocks.
            // I will remove the malformed/extra code blocks and just output the blockList as intended.
            
            try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                gson.toJson(blockList, writer);
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
