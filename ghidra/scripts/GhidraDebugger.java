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
//Simulator for Headless Debugging using EmulatorHelper
//@category Debugger

import ghidra.app.script.GhidraScript;
import ghidra.app.emulator.EmulatorHelper;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.lang.Register;
import ghidra.pcode.emulate.EmulateExecutionState;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.math.BigInteger;

public class GhidraDebugger extends GhidraScript {

    class DebugStep {
        String pc;
        String instruction;
        Map<String, String> registers;
        String event; // "step", "breakpoint", "error", "exit"
    }

    class DebugTrace {
        String status; // "completed", "error", "breakpoint"
        List<DebugStep> steps = new ArrayList<>();
        String final_pc;
        Map<String, String> memory_changes; // TODO
    }

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1) { 
            println("Usage: GhidraDebugger <output_file> [entry_addr] [max_steps] [breakpoints...]");
            return;
        }
        
        String outputPath = args[0];
        String entryStr = (args.length > 1) ? args[1] : null;
        int maxSteps = (args.length > 2) ? Integer.parseInt(args[2]) : 20; // Default 20 steps
        
        List<String> breakpoints = new ArrayList<>();
        if (args.length > 3) {
            for (int i = 3; i < args.length; i++) {
                breakpoints.add(args[i]);
            }
        }

        DebugTrace trace = new DebugTrace();
        EmulatorHelper emu = new EmulatorHelper(currentProgram);

        try {
            // 1. Resolve Entry Point
            Address entryAddr = null;
            if (entryStr != null && !entryStr.isEmpty() && !entryStr.equals("auto")) {
                 if (entryStr.startsWith("0x")) {
                     entryAddr = toAddr(entryStr);
                 } else {
                     List<Symbol> syms = getSymbols(entryStr, null);
                     if (!syms.isEmpty()) entryAddr = syms.get(0).getAddress();
                 }
            }
            
            if (entryAddr == null) {
                // Auto-detect entry
                Address existingEntryPoint = null;
                ghidra.program.model.symbol.SymbolIterator iter = currentProgram.getSymbolTable().getSymbols("entry");
                if (iter.hasNext()) existingEntryPoint = iter.next().getAddress();
                
                if (existingEntryPoint == null) {
                    // Try to find main? or start at min address
                     existingEntryPoint = currentProgram.getMinAddress();
                }
                entryAddr = existingEntryPoint;
            }

            if (entryAddr == null) {
                 trace.status = "error";
                 recordError(outputPath, "Could not resolve entry point.");
                 return;
            }

            // 2. Setup Emulator
            Register pcReg = currentProgram.getLanguage().getProgramCounter();
            emu.writeRegister(pcReg, entryAddr.getOffset());
            
            // Setup Stack (Mock) -> EmulatorHelper usually handles a basic stack on the heap or high memory
            // But we might need to initialize SP if it's 0.
            Register spReg = currentProgram.getCompilerSpec().getStackPointer();
            if (spReg != null) {
                BigInteger currentSp = emu.readRegister(spReg);
                if (currentSp.equals(BigInteger.ZERO)) {
                    // Initialize stack pointer to a safe high address
                    // Assuming 64-bit space or 32-bit
                    long stackBase = 0x7ffffff0L; // Typical stack base
                    emu.writeRegister(spReg, stackBase);
                    println("Initialized Stack Pointer to " + Long.toHexString(stackBase));
                }
            }

            // 3. Run Loop
            println("Starting emulation at " + entryAddr);
            
            for (int i = 0; i < maxSteps; i++) {
                DebugStep step = new DebugStep();
                Address execAddr = emu.getExecutionAddress();
                step.pc = execAddr.toString();
                
                Instruction instr = getInstructionAt(execAddr);
                step.instruction = (instr != null) ? instr.toString() : "??";
                
                // Check Breakpoints BEFORE execution (Hit breakpoint)
                boolean hitBp = false;
                for (String bp : breakpoints) {
                     // Check address match
                     if (execAddr.toString().equals(bp) || ("0x"+execAddr.toString()).equals(bp)) {
                         hitBp = true;
                         break;
                     }
                }
                
                if (hitBp && i > 0) { // Don't break on start immediately unless intended
                    step.event = "breakpoint";
                    step.registers = captureRegisters(emu);
                    trace.steps.add(step);
                    trace.status = "breakpoint";
                    break;
                }

                // Step
                boolean success = emu.step(monitor);
                if (!success) {
                    step.event = "error: " + emu.getLastError();
                    trace.steps.add(step);
                    trace.status = "error";
                    break;
                }
                
                // Capture State
                step.event = "step";
                step.registers = captureRegisters(emu);
                trace.steps.add(step);
                
                if (i == maxSteps - 1) {
                    trace.status = "completed"; // Reached max steps
                }
            }
            
            trace.final_pc = emu.getExecutionAddress().toString();
            if (trace.status == null) trace.status = "completed";

        } catch (Exception e) {
            trace.status = "error";
            DebugStep err = new DebugStep();
            err.event = "Exception: " + e.getMessage();
            trace.steps.add(err);
        } finally {
            emu.dispose();
        }

        // write output
        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
            gson.toJson(trace, writer);
        }
    }
    
    private Map<String, String> captureRegisters(EmulatorHelper emu) {
        Map<String, String> regs = new HashMap<>();
        // Capture context-specific registers
        // For standard display, we want PC, SP, and general purpose
        // Getting ALL registers is too noisy.
        
        List<Register> registers = currentProgram.getLanguage().getRegisters();
        for (Register r : registers) {
            if (r.isHidden()) continue;
            if (r.isProcessorContext()) continue; 
            
            // Filter by size to get main GP registers (e.g. 32-bit or 64-bit)
            // This is a heuristic.
            int bitLen = r.getBitLength();
            if (bitLen >= 32 || r.getName().equals("pc") || r.getName().equals("sp")) {
                 try {
                     BigInteger val = emu.readRegister(r);
                     if (!val.equals(BigInteger.ZERO)) { // Only non-zero? No, debuggers usually show all.
                         // But for JSON size, maybe compress?
                         // Let's include everything >= 32 bits.
                         regs.put(r.getName(), "0x" + val.toString(16));
                     }
                 } catch (Exception e) {}
            }
        }
        return regs;
    }

    private void recordError(String outputPath, String msg) throws Exception {
        Map<String, String> err = new HashMap<>();
        err.put("status", "error");
        err.put("message", msg);
        Gson gson = new GsonBuilder().setPrettyPrinting().create();
         try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
            gson.toJson(err, writer);
        }
    }
}
