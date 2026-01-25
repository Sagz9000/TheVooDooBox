import React, { useState, useMemo, useEffect } from 'react';
import {
    List, Activity, Image, Zap, Terminal, Database, Search,
    Hash, Globe, Code2, Sparkles, Binary, ChevronRight,
    Loader2, ArrowLeft, Clock, Cpu, Disc, Download, FileText
} from 'lucide-react';
import { AgentEvent, voodooApi } from './voodooApi';
import AIInsightPanel, { ForensicReport } from './AIInsightPanel';
import ProcessTree, { Process } from './ProcessTree';

interface Props {
    taskId: string | null;
    events: AgentEvent[];
    onBack: () => void;
}

interface ProcessNode {
    pid: number;
    ppid: number;
    name: string;
    children: ProcessNode[];
    events: AgentEvent[];
    startTime: number;
}

const NOISE_FILTER_PROCESSES = [
    'voodoobox-agent-windows.exe',
    'voodoobox-agent.exe',
    'conhost.exe',
    'svchost.exe',
    'lsass.exe',
    'services.exe',
    'wininit.exe',
    'smss.exe',
    'csrss.exe',
    'winlogon.exe',
    'spoolsv.exe',
    'searchindexer.exe',
    'taskhostw.exe',
    'sppsvc.exe',
    'fontdrvhost.exe',
    'dwm.exe',
    'ctfmon.exe',
    'taskmgr.exe',
    'officeclicktorun.exe',
    'werfault.exe',
    'trustedinstaller.exe',
    'tiworker.exe'
];

export default function ReportView({ taskId, events: globalEvents, onBack }: Props) {
    const [activeTab, setActiveTab] = useState<'timeline' | 'neural' | 'network' | 'files' | 'registry' | 'console' | 'ghidra' | 'intelligence' | 'screenshots'>('timeline');
    const [localEvents, setLocalEvents] = useState<AgentEvent[]>([]);
    const [ghidraStateFindings, setGhidraStateFindings] = useState<AgentEvent[]>([]);
    const [screenshots, setScreenshots] = useState<string[]>([]); // Screenshots state
    const [loading, setLoading] = useState(false);
    const [selectedPid, setSelectedPid] = useState<number | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [consoleSearch, setConsoleSearch] = useState('');
    const [consoleSearchInput, setConsoleSearchInput] = useState('');
    const [aiReport, setAiReport] = useState<ForensicReport | null>(null);
    const [aiLoading, setAiLoading] = useState(false);
    const [showCheatsheet, setShowCheatsheet] = useState(false);

    useEffect(() => {
        if (taskId) {
            setLoading(true);
            console.log(`[TelemetryReport] Loading historical data for Task ${taskId}...`);

            voodooApi.fetchHistory(taskId, consoleSearch).then(evts => {
                setLocalEvents(evts);
                setLoading(false);
            }).catch(err => {
                console.error("[TelemetryReport] Failed to load history:", err);
                setLoading(false);
            });
        }
    }, [taskId, consoleSearch]);

    useEffect(() => {
        if (taskId) {
            voodooApi.fetchGhidraFindings(taskId).then(findings => {
                setGhidraStateFindings(findings);
            }).catch(err => {
                console.error("[TelemetryReport] Failed to load Ghidra findings:", err);
            });

            // Fetch Screenshots
            voodooApi.listScreenshots(taskId).then(shots => {
                setScreenshots(shots);
            }).catch(err => {
                console.error("[TelemetryReport] Failed to load screenshots:", err);
            });

            // Fetch AI Report
            voodooApi.fetchAIReport(taskId).then(report => {
                if (report) setAiReport(report);
            }).catch(err => {
                console.error("[TelemetryReport] Failed to load AI report:", err);
            });
        }
    }, [taskId]);

    const handleAIAnalysis = async () => {
        if (!taskId) return;
        setAiLoading(true);
        try {
            // Task-based analysis - trigger existing backend analyzer
            const report = await voodooApi.triggerTaskAnalysis(taskId);
            if (report) {
                setAiReport(report);
                setActiveTab('intelligence' as any);
            } else {
                alert("AI Analysis is not ready yet or failed.");
            }
        } catch (error) {
            console.error("AI analysis failed:", error);
            alert("Analysis error. Check backend logs.");
        } finally {
            setAiLoading(false);
        }
    };

    const handleConsoleSearch = () => {
        setConsoleSearch(consoleSearchInput);
    };

    const events = useMemo(() => {
        if (!taskId) return globalEvents;

        const combined = [...localEvents];
        const liveHits = globalEvents.filter((e: AgentEvent) => String((e as any).task_id) === String(taskId));

        if (liveHits.length > 0) {
            console.log(`[TelemetryReport] Integrating ${liveHits.length} live events for Task ${taskId}`);
            combined.push(...liveHits);
        }

        // Robust deduplication
        const unique = Array.from(new Map(combined.map((e: AgentEvent) => {
            const key = e.id ? `id-${e.id}` : `${e.timestamp}-${e.event_type}-${e.process_id}-${e.details.substring(0, 50)}`;
            return [key, e];
        })).values());

        return unique.sort((a, b) => a.timestamp - b.timestamp);
    }, [taskId, localEvents, globalEvents]);

    // 1. Build Process Tree with Start Time determination
    const processTree = useMemo(() => {
        const nodes: { [key: number]: ProcessNode } = {};
        const roots: ProcessNode[] = [];

        // 1. Filter events for this specific task and exclude noise
        const filteredEvents = events.filter((e: AgentEvent) => {
            const matchesId = !taskId || String((e as any).task_id) === String(taskId);
            const isNotNoise = !NOISE_FILTER_PROCESSES.includes(e.process_name.toLowerCase());

            if (taskId && !matchesId) {
                // Occasional log for mismatch to avoid spam but give insight
                if (Math.random() < 0.05) console.debug(`[TelemetryReport] Event taskId mismatch: e=${(e as any).task_id} target=${taskId}`);
            }

            return matchesId && isNotNoise;
        });

        console.log(`[TelemetryReport] Task ${taskId}: ${events.length} total events -> ${filteredEvents.length} after filtering`);

        if (events.length > 0 && filteredEvents.length === 0) {
            console.warn(`[TelemetryReport] Found ${events.length} total events, but ALL were filtered out as noise or ID mismatch.`);
        }

        // 2. Create nodes
        filteredEvents.forEach((e: AgentEvent) => {
            if (!nodes[e.process_id]) {
                nodes[e.process_id] = {
                    pid: e.process_id,
                    ppid: e.parent_process_id,
                    name: e.process_name,
                    children: [],
                    events: [],
                    startTime: e.timestamp
                };
            }
            nodes[e.process_id].events.push(e);
            // Update start time to be the earliest event
            if (e.timestamp < nodes[e.process_id].startTime) {
                nodes[e.process_id].startTime = e.timestamp;
            }
        });

        // Second pass: Link children
        Object.values(nodes).forEach(node => {
            node.events.sort((a, b) => a.timestamp - b.timestamp); // Sort events for each process

            if (node.ppid && nodes[node.ppid]) {
                nodes[node.ppid].children.push(node);
            } else {
                roots.push(node);
            }
        });

        // Recursive sort by start time
        const sortNodes = (n: ProcessNode[]) => {
            n.sort((a, b) => a.startTime - b.startTime);
            n.forEach(child => sortNodes(child.children));
        };
        sortNodes(roots);

        // Allow auto-selection of root if nothing selected
        if (roots.length > 0 && !selectedPid) {
            // Side-effect bad in render, but acceptable for initial state set if we handled it in useEffect. 
            // Skipping for purity, user selects manually.
        }

        return roots;
    }, [events]);

    const treeProcesses = useMemo(() => {
        const procMap: Record<number, Process> = {};

        events.forEach((e: AgentEvent) => {
            if (!procMap[e.process_id]) {
                procMap[e.process_id] = {
                    pid: e.process_id,
                    parent_pid: e.parent_process_id,
                    name: e.process_name,
                    status: 'running', // Fallback
                    behaviors: []
                };
            }

            // Add unique behaviors
            if (!procMap[e.process_id].behaviors.includes(e.event_type)) {
                procMap[e.process_id].behaviors.push(e.event_type);
            }

            // Update status if termination detected
            if (e.event_type === 'PROCESS_TERMINATE') {
                procMap[e.process_id].status = 'terminated';
            }
        });

        return procMap;
    }, [events]);

    const filteredProcessTree = useMemo(() => {
        if (!searchTerm.trim()) return processTree;

        const term = searchTerm.toLowerCase();

        const filterNode = (nodes: ProcessNode[]): ProcessNode[] => {
            return nodes.reduce((acc: ProcessNode[], node) => {
                const nameMatches = node.name.toLowerCase().includes(term);
                const pidMatches = String(node.pid).includes(term);
                const filteredChildren = filterNode(node.children);

                if (nameMatches || pidMatches || filteredChildren.length > 0) {
                    acc.push({
                        ...node,
                        children: filteredChildren
                    });
                }
                return acc;
            }, []);
        };

        return filterNode(processTree);
    }, [processTree, searchTerm]);

    const selectedProcessNode = useMemo(() => {
        if (!selectedPid) return null;

        // Flatten tree to find node
        const findNode = (nodes: ProcessNode[]): ProcessNode | null => {
            for (const node of nodes) {
                if (node.pid === selectedPid) return node;
                const found = findNode(node.children);
                if (found) return found;
            }
            return null;
        };
        return findNode(processTree);
    }, [processTree, selectedPid]);

    const selectedProcessEvents = selectedProcessNode ? selectedProcessNode.events : [];

    // Filtered Events for Tabs - Fallback to global 'events' if no process is selected
    const sourceEvents = selectedProcessNode ? selectedProcessEvents : events;

    const timelineEvents = sourceEvents;

    const screenshotsList = useMemo(() => {
        return sourceEvents
            .filter((e: AgentEvent) => e.event_type === 'SCREENSHOT' && e.details)
            .map((e: AgentEvent) => e.details as string);
    }, [sourceEvents]);

    const ghidraFindingsList = useMemo(() => {
        return sourceEvents.filter((e: AgentEvent) => e.event_type === 'GHIDRA_FINDING');
    }, [sourceEvents]);

    const networkEvents = useMemo(() => {
        return sourceEvents.filter((e: AgentEvent) => ['NETWORK_CONNECT', 'LATERAL_MOVEMENT', 'NETWORK_DNS'].includes(e.event_type));
    }, [sourceEvents]);

    const fileEvents = useMemo(() => {
        return sourceEvents.filter((e: AgentEvent) => e.event_type.startsWith('FILE_'));
    }, [sourceEvents]);

    const registryEvents = useMemo(() => {
        return sourceEvents.filter((e: AgentEvent) => e.event_type.includes('REG_') || e.event_type.includes('REGISTRY'));
    }, [sourceEvents]);

    const getProcessCreateDetail = () => {
        return selectedProcessEvents.find((e: AgentEvent) => e.event_type === 'PROCESS_CREATE')?.details || 'Process start parameters not captured.';
    };

    const stats = useMemo(() => {
        const taskEvents = events.filter((e: AgentEvent) => !taskId || (e as any).task_id === taskId);
        if (taskEvents.length === 0) return { duration: '00:00:00', count: 0 };

        const start = Math.min(...taskEvents.map(e => e.timestamp));
        const end = Math.max(...taskEvents.map(e => e.timestamp));
        const diff = Math.max(0, Math.floor((end - start) / 1000));

        const m = Math.floor(diff / 60).toString().padStart(2, '0');
        const s = (diff % 60).toString().padStart(2, '0');

        return {
            duration: `00:${m}:${s}`,
            count: taskEvents.length
        };
    }, [events, taskId]);

    if (loading && events.length === 0) {
        return (
            <div className="h-full w-full flex flex-col items-center justify-center bg-security-bg space-y-4">
                <Loader2 className="text-security-active animate-spin" size={48} />
                <p className="text-security-active/50 text-[10px] font-black uppercase tracking-[0.3em] animate-pulse">RECONSTRUCTING_TELEMETRY_TIMELINE...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-[#050505] text-white overflow-hidden animate-in fade-in duration-300 font-sans">
            {/* Header */}
            <header className="h-16 border-b border-white/10 bg-security-surface/80 backdrop-blur-md flex items-center justify-between px-6 z-20 sticky top-0">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-white/5 rounded-full text-security-active transition-all hover:scale-110 active:scale-90"
                    >
                        <ArrowLeft size={20} />
                    </button>

                    <div className="h-10 w-[1px] bg-white/10 mx-2"></div>

                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-xl font-black tracking-tighter text-white uppercase italic">
                                Forensic Report <span className="text-security-active">#{taskId?.slice(-6) || 'LIVE'}</span>
                            </h1>
                            <span className="px-2 py-0.5 bg-brand-500/10 text-brand-500 text-[10px] font-black uppercase tracking-[0.2em] border border-brand-500/30">
                                Analysis Complete
                            </span>
                        </div>
                        <p className="text-[10px] text-security-active/50 font-mono flex items-center gap-2 mt-0.5">
                            <Hash size={10} /> SESSION_ID: {taskId || 'TELEMETRY_STREAM_ACTIVE'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-8">
                    <div className="flex items-center gap-6 text-[10px] font-mono text-security-active/60">
                        <div className="flex flex-col items-end">
                            <span className="text-white/40 uppercase text-[8px] tracking-widest mb-0.5">Duration</span>
                            <span className="flex items-center gap-2 text-security-active"><Clock size={12} /> {stats.duration}</span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-white/40 uppercase text-[8px] tracking-widest mb-0.5">Events</span>
                            <span className="flex items-center gap-2 text-security-active"><Cpu size={12} /> {stats.count}</span>
                        </div>
                        <div className="flex flex-col items-end border-l border-white/10 pl-6">
                            <span className="text-white/40 uppercase text-[8px] tracking-widest mb-0.5">Status</span>
                            <span className="flex items-center gap-2 text-voodoo-toxic-green animate-pulse"><Disc size={12} /> SYNCED</span>
                        </div>
                    </div>

                    <button
                        onClick={() => taskId && aiReport && voodooApi.downloadPdf(taskId, aiReport)}
                        disabled={!aiReport}
                        className={`group relative flex items-center gap-3 px-6 py-2.5 transition-all uppercase font-black tracking-[0.2em] text-[10px] border ${aiReport
                            ? 'bg-brand-500 text-white border-brand-400/50 shadow-[0_0_15px_rgba(191,0,255,0.3)] hover:shadow-[0_0_25px_rgba(191,0,255,0.5)] hover:scale-105'
                            : 'bg-zinc-900/50 text-zinc-600 border-white/5 cursor-not-allowed opacity-50'}`}
                        title={aiReport ? "Download PDF Report" : "Run AI Analysis first to generate PDF"}
                    >
                        <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <Download size={14} className="group-hover:bounce" />
                        EXPORT_PDF
                    </button>
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden">
                {/* Left: Enhanced Process Tree */}
                <div className="w-[350px] border-r border-white/10 bg-[#0c0c0c] flex flex-col z-0">
                    <div className="p-4 border-b border-white/10 bg-[#111] flex flex-col gap-3 shadow-sm">
                        <div className="flex items-center gap-2">
                            <Activity size={14} className="text-brand-500" />
                            <span className="text-xs font-black uppercase tracking-wider text-zinc-300">Process Lineage</span>
                        </div>
                        <div className="relative">
                            <Terminal size={12} className="absolute left-3 top-2.5 text-zinc-600" />
                            <input
                                type="text"
                                placeholder="Search Name or PID..."
                                className="w-full bg-black/40 border border-white/5 rounded-md pl-9 pr-3 py-2 text-[11px] text-zinc-200 focus:outline-none focus:border-brand-500/50 transition-all font-mono"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        {filteredProcessTree.map(root => (
                            <ProcessTreeNode
                                key={root.pid}
                                node={root}
                                selectedPid={selectedPid}
                                onSelect={setSelectedPid}
                                level={0}
                            />
                        ))}
                    </div>
                </div>

                {/* Right: Detailed Analysis Panel */}
                <div className="flex-1 flex flex-col bg-[#050505] min-w-0">
                    {/* Process Detail Card */}
                    {selectedProcessNode ? (
                        <div className="bg-[#0a0a0a] border-b border-white/10 p-6 flex flex-col shadow-lg z-10">
                            <div className="flex items-start gap-4 mb-4">
                                <div className="p-3 bg-brand-900/20 rounded-xl border border-brand-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
                                    <Terminal size={24} className="text-brand-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                        <h2 className="text-xl font-bold text-white tracking-tight truncate">{selectedProcessNode.name}</h2>
                                        <span className="px-2 py-1 rounded bg-zinc-800 text-zinc-400 font-mono text-[10px] border border-white/5">
                                            {new Date(selectedProcessNode.startTime).toLocaleTimeString()}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-6 text-xs text-zinc-400 font-mono mt-1">
                                        <span className="flex items-center gap-1.5"><Hash size={12} className="text-zinc-600" /> PID: <span className="text-zinc-200">{selectedPid}</span></span>
                                        <span className="flex items-center gap-1.5"><Activity size={12} className="text-zinc-600" /> PPID: <span className="text-zinc-200">{selectedProcessNode.ppid}</span></span>
                                        <span className="flex items-center gap-1.5"><List size={12} className="text-zinc-600" /> Events: <span className="text-zinc-200">{selectedProcessNode.events.length}</span></span>

                                        {/* Kill Process Action */}
                                        <button
                                            onClick={async () => {
                                                if (selectedPid && confirm(`Are you sure you want to TERMINATE process ${selectedPid} (${selectedProcessNode.name})?`)) {
                                                    const success = await voodooApi.killProcess(selectedPid);
                                                    if (success) {
                                                        alert("Termination signal sent successfully.");
                                                    } else {
                                                        alert("Failed to terminate process.");
                                                    }
                                                }
                                            }}
                                            className="ml-auto flex items-center gap-1.5 px-3 py-1 bg-red-900/20 hover:bg-red-600 text-red-400 hover:text-white border border-red-500/30 rounded transition-all text-[10px] font-black uppercase tracking-widest"
                                        >
                                            <Zap size={10} /> Terminate Process
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Command Line Section */}
                            <div className="relative group">
                                <div className="absolute -top-2.5 left-2 px-1 bg-[#0a0a0a] text-[9px] font-bold text-brand-500 uppercase tracking-widest leading-none">Command Line</div>
                                <div className="bg-black/40 p-3 rounded-lg border border-white/10 font-mono text-xs text-zinc-300 break-all leading-relaxed hover:bg-black/60 transition-colors">
                                    <span className="text-brand-500/50 select-none mr-2">$</span>
                                    {getProcessCreateDetail()}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-48 bg-[#0a0a0a] border-b border-white/10 flex flex-col items-center justify-center text-zinc-600 space-y-3">
                            <Activity size={32} className="opacity-20" />
                            <p className="text-sm font-bold uppercase tracking-widest">Select a process to inspect details</p>
                        </div>
                    )}

                    {/* Tabs Navigation */}
                    <div className="flex items-center px-4 border-b border-white/10 bg-[#0a0a0a] overflow-x-auto overflow-y-hidden custom-scrollbar whitespace-nowrap">
                        <TabButton active={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')} icon={<List size={14} />} label="Activity Timeline" count={timelineEvents.length} />
                        <TabButton active={activeTab === 'neural'} onClick={() => setActiveTab('neural')} icon={<Activity size={14} />} label="Neural Lineage" />
                        <TabButton active={activeTab === 'screenshots'} onClick={() => setActiveTab('screenshots')} icon={<Image size={14} />} label="Screenshots" count={screenshotsList.length} />
                        <TabButton active={activeTab === 'network'} onClick={() => setActiveTab('network')} icon={<Globe size={14} />} label="Network" count={networkEvents.length} />
                        <TabButton active={activeTab === 'files'} onClick={() => setActiveTab('files')} icon={<FileText size={14} />} label="Files" count={fileEvents.length} />
                        <TabButton active={activeTab === 'registry'} onClick={() => setActiveTab('registry')} icon={<Database size={14} />} label="Registry" count={registryEvents.length} />
                        <TabButton active={activeTab === 'ghidra'} onClick={() => setActiveTab('ghidra')} icon={<Code2 size={14} />} label="Ghidra Intelligence" count={ghidraFindingsList.length} />
                        <TabButton active={activeTab === 'intelligence'} onClick={() => setActiveTab('intelligence')} icon={<Sparkles size={14} />} label="AI Insight" />
                        <TabButton active={activeTab === 'console'} onClick={() => setActiveTab('console')} icon={<Terminal size={14} />} label="Raw Console" count={stats.count} />
                    </div>

                    {/* Tab Content Area */}
                    <div className="flex-1 overflow-hidden relative bg-[#080808]">
                        {activeTab === 'timeline' && (
                            <TimelineView events={timelineEvents} />
                        )}
                        {activeTab === 'neural' && (
                            <div className="absolute inset-0 p-6 flex flex-col">
                                <ProcessTree
                                    processes={treeProcesses}
                                    selectedPid={selectedPid || undefined}
                                    onNodeClick={setSelectedPid}
                                />
                            </div>
                        )}
                        {activeTab === 'screenshots' && (
                            <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-6">
                                {screenshots.length === 0 ? (
                                    <EmptyState msg="No screenshots captured" />
                                ) : (
                                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
                                        {screenshots.map((shot, i) => (
                                            <div key={i} className="group relative rounded-lg overflow-hidden border border-white/10 bg-black/20 hover:border-brand-500/50 transition-all shadow-xl">
                                                <div className="aspect-video relative overflow-hidden bg-black">
                                                    <img
                                                        src={voodooApi.getScreenshotUrl(shot, taskId || undefined)}
                                                        alt={`Screenshot ${i}`}
                                                        className="object-contain w-full h-full opacity-80 group-hover:opacity-100 transition-opacity"
                                                        loading="lazy"
                                                    />
                                                </div>
                                                <div className="p-3 bg-[#111] border-t border-white/5 flex items-center justify-between">
                                                    <span className="text-[10px] font-mono text-zinc-500 truncate">{shot}</span>
                                                    <a
                                                        href={voodooApi.getScreenshotUrl(shot, taskId || undefined)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="p-1 hover:bg-white/10 rounded text-zinc-400 hover:text-white transition-colors"
                                                    >
                                                        <Globe size={12} />
                                                    </a>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        {activeTab === 'network' && (
                            <EventTable events={networkEvents} type="network" />
                        )}
                        {activeTab === 'files' && (
                            <EventTable events={fileEvents} type="file" />
                        )}
                        {activeTab === 'registry' && (
                            <EventTable events={registryEvents} type="registry" />
                        )}
                        {activeTab === 'ghidra' && (
                            <GhidraFindingsView findings={ghidraFindingsList} />
                        )}
                        {activeTab === 'intelligence' && (
                            <div className="absolute inset-0 bg-security-bg overflow-hidden shadow-2xl">
                                <AIInsightPanel
                                    report={aiReport}
                                    loading={aiLoading}
                                    onAnalyze={handleAIAnalysis}
                                    taskId={taskId || undefined}
                                    onSelectPid={(pid) => {
                                        setSelectedPid(pid);
                                        // Optional: Clear filter if the PID is hidden by current filter
                                        setSearchTerm("");
                                    }}
                                />
                            </div>
                        )}
                        {activeTab === 'console' && (
                            <div className="absolute inset-0 flex flex-col bg-black">
                                <div className="p-4 border-b border-white/5 bg-zinc-900/20">
                                    <div className="flex gap-2">
                                        <div className="relative group flex-1">
                                            <Terminal size={12} className="absolute left-3 top-2.5 text-zinc-600 group-focus-within:text-brand-500 transition-colors" />
                                            <input
                                                type="text"
                                                placeholder="Full-text search telemetry logs (AND, OR, quotes supported)..."
                                                className="w-full bg-black/40 border border-white/5 rounded-md pl-9 pr-3 py-2 text-[11px] text-zinc-200 focus:outline-none focus:border-brand-500/50 transition-all font-mono"
                                                value={consoleSearchInput}
                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConsoleSearchInput(e.target.value)}
                                                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                                    if (e.key === 'Enter') handleConsoleSearch();
                                                }}
                                            />
                                        </div>
                                        <button
                                            onClick={handleConsoleSearch}
                                            className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-md text-[11px] font-bold uppercase tracking-wider transition-colors flex items-center gap-2 shadow-lg shadow-brand-500/20"
                                        >
                                            <Search size={14} />
                                            Search
                                        </button>
                                        <button
                                            onClick={() => setShowCheatsheet(!showCheatsheet)}
                                            className={`p-2 rounded-md border border-white/10 transition-colors ${showCheatsheet ? 'bg-brand-500/20 text-brand-400' : 'bg-black/40 text-zinc-500 hover:text-white'}`}
                                            title="Search Cheatsheet"
                                        >
                                            <Sparkles size={14} />
                                        </button>
                                    </div>

                                    {showCheatsheet && (
                                        <div className="mt-3 p-3 bg-brand-950/20 border border-brand-500/20 rounded-lg animate-in fade-in slide-in-from-top-1 duration-200">
                                            <div className="flex items-center gap-2 mb-2">
                                                <Sparkles size={12} className="text-brand-400" />
                                                <span className="text-[10px] font-black uppercase tracking-widest text-brand-400">Search Cheatsheet</span>
                                            </div>
                                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-[10px] font-mono">
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-zinc-500">Phrase:</span>
                                                    <code className="text-brand-300">"exact phrase"</code>
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-zinc-500">Exclude:</span>
                                                    <code className="text-brand-300">-unwanted</code>
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-zinc-500">Logical OR:</span>
                                                    <code className="text-brand-300">word1 OR word2</code>
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-zinc-500">Both:</span>
                                                    <code className="text-brand-300">word1 word2</code>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 font-mono text-xs">
                                    {events.map((e: AgentEvent, i: number) => (
                                        <div key={i} className="mb-1 border-b border-white/5 pb-1 flex gap-2 hover:bg-white/5">
                                            <span className="text-zinc-600 whitespace-nowrap">[{new Date(e.timestamp).toLocaleTimeString()}]</span>
                                            <span className={`whitespace-nowrap ${e.event_type.includes('ERR') ? 'text-red-500' : 'text-brand-500'}`}>{e.event_type}</span>
                                            <span className="text-zinc-400 break-all">{e.details}</span>
                                        </div>
                                    ))}
                                    {events.length === 0 && (
                                        <div className="h-full flex items-center justify-center text-zinc-700 uppercase font-black tracking-widest text-[10px]">
                                            {consoleSearch ? 'No matches found' : 'Empty Console Feed'}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// --- Visual Components ---

interface TabButtonProps {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    count?: number;
}

const TabButton = ({ active, onClick, icon, label, count }: TabButtonProps) => (
    <button
        onClick={onClick}
        className={`h-12 px-6 flex items-center gap-2 text-xs font-bold border-b-2 transition-all ${active
            ? 'border-brand-500 text-brand-500 bg-brand-500/5'
            : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
            }`}
    >
        {icon}
        {label}
        {count !== undefined && (
            <span className={`px-2 py-0.5 rounded-full text-[10px] ${active ? 'bg-brand-500/20 text-brand-400' : 'bg-white/10 text-zinc-500'}`}>
                {count}
            </span>
        )}
    </button>
);

const ProcessTreeNode = ({ node, selectedPid, onSelect, level }: { node: ProcessNode, selectedPid: number | null, onSelect: (pid: number) => void, level: number, key?: any }) => {
    const isSelected = selectedPid === node.pid;

    return (
        <div className="select-none relative">
            <div
                className={`flex items-center gap-3 py-2 px-3 rounded-lg mb-1 cursor-pointer transition-all border ${isSelected
                    ? 'bg-brand-500/10 border-brand-500/30 shadow-[0_0_10px_rgba(168,85,247,0.1)]'
                    : 'border-transparent hover:bg-white/5 hover:border-white/10'
                    }`}
                style={{ marginLeft: `${level * 20}px` }}
                onClick={() => onSelect(node.pid)}
            >
                <div className="p-1.5 rounded-md bg-zinc-800 border border-white/5 text-zinc-400">
                    <Terminal size={12} />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                        <span className={`text-xs font-bold truncate ${isSelected ? 'text-white' : 'text-zinc-300'}`}>
                            {node.name}
                        </span>
                        <span className="text-[9px] font-mono text-zinc-600 bg-zinc-900 px-1 rounded border border-white/5">
                            {node.pid}
                        </span>
                    </div>
                    {node.children.length > 0 && (
                        <div className="mt-1 flex items-center gap-1">
                            <div className="h-px w-2 bg-zinc-700"></div>
                            <span className="text-[8px] uppercase font-bold text-zinc-600">{node.children.length} Children</span>
                        </div>
                    )}
                </div>

                {isSelected && <ChevronRight size={14} className="text-brand-500 animate-pulse" />}
            </div>

            <div className="relative">
                {level > 0 && (
                    <div className="absolute left-0 top-0 bottom-0 w-px bg-zinc-800" style={{ left: `${(level * 20) - 10}px` }}></div>
                )}
                {node.children.map(child => (
                    <ProcessTreeNode
                        key={child.pid}
                        node={child}
                        selectedPid={selectedPid}
                        onSelect={onSelect}
                        level={level + 1}
                    />
                ))}
            </div>
        </div>
    );
};

const TimelineView = ({ events }: { events: AgentEvent[] }) => {
    if (events.length === 0) return <EmptyState msg="No events recorded for this process" />;

    return (
        <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-6">
            <div className="relative border-l border-zinc-800 ml-3 space-y-6">
                {events.map((e, i) => (
                    <div key={i} className="relative pl-8 group">
                        {/* Timeline Dot */}
                        <div className={`absolute -left-1.5 top-1.5 w-3 h-3 rounded-full border-2 border-[#080808] transition-colors ${e.event_type.includes('ERR') ? 'bg-red-500' :
                            e.event_type.includes('NET') ? 'bg-blue-500' :
                                e.event_type.includes('FILE') ? 'bg-yellow-500' :
                                    'bg-zinc-600'
                            }`}></div>

                        <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] font-mono text-zinc-500 font-bold">
                                    {new Date(e.timestamp).toLocaleTimeString()}
                                </span>
                                <span className={`text-xs font-black uppercase tracking-wider ${e.event_type.includes('ERR') ? 'text-red-400' :
                                    e.event_type.includes('NET') ? 'text-blue-400' :
                                        e.event_type.includes('FILE') ? 'text-yellow-400' :
                                            'text-zinc-300'
                                    }`}>
                                    {e.event_type}
                                </span>
                            </div>
                            <div className="p-3 rounded bg-[#111] border border-white/5 text-xs text-zinc-400 font-mono break-all group-hover:border-white/10 transition-colors shadow-sm relative">
                                {e.details}
                                {e.event_type === 'DOWNLOAD_DETECTED' && (
                                    <button
                                        onClick={() => {
                                            const pathMatch = e.details.match(/File Activity: (.*?) \(SHA256/);
                                            const path = pathMatch ? pathMatch[1] : null;
                                            if (path) {
                                                if (confirm(`Do you want to PIVOT to a deep-dive binary analysis of: ${path}?`)) {
                                                    voodooApi.pivotBin(path).then(success => {
                                                        if (success) {
                                                            alert("Pivot initiated! Check analysis queue for the new mission.");
                                                        } else {
                                                            alert("Failed to initiate pivot.");
                                                        }
                                                    });
                                                }
                                            }
                                        }}
                                        className="mt-2 flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded text-[11px] font-black uppercase transition-all shadow-lg shadow-brand-500/20"
                                    >
                                        <Binary size={14} />
                                        Pivot to Binary Analysis
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const EventTable = ({ events, type }: { events: AgentEvent[], type: string }) => {
    if (events.length === 0) return <EmptyState msg={`No ${type} activity detected`} />;

    return (
        <div className="absolute inset-0 overflow-y-auto custom-scrollbar">
            <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[#111] text-[10px] uppercase font-bold text-zinc-500 tracking-wider shadow-sm z-10">
                    <tr>
                        <th className="p-3 border-b border-white/10 w-32">Time</th>
                        <th className="p-3 border-b border-white/10 w-48">Event</th>
                        <th className="p-3 border-b border-white/10">Details</th>
                    </tr>
                </thead>
                <tbody className="text-xs font-mono text-zinc-300 divide-y divide-white/5">
                    {events.map((evt, i) => (
                        <tr key={i} className="hover:bg-white/5 transition-colors">
                            <td className="p-3 text-zinc-500 whitespace-nowrap">{new Date(evt.timestamp).toLocaleTimeString()}</td>
                            <td className="p-3 font-bold text-zinc-400">{evt.event_type}</td>
                            <td className="p-3 break-all text-zinc-400">{evt.details}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const EmptyState = ({ msg }: { msg: string }) => (
    <div className="h-full flex flex-col items-center justify-center text-zinc-600 space-y-3 opacity-50">
        <Server size={32} />
        <span className="text-xs font-bold uppercase tracking-widest">{msg}</span>
    </div>
);

const GhidraFindingsView = ({ findings }: { findings: any[] }) => {
    const [selected, setSelected] = useState<any>(findings[0] || null);
    const [filter, setFilter] = useState("");

    const filtered = findings.filter(f => f.function_name.toLowerCase().includes(filter.toLowerCase()));

    if (findings.length === 0) return <EmptyState msg="No static analysis findings for this task" />;

    return (
        <div className="absolute inset-0 flex overflow-hidden">
            {/* Symbol Sidebar */}
            <div className="w-64 border-r border-white/10 bg-[#0c0c0c] flex flex-col">
                <div className="p-3 border-b border-white/10 bg-black/20 flex items-center gap-2">
                    <div className="flex-1 relative">
                        <Terminal size={12} className="absolute left-2 top-2 text-zinc-600" />
                        <input
                            type="text"
                            placeholder="Filter symbols..."
                            className="w-full bg-zinc-900/50 border border-white/5 rounded px-7 py-1.5 text-[10px] focus:outline-none focus:border-brand-500/50 transition-colors"
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                        />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {filtered.map((f, i) => (
                        <div
                            key={i}
                            onClick={() => setSelected(f)}
                            className={`px-4 py-2 cursor-pointer border-l-2 transition-all hover:bg-white/5 ${selected?.function_name === f.function_name ? 'bg-brand-500/10 border-brand-500' : 'border-transparent'}`}
                        >
                            <div className={`text-[11px] font-bold truncate ${selected?.function_name === f.function_name ? 'text-white' : 'text-zinc-400'}`}>
                                {f.function_name}
                            </div>
                            <div className="text-[9px] font-mono text-zinc-600 italic">{f.entry_point}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Code View */}
            <div className="flex-1 flex flex-col min-w-0 bg-[#080808]">
                {selected ? (
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <div className="px-6 py-3 border-bottom border-white/5 bg-black/40 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Code2 size={16} className="text-brand-400" />
                                <span className="text-xs font-black text-zinc-300 tracking-wide uppercase">{selected.function_name}</span>
                            </div>
                            <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">Entry: {selected.entry_point}</span>
                        </div>
                        <div className="flex-1 overflow-auto p-6 font-mono text-[13px] leading-relaxed custom-scrollbar">
                            <div className="mb-8 overflow-hidden rounded-lg border border-white/5">
                                <div className="bg-[#111] px-4 py-1.5 border-b border-white/5 flex items-center gap-2">
                                    <Binary size={12} className="text-brand-500" />
                                    <span className="text-[9px] font-black text-brand-500 uppercase tracking-widest">Decompiled C Output</span>
                                </div>
                                <pre className="p-4 bg-black/40 text-purple-300/90 whitespace-pre">
                                    {selected.decompiled_code}
                                </pre>
                            </div>

                            <div className="overflow-hidden rounded-lg border border-white/5 opacity-80">
                                <div className="bg-[#111] px-4 py-1.5 border-b border-white/5 flex items-center gap-2">
                                    <Terminal size={12} className="text-zinc-500" />
                                    <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Assembly Dump</span>
                                </div>
                                <pre className="p-4 bg-black/20 text-zinc-500 whitespace-pre">
                                    {selected.assembly}
                                </pre>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center opacity-20 translate-y-[-10%]">
                        <Code2 size={64} className="mb-4" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em]">Select function to inspect</span>
                    </div>
                )}
            </div>
        </div>
    );
};
