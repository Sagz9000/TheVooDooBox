import React, { useEffect, useState, useRef, useMemo } from 'react';

import {
    RefreshCw,
    Activity,
    Shield,
    Trash2,
    FileText,
    Play,
    Monitor,
    ChevronRight,
    Clock,
    Search,
    ChevronDown,
    RefreshCcw
} from 'lucide-react';
import { voodooApi, AgentEvent, BASE_URL, TaskProgressEvent } from './voodooApi';
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
    const [expandedTab, setExpandedTab] = useState<'info' | 'fishbone' | 'screenshots' | 'telemetry'>('info');

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


    const expandedEvents = useMemo(() => {
        if (!rawEvents) return [];
        if (showNoise) return rawEvents;
        return rawEvents.filter(e => e.process_name && !NOISE_FILTER_PROCESSES.includes(e.process_name.toLowerCase()));
    }, [rawEvents, showNoise]);

    // Race condition protection
    const activeRequestId = useRef<string | null>(null);

    const handleRowClick = async (task: AnalysisTask) => {
        if (expandedTaskId === task.id) {
            setExpandedTaskId(null);
            activeRequestId.current = null; // Cancel current interest
            setRawEvents([]);
            setExpandedScreenshots([]);
            return;
        }

        setExpandedTaskId(task.id);
        activeRequestId.current = task.id; // Mark this as the active request
        setRawEvents([]);
        setExpandedScreenshots([]);
        setExpandedTab('info');
        setIsLoadingDetails(true);

        try {
            console.log(`[TaskDashboard] expanding task ${task.id}, fetching history...`);
            const allEvents = await voodooApi.fetchHistory(task.id);

            // Race check: if the user clicked another row while this was fetching, ignore results
            if (activeRequestId.current !== task.id) {
                console.log(`[TaskDashboard] Ignoring stale events for ${task.id}, active is ${activeRequestId.current}`);
                return;
            }

            console.log(`[TaskDashboard] fetchHistory result: ${allEvents.length} events`);
            setRawEvents(allEvents);

            const relevantScreenshots = await voodooApi.listScreenshots(task.id);
            if (activeRequestId.current !== task.id) return; // Race check again

            console.log(`[TaskDashboard] screenshots found: ${relevantScreenshots.length}`);
            setExpandedScreenshots(relevantScreenshots);



        } catch (e) {
            console.error("Failed to fetch expanded details", e);
        } finally {
            if (activeRequestId.current === task.id) {
                setIsLoadingDetails(false);
            }
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

            {/* Task List Container */}
            <div className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar p-0 relative">
                <div className="min-w-[1000px] xl:min-w-0">
                    {/* Header Row */}
                    <div className="grid grid-cols-12 gap-4 p-4 bg-[#111] border-b border-security-border text-[10px] font-black uppercase text-zinc-500 tracking-widest sticky top-0 z-10 shadow-md">
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
                                const isExpanded = expandedTaskId === task.id;
                                const sandboxName = task.sandbox_id || (task.status.includes('VM') || task.status.includes('Sandbox') || task.status === 'Queued' ? 'Auto' : 'Active Unit');

                                return (
                                    <React.Fragment key={task.id}>
                                        <div
                                            onClick={() => handleRowClick(task)}
                                            className={`grid grid-cols-12 gap-2 p-3 items-center hover:bg-brand-500/5 transition-colors group cursor-pointer border-b border-security-border/40 ${isExpanded ? 'bg-brand-500/10 border-l-2 border-l-brand-500' : 'border-l-2 border-l-transparent'}`}
                                        >
                                            <div className="col-span-1 flex items-center gap-1 hover:bg-white/5 p-1 rounded cursor-pointer z-10">
                                                {isExpanded ? <ChevronDown size={12} className="text-brand-500" /> : <ChevronRight size={12} className="text-security-muted/50" />}
                                                <span className={`text-[10px] font-black cursor-text select-text block truncate ${isExpanded ? 'text-brand-500' : 'text-brand-500/80'}`}>
                                                    #{task.id.slice(0, 8)}
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
                                                    title="Full Report"
                                                    className="p-1.5 hover:bg-brand-500/20 text-brand-500 border border-transparent hover:border-brand-500/30 rounded transition-all flex items-center gap-1"
                                                >
                                                    <span className="text-[9px] font-bold hidden xl:inline">REPORT</span>
                                                    <FileText size={14} />
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

                                        {/* Expanded Details Row */}
                                        {isExpanded && (
                                            <div className="col-span-12 bg-[#0b0b0b] border-b border-white/10 animate-in slide-in-from-top-2 duration-200 shadow-inner">
                                                <div className="p-4">
                                                    {/* Inline Details Content - Simplified from previous right pane */}
                                                    {/* Expanded Tabs Navigation - Horizontal Scrollable */}
                                                    <div className="flex items-center gap-2 mb-4 overflow-x-auto custom-scrollbar pb-2 border-b border-white/10">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setExpandedTab('info'); }}
                                                            className={`px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-2 border ${expandedTab === 'info' ? 'bg-brand-500 text-black border-brand-500' : 'bg-[#111] text-zinc-500 border-white/5 hover:border-brand-500/30 hover:text-brand-400'}`}
                                                        >
                                                            <Shield size={12} /> Overview
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setExpandedTab('fishbone'); }}
                                                            className={`px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-2 border ${expandedTab === 'fishbone' ? 'bg-brand-500 text-black border-brand-500' : 'bg-[#111] text-zinc-500 border-white/5 hover:border-brand-500/30 hover:text-brand-400'}`}
                                                        >
                                                            <Activity size={12} /> Process Graph
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setExpandedTab('telemetry'); }}
                                                            className={`px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-2 border ${expandedTab === 'telemetry' ? 'bg-brand-500 text-black border-brand-500' : 'bg-[#111] text-zinc-500 border-white/5 hover:border-brand-500/30 hover:text-brand-400'}`}
                                                        >
                                                            <Monitor size={12} /> Telemetry
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setExpandedTab('screenshots'); }}
                                                            className={`px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-2 border ${expandedTab === 'screenshots' ? 'bg-brand-500 text-black border-brand-500' : 'bg-[#111] text-zinc-500 border-white/5 hover:border-brand-500/30 hover:text-brand-400'}`}
                                                        >
                                                            <Monitor size={12} /> Screenshots ({expandedScreenshots.length})
                                                        </button>
                                                    </div>

                                                    {/* Tab Content */}
                                                    <div className="min-h-[300px]">
                                                        {isLoadingDetails ? (
                                                            <div className="flex flex-col items-center justify-center h-48 gap-4 text-brand-500/50">
                                                                <RefreshCw size={24} className="animate-spin" />
                                                                <span className="text-xs font-mono uppercase tracking-widest animate-pulse">Decrypting Telemetry...</span>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                {expandedTab === 'info' && (
                                                                    <div className="space-y-4 animate-in fade-in duration-300">
                                                                        {/* Summary Header */}
                                                                        <div className="flex items-center justify-between">
                                                                            <h3 className="text-xs font-black uppercase text-zinc-400">Analysis Summary: <span className="text-brand-500">#{task.id}</span></h3>
                                                                            <button onClick={(e) => { e.stopPropagation(); onSelectTask(task.id); }} className="text-[10px] text-brand-400 hover:text-brand-300 font-bold uppercase flex items-center gap-1">
                                                                                Open Full Report <ChevronRight size={10} />
                                                                            </button>
                                                                        </div>

                                                                        {/* Stats Cards */}
                                                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                                                            <div className="bg-[#111] p-3 rounded border border-white/5">
                                                                                <div className="text-[9px] font-black uppercase text-zinc-500 mb-1">Threat Score</div>
                                                                                <div className={`text-xl font-black ${task.risk_score && task.risk_score > 70 ? 'text-red-500' : 'text-green-500'}`}>
                                                                                    {task.risk_score || 0}%
                                                                                </div>
                                                                            </div>
                                                                            <div className="bg-[#111] p-3 rounded border border-white/5">
                                                                                <div className="text-[9px] font-black uppercase text-zinc-500 mb-1">Events</div>
                                                                                <div className="text-xl font-black text-blue-400">{rawEvents.length}</div>
                                                                            </div>
                                                                            <div className="bg-[#111] p-3 rounded border border-white/5">
                                                                                <div className="text-[9px] font-black uppercase text-zinc-500 mb-1">Duration</div>
                                                                                <div className="text-xl font-black text-purple-400">
                                                                                    {task.completed_at && task.created_at ? `${Math.round((task.completed_at - task.created_at) / 1000)}s` : '...'}
                                                                                </div>
                                                                            </div>
                                                                            <div className="bg-[#111] p-3 rounded border border-white/5">
                                                                                <div className="text-[9px] font-black uppercase text-zinc-500 mb-1">Screenshots</div>
                                                                                <div className="text-xl font-black text-orange-400">{expandedScreenshots.length}</div>
                                                                            </div>
                                                                        </div>

                                                                        {/* Screenshots Section */}
                                                                        <div className="bg-[#111] border border-white/5 rounded-lg p-4">
                                                                            <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider flex items-center gap-2 mb-4">
                                                                                <Monitor size={14} /> Sandbox Screenshots
                                                                            </h4>
                                                                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                                                                {expandedScreenshots.length > 0 ? expandedScreenshots.map((filename: string, idx: number) => (
                                                                                    <div key={idx} className="group relative aspect-video bg-black border border-white/10 rounded overflow-hidden cursor-pointer hover:border-brand-500/50 transition-all">
                                                                                        <img
                                                                                            src={voodooApi.getScreenshotUrl(filename, task.id)}
                                                                                            alt={`Screenshot ${idx}`}
                                                                                            className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                                                                                            onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
                                                                                                const target = e.currentTarget;
                                                                                                target.style.display = 'none';
                                                                                                if (target.parentElement) target.parentElement.innerText = 'Image Load Error';
                                                                                            }}
                                                                                        />
                                                                                        <div className="absolute bottom-0 left-0 right-0 bg-black/80 p-1 text-[9px] font-mono text-center text-zinc-400 truncate">
                                                                                            {filename}
                                                                                        </div>
                                                                                    </div>
                                                                                )) : (
                                                                                    <div className="col-span-full h-24 flex items-center justify-center text-zinc-600 border border-white/5 border-dashed rounded">
                                                                                        <span className="text-[10px] uppercase font-black tracking-widest">No Screenshots Available</span>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>

                                                                        {/* Process Graph Section */}
                                                                        <div className="bg-[#111] border border-white/5 rounded-lg overflow-hidden">
                                                                            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                                                                                <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider flex items-center gap-2">
                                                                                    <Activity size={14} /> Process Graph
                                                                                </h4>
                                                                                <button
                                                                                    onClick={(e) => { e.stopPropagation(); onOpenLineage(task.id); }}
                                                                                    className="text-[9px] font-bold uppercase text-brand-400 hover:text-brand-300 flex items-center gap-1 transition-colors"
                                                                                >
                                                                                    Maximize <Monitor size={10} />
                                                                                </button>
                                                                            </div>
                                                                            <div className="h-[400px] relative">
                                                                                <ProcessLineage
                                                                                    events={expandedEvents}
                                                                                    onMaximize={() => onOpenLineage(task.id)}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {expandedTab === 'fishbone' && (
                                                                    <div className="animate-in fade-in duration-300 h-[500px] border border-white/5 rounded-lg overflow-hidden bg-[#000] relative group">
                                                                        <ProcessLineage
                                                                            events={expandedEvents}
                                                                            onMaximize={() => onOpenLineage(task.id)}
                                                                        />
                                                                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); onOpenLineage(task.id); }}
                                                                                className="bg-black/80 hover:bg-brand-500 text-brand-500 hover:text-black border border-brand-500/50 rounded p-1.5 text-[10px] font-bold uppercase transition-all flex items-center gap-1"
                                                                            >
                                                                                Maximize <Monitor size={12} />
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {expandedTab === 'telemetry' && (
                                                                    <div className="animate-in fade-in duration-300 h-[500px] border border-white/5 rounded-lg overflow-hidden bg-[#111] flex flex-col">
                                                                        <div className="p-2 border-b border-white/5 bg-black/20 flex justify-between items-center">
                                                                            <h4 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider">Raw Event Stream</h4>
                                                                            <span className="text-[10px] text-zinc-600 font-mono">{rawEvents.length} Events</span>
                                                                        </div>
                                                                        <div className="flex-1 overflow-y-auto custom-scrollbar p-0">
                                                                            <table className="w-full text-left border-collapse">
                                                                                <thead className="sticky top-0 bg-[#0a0a0a] z-10 text-[9px] uppercase font-black text-zinc-500 tracking-wider">
                                                                                    <tr>
                                                                                        <th className="p-2 border-b border-white/5 w-24">Time</th>
                                                                                        <th className="p-2 border-b border-white/5 w-16">PID</th>
                                                                                        <th className="p-2 border-b border-white/5 w-40">Process</th>
                                                                                        <th className="p-2 border-b border-white/5 w-24">Type</th>
                                                                                        <th className="p-2 border-b border-white/5">Details</th>
                                                                                    </tr>
                                                                                </thead>
                                                                                <tbody className="font-mono text-[10px] text-zinc-400">
                                                                                    {rawEvents.slice(0, 200).map((evt, idx) => (
                                                                                        <tr key={idx} className="hover:bg-white/5 border-b border-white/5">
                                                                                            <td className="p-2 whitespace-nowrap text-zinc-600">{new Date(evt.timestamp).toLocaleTimeString()}</td>
                                                                                            <td className="p-2 text-brand-500/80">{evt.process_id}</td>
                                                                                            <td className="p-2 truncate max-w-[150px]" title={evt.process_name}>{evt.process_name}</td>
                                                                                            <td className="p-2">
                                                                                                <span className={`px-1 rounded ${evt.event_type === 'PROCESS_CREATE' ? 'bg-brand-500/10 text-brand-500' :
                                                                                                    evt.event_type.includes('NETWORK') ? 'bg-blue-500/10 text-blue-500' :
                                                                                                        evt.event_type.includes('FILE') ? 'bg-yellow-500/10 text-yellow-500' :
                                                                                                            'bg-zinc-800 text-zinc-400'
                                                                                                    }`}>{evt.event_type}</span>
                                                                                            </td>
                                                                                            <td className="p-2 truncate max-w-[300px] text-zinc-500" title={evt.details}>{evt.details}</td>
                                                                                        </tr>
                                                                                    ))}
                                                                                    {rawEvents.length > 200 && (
                                                                                        <tr>
                                                                                            <td colSpan={5} className="p-4 text-center text-zinc-600 italic">
                                                                                                ... {rawEvents.length - 200} more events ...
                                                                                            </td>
                                                                                        </tr>
                                                                                    )}
                                                                                </tbody>
                                                                            </table>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {expandedTab === 'screenshots' && (
                                                                    <div className="animate-in fade-in duration-300">
                                                                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                                                                            {expandedScreenshots.length > 0 ? expandedScreenshots.map((filename: string, idx: number) => (
                                                                                <div key={idx} className="group relative aspect-video bg-black border border-white/10 rounded overflow-hidden cursor-pointer hover:border-brand-500/50 transition-all">
                                                                                    <img
                                                                                        src={voodooApi.getScreenshotUrl(filename, task.id)}
                                                                                        alt={`Screenshot ${idx}`}
                                                                                        className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                                                                                        onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
                                                                                            const target = e.currentTarget;
                                                                                            target.style.display = 'none';
                                                                                            if (target.parentElement) target.parentElement.innerText = 'Image Load Error';
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
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        {tasks.length === 0 && (
                            <div className="p-12 text-center text-zinc-600">
                                <FileText size={48} className="mx-auto mb-4 opacity-50" />
                                <p className="font-bold uppercase tracking-wider">No Tasks Found</p>
                                <p className="text-xs opacity-50 mt-1">Submit a sample to begin analysis</p>
                            </div>
                        )}
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
