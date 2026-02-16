import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';

import {
    RefreshCw,
    Activity,
    Shield,
    Trash2,
    FileText,
    Play,
    Monitor,
    ChevronRight,
    ChevronLeft,
    RefreshCcw,
    Brain,
    Clock,
    Search,
    Share2,
    X
} from 'lucide-react';
import { voodooApi, AgentEvent, BASE_URL, TaskProgressEvent, ForensicReport, MitreTechnique } from './voodooApi';
import GhidraConsole from './GhidraConsole';
import ProcessLineage from './ProcessLineage';


interface AnalysisTask {
    id: string;
    filename: string;
    original_filename?: string;
    file_hash?: string;
    status: string;
    verdict: string | null;
    risk_score: number | null;
    created_at: number;
    completed_at: number | null;
    sandbox_id: string | null;
    remnux_status?: string;
    remnux_report?: any;
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
    'system',
    'smss.exe'
];

export default function TaskDashboard({ onSelectTask, onOpenSubmission, onOpenLineage }: {
    onSelectTask: (taskId: string) => void,
    onOpenSubmission: () => void,
    onOpenLineage: (taskId: string) => void
}) {

    const [tasks, setTasks] = useState<AnalysisTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('All');
    const [searchTerm, setSearchTerm] = useState("");
    const [showNoise, setShowNoise] = useState(false);
    const [isSystemHealthy, setIsSystemHealthy] = useState(true);

    useEffect(() => {
        const checkHealth = async () => {
            const healthy = await voodooApi.getSystemHealth();
            setIsSystemHealthy(healthy);
        };
        checkHealth();
        const interval = setInterval(checkHealth, 30000); // Check every 30s
        return () => clearInterval(interval);
    }, []);

    // Expansion State
    const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
    const [rawEvents, setRawEvents] = useState<AgentEvent[]>([]);
    const [expandedScreenshots, setExpandedScreenshots] = useState<string[]>([]);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [activeGhidraTask, setActiveGhidraTask] = useState<{ id: string, filename: string } | null>(null);
    const [progressMap, setProgressMap] = useState<Record<string, TaskProgressEvent>>({});
    const [aiReport, setAiReport] = useState<ForensicReport | null>(null);

    // Resizable Panels State
    const sidebarRef = useRef<HTMLDivElement>(null);
    const tabsRef = useRef<HTMLDivElement>(null);
    const [isResizing, setIsResizing] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(400);

    const scrollTabs = (direction: 'left' | 'right') => {
        if (tabsRef.current) {
            const scrollAmount = 300;
            tabsRef.current.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
        }
    };

    const startResizing = useCallback(() => setIsResizing(true), []);
    const stopResizing = useCallback(() => setIsResizing(false), []);
    const resize = useCallback((mouseMoveEvent: MouseEvent) => {
        if (isResizing && sidebarRef.current) {
            const newWidth = mouseMoveEvent.clientX - sidebarRef.current.getBoundingClientRect().left;
            if (newWidth > 300 && newWidth < window.innerWidth - 400) {
                setSidebarWidth(newWidth);
            }
        }
    }, [isResizing]);

    useEffect(() => {
        window.addEventListener("mousemove", resize);
        window.addEventListener("mouseup", stopResizing);
        return () => {
            window.removeEventListener("mousemove", resize);
            window.removeEventListener("mouseup", stopResizing);
        };
    }, [resize, stopResizing]);

    const selectedTask = useMemo(() => tasks.find(t => t.id === expandedTaskId), [tasks, expandedTaskId]);

    useEffect(() => {
        const ws = voodooApi.connectTaskProgress((event) => {
            setProgressMap(prev => ({
                ...prev,
                [event.task_id]: event
            }));

            // Auto-refresh task list on completion
            if (event.percent === 100) {
                setTimeout(() => fetchTasks(), 1000);
            }
        });

        return () => {
            ws.close();
        };
    }, []);


    const [expandedTab, setExpandedTab] = useState<string>('timeline');

    const toggleExpandedTab = (tab: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedTab(tab);
    };

    const expandedEvents = useMemo(() => {
        if (!rawEvents) return [];
        if (showNoise) return rawEvents;
        return rawEvents.filter(e => e.process_name && !NOISE_FILTER_PROCESSES.includes(e.process_name.toLowerCase()));
    }, [rawEvents, showNoise]);

    const handleRowClick = async (task: AnalysisTask) => {
        if (expandedTaskId === task.id) {
            setExpandedTaskId(null);
            setRawEvents([]);
            setExpandedScreenshots([]);
            setAiReport(null);
            return;
        }

        setExpandedTaskId(task.id);
        setRawEvents([]);
        setExpandedScreenshots([]);
        setAiReport(null);
        setIsLoadingDetails(true);

        try {
            console.log(`[TaskDashboard] expanding task ${task.id}, fetching history...`);
            const allEvents = await voodooApi.fetchHistory(task.id);
            console.log(`[TaskDashboard] fetchHistory result: ${allEvents.length} events`);
            setRawEvents(allEvents);

            const relevantScreenshots = await voodooApi.listScreenshots(task.id);
            console.log(`[TaskDashboard] screenshots found: ${relevantScreenshots.length}`);
            setExpandedScreenshots(relevantScreenshots);

            // Fetch AI Report for MITRE data
            try {
                const report = await voodooApi.getAIAnalysis(allEvents);
                setAiReport(report);
            } catch (err) {
                console.error("[TaskDashboard] Failed to fetch AI report", err);
            }

        } catch (e) {
            console.error("Failed to fetch expanded details", e);
        } finally {
            setIsLoadingDetails(false);
        }
    };

    useEffect(() => {
        fetchTasks();
        const interval = setInterval(() => {
            fetchTasks();
        }, 5000); // Refresh every 5 seconds
        return () => clearInterval(interval);
    }, []);

    const fetchTasks = async () => {
        try {
            const response = await fetch(`${BASE_URL}/tasks`);
            if (response.ok) {
                const data: AnalysisTask[] = await response.json();
                setTasks(data);
            }
            setLoading(false);
        } catch (error) {
            console.error('Failed to fetch tasks:', error);
            setLoading(false);
        }
    };

    const handleDeleteTask = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("Are you sure you want to delete this task and all its data?")) return;

        try {
            const success = await voodooApi.deleteTask(id);
            if (success) {
                fetchTasks();
                if (expandedTaskId === id) setExpandedTaskId(null);
            } else {
                alert("Failed to delete task.");
            }
        } catch (error) {
            console.error('Delete failed', error);
            alert("Error deleting task.");
        }
    };

    const handlePurgeAll = async () => {
        if (!confirm("CRITICAL: This will permanently delete ALL tasks, events, screenshots, and uploaded samples. Are you sure?")) return;

        try {
            const success = await voodooApi.purgeAll();
            if (success) {
                fetchTasks();
                setExpandedTaskId(null);
                alert("Sandbox environment purged successfully.");
            } else {
                alert("Failed to purge sandbox.");
            }
        } catch (error) {
            console.error('Purge failed', error);
            alert("Error purging sandbox.");
        }
    };

    const formatTimestamp = (timestamp: number): string => {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);

        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes} mins ago`;
        if (hours < 24) return `${hours} hours ago`;
        return new Date(timestamp).toLocaleDateString() + ' ' + new Date(timestamp).toLocaleTimeString();
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-security-bg animate-in fade-in duration-500 overflow-hidden min-h-0">
            {/* Action Header - Responsive */}
            <div className="p-4 md:p-6 bg-security-surface border-b border-security-border flex flex-col sm:flex-row items-center justify-between shadow-xl z-20 gap-4">
                <div className="flex items-center gap-4 md:gap-8 w-full sm:w-auto overflow-hidden">
                    <img src="/logo.png" alt="VooDooBox" className="h-12 md:h-16 w-auto object-contain drop-shadow-[4px_4px_0px_rgba(0,0,0,1)] shrink-0" />
                    <div className="hidden lg:block shrink-0">
                        <div className="text-[10px] font-black text-security-muted uppercase tracking-[0.2em] mb-1">Status</div>
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${isSystemHealthy ? 'bg-voodoo-toxic-green animate-pulse' : 'bg-red-500'} transition-colors duration-500`}></div>
                            <span className={`text-xs font-bold uppercase ${isSystemHealthy ? 'text-white' : 'text-red-400'}`}>
                                {isSystemHealthy ? 'Operational Core' : 'System Offline'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                    {/* Search Bar */}
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search size={12} className="text-security-muted group-focus-within:text-brand-500 transition-colors" />
                        </div>
                        <input
                            type="text"
                            placeholder="SEARCH INTEL..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="bg-security-panel border border-security-border rounded pl-9 pr-3 py-2 text-[10px] md:text-xs text-white outline-none focus:border-brand-500/50 w-full sm:w-48 transition-all font-mono placeholder:text-security-muted/50"
                        />
                    </div>

                    <button
                        onClick={onOpenSubmission}
                        className="btn-primary h-9 md:h-10 px-4 md:px-6 flex items-center gap-2 group shadow-[0_0_15px_rgba(57,255,20,0.2)] hover:bg-voodoo-toxic-green hover:text-black transition-all flex-1 sm:flex-initial justify-center"
                    >
                        <Play fill="currentColor" size={14} />
                        <span className="font-black uppercase tracking-[0.2em] text-[10px]">Submit</span>
                    </button>

                    <select
                        className="bg-security-panel border border-security-border rounded px-3 py-2 text-[10px] md:text-xs text-white outline-none focus:border-security-muted h-9 md:h-10 flex-1 sm:flex-initial"
                        value={statusFilter}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)}
                    >
                        <option value="All">All Statuses</option>
                        <option value="Queued">Queued</option>
                        <option value="Preparing">Preparing</option>
                        <option value="Running">Running</option>
                        <option value="Completed">Completed</option>
                        <option value="Failed">Failed</option>
                    </select>

                    <button
                        onClick={handlePurgeAll}
                        className="p-2 h-9 md:h-10 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-lg transition-all flex items-center gap-2 shrink-0"
                        title="Purge All Data"
                    >
                        <RefreshCcw size={16} />
                        <span className="text-[10px] font-black uppercase hidden md:inline">Purge All</span>
                    </button>
                </div>
            </div>

            {/* Split View Container */}
            <div className="flex-1 flex overflow-hidden min-h-0 relative select-none" onMouseMove={resize} onMouseUp={stopResizing}>

                {/* Left Pane: Task List */}
                <div
                    ref={sidebarRef}
                    className="flex-shrink-0 flex flex-col bg-security-bg/30 border-r border-security-border overflow-hidden transition-all duration-75 relative"
                    style={{ width: expandedTaskId ? sidebarWidth : '100%' }}
                >
                    <div className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar p-0">
                        <div className="min-w-[800px] xl:min-w-0">
                            {/* Header Row */}
                            <div className="grid grid-cols-12 gap-4 p-4 bg-[#111] border-b border-security-border text-[10px] font-black uppercase text-zinc-500 tracking-widest sticky top-0 z-10">
                                <div className="col-span-1">ID</div>
                                <div className="col-span-1">Verdict</div>
                                <div className="col-span-2">Timestamp</div>
                                <div className="col-span-1">Sandbox</div>
                                <div className="col-span-3">Filename</div>
                                <div className="col-span-2">Status</div>
                                <div className="col-span-2 text-right">Actions</div>
                            </div>

                            <div className="divide-y divide-security-border/40">
                                {tasks
                                    .filter((task: AnalysisTask) => {
                                        const matchesStatus = statusFilter === 'All' || task.status.toLowerCase().includes(statusFilter.toLowerCase());
                                        const term = searchTerm.toLowerCase();
                                        const matchesSearch = !term ||
                                            task.id.toLowerCase().includes(term) ||
                                            (task.filename && task.filename.toLowerCase().includes(term)) ||
                                            (task.original_filename && task.original_filename.toLowerCase().includes(term)) ||
                                            (task.file_hash && task.file_hash.toLowerCase().includes(term)) ||
                                            (task.verdict && task.verdict.toLowerCase().includes(term));

                                        return matchesStatus && matchesSearch;
                                    })
                                    .map((task: AnalysisTask) => {
                                        const isSelected = expandedTaskId === task.id;
                                        const sandboxName = task.sandbox_id || (task.status.includes('VM') || task.status.includes('Sandbox') || task.status === 'Queued' ? 'Auto' : 'Active Unit');

                                        return (
                                            <div
                                                key={task.id}
                                                onClick={() => handleRowClick(task)}
                                                className={`grid grid-cols-12 gap-2 p-3 items-center hover:bg-brand-500/5 transition-colors group cursor-pointer border-b border-security-border/40 shadow-sm ${isSelected ? 'bg-brand-500/10 border-l-2 border-l-brand-500' : 'border-l-2 border-l-transparent'}`}
                                            >
                                                <div className="col-span-1 flex items-center gap-1 hover:bg-white/5 p-1 rounded cursor-pointer z-10">
                                                    {isSelected ? <ChevronRight size={12} className="text-brand-500" /> : <ChevronRight size={12} className="text-security-muted/50" />}
                                                    <span className={`text-[10px] font-black cursor-text select-text block truncate ${isSelected ? 'text-brand-500' : 'text-brand-500/80'}`}>
                                                        #{task.id}
                                                    </span>
                                                </div>

                                                <div className="col-span-1">
                                                    {task.verdict ? (
                                                        <span className={`px-2 py-1 rounded text-[9px] font-black border uppercase tracking-wider ${task.verdict === 'Malicious' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                                                            task.verdict === 'Suspicious' ? 'bg-orange-500/10 text-orange-500 border-orange-500/20' :
                                                                'bg-green-500/10 text-green-500 border-green-500/20'
                                                            }`}>
                                                            {task.verdict}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[9px] text-zinc-600 font-mono">PENDING</span>
                                                    )}
                                                </div>

                                                <div className="col-span-2 flex items-center gap-2 min-w-0">
                                                    <Clock size={12} className="text-security-muted shrink-0" />
                                                    <span className="text-[10px] font-medium text-slate-300 cursor-text select-text truncate">
                                                        {formatTimestamp(task.created_at)}
                                                    </span>
                                                </div>

                                                <div className="col-span-1">
                                                    <div className="flex items-center gap-1">
                                                        <Monitor size={12} className="text-brand-500/50" />
                                                        <span className="text-[10px] font-bold text-slate-400 cursor-text select-text truncate">{sandboxName}</span>
                                                    </div>
                                                </div>

                                                <div className="col-span-3 min-w-0 text-white font-bold">
                                                    <div className="flex items-start gap-2 min-w-0">
                                                        {task.verdict === 'Malicious' ? <FileText size={16} className="text-red-500 shrink-0" /> : <FileText size={16} className="text-zinc-500 shrink-0" />}
                                                        <span className="text-[11px] truncate cursor-text select-text" title={task.original_filename || task.filename}>
                                                            {task.original_filename || task.filename}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="col-span-2">
                                                    <div className={`text-[10px] font-black uppercase flex flex-col gap-1 w-full`}>
                                                        <div className={`flex items-center gap-1.5 ${task.status === 'Completed' || task.status === 'Analysis Complete' ? 'text-brand-500' :
                                                            task.status.includes('Failed') ? 'text-threat-critical' :
                                                                'text-yellow-500 animate-pulse'
                                                            }`}>
                                                            <div className={`w-1.5 h-1.5 rounded-full ${task.status === 'Completed' || task.status === 'Analysis Complete' ? 'bg-brand-500' :
                                                                task.status.includes('Failed') ? 'bg-threat-critical' :
                                                                    'bg-yellow-500'
                                                                }`}></div>
                                                            <span className="cursor-text select-text truncate flex-1" title={task.status}>
                                                                {progressMap[task.id] && task.status !== 'Completed' && !task.status.includes('Failed')
                                                                    ? `EXE: ${progressMap[task.id].message}`
                                                                    : `EXE: ${task.status}`}
                                                            </span>
                                                            {progressMap[task.id] && task.status !== 'Completed' && !task.status.includes('Failed') && (
                                                                <span className="text-[9px] opacity-80">{progressMap[task.id].percent}%</span>
                                                            )}
                                                        </div>

                                                        {progressMap[task.id] && task.status !== 'Completed' && !task.status.includes('Failed') && (
                                                            <div className="w-full h-0.5 bg-zinc-800 rounded-full overflow-hidden mb-1">
                                                                <div
                                                                    className="h-full bg-brand-500 transition-all duration-300 ease-out"
                                                                    style={{ width: `${progressMap[task.id].percent}%` }}
                                                                ></div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="col-span-2 flex justify-end items-center gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); onSelectTask(task.id); }}
                                                        title="View Neural Report"
                                                        className="p-1.5 hover:bg-brand-500/20 text-brand-500 border border-transparent hover:border-brand-500/30 rounded transition-all"
                                                    >
                                                        <Brain size={14} />
                                                    </button>
                                                    <button
                                                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleDeleteTask(task.id, e); }}
                                                        title="Delete Task"
                                                        className="p-1.5 hover:bg-threat-critical/20 text-threat-critical border border-transparent hover:border-threat-critical/30 rounded transition-all"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                {tasks.length === 0 && (
                                    <div className="p-12 text-center">
                                        <FileText className="mx-auto text-security-muted mb-4 opacity-50" size={48} />
                                        <p className="text-security-muted font-bold">No analysis tasks found.</p>
                                        <p className="text-xs text-security-muted/50 mt-2">Submit a sample to begin.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Resizer Handle */}
                {expandedTaskId && (
                    <div
                        onMouseDown={startResizing}
                        className={`w-1 cursor-col-resize hover:bg-brand-500 transition-colors z-50 flex-shrink-0 relative ${isResizing ? 'bg-brand-500' : 'bg-[#111] border-l border-white/5'}`}
                    >
                        {/* Drag Handle Indicator */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-0.5 bg-zinc-600 rounded-full"></div>
                    </div>
                )}

                {/* Right Pane: Details View */}
                {expandedTaskId && selectedTask && (
                    <div className="flex-1 flex flex-col bg-[#0b0b0b] min-w-0 overflow-hidden shadow-2xl z-20">
                        {/* Header */}
                        <div className="p-4 border-b border-white/5 bg-[#111] flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="bg-brand-500/10 p-2 rounded"><Activity size={18} className="text-brand-500" /></div>
                                <div>
                                    <h3 className="text-sm font-black uppercase tracking-widest text-white">Analyst Report</h3>
                                    <div className="text-[10px] font-mono text-zinc-500">TASK ID: <span className="text-brand-500">#{selectedTask.id}</span></div>
                                </div>
                            </div>

                            <button onClick={() => setExpandedTaskId(null)} className="p-2 hover:bg-white/5 text-zinc-500 hover:text-white rounded transition-colors">
                                <X size={16} />
                            </button>
                        </div>

                        {/* Tabs Bar */}
                        {/* Tabs Bar */}
                        <div className="flex items-center bg-[#080808] border-b border-white/5 shrink-0">
                            <button
                                onClick={() => scrollTabs('left')}
                                className="p-2.5 text-zinc-500 hover:text-white hover:bg-white/5 transition-colors border-r border-white/5"
                            >
                                <ChevronLeft size={14} />
                            </button>

                            <div
                                ref={tabsRef}
                                className="flex-1 flex gap-2 overflow-x-auto no-scrollbar px-3 py-2 scroll-smooth items-center"
                            >
                                {[
                                    { id: 'timeline', label: 'Timeline' },
                                    { id: 'fishbone', label: 'Process Lineage' },
                                    { id: 'network', label: 'Network' },
                                    { id: 'files', label: 'Files' },
                                    { id: 'registry', label: 'Registry' },
                                    { id: 'static', label: 'Static Analysis' },
                                    { id: 'mitre', label: 'MITRE Matrix' },
                                    { id: 'thinking', label: 'AI Thinking' },
                                    { id: 'screenshots', label: `Screenshots (${expandedScreenshots.length})` },
                                ].map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={(e: React.MouseEvent<HTMLButtonElement>) => toggleExpandedTab(tab.id, e)}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-wider transition-all border whitespace-nowrap ${expandedTab === tab.id
                                            ? 'bg-brand-500/10 border-brand-500/20 text-brand-400'
                                            : 'bg-transparent border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                                            }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            <button
                                onClick={() => scrollTabs('right')}
                                className="p-2.5 text-zinc-500 hover:text-white hover:bg-white/5 transition-colors border-l border-white/5"
                            >
                                <ChevronRight size={14} />
                            </button>

                            <div className="px-2 border-l border-white/5">
                                <select
                                    value={expandedTab}
                                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setExpandedTab(e.target.value)}
                                    className="bg-[#111] text-[10px] font-bold uppercase text-zinc-400 border border-white/10 rounded py-1 px-2 focus:border-brand-500 outline-none cursor-pointer hover:bg-[#1a1a1a] transition-colors"
                                >
                                    <option value="timeline">Timeline</option>
                                    <option value="fishbone">Process Lineage</option>
                                    <option value="network">Network</option>
                                    <option value="files">Files</option>
                                    <option value="registry">Registry</option>
                                    <option value="static">Static Analysis</option>
                                    <option value="mitre">MITRE Matrix</option>
                                    <option value="thinking">AI Thinking</option>
                                    <option value="screenshots">Screenshots</option>
                                </select>
                            </div>
                        </div>

                        {/* Scrollable Content Area */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 relative">
                            {/* Target Info */}
                            <div className="bg-[#111] border border-white/5 p-4 rounded flex justify-between items-center mb-6">
                                <div>
                                    <div className="text-[9px] text-zinc-500 font-black uppercase tracking-[0.2em] mb-1">Target Name</div>
                                    <div className="text-xs font-mono text-zinc-300 break-all leading-relaxed">
                                        {selectedTask.original_filename || selectedTask.filename}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-[9px] text-zinc-500 font-black uppercase tracking-[0.2em] mb-1">Evidential Events</div>
                                    <div className="text-xs font-mono text-brand-400 font-bold">
                                        {expandedEvents.length} Events
                                    </div>
                                </div>
                            </div>

                            {/* Tab Content */}
                            {expandedTab === 'timeline' && (
                                <div className="animate-in fade-in duration-300">
                                    <div className="bg-[#111] border border-white/5 rounded-lg overflow-hidden shadow-lg">
                                        <div className="min-h-[200px]">
                                            {isLoadingDetails ? (
                                                <div className="p-12 text-center text-zinc-600">
                                                    <RefreshCw size={16} className="animate-spin mx-auto mb-2" />
                                                    <span className="text-[10px] font-black uppercase">Loading Stream...</span>
                                                </div>
                                            ) : expandedEvents.length > 0 ? (
                                                <div className="p-0">
                                                    {expandedEvents.map((e: AgentEvent, idx: number) => (
                                                        <div key={idx} className="flex gap-4 text-[10px] font-mono text-zinc-400 border-b border-white/5 pb-2 hover:bg-white/5 transition-colors p-3 last:border-0">
                                                            <span className="w-16 text-zinc-600 shrink-0 font-bold">
                                                                {new Date(e.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                            </span>
                                                            <span className={`w-28 font-bold shrink-0 ${e.event_type.includes('FILE') ? 'text-blue-400' : e.event_type.includes('NET') ? 'text-green-400' : 'text-yellow-500'}`}>
                                                                {e.event_type}
                                                            </span>
                                                            <span className="w-32 text-white truncate shrink-0" title={e.process_name}>{e.process_name}</span>
                                                            <span className="flex-1 text-zinc-500 italic break-all" title={e.details}>{e.details}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="p-12 text-center text-zinc-600">No events found.</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                            {expandedTab === 'network' && (
                                <div className="space-y-6 animate-in fade-in duration-300">
                                    {/* C2 Information */}
                                    {aiReport?.artifacts && (aiReport.artifacts.c2_domains.length > 0 || (aiReport.artifacts.c2_ips && aiReport.artifacts.c2_ips.length > 0)) && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {aiReport.artifacts.c2_domains.length > 0 && (
                                                <div className="bg-[#111] border border-white/5 rounded-lg p-4">
                                                    <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider mb-3">C2 Domains</h4>
                                                    <div className="space-y-1">
                                                        {aiReport.artifacts.c2_domains.map((domain: string, i: number) => (
                                                            <div key={i} className="text-xs font-mono text-brand-400 bg-brand-500/5 px-2 py-1 rounded border border-brand-500/10 flex items-center justify-between group">
                                                                <span>{domain}</span>
                                                                <Share2 size={10} className="opacity-0 group-hover:opacity-50" />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {aiReport.artifacts.c2_ips && aiReport.artifacts.c2_ips.length > 0 && (
                                                <div className="bg-[#111] border border-white/5 rounded-lg p-4">
                                                    <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider mb-3">C2 IP Addresses</h4>
                                                    <div className="space-y-1">
                                                        {aiReport.artifacts.c2_ips.map((ip: string, i: number) => (
                                                            <div key={i} className="text-xs font-mono text-yellow-500 bg-yellow-500/5 px-2 py-1 rounded border border-yellow-500/10 flex items-center justify-between group">
                                                                <span>{ip}</span>
                                                                <Monitor size={10} className="opacity-0 group-hover:opacity-50" />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Network Events */}
                                    <div className="bg-[#111] border border-white/5 rounded-lg overflow-hidden">
                                        <div className="px-4 py-3 border-b border-white/5 bg-white/2">
                                            <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider">Network Activity Stream</h4>
                                        </div>
                                        <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
                                            {expandedEvents.filter(e => e.event_type.includes('NET')).length > 0 ? (
                                                expandedEvents.filter(e => e.event_type.includes('NET')).map((e: AgentEvent, idx: number) => (
                                                    <div key={idx} className="flex gap-4 text-[10px] font-mono text-zinc-400 border-b border-white/5 pb-2 hover:bg-white/5 transition-colors p-3 last:border-0 border-l border-l-green-500/20">
                                                        <span className="w-16 text-zinc-600 shrink-0 font-bold">
                                                            {new Date(e.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                        </span>
                                                        <span className="w-20 font-bold shrink-0 text-green-400">{e.event_type}</span>
                                                        <span className="w-32 text-white truncate shrink-0" title={e.process_name}>{e.process_name}</span>
                                                        <div className="flex-1 break-all">
                                                            <span className="text-zinc-500 italic">{e.details}</span>
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="p-8 text-center text-zinc-600 text-xs font-mono">No network events captured.</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {expandedTab === 'files' && (
                                <div className="space-y-6 animate-in fade-in duration-300">
                                    {/* Dropped Files */}
                                    {aiReport?.artifacts?.dropped_files && aiReport.artifacts.dropped_files.length > 0 && (
                                        <div className="bg-[#111] border border-white/5 rounded-lg p-4">
                                            <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider mb-3">Dropped / Created Files</h4>
                                            <div className="grid grid-cols-1 gap-2">
                                                {aiReport.artifacts.dropped_files.map((file: string, i: number) => (
                                                    <div key={i} className="text-xs font-mono text-blue-300 bg-blue-500/5 px-3 py-2 rounded border border-blue-500/10 flex items-center gap-2">
                                                        <FileText size={12} className="text-blue-500" />
                                                        <span className="break-all">{file}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* File Events */}
                                    <div className="bg-[#111] border border-white/5 rounded-lg overflow-hidden">
                                        <div className="px-4 py-3 border-b border-white/5 bg-white/2">
                                            <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider">File System Activity</h4>
                                        </div>
                                        <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
                                            {expandedEvents.filter(e => e.event_type.includes('FILE')).length > 0 ? (
                                                expandedEvents.filter(e => e.event_type.includes('FILE')).map((e: AgentEvent, idx: number) => (
                                                    <div key={idx} className="flex gap-4 text-[10px] font-mono text-zinc-400 border-b border-white/5 pb-2 hover:bg-white/5 transition-colors p-3 last:border-0 border-l border-l-blue-500/20">
                                                        <span className="w-16 text-zinc-600 shrink-0 font-bold">
                                                            {new Date(e.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                        </span>
                                                        <span className="w-20 font-bold shrink-0 text-blue-400">{e.event_type}</span>
                                                        <span className="w-32 text-white truncate shrink-0" title={e.process_name}>{e.process_name}</span>
                                                        <div className="flex-1 break-all">
                                                            <span className="text-zinc-500 italic">{e.details}</span>
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="p-8 text-center text-zinc-600 text-xs font-mono">No file events captured.</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {expandedTab === 'registry' && (
                                <div className="space-y-6 animate-in fade-in duration-300">
                                    {/* Registry Events */}
                                    <div className="bg-[#111] border border-white/5 rounded-lg overflow-hidden">
                                        <div className="px-4 py-3 border-b border-white/5 bg-white/2">
                                            <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider">Registry Activity</h4>
                                        </div>
                                        <div className="max-h-[600px] overflow-y-auto custom-scrollbar">
                                            {expandedEvents.filter(e => e.event_type.includes('REG')).length > 0 ? (
                                                expandedEvents.filter(e => e.event_type.includes('REG')).map((e: AgentEvent, idx: number) => (
                                                    <div key={idx} className="flex gap-4 text-[10px] font-mono text-zinc-400 border-b border-white/5 pb-2 hover:bg-white/5 transition-colors p-3 last:border-0 border-l border-l-purple-500/20">
                                                        <span className="w-16 text-zinc-600 shrink-0 font-bold">
                                                            {new Date(e.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                        </span>
                                                        <span className="w-20 font-bold shrink-0 text-purple-400">{e.event_type}</span>
                                                        <span className="w-32 text-white truncate shrink-0" title={e.process_name}>{e.process_name}</span>
                                                        <div className="flex-1 break-all">
                                                            <span className="text-zinc-500 italic">{e.details}</span>
                                                        </div>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="p-8 text-center text-zinc-600 text-xs font-mono">No registry events captured.</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {expandedTab === 'static' && (
                                <div className="space-y-4 animate-in fade-in duration-300">
                                    <div className="bg-[#111] border border-white/5 rounded-lg p-6">
                                        <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider mb-6 flex items-center gap-2">
                                            <Search size={14} /> Static Analysis Insights
                                        </h4>
                                        {aiReport?.static_analysis_insights && aiReport.static_analysis_insights.length > 0 ? (
                                            <ul className="space-y-3">
                                                {aiReport.static_analysis_insights.map((insight: string, i: number) => (
                                                    <li key={i} className="text-xs text-zinc-300 font-mono flex items-start gap-3 bg-white/2 p-3 rounded hover:bg-white/5 transition-colors border border-transparent hover:border-white/5">
                                                        <span className="text-brand-500 mt-0.5">►</span>
                                                        <span className="leading-relaxed">{insight}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <div className="text-center text-zinc-600 text-xs font-mono py-8">
                                                No static analysis insights available.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {expandedTab === 'mitre' && (
                                <div className="space-y-4 animate-in fade-in duration-300">
                                    <div className="bg-[#111] border border-white/5 rounded-lg p-6">
                                        <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider mb-6 flex items-center gap-2">
                                            <Shield size={14} /> MITRE ATT&CK Matrix
                                        </h4>
                                        {aiReport?.mitre_matrix ? (
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {Object.entries(aiReport.mitre_matrix).map(([tactic, techniques]: [string, any]) => (
                                                    <div key={tactic} className="bg-zinc-950/50 rounded border border-white/5 p-3">
                                                        <h5 className="text-[10px] font-bold text-brand-400 uppercase mb-3 border-b border-white/5 pb-1">{tactic.replace(/_/g, ' ')}</h5>
                                                        <div className="space-y-2">
                                                            {techniques.map((tech: MitreTechnique) => (
                                                                <div key={tech.id} className="group">
                                                                    <div className="flex items-center justify-between text-xs text-zinc-300 mb-1">
                                                                        <span className="font-bold text-[10px] bg-white/5 px-1.5 rounded">{tech.id}</span>
                                                                        <span className="text-[10px] text-zinc-500 uppercase">{tech.status}</span>
                                                                    </div>
                                                                    <div className="text-[11px] text-zinc-400 font-mono leading-tight mb-1">{tech.name}</div>
                                                                    {tech.evidence && tech.evidence.length > 0 && (
                                                                        <div className="pl-2 border-l border-zinc-700 mt-1">
                                                                            {tech.evidence.map((ev: string, i: number) => (
                                                                                <div key={i} className="text-[9px] text-zinc-600 truncate" title={ev}>• {ev}</div>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-center text-zinc-600 text-xs font-mono py-8">
                                                No MITRE ATT&CK data mapped.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {expandedTab === 'thinking' && (
                                <div className="space-y-4 animate-in fade-in duration-300 h-full flex flex-col">
                                    <div className="bg-[#111] border border-white/5 rounded-lg p-0 flex-1 flex flex-col overflow-hidden">
                                        <div className="px-4 py-3 border-b border-white/5 bg-white/2 flex justify-between items-center">
                                            <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider flex items-center gap-2">
                                                <Brain size={14} /> AI Analysis / Chain of Thought
                                            </h4>
                                        </div>
                                        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 bg-black/20">
                                            {aiReport?.thinking ? (
                                                <pre className="text-xs text-brand-400/80 font-mono whitespace-pre-wrap leading-relaxed">
                                                    {aiReport.thinking}
                                                </pre>
                                            ) : (
                                                <div className="text-center text-zinc-600 text-xs font-mono py-12">
                                                    No Chain of Thought record available for this analysis.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                            {expandedTab === 'fishbone' && (
                                <div className="animate-in fade-in duration-300 h-[600px] border border-white/5 rounded-lg overflow-hidden bg-[#000]">
                                    <ProcessLineage
                                        events={expandedEvents}
                                        mitreData={(() => {
                                            if (!aiReport || !aiReport.mitre_matrix) return undefined;
                                            const map = new Map<number, string[]>();
                                            Object.values(aiReport.mitre_matrix).flat().forEach((tech: any) => {
                                                if (tech.evidence) {
                                                    tech.evidence.forEach((ev: string) => {
                                                        const match = ev.match(/PID[:\s]+(\d+)/i);
                                                        if (match && match[1]) {
                                                            const pid = parseInt(match[1]);
                                                            const existing = map.get(pid) || [];
                                                            if (!existing.includes(tech.id)) existing.push(tech.id);
                                                            map.set(pid, existing);
                                                        }
                                                    });
                                                }
                                            });
                                            return map;
                                        })()}
                                        onMaximize={() => onOpenLineage(selectedTask.id)}
                                    />
                                </div>
                            )}

                            {expandedTab === 'screenshots' && (
                                <div className="animate-in fade-in duration-300">
                                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                                        {expandedScreenshots.length > 0 ? expandedScreenshots.map((filename: string, idx: number) => (
                                            <div key={idx} className="group relative aspect-video bg-black border border-white/10 rounded overflow-hidden cursor-pointer hover:border-brand-500/50 transition-all">
                                                <img
                                                    src={voodooApi.getScreenshotUrl(filename, selectedTask.id)}
                                                    alt={`Screenshot ${idx}`}
                                                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                                                    onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
                                                        console.warn(`Failed to load screenshot: ${filename}`);
                                                        e.currentTarget.style.display = 'none';
                                                        e.currentTarget.parentElement!.innerText = 'Image Load Error';
                                                    }}
                                                />
                                                <div className="absolute bottom-0 left-0 right-0 bg-black/80 p-1 text-[9px] font-mono text-center text-zinc-400 truncate">
                                                    {filename}
                                                </div>
                                            </div>
                                        )) : (
                                            <div className="col-span-full h-32 flex items-center justify-center text-zinc-600 border border-white/5 border-dashed rounded">
                                                <span className="text-[10px] uppercase font-black tracking-widest">No Screenshots Available</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Ghidra Fly-out Panel - Responsive Width */}
            {activeGhidraTask && (
                <div className="fixed inset-y-0 right-0 w-full sm:w-2/3 lg:w-[800px] z-[60] bg-[#0D1117] border-l border-security-border shadow-[0_0_50px_rgba(0,0,0,0.5)] animate-in slide-in-from-right duration-300">
                    <GhidraConsole
                        taskId={activeGhidraTask.id}
                        filename={activeGhidraTask.filename}
                        onClose={() => setActiveGhidraTask(null)}
                    />
                </div>
            )}
        </div>
    );
}
