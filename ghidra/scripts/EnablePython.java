//Enable Python Plugin
//@category _ReBrain

import ghidra.app.script.GhidraScript;
import ghidra.framework.plugintool.PluginTool;

public class EnablePython extends GhidraScript {

    @Override
    public void run() throws Exception {
        PluginTool tool = state.getTool();
        String pluginName = "ghidra.python.PythonPlugin";
        
        println("Checking for " + pluginName + "...");
        
        try {
            Class<?> c = Class.forName(pluginName);
            println("Class found: " + c.getName());
            
            if (tool.getManagedPlugins().contains(c)) {
                println("Plugin is ALREADY managed by the tool.");
            } else {
                println("Plugin missing from tool. Adding...");
                tool.addPlugin(c.getName());
                println("Added successfully!");
            }
        } catch (ClassNotFoundException e) {
            printerr("CRITICAL: PythonPlugin class NOT found in classpath!");
            printerr("This implies the Jython module is not being loaded by the ClassLoader.");
        } catch (Exception e) {
            printerr("Error adding plugin: " + e.getMessage());
            e.printStackTrace();
        }
    }
}
