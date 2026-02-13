import React, { useState, useMemo, useEffect } from 'react';
import {
    RefreshCw,
    Activity,
    Shield,
    Trash2,
    FileText,
    Play,
    Monitor,
    ChevronRight,
    ChevronDown,
    RefreshCcw,
    Brain,
    Clock,
    Search
} from 'lucide-react';
import { voodooApi, AgentEvent, BASE_URL } from './voodooApi';
import GhidraConsole from './GhidraConsole';

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

export default function TaskDashboard({ onSelectTask, onOpenSubmission }: { onSelectTask: (taskId: string) => void, onOpenSubmission: () => void }) {

    const [tasks, setTasks] = useState<AnalysisTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('All');
    const [searchTerm, setSearchTerm] = useState("");

    // Expansion State
    const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
    const [rawEvents, setRawEvents] = useState<AgentEvent[]>([]);
    const [showNoise, setShowNoise] = useState(false);
    const [expandedScreenshots, setExpandedScreenshots] = useState<string[]>([]);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [activeGhidraTask, setActiveGhidraTask] = useState<{ id: string, filename: string } | null>(null);

    const expandedEvents = useMemo(() => {
        if (showNoise) return rawEvents;
        return rawEvents.filter(e => !NOISE_FILTER_PROCESSES.includes(e.process_name.toLowerCase()));
    }, [rawEvents, showNoise]);

    const handleRowClick = async (task: AnalysisTask) => {
        if (expandedTaskId === task.id) {
            setExpandedTaskId(null);
            setRawEvents([]);
            setExpandedScreenshots([]);
            return;
        }

        setExpandedTaskId(task.id);
        setRawEvents([]);
        setExpandedScreenshots([]);
        setIsLoadingDetails(true);

        try {
            console.log(`[TaskDashboard] expanding task ${task.id}, fetching history...`);
            const allEvents = await voodooApi.fetchHistory(task.id);
            console.log(`[TaskDashboard] fetchHistory result: ${allEvents.length} events`);
            setRawEvents(allEvents);

            const relevantScreenshots = await voodooApi.listScreenshots(task.id);
            console.log(`[TaskDashboard] screenshots found: ${relevantScreenshots.length}`);
            setExpandedScreenshots(relevantScreenshots);

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
                            <div className="w-2 h-2 rounded-full bg-voodoo-toxic-green animate-pulse"></div>
                            <span className="text-xs font-bold text-white uppercase">Operational Core</span>
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

            {/* Task List Container - Fixed Layout */}
            <div className="flex-1 overflow-x-auto overflow-y-auto p-2 md:p-6 custom-scrollbar bg-security-bg/30 min-h-0">
                <div className="min-w-[1000px] xl:min-w-0">
                    <div className="card bg-security-surface border-security-border overflow-hidden">
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
                                    const isUrl = task.filename.startsWith('URL:');
                                    const fileType = isUrl ? 'URL' : ((task.original_filename || task.filename).split('.').pop()?.toUpperCase() || 'BIN');
                                    const sandboxName = task.sandbox_id || (task.status.includes('VM') || task.status.includes('Sandbox') || task.status === 'Queued' ? 'Auto' : 'Active Unit');
                                    const isExpanded = expandedTaskId === task.id;

                                    return (
                                        <React.Fragment key={task.id}>
                                            <div
                                                onClick={() => handleRowClick(task)}
                                                className={`grid grid-cols-12 gap-4 p-4 items-center border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer group ${isExpanded ? 'bg-brand-900/10' : ''}`}
                                            >
                                                <div className="col-span-1 font-mono text-xs text-brand-500 flex items-center gap-1">
                                                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                                    #{task.id}
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

                                                <div className="col-span-2 text-xs text-zinc-400 flex items-center gap-2">
                                                    <Clock size={12} />
                                                    {isExpanded ? formatTimestamp(task.created_at) : new Date(task.created_at).toLocaleString()}
                                                </div>

                                                <div className="col-span-1 text-xs text-zinc-500 font-mono">
                                                    {sandboxName}
                                                </div>

                                                <div className="col-span-3 flex items-center gap-2 overflow-hidden">
                                                    {task.verdict === 'Malicious' ? <FileText size={16} className="text-red-500 shrink-0" /> : <FileText size={16} className="text-zinc-500 shrink-0" />}
                                                    <span className="text-sm font-bold text-white truncate" title={task.original_filename || task.filename}>
                                                        {task.original_filename || task.filename}
                                                    </span>
                                                </div>

                                                <div className="col-span-2 flex items-center gap-2">
                                                    <div className={`w-1.5 h-1.5 rounded-full ${task.status === 'Completed' ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`}></div>
                                                    <span className="text-xs font-mono text-zinc-300 uppercase">{task.status}</span>
                                                </div>

                                                <div className="col-span-2 flex justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); onSelectTask(task.id); }}
                                                        className="p-1.5 hover:bg-white/10 rounded text-zinc-400"
                                                        title="Full Report"
                                                    >
                                                        <Brain size={16} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id, e); }}
                                                        className="p-1.5 hover:bg-white/10 rounded text-zinc-400 hover:text-red-500"
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* EXPANDED ANALYST REPORT AREA - RESPONSIVE */}
                                            {isExpanded && (
                                                <div className="col-span-12 p-6 bg-[#080808] border-t border-white/10 shadow-inner">
                                                    <div className="flex items-center gap-3 mb-6">
                                                        <div className="bg-brand-500/10 p-2 rounded"><Activity size={20} className="text-brand-500" /></div>
                                                        <h3 className="text-sm font-black uppercase tracking-widest text-white">Analyst Task Report <span className="text-brand-500">#{task.id}</span></h3>
                                                    </div>

                                                    <div className="flex gap-6 mb-6">
                                                        {/* Left: Stats Cards */}
                                                        <div className="flex-1 space-y-4">
                                                            <div className="grid grid-cols-4 gap-4">
                                                                <div className="bg-[#111] border border-white/5 p-3 rounded">
                                                                    <div className="text-[9px] text-zinc-500 font-black uppercase tracking-wider mb-1">Target Name</div>
                                                                    <div className="text-xs font-mono text-zinc-300 truncate">{task.filename}</div>
                                                                </div>
                                                                <div className="bg-[#111] border border-white/5 p-3 rounded">
                                                                    <div className="text-[9px] text-zinc-500 font-black uppercase tracking-wider mb-1">Telemetry</div>
                                                                    <div className="text-xl font-black text-purple-400">{expandedEvents.length}</div>
                                                                </div>
                                                                <div className="bg-[#111] border border-white/5 p-3 rounded">
                                                                    <div className="text-[9px] text-zinc-500 font-black uppercase tracking-wider mb-1">Processes</div>
                                                                    <div className="text-xl font-black text-blue-400">{new Set(expandedEvents.map(e => e.process_id)).size}</div>
                                                                </div>
                                                                <div className="bg-[#111] border border-white/5 p-3 rounded">
                                                                    <div className="text-[9px] text-zinc-500 font-black uppercase tracking-wider mb-1">Duration</div>
                                                                    <div className="text-xl font-black text-zinc-300">{task.completed_at ? Math.floor((task.completed_at - task.created_at) / 1000) + 's' : 'Running'}</div>
                                                                </div>
                                                            </div>

                                                            {/* Detonation Timeline */}
                                                            <div className="bg-[#111] border border-white/5 rounded overflow-hidden">
                                                                <div className="p-2 border-b border-white/5 bg-white/5 flex items-center justify-between">
                                                                    <div className="text-[9px] font-black uppercase tracking-wider text-brand-500 flex items-center gap-2">
                                                                        <Activity size={12} /> Detonation Timeline
                                                                    </div>
                                                                    <button onClick={() => setShowNoise(!showNoise)} className="text-[9px] text-zinc-500 font-mono cursor-pointer hover:text-white uppercase">
                                                                        {showNoise ? 'Hide Noise' : 'Show Noise'}
                                                                    </button>
                                                                </div>
                                                                <div className="p-2 space-y-2 h-[200px] overflow-y-auto custom-scrollbar">
                                                                    {expandedEvents.length > 0 ? expandedEvents.map((e, idx) => (
                                                                        <div key={idx} className="flex gap-4 text-[10px] font-mono text-zinc-400 border-b border-white/5 pb-2">
                                                                            <span className="w-16 text-zinc-600">{new Date(e.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                                                                            <span className={`w-24 font-bold ${e.event_type.includes('FILE') ? 'text-blue-400' : e.event_type.includes('NET') ? 'text-green-400' : 'text-yellow-500'}`}>{e.event_type}</span>
                                                                            <span className="w-24 text-white truncate" title={e.process_name}>{e.process_name}</span>
                                                                            <span className="flex-1 truncate" title={e.details}>{e.details}</span>
                                                                        </div>
                                                                    )) : (
                                                                        <div className="text-center text-zinc-600 py-10">No events found.</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Right: Visuals & Score */}
                                                        <div className="w-80 space-y-4">
                                                            <div className="bg-[#111] border border-red-500/20 rounded p-6 flex flex-col items-center justify-center relative overflow-hidden">
                                                                <Shield size={48} className="text-red-500/20 mb-2" />
                                                                <div className="text-[9px] text-zinc-500 font-black uppercase tracking-wider mb-1">Threat Rating</div>
                                                                <div className={`text-4xl font-black mb-4 ${task.verdict === 'Malicious' ? 'text-red-500' : task.verdict === 'Clean' ? 'text-green-500' : 'text-orange-500'}`}>
                                                                    {task.risk_score || 0}%
                                                                </div>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); onSelectTask(task.id); }}
                                                                    className="w-full py-2 rounded bg-red-500/10 text-red-500 border border-red-500/20 text-[10px] font-black uppercase tracking-wider hover:bg-red-500 hover:text-white transition-all flex items-center justify-center gap-2"
                                                                >
                                                                    Deep Dive
                                                                </button>
                                                            </div>

                                                            <div className="bg-[#111] border border-white/5 rounded overflow-hidden h-40 flex items-center justify-center relative group">
                                                                {expandedScreenshots.length > 0 ? (
                                                                    <img src={voodooApi.getScreenshotUrl(expandedScreenshots[0], task.id)} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" alt="Preview" />
                                                                ) : (
                                                                    <div className="text-center">
                                                                        <Monitor size={32} className="text-zinc-600 mx-auto mb-2" />
                                                                        <div className="text-[9px] font-black uppercase text-zinc-600">No Visuals</div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </React.Fragment>
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
