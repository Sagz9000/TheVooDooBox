import React, { useState, useEffect } from 'react';
import {
    Terminal,
    Search,
    Bug,
    ChevronRight,
    Loader2,
    Play
} from 'lucide-react';
import { BASE_URL } from './voodooApi';

interface GhidraConsoleProps {
    taskId: string;
    filename: string;
    onClose?: () => void;
}

interface GhidraFunction {
    name: string;
    addr: string;
    score?: number;
    code?: string;
    asm?: string;
}

export default function GhidraConsole({ taskId, filename, onClose }: GhidraConsoleProps) {
    const [functions, setFunctions] = useState<GhidraFunction[]>([]);
    const [selectedFunction, setSelectedFunction] = useState<GhidraFunction | null>(null);
    const [decompiledCode, setDecompiledCode] = useState<string>("// Select a function to decompile");
    const [isLoading, setIsLoading] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [logs, setLogs] = useState<string[]>(["[SYSTEM] Ghidra Headless Engine Initialized."]);

    const addLog = (msg: string) => {
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    const startPolling = async () => {
        setIsAnalyzing(true);
        // Poll for results every 5 seconds for up to 5 minutes (60 attempts)
        let attempts = 0;
        const pollInterval = setInterval(async () => {
            attempts++;
            const count = await fetchFunctions(true);

            // Check task status to see if it's finished via signal
            try {
                const taskRes = await fetch(`${BASE_URL}/tasks`);
                const tasks = await taskRes.json();
                const currentTask = tasks.find((t: any) => t.id === taskId);

                if (currentTask?.ghidra_status === 'Analysis Complete' || count > 0 || attempts >= 60) {
                    clearInterval(pollInterval);
                    setIsAnalyzing(false);
                    if (currentTask?.ghidra_status === 'Analysis Complete' || count > 0) {
                        addLog("SUCCESS: Static analysis data synchronized.");
                        fetchFunctions(false); // Final refresh
                    } else {
                        addLog("TIMEOUT: Analysis taking longer than expected. Check logs.");
                    }
                }
            } catch (e) {
                console.error("Polling status check failed", e);
            }
        }, 5000);
    };

    useEffect(() => {
        const checkStatus = async () => {
            const res = await fetch(`${BASE_URL}/tasks`);
            const tasks = await res.json();
            const currentTask = tasks.find((t: any) => t.id === taskId);

            if (currentTask?.ghidra_status === 'Analysis Running') {
                addLog("AUTO-DETECT: Background analysis in progress. Hooking stream...");
                startPolling();
            } else if (currentTask?.ghidra_status === 'Analysis Complete') {
                addLog("Data found in persistent cache. Loading symbols...");
                fetchFunctions(false);
            }
        };

        addLog(`Ghidra session active for task ${taskId}`);
        checkStatus();
    }, [taskId]);

    const runAnalysis = async () => {
        if (isAnalyzing) return;
        setIsAnalyzing(true);
        addLog(`Initiating manual analysis for ${filename}...`);
        try {
            const res = await fetch(`${BASE_URL}/ghidra/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    binary_name: filename,
                    task_id: taskId
                })
            });
            const data = await res.json();
            addLog(`Ghidra Status: ${data.status || 'OK'}`);
            startPolling();
        } catch (e) {
            addLog(`Error: ${e}`);
            setIsAnalyzing(false);
        }
    };

    const fetchFunctions = async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            // Fetch from persistent DB
            const res = await fetch(`${BASE_URL}/tasks/${taskId}/ghidra-findings`);
            const data = await res.json();

            if (Array.isArray(data) && data.length > 0) {
                // Map DB findings to component state
                const mapped = data.map((f: any) => ({
                    name: f.function_name,
                    addr: f.entry_point,
                    score: 0.9, // Default score
                    code: f.decompiled_code, // Store code directly
                    asm: f.assembly
                }));
                setFunctions(mapped);
                // If we have functions and none selected, verify log
                if (!isAnalyzing) {
                    addLog(`Loaded ${data.length} analyzed functions from database.`);
                }
                return data.length;
            } else {
                // Fallback only if strictly empty and no analysis running
                if (!isAnalyzing) {
                    // addLog("No findings in database. Run Auto-Analysis to populate.");
                    setFunctions([]);
                }
                return 0;
            }
        } catch (e) {
            addLog(`Failed to fetch findings: ${e}`);
            return 0;
        } finally {
            setIsLoading(false);
        }
    };

    const handleFunctionClick = async (fn: GhidraFunction & { code?: string, asm?: string }) => {
        setSelectedFunction(fn);
        if (fn.code) {
            // If we have data from DB, use it
            setDecompiledCode(fn.code);
        } else {
            // Fallback for legacy items (won't happen with DB)
            setDecompiledCode(`// No decompiled code available for ${fn.name}`);
        }
    };

    return (
        <div className="h-full flex flex-col font-mono bg-[#0D1117] text-slate-300 overflow-hidden border border-security-border rounded-xl shadow-2xl">
            <div className="h-10 bg-[#161B22] border-b border-security-border flex items-center px-4 justify-between">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Bug className="w-4 h-4 text-brand-500" />
                        <span className="text-[11px] font-black text-white uppercase tracking-widest">Static Bin-Explorer</span>
                    </div>
                    <div className="h-4 w-px bg-security-border"></div>
                    <span className="text-[10px] text-security-muted font-bold truncate max-w-[200px]">TARGET: {filename}</span>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={runAnalysis}
                        disabled={isAnalyzing}
                        className="flex items-center gap-1.5 px-3 py-1 bg-brand-500/10 border border-brand-500/30 text-brand-500 text-[10px] font-black rounded hover:bg-brand-500/20 transition-all disabled:opacity-50"
                    >
                        {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        RUN AUTO-ANALYSIS
                    </button>
                    {onClose && (
                        <button onClick={onClose} className="p-1 hover:bg-white/5 rounded text-security-muted">
                            <ChevronRight className="w-4 h-4 rotate-90" />
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                <div className="w-64 bg-[#0D1117] border-r border-security-border flex flex-col">
                    <div className="p-3 bg-black/20 border-b border-security-border flex items-center justify-between">
                        <span className="text-[10px] font-black text-security-muted uppercase tracking-wider">Indexed Symbols</span>
                        <Search className="w-3 h-3 text-security-muted" />
                    </div>
                    <div className="flex-1 overflow-auto custom-scrollbar">
                        {isLoading && functions.length === 0 ? (
                            <div className="p-8 flex flex-col items-center justify-center gap-2 opacity-50">
                                <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
                                <span className="text-[9px] font-bold">LOADING MAP...</span>
                            </div>
                        ) : functions.map((fn, i) => (
                            <div
                                key={i}
                                onClick={() => handleFunctionClick(fn)}
                                className={`px-4 py-2 hover:bg-brand-500/5 cursor-pointer group flex items-center justify-between border-l-2 transition-all ${selectedFunction?.addr === fn.addr ? 'border-brand-500 bg-brand-500/10' : 'border-transparent'}`}
                            >
                                <span className={`text-[11px] truncate font-bold ${selectedFunction?.addr === fn.addr ? 'text-white' : 'text-slate-400'}`}>
                                    {fn.name}
                                </span>
                                <span className="text-[9px] text-security-muted font-mono">{fn.addr}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex-1 flex flex-col min-w-0 bg-[#0D1117]">
                    <div className="flex-1 p-6 text-[13px] leading-relaxed text-slate-300 overflow-auto whitespace-pre custom-scrollbar font-mono relative">
                        {isLoading && (
                            <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center z-10">
                                <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
                            </div>
                        )}
                        <div className="text-security-muted mb-4 italic opacity-50">// VOODOOBOX Static Decompiler - Headless Ghidra Output</div>
                        <div className="text-brand-500/90">
                            {decompiledCode}
                        </div>
                    </div>

                    <div className="h-48 bg-[#161B22] border-t border-security-border flex flex-col shadow-2xl">
                        <div className="px-4 py-2 border-b border-security-border bg-black/20 flex items-center gap-2">
                            <Terminal className="w-3.5 h-3.5 text-brand-500" />
                            <span className="text-[10px] font-black text-white uppercase tracking-widest">Engine Logs</span>
                            <div className="ml-auto flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-brand-500 animate-pulse"></div>
                                <span className="text-[9px] text-brand-500 font-bold uppercase">Active Session</span>
                            </div>
                        </div>
                        <div className="flex-1 p-3 text-[10px] text-security-muted overflow-auto font-mono custom-scrollbar">
                            {logs.map((log, i) => (
                                <div key={i} className="mb-0.5 whitespace-pre-wrap">
                                    {log.includes("Error") ? <span className="text-red-400">{log}</span> :
                                        log.includes("SUCCESS") ? <span className="text-brand-500">{log}</span> : log}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
