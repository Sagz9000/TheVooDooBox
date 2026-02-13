import React, { useState, useMemo, useEffect } from 'react';
import {
    RefreshCw,
    Activity,
    Shield,
    Trash2,
    FileText,
    Image as ImageIcon,
    Code,
    Play,
    Monitor,
    Hash,
    ChevronRight,
    ChevronDown,
    RefreshCcw,
    Brain,
    Filter,
    Clock,
    Download
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
                        <div className="grid grid-cols-12 gap-2 p-3 bg-security-panel border-b border-security-border text-[9px] font-black uppercase text-security-muted tracking-widest whitespace-nowrap sticky top-0 z-10">
                            <div className="col-span-1">ID</div>
                            <div className="col-span-2">Timestamp</div>
                            <div className="col-span-1">Sandbox</div>
                            <div className="col-span-1">Type</div>
                            <div className="col-span-2">Filename</div>
                            <div className="col-span-2">Hash</div>
                            <div className="col-span-2">Status / Stage</div>
                            <div className="col-span-1 text-right px-2">Actions</div>
                        </div>

                        <div className="divide-y divide-security-border/40">
                            {tasks
                                .filter((task: AnalysisTask) => {
                                    return statusFilter === 'All' || task.status.toLowerCase().includes(statusFilter.toLowerCase());
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
                                                className={`grid grid-cols-12 gap-2 p-3 items-center hover:bg-brand-500/5 transition-colors group cursor-pointer border-b border-security-border/40 shadow-sm ${isExpanded ? 'bg-brand-500/10' : ''}`}
                                            >
                                                <div className="col-span-1 flex items-center gap-1 hover:bg-white/5 p-1 rounded cursor-pointer z-10">
                                                    {isExpanded ? <ChevronDown size={12} className="text-brand-500" /> : <ChevronRight size={12} className="text-security-muted" />}
                                                    <span className="text-[10px] font-black text-brand-500/80 cursor-text select-text block truncate">
                                                        #{task.id}
                                                    </span>
                                                </div>

                                                {/* VERDICT COLUMN - V5 Requirement */}
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
                                                    <div className={`text-[10px] font-black uppercase flex items-center gap-1.5 ${task.status === 'Completed' || task.status === 'Analysis Complete' ? 'text-brand-500' :
                                                        task.status.includes('Failed') ? 'text-threat-critical' :
                                                            'text-yellow-500 animate-pulse'
                                                        }`}>
                                                        <div className={`w-1.5 h-1.5 rounded-full ${task.status === 'Completed' || task.status === 'Analysis Complete' ? 'bg-brand-500' :
                                                            task.status.includes('Failed') ? 'bg-threat-critical' :
                                                                'bg-yellow-500'
                                                            }`}></div>
                                                        <span className="cursor-text select-text truncate" title={task.status}>{task.status}</span>
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

                                            {/* EXPANDED ANALYST REPORT AREA - SIMPLIFIED AS PER USER SCREENSHOT */}
                                            {isExpanded && (
                                                <div className="col-span-12 bg-[#080808] p-6 border-t border-white/10 shadow-inner animate-in slide-in-from-top-2 duration-300">
                                                    <div className="flex items-center gap-3 mb-6">
                                                        <div className="bg-brand-500/10 p-2 rounded"><Activity size={20} className="text-brand-500" /></div>
                                                        <h3 className="text-sm font-black uppercase tracking-widest text-white">Analyst Task Report <span className="text-brand-500">#{task.id}</span></h3>
                                                    </div>

                                                    <div className="space-y-6">
                                                        {/* Target Name Section */}
                                                        <div className="bg-[#111] border border-white/5 p-4 rounded">
                                                            <div className="text-[9px] text-zinc-500 font-black uppercase tracking-[0.2em] mb-2">Target Name</div>
                                                            <div className="text-xs font-mono text-zinc-300 break-all leading-relaxed">
                                                                {task.original_filename || task.filename}
                                                            </div>
                                                        </div>

                                                        {/* Timeline Section */}
                                                        <div>
                                                            <div className="flex items-center gap-2 mb-4 text-[9px] font-black uppercase tracking-[0.2em] text-brand-500">
                                                                <Activity size={12} /> Detonation Timeline
                                                            </div>
                                                            <div className="bg-[#111] border border-white/5 rounded-lg overflow-hidden shadow-2xl">
                                                                <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
                                                                    {isLoadingDetails ? (
                                                                        <div className="p-12 text-center text-zinc-600">
                                                                            <RefreshCw size={16} className="animate-spin mx-auto mb-2" />
                                                                            <span className="text-[10px] font-black uppercase">Loading Stream...</span>
                                                                        </div>
                                                                    ) : expandedEvents.length > 0 ? (
                                                                        <div className="p-2 space-y-1">
                                                                            {expandedEvents.map((e, idx) => (
                                                                                <div key={idx} className="flex gap-4 text-[10px] font-mono text-zinc-400 border-b border-white/5 pb-2 hover:bg-white/5 transition-colors p-2">
                                                                                    <span className="w-16 text-zinc-600 shrink-0">
                                                                                        {new Date(e.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                                                    </span>
                                                                                    <span className={`w-32 font-bold shrink-0 ${e.event_type.includes('FILE') ? 'text-blue-400' : e.event_type.includes('NET') ? 'text-green-400' : 'text-yellow-500'}`}>
                                                                                        {e.event_type}
                                                                                    </span>
                                                                                    <span className="w-32 text-white truncate shrink-0" title={e.process_name}>{e.process_name}</span>
                                                                                    <span className="flex-1 text-zinc-500 italic truncate" title={e.details}>{e.details}</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="p-12 text-center text-zinc-600">No events found.</div>
                                                                    )}
                                                                </div>
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
