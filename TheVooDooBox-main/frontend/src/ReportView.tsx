import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
    Activity,
    Server,
    FileText,
    Hash,
    Clock,
    ChevronRight,
    Globe,
    Terminal,
    ArrowLeft,
    List,
    Cpu,
    Loader2,
    Code2,
    Binary,
    Sparkles,
    Image,
    Search,
    Download,
    Pencil,
    ShieldAlert,
    CheckCircle,
    EyeOff,
    Tag as TagIcon,
    Fingerprint,
    ExternalLink,
    Share2
} from 'lucide-react';
import { AgentEvent, voodooApi, ForensicReport, Tag } from './voodooApi';
import AIInsightPanel from './AIInsightPanel';
import AnalystNotepad from './AnalystNotepad';

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
    const [selectedPid, setSelectedPid] = useState<number | null>(null);
    const [activeTab, setActiveTab] = useState<'timeline' | 'network' | 'web' | 'files' | 'registry' | 'console' | 'ghidra' | 'intelligence' | 'screenshots' | 'notes' | 'decoder'>('timeline');
    const [localEvents, setLocalEvents] = useState<AgentEvent[]>([]);
    const [ghidraFindings, setGhidraFindings] = useState<any[]>([]);
    const [screenshots, setScreenshots] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [aiReport, setAiReport] = useState<ForensicReport | null>(null);
    const [aiLoading, setAiLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [consoleSearch, setConsoleSearch] = useState("");
    const [consoleSearchInput, setConsoleSearchInput] = useState("");
    const [showCheatsheet, setShowCheatsheet] = useState(false);
    const [tags, setTags] = useState<Tag[]>([]);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, eventId: number } | null>(null);
    const navRef = React.useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    const scrollInterval = React.useRef<any>(null);

    const checkScroll = () => {
        if (navRef.current) {
            const { scrollLeft, scrollWidth, clientWidth } = navRef.current;
            setCanScrollLeft(scrollLeft > 0);
            setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 5);
        }
    };

    const startAutoScroll = (direction: 'left' | 'right') => {
        if (scrollInterval.current) return;
        scrollInterval.current = setInterval(() => {
            if (navRef.current) {
                const scrollAmount = direction === 'left' ? -10 : 10;
                navRef.current.scrollBy({ left: scrollAmount });
            }
        }, 16); // ~60fps
    };

    const stopAutoScroll = () => {
        if (scrollInterval.current) {
            clearInterval(scrollInterval.current);
            scrollInterval.current = null;
        }
    };

    const scrollNav = (direction: 'left' | 'right') => {
        if (navRef.current) {
            const scrollAmount = 250;
            navRef.current.scrollBy({
                left: direction === 'left' ? -scrollAmount : scrollAmount,
                behavior: 'smooth'
            });
        }
    };

    useEffect(() => {
        const nav = navRef.current;
        if (nav) {
            checkScroll();
            nav.addEventListener('scroll', checkScroll);
            window.addEventListener('resize', checkScroll);
            return () => {
                nav.removeEventListener('scroll', checkScroll);
                window.removeEventListener('resize', checkScroll);
                stopAutoScroll();
            };
        }
    }, [activeTab]); // Also re-check when tab changes in case it scrolls automatically


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

    const fetchTags = () => {
        if (taskId) {
            voodooApi.getTags(taskId).then(setTags).catch(err => console.error("Failed to fetch tags", err));
        }
    };

    useEffect(() => {
        fetchTags();
    }, [taskId]);

    const handleTag = async (tagType: string) => {
        if (!taskId || !contextMenu) return;
        try {
            await voodooApi.addTag(taskId, contextMenu.eventId, tagType);
            fetchTags();
        } catch (err) {
            console.error("Failed to tag event", err);
        } finally {
            setContextMenu(null);
        }
    };

    const onEventContextMenu = (e: React.MouseEvent, eventId?: number) => {
        if (!eventId) return;
        e.preventDefault();
        e.stopPropagation();

        const menuWidth = 192;
        const menuHeight = 180;
        const margin = 10;

        let x = e.clientX;
        let y = e.clientY;

        // Check if the click came from a button element (Fingerprint icon)
        const target = e.target as HTMLElement;
        const isButtonClick = target.closest('button') !== null;

        // If it's a button click, position relative to the button
        if (isButtonClick) {
            const button = target.closest('button');
            if (button) {
                const rect = button.getBoundingClientRect();

                // Check if there's enough space on the right
                const spaceOnRight = window.innerWidth - rect.right;

                if (spaceOnRight < menuWidth + margin) {
                    // Position to the left of the button
                    x = rect.left - menuWidth - margin;
                } else {
                    // Position to the right of the button
                    x = rect.right + margin;
                }

                // Vertically align with the button
                y = rect.top;
            }
        }

        // Final boundary checks
        if (x + menuWidth + margin > window.innerWidth) {
            x = window.innerWidth - menuWidth - margin;
        }

        if (x < margin) {
            x = margin;
        }

        if (y + menuHeight + margin > window.innerHeight) {
            y = window.innerHeight - menuHeight - margin;
        }

        if (y < margin) {
            y = margin;
        }

        setContextMenu({ x, y, eventId });
    };

    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    // 1. Fetch History and Ghidra Findings
    useEffect(() => {
        if (taskId) {
            voodooApi.fetchGhidraFindings(taskId).then(findings => {
                setGhidraFindings(findings);
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

    const handleAIAnalysis = async (mode: string = 'quick', autoResponse: boolean = true) => {
        setAiLoading(true);
        try {
            let report;
            if (taskId) {
                // Task-based analysis (Historical)
                report = await voodooApi.triggerTaskAnalysis(taskId, mode, autoResponse);
            } else {
                // Session-based analysis (Live)
                report = await voodooApi.getAIAnalysis(events, mode);
            }
            setAiReport(report);
        } catch (error) {
            console.error("AI Analysis failed:", error);
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

        return roots;
    }, [events, taskId]);

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

    const networkEvents = useMemo(() => {
        return sourceEvents.filter((e: AgentEvent) => ['NETWORK_CONNECT', 'LATERAL_MOVEMENT', 'NETWORK_DNS', 'GET', 'POST'].includes(e.event_type));
    }, [sourceEvents]);

    const fileEvents = useMemo(() => {
        return sourceEvents.filter((e: AgentEvent) => e.event_type.startsWith('FILE_'));
    }, [sourceEvents]);

    const registryEvents = useMemo(() => {
        return sourceEvents.filter((e: AgentEvent) => e.event_type.includes('REG_') || e.event_type.includes('REGISTRY'));
    }, [sourceEvents]);

    const webEvents = useMemo(() => {
        return sourceEvents.filter((e: AgentEvent) => e.event_type.startsWith('BROWSER_'));
    }, [sourceEvents]);

    const getProcessCreateDetail = () => {
        return selectedProcessEvents.find((e: AgentEvent) => e.event_type === 'PROCESS_CREATE')?.details || 'Process start parameters not captured.';
    };

    const stats = useMemo(() => {
        const taskEvents = events.filter((e: AgentEvent) => !taskId || e.task_id === taskId);
        if (taskEvents.length === 0) return { duration: '00:00:00', count: 0 };

        const start = Math.min(...taskEvents.map((e: AgentEvent) => e.timestamp));
        const end = Math.max(...taskEvents.map((e: AgentEvent) => e.timestamp));
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
            <div className="h-full w-full flex flex-col items-center justify-center bg-[#050505] space-y-4">
                <Loader2 className="text-brand-500 animate-spin" size={48} />
                <p className="text-security-muted text-[10px] font-black uppercase tracking-widest animate-pulse">Reconstructing Telemetry Timeline...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-[#050505] text-white overflow-hidden animate-in fade-in duration-300 font-sans">
            {/* Header - Scalable */}
            <header className="min-h-14 py-3 md:h-14 border-b border-white/10 bg-[#0a0a0a] flex flex-col md:flex-row items-center justify-between px-4 md:px-6 shadow-2xl z-10 gap-4">
                <div className="flex items-center gap-4 w-full md:w-auto">
                    <button onClick={onBack} className="p-2 hover:bg-white/5 rounded-full text-zinc-400 hover:text-white transition-colors group shrink-0">
                        <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
                    </button>
                    <img src="/logo.png" alt="VooDooBox" className="h-8 w-auto object-contain bg-black/50 rounded-sm border border-white/10 shrink-0" />
                    <div className="min-w-0">
                        <h1 className="text-[9px] font-black uppercase tracking-widest text-zinc-500 truncate">Telemetry: Neural Analysis</h1>
                        <div className="flex items-center gap-2">
                            <span className="text-sm md:text-base font-bold tracking-tight text-white truncate">{taskId || 'LIVE_SESSION'}</span>
                            <span className="hidden sm:inline-block px-2 py-0.5 rounded bg-brand-500/10 text-brand-400 text-[9px] font-black border border-brand-500/20 uppercase tracking-wider">
                                Dynamic
                            </span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center justify-between md:justify-end gap-4 text-[10px] md:text-xs font-mono text-zinc-500 w-full md:w-auto">
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-2"><Clock size={12} /> {stats.duration}</span>
                        <span className="hidden sm:flex items-center gap-2"><Cpu size={12} /> {stats.count} Events</span>
                    </div>
                    {taskId && (
                        <>
                            <button
                                onClick={() => {
                                    const url = `${window.location.origin}/?task=${taskId}`;
                                    navigator.clipboard.writeText(url);
                                    alert("Analysis Link Copied to Clipboard!");
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-md transition-all shadow-lg uppercase font-black tracking-wider text-[10px] bg-zinc-800 text-zinc-500 border border-white/5 shadow-none hover:bg-zinc-700 hover:text-zinc-300"
                                title="Share Analysis Link"
                            >
                                <Share2 size={14} />
                                <span className="hidden xs:inline">SHARE</span>
                            </button>

                            <button
                                onClick={() => {
                                    if (aiReport) {
                                        voodooApi.downloadPdf(taskId, aiReport);
                                    } else {
                                        // Switch to intelligence tab and explain
                                        setActiveTab('intelligence');
                                        alert("AI Analysis is required before downloading the PDF report. Please click 'RUN ANALYTICS'.");
                                    }
                                }}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all shadow-lg uppercase font-black tracking-wider text-[10px] ${aiReport
                                    ? 'bg-brand-600 hover:bg-brand-500 text-white border border-brand-400/50 shadow-brand-500/40'
                                    : 'bg-zinc-800 text-zinc-500 border border-white/5 shadow-none hover:bg-zinc-700 hover:text-zinc-300'
                                    }`}
                                title={aiReport ? "Download PDF Report" : "Analysis Required"}
                            >
                                <Download size={14} />
                                <span className="hidden xs:inline">PDF</span>
                            </button>
                        </>
                    )}
                </div>
            </header>

            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
                {/* Left: Enhanced Process Tree (Fluid Sidebar) */}
                <div className="w-full lg:w-80 xl:w-[350px] lg:border-r border-b lg:border-b-0 border-white/10 bg-[#0c0c0c] flex flex-col shrink-0 min-h-0 h-64 lg:h-auto">
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
                                tags={tags}
                                onTag={onEventContextMenu}
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

                    {/* Tabs Navigation - Scrollable */}
                    <div className="relative border-b border-white/10 bg-[#0a0a0a]">
                        {/* Left Gradient/Indicator */}
                        {canScrollLeft && (
                            <button
                                onClick={() => scrollNav('left')}
                                onMouseEnter={() => startAutoScroll('left')}
                                onMouseLeave={stopAutoScroll}
                                className="absolute left-0 top-0 bottom-0 w-12 z-50 bg-gradient-to-r from-[#0a0a0a] via-[#0a0a0a]/90 to-transparent flex items-center pl-2 hover:from-brand-500/20 transition-colors group"
                            >
                                <ArrowLeft size={20} className="text-brand-500 group-hover:scale-125 transition-transform drop-shadow-[0_0_8px_rgba(59,130,246,0.3)]" />
                            </button>
                        )}

                        <div
                            ref={navRef}
                            className="flex items-center px-12 overflow-x-auto overflow-y-hidden custom-scrollbar whitespace-nowrap scroll-smooth min-h-[48px] relative z-20"
                        >
                            <TabButton active={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')} icon={<List size={14} />} label="Timeline" count={timelineEvents.length} />
                            <TabButton active={activeTab === 'screenshots'} onClick={() => setActiveTab('screenshots')} icon={<Image size={14} />} label="Screenshots" count={screenshots.length} />
                            <TabButton active={activeTab === 'network'} onClick={() => setActiveTab('network')} icon={<Globe size={14} />} label="Network" count={networkEvents.length} />
                            <TabButton active={activeTab === 'web'} onClick={() => setActiveTab('web')} icon={<Globe size={14} />} label="Web" count={webEvents.length} />
                            <TabButton active={activeTab === 'files'} onClick={() => setActiveTab('files')} icon={<FileText size={14} />} label="Files" count={fileEvents.length} />
                            <TabButton active={activeTab === 'registry'} onClick={() => setActiveTab('registry')} icon={<Server size={14} />} label="Registry" count={registryEvents.length} />
                            <TabButton active={activeTab === 'ghidra'} onClick={() => setActiveTab('ghidra')} icon={<Code2 size={14} />} label="Static Findings" count={ghidraFindings.length} />
                            <TabButton active={activeTab === 'intelligence'} onClick={() => setActiveTab('intelligence')} icon={<Sparkles size={14} />} label="Intelligence" />
                            <TabButton active={activeTab === 'notes'} onClick={() => setActiveTab('notes')} icon={<Pencil size={14} />} label="Notes" />
                            <TabButton active={activeTab === 'decoder'} onClick={() => setActiveTab('decoder')} icon={<Binary size={14} />} label="Decoder" />
                            <TabButton active={activeTab === 'console'} onClick={() => setActiveTab('console')} icon={<Terminal size={14} />} label="Raw Feed" count={stats.count} />
                        </div>

                        {/* Right Gradient/Indicator */}
                        {canScrollRight && (
                            <button
                                onClick={() => scrollNav('right')}
                                onMouseEnter={() => startAutoScroll('right')}
                                onMouseLeave={stopAutoScroll}
                                className="absolute right-0 top-0 bottom-0 w-12 z-50 bg-gradient-to-l from-[#0a0a0a] via-[#0a0a0a]/90 to-transparent flex items-center justify-end pr-2 hover:from-brand-500/20 transition-colors group"
                            >
                                <ChevronRight size={20} className="text-brand-500 group-hover:scale-125 transition-transform drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                            </button>
                        )}
                    </div>

                    {/* Tab Content Area */}
                    <div className="flex-1 overflow-hidden relative bg-[#080808]">
                        {activeTab === 'timeline' && (
                            <TimelineView
                                events={timelineEvents}
                                tags={tags}
                                onTag={onEventContextMenu}
                            />
                        )}
                        {activeTab === 'screenshots' && (
                            <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-4 md:p-6">
                                {screenshots.length === 0 ? (
                                    <EmptyState msg="No screenshots captured" />
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
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
                                                <div className="p-3 bg-[#111] border-t border-white/5 flex items-center justify-between gap-2 overflow-hidden">
                                                    <span className="text-[9px] font-mono text-zinc-500 truncate">{shot}</span>
                                                    <a
                                                        href={voodooApi.getScreenshotUrl(shot, taskId || undefined)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="p-1 hover:bg-white/10 rounded text-zinc-400 hover:text-white transition-colors shrink-0"
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
                            <EventTable events={networkEvents} type="network" tags={tags} onTag={onEventContextMenu} />
                        )}
                        {activeTab === 'files' && (
                            <EventTable events={fileEvents} type="file" tags={tags} onTag={onEventContextMenu} />
                        )}
                        {activeTab === 'registry' && (
                            <EventTable events={registryEvents} type="registry" tags={tags} onTag={onEventContextMenu} />
                        )}
                        {activeTab === 'ghidra' && (
                            <GhidraFindingsView findings={ghidraFindings} />
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
                                        setSearchTerm("");
                                    }}
                                />
                            </div>
                        )}
                        {activeTab === 'notes' && (
                            <div className="absolute inset-0 bg-security-bg overflow-hidden">
                                <AnalystNotepad
                                    taskId={taskId || undefined}
                                    onNoteAdded={() => setActiveTab('intelligence')}
                                />
                            </div>
                        )}
                        {activeTab === 'web' && (
                            <WebView events={webEvents} taskId={taskId || undefined} />
                        )}
                        {activeTab === 'decoder' && (
                            <DecoderView />
                        )}
                        {activeTab === 'console' && (
                            <div className="absolute inset-0 flex flex-col bg-black">
                                <div className="p-3 md:p-4 border-b border-white/5 bg-zinc-900/20">
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <div className="relative group flex-1">
                                            <Terminal size={12} className="absolute left-3 top-2.5 text-zinc-600 group-focus-within:text-brand-500 transition-colors" />
                                            <input
                                                type="text"
                                                placeholder="Search logs..."
                                                className="w-full bg-black/40 border border-white/5 rounded-md pl-9 pr-3 py-2 text-[10px] md:text-[11px] text-zinc-200 focus:outline-none focus:border-brand-500/50 transition-all font-mono"
                                                value={consoleSearchInput}
                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConsoleSearchInput(e.target.value)}
                                                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                                    if (e.key === 'Enter') handleConsoleSearch();
                                                }}
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={handleConsoleSearch}
                                                className="flex-1 sm:flex-initial px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-md text-[10px] md:text-[11px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2"
                                            >
                                                <Search size={14} />
                                                Search
                                            </button>
                                            <button
                                                onClick={() => setShowCheatsheet(!showCheatsheet)}
                                                className={`p-2 rounded-md border border-white/10 transition-colors ${showCheatsheet ? 'bg-brand-500/20 text-brand-400' : 'bg-black/40 text-zinc-500 hover:text-white'}`}
                                            >
                                                <Sparkles size={14} />
                                            </button>
                                        </div>
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
                                        <div
                                            key={i}
                                            className={`mb-1 border-b border-white/5 pb-1 flex gap-2 hover:bg-white/5 cursor-context-menu select-none transition-colors group ${getTagStyle(tags, e.id)}`}
                                            onContextMenu={(evt) => onEventContextMenu(evt, e.id)}
                                        >
                                            <span className="text-zinc-600 whitespace-nowrap">[{new Date(e.timestamp).toLocaleTimeString()}]</span>
                                            <span className={`whitespace-nowrap ${e.event_type.includes('ERR') ? 'text-red-500' : 'text-brand-500'}`}>{e.event_type}</span>
                                            <span className="text-zinc-400 break-all flex-1">
                                                {e.details}
                                                {tags.find(t => t.event_id === e.id) && (
                                                    <span className={`ml-2 text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${tags.find(t => t.event_id === e.id)?.tag_type === 'Malicious' ? 'bg-red-500 text-white' :
                                                        tags.find(t => t.event_id === e.id)?.tag_type === 'KeyArtifact' ? 'bg-yellow-500 text-black' :
                                                            'bg-zinc-700 text-zinc-300'
                                                        }`}>
                                                        {tags.find(t => t.event_id === e.id)?.tag_type}
                                                    </span>
                                                )}
                                            </span>
                                            <button
                                                onClick={(evt) => onEventContextMenu(evt, e.id)}
                                                className="self-start p-1 hover:bg-white/10 rounded text-zinc-600 hover:text-brand-500 opacity-20 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                                title="Tag Event"
                                            >
                                                <Fingerprint size={12} />
                                            </button>
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

            {/* Context Menu */}
            {contextMenu && createPortal(
                <div
                    className="fixed z-[9999] bg-[#111] border border-white/10 shadow-2xl rounded-lg py-1 w-48 animate-in fade-in zoom-in-95 duration-100"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                    <div className="px-3 py-1.5 text-[9px] font-black text-zinc-500 uppercase tracking-widest border-b border-white/5 mb-1">
                        Precision Tagging
                    </div>
                    {[
                        { type: 'Malicious', label: 'Mark as Malicious', icon: <ShieldAlert size={14} className="text-threat-critical" />, color: 'hover:bg-threat-critical/20' },
                        { type: 'Benign', label: 'Mark as Benign', icon: <CheckCircle size={14} className="text-threat-low" />, color: 'hover:bg-threat-low/20' },
                        { type: 'KeyArtifact', label: 'Key Artifact', icon: <TagIcon size={14} className="text-brand-500" />, color: 'hover:bg-brand-500/20' },
                        { type: 'Ignored', label: 'Ignore/Background', icon: <EyeOff size={14} className="text-zinc-500" />, color: 'hover:bg-zinc-500/10' },
                    ].map((item, idx) => (
                        <button
                            key={idx}
                            onClick={() => handleTag(item.type)}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-[11px] text-zinc-300 transition-colors ${item.color}`}
                        >
                            {item.icon}
                            {item.label}
                        </button>
                    ))}
                </div>,
                document.body
            )}
        </div>
    );
}

const DecoderView = () => {
    const [input, setInput] = useState("");
    const [output, setOutput] = useState("");

    const decodeBase64 = () => {
        try {
            setOutput(atob(input));
        } catch (e) {
            setOutput("Error: Invalid Base64: " + (e as Error).message);
        }
    };

    const decodeHex = () => {
        try {
            let str = '';
            for (let i = 0; i < input.length; i += 2) {
                str += String.fromCharCode(parseInt(input.substr(i, 2), 16));
            }
            setOutput(str);
        } catch (e) {
            setOutput("Error: Invalid Hex");
        }
    };

    const reverse = () => {
        setOutput(input.split('').reverse().join(''));
    };

    const clear = () => {
        setInput("");
        setOutput("");
    }

    return (
        <div className="absolute inset-0 p-8 flex flex-col gap-6 bg-[#080808]">
            <div className="flex flex-col gap-2">
                <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                    <Binary size={16} className="text-brand-500" />
                    CyberChef Lite / Decoder
                </h2>
                <p className="text-xs text-zinc-600">
                    Quickly decode obfuscated strings found in telemetry.
                </p>
            </div>

            <div className="grid grid-cols-2 gap-6 flex-1 min-h-0">
                <div className="flex flex-col gap-2">
                    <label className="text-[10px] uppercase font-bold text-zinc-500">Input (Obfuscated)</label>
                    <textarea
                        className="flex-1 bg-[#111] border border-white/10 rounded-lg p-4 font-mono text-xs text-zinc-300 focus:border-brand-500/50 focus:outline-none resize-none"
                        placeholder="Paste base64, hex, or reversed strings here..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-[10px] uppercase font-bold text-zinc-500">Output (Cleartext)</label>
                    <textarea
                        className="flex-1 bg-[#111] border border-white/10 rounded-lg p-4 font-mono text-xs text-brand-400 focus:border-brand-500/50 focus:outline-none resize-none"
                        readOnly
                        value={output}
                    />
                </div>
            </div>

            <div className="flex items-center gap-3 p-4 bg-[#111] rounded-lg border border-white/5">
                <button onClick={decodeBase64} className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded text-xs font-bold text-zinc-300 transition-colors border border-white/5">
                    From Base64
                </button>
                <button onClick={decodeHex} className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded text-xs font-bold text-zinc-300 transition-colors border border-white/5">
                    From Hex
                </button>
                <button onClick={reverse} className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded text-xs font-bold text-zinc-300 transition-colors border border-white/5">
                    Reverse String
                </button>
                <div className="flex-1"></div>
                <button onClick={clear} className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded text-xs font-bold transition-colors border border-red-500/20">
                    Clear Workspace
                </button>
            </div>
        </div>
    );
};

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

const ProcessTreeNode = ({ node, selectedPid, onSelect, tags, onTag, level }: { node: ProcessNode, selectedPid: number | null, onSelect: (pid: number) => void, tags: Tag[], onTag: (e: React.MouseEvent, eventId?: number) => void, level: number }) => {
    const isSelected = selectedPid === node.pid;
    const processEventId = node.events.length > 0 ? node.events[0].id : undefined;

    return (
        <div className="select-none relative">
            <div
                className={`flex items-center gap-3 py-1.5 px-3 rounded-lg mb-0.5 cursor-pointer transition-all border group ${isSelected
                    ? 'bg-brand-500/10 border-brand-500/30'
                    : 'border-transparent hover:bg-white/5 hover:border-white/10'
                    } ${getTagStyle(tags, processEventId)}`}
                style={{ marginLeft: `${level * 20}px` }}
                onClick={() => onSelect(node.pid)}
                onContextMenu={(e) => onTag(e, processEventId)}
            >
                <div className="p-1.5 rounded-md bg-zinc-800 border border-white/5 text-zinc-400 shrink-0">
                    <Terminal size={12} />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                        <span className={`text-[11px] font-bold truncate ${isSelected ? 'text-white' : 'text-zinc-300'}`} title={node.name}>
                            {node.name}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                            {/* Tag Indicator for Sidebar */}
                            {tags.some(t => node.events.some(ev => ev.id === t.event_id)) && (
                                <div className={`w-2 h-2 rounded-full ${tags.find(t => node.events.some(ev => ev.id === t.event_id))?.tag_type === 'Malicious' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'bg-yellow-500 animate-pulse'}`}></div>
                            )}
                            <span className="text-[9px] font-mono text-zinc-600 bg-zinc-900 px-1 rounded border border-white/5">
                                {node.pid}
                            </span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onTag(e, processEventId);
                                }}
                                className="p-1 hover:bg-white/10 rounded text-zinc-600 hover:text-brand-500 opacity-20 group-hover:opacity-100 transition-opacity"
                                title="Tag Process"
                            >
                                <Fingerprint size={12} />
                            </button>
                        </div>
                    </div>
                </div>

                {isSelected && <ChevronRight size={14} className="text-brand-500 shrink-0" />}
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
                        tags={tags}
                        onTag={onTag}
                        level={level + 1}
                    />
                ))}
            </div>
        </div>
    );
};

const getTagStyle = (tags: Tag[], eventId?: number) => {
    if (!eventId) return "";
    const tag = tags.find(t => t.event_id === eventId);
    if (!tag) return "";
    switch (tag.tag_type) {
        case 'Malicious': return "bg-red-500/10 border-l-2 border-l-red-500 ring-1 ring-red-500/20";
        case 'Benign': return "opacity-40 grayscale blur-[0.2px]";
        case 'KeyArtifact': return "bg-yellow-500/10 border-l-2 border-l-yellow-500 ring-1 ring-yellow-500/20";
        case 'Ignored': return "opacity-20";
        default: return "";
    }
};

const TimelineView = ({ events, tags, onTag }: { events: AgentEvent[], tags: Tag[], onTag: (e: React.MouseEvent, eventId?: number) => void }) => {
    if (events.length === 0) return <EmptyState msg="No events recorded for this process" />;

    return (
        <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-6">
            <div className="relative border-l border-zinc-800 ml-3 space-y-6">
                {events.map((e: AgentEvent, i: number) => (
                    <div
                        key={i}
                        className={`relative pl-8 group transition-all duration-200 select-none ${getTagStyle(tags, e.id)}`}
                        onContextMenu={(evt: React.MouseEvent) => onTag(evt, e.id)}
                    >
                        <div className={`absolute -left-1.5 top-1.5 w-3 h-3 rounded-full border-2 border-[#080808] transition-colors ${e.event_type.includes('ERR') ? 'bg-red-500' :
                            e.event_type.includes('NET') || e.event_type === 'GET' || e.event_type === 'POST' ? 'bg-blue-500' :
                                e.event_type.includes('FILE') ? 'bg-yellow-500' :
                                    'bg-zinc-600'
                            }`}></div>

                        <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] font-mono text-zinc-500 font-bold">
                                    {new Date(e.timestamp).toLocaleTimeString()}
                                </span>
                                <span className={`text-xs font-black uppercase tracking-wider ${e.event_type.includes('ERR') ? 'text-red-400' :
                                    e.event_type.includes('NET') || e.event_type === 'GET' || e.event_type === 'POST' ? 'text-blue-400' :
                                        e.event_type.includes('FILE') ? 'text-yellow-400' :
                                            'text-zinc-300'
                                    }`}>
                                    {e.event_type}
                                </span>
                                {tags.find(t => t.event_id === e.id) && (
                                    <div className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-[0.1em] ${tags.find(t => t.event_id === e.id)?.tag_type === 'Malicious' ? 'bg-red-500 text-white' :
                                        tags.find(t => t.event_id === e.id)?.tag_type === 'KeyArtifact' ? 'bg-yellow-500 text-black' :
                                            'bg-zinc-700 text-zinc-300'
                                        }`}>
                                        {tags.find(t => t.event_id === e.id)?.tag_type}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-3 rounded bg-[#111] border border-white/5 text-xs text-zinc-400 font-mono break-all group-hover:border-white/10 transition-colors shadow-sm relative flex flex-col gap-2">
                            <div className="flex justify-between gap-4">
                                <span>{e.details}</span>
                                <button
                                    onClick={(evt) => onTag(evt, e.id)}
                                    className="self-start p-1 hover:bg-white/10 rounded text-zinc-600 hover:text-brand-500 opacity-20 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                    title="Tag Event"
                                >
                                    <Fingerprint size={12} />
                                </button>
                            </div>
                            {e.decoded_details && (
                                <div className="mt-2 p-2 bg-brand-500/5 border border-brand-500/20 rounded-md animate-in slide-in-from-left duration-500">
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse"></div>
                                        <span className="text-[9px] font-black text-brand-500 uppercase tracking-widest">Decoded Analysis</span>
                                    </div>
                                    <div className="text-brand-300/90 whitespace-pre-wrap font-mono text-[10px]">
                                        {e.decoded_details}
                                    </div>
                                </div>
                            )}
                        </div>
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
                ))}
            </div>
        </div>
    );
};

const EventTable = ({ events, type, tags, onTag }: { events: AgentEvent[], type: string, tags: Tag[], onTag: (e: React.MouseEvent, eventId?: number) => void }) => {
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
                    {events.map((evt: AgentEvent, i: number) => (
                        <tr
                            key={i}
                            className={`hover:bg-white/5 transition-colors group cursor-context-menu select-none ${getTagStyle(tags, evt.id)}`}
                            onContextMenu={(e: React.MouseEvent) => onTag(e, evt.id)}
                        >
                            <td className="p-3 text-zinc-500 whitespace-nowrap align-top">
                                <div className="flex items-center gap-2">
                                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${evt.event_type.includes('ERR') ? 'bg-red-500' :
                                        evt.event_type.includes('NET') || evt.event_type === 'GET' || evt.event_type === 'POST' ? 'bg-blue-500' :
                                            evt.event_type.includes('FILE') ? 'bg-yellow-500' :
                                                'bg-zinc-600'
                                        }`}></div>
                                    {new Date(evt.timestamp).toLocaleTimeString()}
                                </div>
                            </td>
                            <td className="p-3 font-bold text-zinc-400 align-top">
                                <div className="flex items-center gap-2">
                                    {evt.event_type}
                                    {tags.find(t => t.event_id === evt.id) && (
                                        <TagIcon size={10} className={
                                            tags.find(t => t.event_id === evt.id)?.tag_type === 'Malicious' ? 'text-red-500' :
                                                tags.find(t => t.event_id === evt.id)?.tag_type === 'KeyArtifact' ? 'text-yellow-500' :
                                                    'text-zinc-500'
                                        } />
                                    )}
                                </div>
                            </td>
                            <td className="p-3 text-zinc-400 align-top">
                                <div className="flex flex-col gap-2">
                                    <div className="flex justify-between items-start gap-4">
                                        <span className="break-all leading-relaxed">{evt.details}</span>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {evt.decoded_details && (
                                                <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-brand-500/20 border border-brand-500/30 text-brand-400 animate-pulse" title="Decoded Data Available">
                                                    <Sparkles size={10} />
                                                    <span className="text-[8px] font-black uppercase tracking-tighter">DECODED</span>
                                                </div>
                                            )}
                                            <button
                                                onClick={(e: React.MouseEvent) => onTag(e, evt.id)}
                                                className="p-1 hover:bg-white/10 rounded text-zinc-600 hover:text-brand-500 opacity-20 group-hover:opacity-100 transition-opacity"
                                                title="Tag Event"
                                            >
                                                <Fingerprint size={12} />
                                            </button>
                                        </div>
                                    </div>
                                    {evt.decoded_details && (
                                        <div className="p-2 bg-brand-500/5 border border-white/5 rounded italic text-[10px] text-brand-300 font-mono whitespace-pre-wrap">
                                            {evt.decoded_details}
                                        </div>
                                    )}
                                </div>
                            </td>
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

const WebView = ({ events }: { events: AgentEvent[], taskId?: string }) => {
    if (events.length === 0) return <EmptyState msg="No web activity detected" />;

    return (
        <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-6 bg-[#080808]">
            <div className="max-w-5xl mx-auto space-y-8">
                {events.map((e, i) => {
                    const isUrl = e.event_type === 'BROWSER_URL';
                    const isDownload = e.event_type === 'BROWSER_DOWNLOAD';

                    return (
                        <div key={i} className="group bg-[#0c0c0c] border border-white/5 rounded-xl overflow-hidden hover:border-brand-500/30 transition-all shadow-xl">
                            {/* Header */}
                            <div className="px-4 py-3 bg-[#111] border-b border-white/5 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`p-1.5 rounded-lg ${isDownload ? 'bg-amber-500/10 text-amber-500' : 'bg-brand-500/10 text-brand-500'}`}>
                                        {isDownload ? <Download size={14} /> : <Globe size={14} />}
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{e.event_type}</div>
                                        <div className="text-[9px] font-mono text-zinc-600">{new Date(e.timestamp).toLocaleString()}</div>
                                    </div>
                                </div>
                                <div className="px-2 py-0.5 rounded bg-zinc-900 border border-white/5 text-[9px] font-mono text-zinc-400">
                                    PID {e.process_id}
                                </div>
                            </div>

                            {/* Content */}
                            <div className="p-4 flex gap-6">
                                <div className="flex-1 space-y-3">
                                    <div className="flex items-start gap-3">
                                        <div className="mt-1 text-zinc-500"><Terminal size={14} /></div>
                                        <div className="text-xs text-zinc-300 font-mono break-all leading-relaxed">
                                            {e.details}
                                        </div>
                                    </div>

                                    {/* Sub-details for specific types */}
                                    {isUrl && e.details.includes('URL: ') && (
                                        <div className="mt-4 p-3 bg-black/40 rounded-lg border border-white/5 flex items-center justify-between gap-4">
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[9px] font-black uppercase text-brand-500 mb-1">Target Resource</div>
                                                <div className="text-xs text-zinc-400 truncate font-mono">
                                                    {e.details.split('URL: ')[1]}
                                                </div>
                                            </div>
                                            <a
                                                href={e.details.split('URL: ')[1]}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="p-2 bg-white/5 hover:bg-brand-500/20 rounded-lg text-zinc-400 hover:text-brand-400 transition-all border border-white/5"
                                            >
                                                <ExternalLink size={14} />
                                            </a>
                                        </div>
                                    )}
                                </div>

                                {/* Right Side: Visual Evidence or Context */}
                                {e.decoded_details && (
                                    <div className="w-1/3 shrink-0 p-3 bg-brand-500/5 border border-brand-500/20 rounded-lg animate-in fade-in duration-500 max-h-[300px] overflow-hidden flex flex-col">
                                        <div className="flex items-center gap-2 mb-2 shrink-0">
                                            <Sparkles size={12} className="text-brand-500" />
                                            <span className="text-[9px] font-black text-brand-500 uppercase tracking-widest">
                                                {e.decoded_details.includes("FULL DOM PREVIEW") ? "DOM Snapshot" : "Web Decoded"}
                                            </span>
                                        </div>
                                        <div className="text-brand-300/80 font-mono text-[10px] whitespace-pre-wrap leading-relaxed overflow-y-auto custom-scrollbar flex-1">
                                            {e.decoded_details.includes("FULL DOM PREVIEW") ? (
                                                <div className="space-y-4">
                                                    {e.decoded_details.split("FULL DOM PREVIEW:")[0].includes("DECODED DATA FOUND IN DOM:") && (
                                                        <div className="p-2 bg-brand-500/10 border border-brand-500/20 rounded text-brand-400 font-bold">
                                                            {e.decoded_details.split("FULL DOM PREVIEW:")[0]}
                                                        </div>
                                                    )}
                                                    <div className="opacity-50 text-[9px] italic">
                                                        {e.decoded_details.split("FULL DOM PREVIEW:")[1] || e.decoded_details}
                                                    </div>
                                                </div>
                                            ) : (
                                                e.decoded_details
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const GhidraFindingsView = ({ findings }: { findings: any[] }) => {
    const [selected, setSelected] = useState<any>(findings[0] || null);
    const [filter, setFilter] = useState("");

    const filtered = findings.filter(f => f.function_name.toLowerCase().includes(filter.toLowerCase()));

    if (findings.length === 0) return <EmptyState msg="No static analysis findings for this task" />;

    return (
        <div className="absolute inset-0 flex overflow-hidden">
            <div className="w-64 border-r border-white/10 bg-[#0c0c0c] flex flex-col">
                <div className="p-3 border-b border-white/10 bg-black/20 flex items-center gap-2">
                    <div className="flex-1 relative">
                        <Terminal size={12} className="absolute left-2 top-2 text-zinc-600" />
                        <input
                            type="text"
                            placeholder="Filter symbols..."
                            className="w-full bg-zinc-900/50 border border-white/5 rounded px-7 py-1.5 text-[10px] focus:outline-none focus:border-brand-500/50 transition-colors"
                            value={filter}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
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

            <div className="flex-1 flex flex-col min-w-0 bg-[#080808]">
                {selected ? (
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <div className="px-6 py-3 border-b border-white/5 bg-black/40 flex items-center justify-between">
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
                                <pre className="p-4 bg-black/40 text-purple-300/90 whitespace-pre font-mono">
                                    {selected.decompiled_code}
                                </pre>
                            </div>

                            <div className="overflow-hidden rounded-lg border border-white/5 opacity-80">
                                <div className="bg-[#111] px-4 py-1.5 border-b border-white/5 flex items-center gap-2">
                                    <Terminal size={12} className="text-zinc-500" />
                                    <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Assembly Dump</span>
                                </div>
                                <pre className="p-4 bg-black/20 text-zinc-500 whitespace-pre font-mono">
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
