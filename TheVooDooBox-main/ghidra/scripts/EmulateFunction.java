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
//Performs P-Code Emulation on a function
//@category AI

import ghidra.app.script.GhidraScript;
import ghidra.app.emulator.EmulatorHelper;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.listing.Instruction;
import ghidra.pcode.emulate.EmulateExecutionState;
import ghidra.program.model.lang.Register;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class EmulateFunction extends GhidraScript {

    class StepInfo {
        String address;
        String instruction;
        Map<String, String> registers;
        String error;
    }

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2) { // Need at least output file and address
            println("Usage: EmulateFunction <output_file> <address> [steps] [stopAddr]");
            return;
        }
        String outputPath = args[0];
        String startAddrStr = args[1];

        int maxSteps = 10;
        if (args.length > 2) {
            try {
                maxSteps = Integer.parseInt(args[2]);
            } catch (NumberFormatException e) {
                // ignore
            }
        }
        
        String stopAddrStr = null;
        if (args.length > 3) {
            stopAddrStr = args[3];
        }

        Address startAddr = currentAddress;
        if (startAddrStr.startsWith("0x")) {
            startAddr = toAddr(startAddrStr);
        } else {
            // Try to resolve as function name
            List<Symbol> symbols = getSymbols(startAddrStr, null);
            if (symbols != null && !symbols.isEmpty()) {
                startAddr = symbols.get(0).getAddress();
            }
        }

        Gson gson = new GsonBuilder().setPrettyPrinting().create();

        if (startAddr == null) {
            Map<String, String> err = new HashMap<>();
            err.put("error", "Invalid address or symbol: " + startAddrStr);
            try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                gson.toJson(err, writer);
            }
            return;
        }

        EmulatorHelper emu = new EmulatorHelper(currentProgram);
        List<StepInfo> trace = new ArrayList<>();
        
        try {
            // Initialize PC
            Register pcReg = currentProgram.getLanguage().getProgramCounter();
            emu.writeRegister(pcReg, startAddr.getOffset());

            // Track registers we care about (General Purpose)
            // This is architecture dependent, but we'll try to get common ones
            List<Register> trackRegs = new ArrayList<>();
            for (Register r : currentProgram.getLanguage().getRegisters()) {
                if (!r.isHidden() && r.getBitLength() >= 32) {
                     // Heuristic: only track larger registers to avoid noise
                     trackRegs.add(r);
                }
            }

            for (int i = 0; i < maxSteps; i++) {
                StepInfo step = new StepInfo();
                Address executionAddress = emu.getExecutionAddress();
                
                step.address = executionAddress.toString();
                
                Instruction instr = getInstructionAt(executionAddress);
                if (instr != null) {
                    step.instruction = instr.toString();
                } else {
                    step.instruction = "??";
                }
                
                // Check Breakpoint
                if (stopAddrStr != null && executionAddress.toString().equals(stopAddrStr)) {
                    step.error = "Breakpoint hit at " + stopAddrStr;
                    trace.add(step);
                    break;
                }

                // Execute
                boolean success = emu.step(monitor);
                
                // Record Register State AFTER execution
                step.registers = new HashMap<>();
                for (Register r : trackRegs) {
                    try {
                        // Check if register changed? 
                        // For now just dump important ones or non-zero ones could be expensive
                        // Let's just dump the common ones: RAX, RBX, RCX, RDX, RSI, RDI, RSP, RBP, R8-R15 (x86)
                        // Or R0-R12, SP, LR, PC (ARM)
                        // Simple filter: if name is short
                        if (r.getName().length() <= 3) {
                             java.math.BigInteger val = emu.readRegister(r);
                             step.registers.put(r.getName(), "0x" + val.toString(16));
                        }
                    } catch (Exception e) {
                        // ignore
                    }
                }
                
                trace.add(step);

                if (!success) {
                    step.error = emu.getLastError();
                    break;
                }
            }

        } catch (Exception e) {
            StepInfo errStep = new StepInfo();
            errStep.error = e.getMessage();
            trace.add(errStep);
        } finally {
            emu.dispose();
        }

        try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
            gson.toJson(trace, writer);
        }
        println("JSON written to " + outputPath);
    }
}
