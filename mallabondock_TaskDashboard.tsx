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
    Clock
} from 'lucide-react';
import { mallabApi, AgentEvent, BASE_URL } from './mallabApi';
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
}

const NOISE_FILTER_PROCESSES = [
    'mallab-agent-windows.exe',
    'mallab-agent.exe',
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

    // Global Search Removed per request

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
            // 1. Fetch Task-Specific Events
            const allEvents = await mallabApi.fetchHistory(task.id);
            console.log(`[TaskDashboard] fetchHistory result: ${allEvents.length} events`);

            setRawEvents(allEvents);

            // 2. Fetch Task-Specific Screenshots
            const relevantScreenshots = await mallabApi.listScreenshots(task.id);
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
            const success = await mallabApi.deleteTask(id);
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
            const success = await mallabApi.purgeAll();
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
        <div className="flex-1 flex flex-col h-full bg-security-bg animate-in fade-in duration-500 overflow-hidden">
            {/* Action Header */}
            <div className="p-6 bg-security-surface border-b border-security-border flex items-center justify-between shadow-xl z-20">
                <div className="flex items-center gap-8">
                    <img src="/logo.png" alt="VooDooBox" className="h-20 w-auto object-contain drop-shadow-[4px_4px_0px_rgba(0,0,0,1)]" />


                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={onOpenSubmission}
                        className="btn-primary h-10 px-6 flex items-center gap-2 group shadow-[0_0_15px_rgba(57,255,20,0.2)] hover:bg-voodoo-toxic-green hover:text-black transition-all"
                    >
                        <Play fill="currentColor" size={14} />
                        <span className="font-black uppercase tracking-[0.2em] text-[10px]">Submit Sample</span>
                    </button>

                    <select
                        className="bg-security-panel border border-security-border rounded px-3 py-2 text-xs text-white outline-none focus:border-security-muted"
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
                        className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-lg transition-all flex items-center gap-2"
                        title="Purge All Data"
                    >
                        <RefreshCcw size={16} />
                        <span className="text-[10px] font-black uppercase">Purge All</span>
                    </button>
                </div>
            </div>



            {/* Task List */}
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-security-bg/30">
                <div className="card bg-security-surface border-security-border">
                    <div className="grid grid-cols-12 gap-2 p-3 bg-security-panel border-b border-security-border text-[9px] font-black uppercase text-security-muted tracking-widest whitespace-nowrap">
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
                                const sandboxName = task.status.includes('VM') || task.status.includes('Sandbox') || task.status === 'Queued' ? 'Auto' : 'Active Unit';
                                const isExpanded = expandedTaskId === task.id;

                                return (
                                    <React.Fragment key={task.id}>
                                        <div
                                            onClick={() => handleRowClick(task)}
                                            className={`grid grid-cols-12 gap-2 p-3 items-center hover:bg-brand-500/5 transition-colors group cursor-pointer border-b border-security-border/40 shadow-sm ${isExpanded ? 'bg-brand-500/10' : ''}`}
                                        >
                                            {/* ID + Chevron (Toggle Expand separately if needed, or remove expand logic if detailed report is preferred) */}
                                            {/* We will keep the chevron for expansion but maybe make it a separate clickable area if user wants to keep expansion. 
                                                However, user asked "clicking on the row takes you to the detailed report". 
                                                I will make the ID/Chevron click toggle expand, and the rest of the row go to report? 
                                                Actually, the request implies the MAIN interaction should be navigation. 
                                                Let's make the row click navigation. I'll make the chevron specifically toggle expand. 
                                            */}
                                            <div
                                                className="col-span-1 flex items-center gap-1 hover:bg-white/5 p-1 rounded cursor-pointer z-10"
                                                title="Toggle Quick Preview"
                                            >
                                                {isExpanded ? <ChevronDown size={12} className="text-brand-500" /> : <ChevronRight size={12} className="text-security-muted" />}
                                                <span className="text-[10px] font-black text-brand-500/80 cursor-text select-text block truncate">
                                                    #{task.id}
                                                </span>
                                            </div>

                                            {/* Timestamp */}
                                            <div className="col-span-2 flex items-center gap-2 min-w-0">
                                                <Clock size={12} className="text-security-muted shrink-0" />
                                                <span className="text-[10px] font-medium text-slate-300 cursor-text select-text truncate">
                                                    {isExpanded ? formatTimestamp(task.created_at) : new Date(task.created_at).toLocaleString()}
                                                </span>
                                            </div>

                                            {/* Sandbox */}
                                            <div className="col-span-1">
                                                <div className="flex items-center gap-1">
                                                    <Monitor size={12} className="text-brand-500/50" />
                                                    <span className="text-[10px] font-bold text-slate-400 cursor-text select-text truncate">{sandboxName}</span>
                                                </div>
                                            </div>

                                            {/* Type */}
                                            <div className="col-span-1">
                                                <span className="px-1.5 py-0.5 rounded-sm bg-security-panel border border-security-border text-[9px] font-black text-white cursor-text select-text">
                                                    {fileType}
                                                </span>
                                            </div>

                                            {/* Filename */}
                                            <div className="col-span-2 min-w-0">
                                                <div className="flex items-start gap-2 min-w-0">
                                                    <FileText size={14} className="text-security-muted shrink-0 mt-0.5" />
                                                    <span className="text-[11px] font-bold text-white group-hover:text-brand-500 transition-colors truncate cursor-text select-text" title={task.original_filename || task.filename}>
                                                        {task.original_filename || task.filename}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Hash */}
                                            <div className="col-span-2 min-w-0">
                                                <div className="flex items-center gap-1 min-w-0">
                                                    <Hash size={10} className="text-security-muted shrink-0" />
                                                    <span className="text-[9px] font-mono text-security-muted cursor-text select-text break-all" title={task.file_hash || 'Pending'}>
                                                        {task.file_hash || 'Pending...'}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Status / Verdict */}
                                            <div className="col-span-2">
                                                <div className="flex flex-col gap-1">
                                                    <div className={`text-[10px] font-black uppercase flex items-center gap-1.5 ${task.status === 'Completed' ? 'text-brand-500' :
                                                        task.status.includes('Failed') ? 'text-threat-critical' :
                                                            'text-yellow-500 animate-pulse'
                                                        }`}>
                                                        <div className={`w-1.5 h-1.5 rounded-full ${task.status === 'Completed' ? 'bg-brand-500' :
                                                            task.status.includes('Failed') ? 'bg-threat-critical' :
                                                                'bg-yellow-500'
                                                            }`}></div>
                                                        <span className="cursor-text select-text truncate" title={task.status}>{task.status}</span>
                                                    </div>
                                                    {task.verdict && task.verdict !== 'Pending' && (
                                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm bg-black/20 w-fit ${task.verdict === 'Malicious' ? 'text-threat-critical border border-threat-critical/20' :
                                                            task.verdict === 'Suspicious' ? 'text-threat-high border border-threat-high/20' :
                                                                'text-brand-500 border border-brand-500/20'
                                                            } cursor-text select-text`}>
                                                            {task.verdict} ({task.risk_score || 0})
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Actions */}
                                            <div className="col-span-1 flex justify-end items-center gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); onSelectTask(task.id); }}
                                                    title="View Neural Report"
                                                    className="p-1.5 hover:bg-brand-500/20 text-brand-500 border border-transparent hover:border-brand-500/30 rounded transition-all"
                                                >
                                                    <Brain size={14} />
                                                </button>
                                                <button
                                                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); setActiveGhidraTask({ id: task.id, filename: task.filename }); }}
                                                    title="Reverse Engineer (Ghidra)"
                                                    className="p-1.5 hover:bg-brand-500/20 text-brand-500 border border-transparent hover:border-brand-500/30 rounded transition-all"
                                                >
                                                    <Code size={14} />
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

                                        {/* EXPANDED ANALYST REPORT AREA */}
                                        {isExpanded && (
                                            <div className="col-span-12 bg-security-bg/50 p-6 border-b border-security-border shadow-inner animate-in slide-in-from-top-2 duration-300">
                                                <div className="max-w-7xl mx-auto space-y-6">

                                                    {/* Report Top: Metadata & Stats */}
                                                    <div className="flex justify-between items-start gap-6">
                                                        <div className="flex-1 space-y-4">
                                                            <div className="flex items-center gap-4">
                                                                <h3 className="text-lg font-black text-white uppercase tracking-tighter">Analyst Task Report</h3>
                                                                <span className="px-2 py-1 rounded bg-brand-500/10 border border-brand-500/30 text-[10px] text-brand-500 font-mono">
                                                                    ID: {task.id}
                                                                </span>
                                                            </div>

                                                            <div className="grid grid-cols-4 gap-4">
                                                                <div className="bg-security-panel p-3 rounded-lg border border-security-border shadow-sm">
                                                                    <div className="text-[10px] text-security-muted uppercase font-black mb-1">Target Name</div>
                                                                    <div className="text-xs text-white font-bold truncate">{task.original_filename || task.filename}</div>
                                                                </div>
                                                                <div className="bg-security-panel p-3 rounded-lg border border-security-border shadow-sm">
                                                                    <div className="text-[10px] text-security-muted uppercase font-black mb-1">Telemetry Events</div>
                                                                    <div className="text-brand-500 text-lg font-black font-mono leading-none">{expandedEvents.length}</div>
                                                                </div>
                                                                <div className="bg-security-panel p-3 rounded-lg border border-security-border shadow-sm">
                                                                    <div className="text-[10px] text-security-muted uppercase font-black mb-1">Process Count</div>
                                                                    <div className="text-cyan-400 text-lg font-black font-mono leading-none">
                                                                        {new Set(expandedEvents.map((e: AgentEvent) => e.process_id)).size}
                                                                    </div>
                                                                </div>
                                                                <div className="bg-security-panel p-3 rounded-lg border border-security-border shadow-sm">
                                                                    <div className="text-[10px] text-security-muted uppercase font-black mb-1">Detonation Duration</div>
                                                                    <div className="text-white text-xs font-bold leading-normal">
                                                                        {task.completed_at ? `${Math.floor((task.completed_at - task.created_at) / 1000)}s` : 'Analysis running...'}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Verdict Gauge Placeholder (Future integration) */}
                                                        <div className="w-48 h-full flex flex-col items-center justify-center p-4 bg-security-panel/50 border border-security-border rounded-xl">
                                                            <Shield size={32} className={`${task.verdict === 'Malicious' ? 'text-threat-critical' : 'text-brand-500'} mb-2`} />
                                                            <span className="text-[10px] text-security-muted font-black uppercase tracking-widest text-center">Threat Rating</span>
                                                            <span className={`text-xl font-black ${task.verdict === 'Malicious' ? 'text-threat-critical' : 'text-brand-500'}`}>
                                                                {task.risk_score || 0}%
                                                            </span>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); onSelectTask(task.id); }}
                                                                className="mt-4 w-full py-2 bg-brand-500/10 hover:bg-brand-500/20 text-brand-500 border border-brand-500/20 rounded-lg text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
                                                            >
                                                                <Brain size={12} />
                                                                Neural Deep Dive
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-cols-12 gap-6">
                                                        {/* COLUMN 1: Behavioral Feed (Full Data) */}
                                                        <div className="col-span-7 space-y-3">
                                                            <div className="flex items-center justify-between border-b border-security-border pb-2">
                                                                <h4 className="text-[10px] uppercase font-black text-white tracking-widest flex items-center gap-2">
                                                                    <Activity size={14} className="text-brand-500" /> Detonation Timeline
                                                                </h4>
                                                                <div className="flex items-center gap-2">
                                                                    <button
                                                                        onClick={() => setShowNoise(!showNoise)}
                                                                        className={`text-[9px] font-bold uppercase transition-colors flex items-center gap-1 ${showNoise ? 'text-brand-500' : 'text-security-muted hover:text-white'}`}
                                                                    >
                                                                        {showNoise ? <Filter size={10} /> : <Filter size={10} className="opacity-50" />}
                                                                        {showNoise ? 'Hide System Noise' : 'Show System Noise'}
                                                                    </button>
                                                                    <span className="text-[9px] text-security-muted font-bold uppercase border-l border-white/10 pl-2">Chronological Telemetry</span>
                                                                </div>
                                                            </div>

                                                            <div className="bg-security-panel/40 rounded-xl border border-security-border overflow-hidden flex flex-col h-96 shadow-inner">
                                                                <div className="flex-1 overflow-y-auto custom-scrollbar p-0">
                                                                    {isLoadingDetails ? (
                                                                        <div className="h-full flex flex-col items-center justify-center p-12 text-security-muted">
                                                                            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                                                                            <p className="text-[10px] font-black uppercase tracking-widest">Retrieving Forensic Timeline...</p>
                                                                        </div>
                                                                    ) : expandedEvents.length > 0 ? (
                                                                        <table className="w-full text-left border-collapse">
                                                                            <thead className="sticky top-0 bg-security-panel z-10 border-b border-security-border">
                                                                                <tr>
                                                                                    <th className="p-3 text-[9px] font-black text-security-muted uppercase">Time</th>
                                                                                    <th className="p-3 text-[9px] font-black text-security-muted uppercase">Event</th>
                                                                                    <th className="p-3 text-[9px] font-black text-security-muted uppercase">Process</th>
                                                                                    <th className="p-3 text-[9px] font-black text-security-muted uppercase">Details</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody className="divide-y divide-security-border/20">
                                                                                {expandedEvents.map((e: AgentEvent, idx: number) => (
                                                                                    <tr key={idx} className="hover:bg-brand-500/5 transition-colors group">
                                                                                        <td className="p-3 text-[10px] font-mono text-security-muted whitespace-nowrap">
                                                                                            {new Date(e.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                                                        </td>
                                                                                        <td className="p-3">
                                                                                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${e.event_type.includes('PROCESS') ? 'text-brand-500 bg-brand-500/10' :
                                                                                                e.event_type.includes('FILE') ? 'text-cyan-400 bg-cyan-400/10' :
                                                                                                    'text-yellow-500 bg-yellow-500/10'
                                                                                                }`}>
                                                                                                {e.event_type}
                                                                                            </span>
                                                                                        </td>
                                                                                        <td className="p-3 text-[10px] font-bold text-white whitespace-nowrap truncate max-w-[120px]" title={e.process_name}>
                                                                                            {e.process_name}
                                                                                        </td>
                                                                                        <td className="p-3 text-[10px] text-slate-400 font-mono break-all leading-relaxed opacity-70 group-hover:opacity-100 transition-opacity">
                                                                                            {e.details}
                                                                                        </td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    ) : (
                                                                        <div className="h-full flex flex-col items-center justify-center p-12 text-security-muted opacity-60">
                                                                            {task.status === 'running' ? (
                                                                                <>
                                                                                    <RefreshCw className="animate-spin mb-4" size={24} />
                                                                                    <p className="text-[10px] font-black uppercase tracking-widest text-center">Awaiting Live Telemetry...<br />(System processes filtered)</p>
                                                                                </>
                                                                            ) : (
                                                                                <>
                                                                                    <div className="mb-4 relative">
                                                                                        <FileText size={40} className="opacity-20" />
                                                                                        <span className="absolute -bottom-1 -right-1 text-xs font-bold text-zinc-500">0</span>
                                                                                    </div>
                                                                                    <p className="text-[10px] font-black uppercase tracking-widest text-center">No Relevant Events Found<br />(Noise Filter Active)</p>
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* COLUMN 2: Evidence Gallery (Screenshots) */}
                                                        <div className="col-span-5 space-y-3">
                                                            <div className="flex items-center justify-between border-b border-security-border pb-2">
                                                                <h4 className="text-[10px] uppercase font-black text-white tracking-widest flex items-center gap-2">
                                                                    <ImageIcon size={14} className="text-cyan-400" /> Behavioral Storyboard
                                                                </h4>
                                                                <span className="text-[9px] text-security-muted font-bold uppercase">{expandedScreenshots.length} Captures</span>
                                                            </div>

                                                            <div className="bg-security-panel/40 rounded-xl border border-security-border flex flex-col h-96 overflow-hidden shadow-inner">
                                                                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
                                                                    {expandedScreenshots.length > 0 ? (
                                                                        expandedScreenshots.map((shot: string, idx: number) => (
                                                                            <div key={idx} className="bg-black/40 rounded-lg border border-security-border p-2 space-y-2 group">
                                                                                <img
                                                                                    src={mallabApi.getScreenshotUrl(shot, task.id)}
                                                                                    className="w-full h-auto rounded-md shadow-lg border border-security-border hover:border-brand-500 transition-all cursor-zoom-in active:scale-95"
                                                                                    alt="Analysis Feed"
                                                                                    onClick={() => window.open(mallabApi.getScreenshotUrl(shot, task.id))}
                                                                                />
                                                                                <div className="flex justify-between items-center px-1">
                                                                                    <span className="text-[9px] font-mono text-security-muted uppercase">T-{idx + 1} Capture</span>
                                                                                    <span className="text-[9px] text-brand-500/50 font-bold uppercase">{shot.includes('_') ? shot.split('_')[1].split('.')[0] : 'n/a'}ms</span>
                                                                                </div>
                                                                            </div>
                                                                        ))
                                                                    ) : (
                                                                        <div className="h-full border-2 border-dashed border-security-border flex flex-col items-center justify-center p-12 text-security-muted opacity-50 rounded-xl">
                                                                            <Monitor size={48} className="mb-4" />
                                                                            <p className="text-[10px] font-black uppercase text-center leading-relaxed">No visual evidence<br />captured during run</p>
                                                                        </div>
                                                                    )}
                                                                </div>
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



            {/* Ghidra Fly-out Panel */}
            {activeGhidraTask && (
                <div className="fixed inset-y-0 right-0 w-[800px] z-[60] bg-[#0D1117] border-l border-security-border shadow-[0_0_50px_rgba(0,0,0,0.5)] animate-in slide-in-from-right duration-300">
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
