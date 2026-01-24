//LiveBridge (Java Version)
//@category _ReBrain
//@menupath Tools.LiveBridge
//@keybinding ctrl shift L
//@toolbar
//@description A Native Java replacement for the Python LiveBridge. Listens on port 9999.

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.Map;
import java.util.Collections;
import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import ghidra.app.script.GhidraScript;
import ghidra.app.services.ProgramManager;
import ghidra.framework.model.DomainFile;
import ghidra.framework.model.DomainFolder;
import ghidra.framework.model.Project;
import ghidra.framework.model.ProjectData;
import ghidra.framework.model.ToolChest;
import ghidra.framework.model.ToolTemplate;
import ghidra.framework.plugintool.PluginTool;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.CodeUnit;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.listing.Program;
import ghidra.program.model.symbol.SourceType;
import ghidra.program.model.symbol.Symbol;
import ghidra.util.Swing;
import ghidra.util.task.TaskMonitor;
import ghidra.app.util.opinion.LoadResults;
import ghidra.app.util.opinion.Loaded;
import ghidra.app.plugin.core.analysis.AutoAnalysisManager;
import ghidra.framework.options.Options;


@SuppressWarnings({"deprecation", "removal"})
public class LiveBridge extends GhidraScript {

    private static final int PORT = 9999;
    private Gson gson = new Gson();

    @Override
    public void run() throws Exception {
        println("LiveBridge (Java): Initializing on port " + PORT + "...");
        
        try (ServerSocket serverSocket = new ServerSocket(PORT)) {
            // Allow address reuse if possible (Java ServerSocket defaults vary, but this is usually fine)
            // serverSocket.setReuseAddress(true); 

            println("Listening for connections...");

            while (!monitor.isCancelled()) {
                try {
                    Socket clientSocket = serverSocket.accept();
                    handleClient(clientSocket);
                } catch (Exception e) {
                    printerr("Connection error: " + e.getMessage());
                }
            }
        }
    }

    private void handleClient(Socket socket) {
        try (
            PrintWriter out = new PrintWriter(socket.getOutputStream(), true);
            BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream()))
        ) {
            String inputLine = in.readLine();
            if (inputLine != null) {
                // println("Received: " + inputLine);
                String result = processCommand(inputLine);
                out.print(result); // Don't use println if the client expects raw string without newline, or do. Python client expects raw.
                out.flush();
            }
        } catch (Exception e) {
            printerr("Handler error: " + e.getMessage());
        }
    }

    private String processCommand(String json) {
        try {
            Map<String, String> cmd = gson.fromJson(json, new TypeToken<Map<String, String>>(){}.getType());
            String action = cmd.get("action");
            
            println("Action: " + action);

            if ("rename".equals(action)) {
                return doRename(cmd);
            } else if ("comment".equals(action)) {
                return doComment(cmd);
            } else if ("goto".equals(action)) {
                return doGoto(cmd);
            } else if ("open_binary".equals(action)) {
                return doOpenBinary(cmd);
            } else if ("debug_binary".equals(action)) {
                return doDebugBinary(cmd);
            } else {
                return "Unknown action: " + action;
            }

        } catch (Exception e) {
            e.printStackTrace();
            return "Error: " + e.getMessage();
        }
    }

    private String doRename(Map<String, String> cmd) {
        String addrStr = cmd.get("address");
        String name = cmd.get("name");
        
        Swing.runLater(() -> {
            try {
                // Refresh current program from tool
                ProgramManager pm = state.getTool().getService(ProgramManager.class);
                Program p = pm.getCurrentProgram();
                if (p != null) currentProgram = p;
                
                if (currentProgram == null) {
                    printerr("Rename failed: No program active");
                    return;
                }

                Address addr = toAddr(addrStr);
                if (addr == null) {
                    printerr("Rename failed: Invalid address " + addrStr);
                    return;
                }

                int txId = currentProgram.startTransaction("Rename Symbol");
                try {
                    Symbol sym = getSymbolAt(addr);
                    if (sym != null) {
                        sym.setName(name, SourceType.USER_DEFINED);
                        println("Renamed " + addrStr + " -> " + name);
                    } else {
                        createLabel(addr, name, true);
                        println("Created label " + name + " @ " + addrStr);
                    }
                } finally {
                    currentProgram.endTransaction(txId, true);
                }
            } catch (Exception e) {
                printerr("Rename failed: " + e.getMessage());
                e.printStackTrace();
            }
        });
        return "OK";
    }

    private String doComment(Map<String, String> cmd) {
        String addrStr = cmd.get("address");
        String comment = cmd.get("comment");
        String type = cmd.getOrDefault("type", "plate");

        Swing.runLater(() -> {
            try {
                // Refresh current program from tool
                ProgramManager pm = state.getTool().getService(ProgramManager.class);
                Program p = pm.getCurrentProgram();
                if (p != null) currentProgram = p;

                if (currentProgram == null) {
                     printerr("Comment failed: No program active");
                     return;
                }

                Address addr = toAddr(addrStr);
                if (addr == null) {
                    printerr("Comment failed: Invalid address " + addrStr);
                    return;
                }

                int txId = currentProgram.startTransaction("Set Comment");
                try {
                    Listing listing = currentProgram.getListing();
                    int commentType = CodeUnit.PLATE_COMMENT;
                    if ("eol".equals(type)) commentType = CodeUnit.EOL_COMMENT;
                    else if ("pre".equals(type)) commentType = CodeUnit.PRE_COMMENT;
                    
                    listing.setComment(addr, commentType, comment);
                    println("Comment added @ " + addrStr);
                } finally {
                    currentProgram.endTransaction(txId, true);
                }
            } catch (Exception e) {
                printerr("Comment failed: " + e.getMessage());
                e.printStackTrace();
            }
        });
        return "OK";
    }

    private String doGoto(Map<String, String> cmd) {
        String addrStr = cmd.get("address");
        Swing.runLater(() -> {
            try {
                // Refresh current program from tool
                ProgramManager pm = state.getTool().getService(ProgramManager.class);
                Program p = pm.getCurrentProgram();
                if (p != null) currentProgram = p;
                
                if (currentProgram == null) {
                    printerr("Goto failed: No program active");
                    return;
                }

                Address addr = toAddr(addrStr);
                if (addr == null) {
                    printerr("Goto failed: Invalid address " + addrStr);
                    return;
                }
                goTo(addr);
            } catch (Exception e) { 
                printerr("Goto failed: " + e.getMessage());
                e.printStackTrace();
            }
        });
        return "OK";
    }

    private String doOpenBinary(Map<String, String> cmd) {
        String binaryName = cmd.get("binary");
        
        try {
            Project project = state.getProject();
            if (project == null) return "No project open";

            ProjectData projectData = project.getProjectData();
            DomainFolder root = projectData.getRootFolder();
            DomainFile file = root.getFile(binaryName);
            
            if (file == null) {
                // Try to import from /ghidra/binaries
                java.io.File rawFile = new java.io.File("/ghidra/binaries/" + binaryName);
                if (rawFile.exists()) {
                    println("Binary not in project. Importing from disk: " + rawFile.getAbsolutePath());
                    Swing.runLater(() -> {
                        try {
                             LoadResults<Program> results = ghidra.app.util.importer.AutoImporter.importByUsingBestGuess(
                                 rawFile, 
                                 project, 
                                 root.getPathname(), // Destination folder path as String
                                 LiveBridge.this,    // Consumer (this script object)
                                 new ghidra.app.util.importer.MessageLog(), 
                                 TaskMonitor.DUMMY
                             );
                             
                             boolean found = false;
                             if (results != null) {
                                  for (Loaded<Program> loaded : results) {
                                      DomainFile newFile = loaded.getDomainObject().getDomainFile();
                                      println("Imported " + newFile.getName());
                                      openDomainFile(newFile);
                                      found = true;
                                      break; 
                                  }
                             }
                             
                             if (!found) {
                                 printerr("Import returned no files.");
                             }
                        } catch (Exception e) {
                             printerr("AutoImport failed: " + e.getMessage());
                             e.printStackTrace();
                        }
                    });
                    return "OK (Importing)";
                }
                return "Binary not found in project or disk: " + binaryName;
            }

            // File exists, open it
            Swing.runLater(() -> openDomainFile(file));
            return "OK";
        } catch (Exception e) {
            return "Error opening binary: " + e.getMessage();
        }
    }

    private String doDebugBinary(Map<String, String> cmd) {
        String binaryName = cmd.get("binary");
        println("Debug Binary: " + binaryName);
        
        Swing.runLater(() -> {
            try {
                Project project = state.getProject();
                if (project == null) return;

                ProjectData projectData = project.getProjectData();
                DomainFolder root = projectData.getRootFolder();
                DomainFile file = root.getFile(binaryName);

                if (file == null) {
                    // Try to auto-import from /ghidra/binaries
                    java.io.File rawFile = new java.io.File("/ghidra/binaries/" + binaryName);
                    if (rawFile.exists()) {
                         println("Binary not in project. Importing from disk: " + rawFile.getAbsolutePath());
                         try {
                             LoadResults<Program> results = ghidra.app.util.importer.AutoImporter.importByUsingBestGuess(
                                 rawFile, 
                                 project, 
                                 root.getPathname(), 
                                 LiveBridge.this, 
                                 new ghidra.app.util.importer.MessageLog(), 
                                 TaskMonitor.DUMMY
                             );
                             
                             if (results != null) {
                                  for (Loaded<Program> loaded : results) {
                                      // Get the file reference from the imported program
                                      if (loaded.getDomainObject() != null) {
                                          file = loaded.getDomainObject().getDomainFile();
                                          
                                          // Ensure it is saved? AutoImporter usually saves.
                                          if (file == null && loaded.getDomainObject() instanceof Program) {
                                               // This shouldn't happen if it was imported to a folder
                                               println("Imported object has no file? Saving...");
                                               ((Program)loaded.getDomainObject()).save("Imported " + binaryName, TaskMonitor.DUMMY);
                                               file = loaded.getDomainObject().getDomainFile();
                                          }
                                      
                                          // Release the consumer (LiveBridge) on the program object to avoid leaks?
                                          loaded.getDomainObject().release(LiveBridge.this);
                                          
                                          if (file != null) {
                                              println("Imported " + file.getName());
                                              break; 
                                          }
                                      } else {
                                          println("Loaded object provided null domain object.");
                                      }
                                  }
                             }
                        } catch (Exception e) {
                             printerr("AutoImport failed: " + e.getMessage());
                             e.printStackTrace();
                        }
                    }
                }

                if (file == null) {
                    printerr("Cannot debug: Binary " + binaryName + " not in project and import failed.");
                    return;
                }

                // Try to find the Debugger tool
                ToolChest chest = project.getLocalToolChest();
                ToolTemplate[] templates = chest.getToolTemplates();
                ToolTemplate debuggerTemplate = null;
                
                println("Searching ToolChest for 'Debugger'...");
                for (ToolTemplate t : templates) {
                    // println("  Found template: " + t.getName());
                    if (t.getName().toLowerCase().contains("debugger")) {
                        debuggerTemplate = t;
                        break;
                    }
                }
                if (debuggerTemplate != null) println("Found Debugger Template: " + debuggerTemplate.getName());

                // 2. Launch using high-level API
                if (debuggerTemplate != null) {
                    try {
                        println("Launching Debugger tool: " + debuggerTemplate.getName());
                        // launchTool handles checking for running tools, bringing to front, and opening files
                        project.getToolServices().launchTool(debuggerTemplate.getName(), Collections.singletonList(file));
                        println("launchTool called successfully.");
                    } catch (Exception ex) {
                        printerr("Error launching tool: " + ex);
                        ex.printStackTrace();
                    }
                } else {
                    printerr("No tool named 'Debugger' found in Tool Chest.");
                }

            } catch (Exception e) {
                printerr("Debug failed (Main Catch): " + e); // Use e.toString() to avoid null message
                e.printStackTrace();
            }
        });
        return "OK";
    }

    private void openDomainFile(DomainFile file) {
         try {
             ProgramManager pm = state.getTool().getService(ProgramManager.class);
             Program p = (Program) file.getDomainObject(this, true, false, TaskMonitor.DUMMY);
             pm.openProgram(p);
             
             // Trigger Auto Analysis
             AutoAnalysisManager mgr = AutoAnalysisManager.getAnalysisManager(p);
             
             // Configure PDB Search Path
             int txId = p.startTransaction("Config PDB");
             try {
                 Options analysisOptions = p.getOptions(Program.ANALYSIS_PROPERTIES);
                 analysisOptions.setString("PDB.Symbol Repository Path", "/ghidra/binaries");
             } catch (Exception e) {
                 printerr("Failed to set PDB options: " + e.getMessage());
             } finally {
                 p.endTransaction(txId, true);
             }
             
             mgr.initializeOptions();
             mgr.reAnalyzeAll(null);
             mgr.startAnalysis(TaskMonitor.DUMMY);


             
             println("Opened and Analysis started for " + file.getName());
         } catch (Exception e) {
             printerr("Open failed: " + e.getMessage());
         }
    }
}
