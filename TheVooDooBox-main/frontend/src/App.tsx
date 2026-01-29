import React, { useEffect, useState } from 'react';
import {
    Activity,
    Brain,
    Biohazard,
    Disc,
    Layers,
    Zap,
    Box,
    LayoutDashboard
} from 'lucide-react';
import { AgentEvent, ViewModel, voodooApi, BASE_URL } from './voodooApi';
import LabDashboard from './LabDashboard';
import AnalysisArena from './AnalysisArena';
import TaskDashboard from './TaskDashboard';
import FloatingChat from './FloatingChat';
import ReportView from './ReportView';
import SubmissionModal, { SubmissionData } from './SubmissionModal';

export default function App() {
    const [view, setView] = useState<'tasks' | 'lab' | 'arena' | 'history' | 'intel' | 'report'>('lab');
    const [vms, setVms] = useState<ViewModel[]>([]);
    const [events, setEvents] = useState<AgentEvent[]>([]);
    const [connected, setConnected] = useState(false);
    const [arenaTarget, setArenaTarget] = useState<{ node: string, vmid: number, mode: 'vnc' | 'spice-html5' } | null>(null);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [startTime] = useState(Date.now());

    // Submission Modal State
    const [showSubmissionModal, setShowSubmissionModal] = useState(false);
    const [preSelectedVm, setPreSelectedVm] = useState<{ node: string, vmid: number } | null>(null);

    // WebSocket Handling
    useEffect(() => {
        console.log("MALLAB-DEBUG: App mounting, starting WS");
        const hostUrl = BASE_URL.replace(/^https?:\/\//, '');
        const ws = new WebSocket(`ws://${hostUrl}/ws`);
        ws.onopen = () => {
            console.log("MALLAB-DEBUG: WS Connected");
            setConnected(true);
        };
        ws.onmessage = (event) => {
            try {
                const data: AgentEvent = JSON.parse(event.data);
                setEvents(prev => [...prev.slice(-499), data]);
            } catch (e) {
                console.error("Failed to parse event", e);
            }
        };
        ws.onclose = () => {
            console.log("MALLAB-DEBUG: WS Closed");
            setConnected(false);
        };

        refreshVms();
        return () => ws.close();
    }, []);

    const refreshVms = async () => {
        try {
            const data = await voodooApi.fetchVms();
            setVms(data);
        } catch (e) {
            console.error(e);
        }
    };

    const loadHistory = async () => {
        try {
            const hist = await voodooApi.fetchHistory();
            setEvents(prev => {
                const combined = [...hist, ...prev];
                // Use database ID for reliable deduplication, fallback to composite key for live events
                const unique = Array.from(new Map(combined.map(e => [
                    e.id ? `id-${e.id}` : `${e.timestamp}-${e.event_type}-${e.process_id}-${e.details.substring(0, 20)}`,
                    e
                ])).values());
                return unique.sort((a, b) => a.timestamp - b.timestamp);
            });
        } catch (e) {
            console.error("Failed to load history", e);
        }
    };

    useEffect(() => {
        loadHistory();
    }, []);

    const handleSelectVm = (node: string, vmid: number, mode: 'vnc' | 'spice-html5') => {
        setArenaTarget({ node, vmid, mode });
        setView('arena');
    };

    const handleSelectTask = (taskId: string) => {
        setSelectedTaskId(taskId);
        setView('report');
    };

    const handleOpenSubmission = (vm?: { node: string, vmid: number }) => {
        setPreSelectedVm(vm || null);
        setShowSubmissionModal(true);
    };

    const handleGlobalSubmission = async (data: SubmissionData & { vmid?: number, node?: string }) => {
        try {
            if (data.type === 'file' && data.file) {
                const formData = new FormData();
                formData.append('file', data.file);
                formData.append('analysis_duration', data.duration.toString());
                if (data.vmid) formData.append('vmid', data.vmid.toString());
                if (data.node) formData.append('node', data.node);

                const res = await fetch(`${BASE_URL}/vms/actions/submit`, {
                    method: 'POST',
                    body: formData,
                });

                if (res.ok) {
                    alert("Sample submitted successfully! Analysis starting...");
                    // We might need a way to refresh the TaskDashboard if it's active
                } else {
                    const errText = await res.text();
                    alert(`Failed to submit sample. Server responded: ${res.status} ${errText}`);
                }
            } else if (data.type === 'url' && data.url) {
                const success = await voodooApi.execUrl(data.url, data.duration, data.vmid, data.node);
                if (success) {
                    alert("URL submitted! Browser DETONATION initiated.");
                } else {
                    alert("Failed to detonate URL.");
                }
            }
        } catch (error) {
            console.error('Submission failed', error);
            alert(`Error submitting task: ${error}`);
        }
    };

    const handleNativeSpice = (node: string, vmid: number) => {
        voodooApi.getSpiceTicket(node, vmid).then(data => {
            const vvContent = `[virt-viewer]\ntype=spice\nhost=${data.host}\npassword=${data.password || ''}\ntls-port=${data.tls_port || ''}\nproxy=${data.proxy || ''}\nhost-subject=${data.host_subject || ''}\nca=${data.ca || ''}\ndelete-this-file=1\ntitle=MallabV3 SPICE\n`;
            const blob = new Blob([vvContent], { type: 'application/x-virt-viewer' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mallab-node-${vmid}.vv`;
            a.click();
        });
    };

    const activeVmCount = vms.filter(v => v.status === 'running').length;

    try {
        return (
            <div className="flex h-screen bg-security-bg text-[#c9d1d9] overflow-hidden font-sans select-none">
                {/* Sidebar */}
                <aside className="w-[80px] bg-black border-r border-white/5 flex flex-col items-center py-10 z-30 shadow-[10px_0_50px_rgba(0,0,0,0.5)]">
                    <div className="mb-12 cursor-pointer group relative" onClick={() => setView('lab')}>
                        <div className="absolute inset-0 bg-voodoo-toxic-green/40 blur-xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <Biohazard size={32} className="text-voodoo-toxic-green relative z-10 animate-pulse" />
                    </div>

                    <nav className="flex-1 w-full flex flex-col items-center gap-6">
                        <NavItem icon={<Disc size={22} />} label="Mixer" active={view === 'lab'} onClick={() => setView('lab')} />
                        <NavItem icon={<Layers size={22} />} label="Telemetry Reports" active={view === 'tasks'} onClick={() => setView('tasks')} />
                        <NavItem
                            icon={<Zap size={22} className={arenaTarget ? 'animate-pulse text-boombox-teal' : ''} />}
                            label="Arena"
                            active={view === 'arena'}
                            onClick={() => arenaTarget && setView('arena')}
                            disabled={!arenaTarget}
                        />
                        <NavItem icon={<Brain size={22} />} label="Intel" active={view === 'intel'} onClick={() => setView('intel')} />
                    </nav>

                    <div className="mt-auto flex flex-col items-center gap-4">
                        <div className={`w-3 h-3 rounded-full ${connected ? 'bg-boombox-green shadow-[0_0_15px_#00FF00]' : 'bg-red-600 shadow-[0_0_15px_#FF0000]'}`}></div>
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">{connected ? 'ON' : 'OFF'}</span>
                    </div>
                </aside>

                {/* Main Area */}
                <div className="flex-1 flex flex-col min-w-0">
                    {/* Activity Indicator Bar */}
                    <div className="h-1 bg-security-panel flex overflow-hidden">
                        <div className="h-full bg-brand-500/50 animate-pulse" style={{ width: '35%' }}></div>
                        <div className="h-full bg-threat-high/50" style={{ width: '15%' }}></div>
                        <div className="h-full bg-transparent" style={{ width: '50%' }}></div>
                    </div>

                    <div className="flex-1 overflow-hidden relative">
                        {view === 'tasks' && <TaskDashboard onSelectTask={handleSelectTask} onOpenSubmission={() => handleOpenSubmission()} />}

                        {view === 'lab' && (
                            <LabDashboard
                                vms={vms}
                                onRefresh={refreshVms}
                                onSelectVm={handleSelectVm}
                                onLaunchNativeSpice={handleNativeSpice}
                                onOpenSubmission={handleOpenSubmission}
                                onSelectTask={handleSelectTask}
                            />
                        )}

                        {view === 'arena' && arenaTarget && (
                            <AnalysisArena target={arenaTarget} events={events} onBack={() => setView('tasks')} />
                        )}

                        {view === 'report' && (
                            <ReportView taskId={selectedTaskId} events={events} onBack={() => setView('tasks')} />
                        )}

                        {view === 'arena' && !arenaTarget && (
                            <div className="h-full flex flex-col items-center justify-center text-security-muted space-y-6 animate-in fade-in duration-700">
                                <MonitorPlaceholder />
                            </div>
                        )}

                        {view === 'intel' && (
                            <IntelHub />
                        )}
                    </div>
                </div>

                {/* Global Floating Components */}
                <FloatingChat
                    activeTaskId={selectedTaskId}
                    pageContext={(() => {
                        let ctx = `User is currently viewing the [${view.toUpperCase()}] page.\n`;

                        if (view === 'lab') {
                            ctx += `Visible VMs: ${vms.length}. Running: ${vms.filter(v => v.status === 'running').length}.\n`;
                            vms.forEach(v => ctx += `- VM ${v.vmid} (${v.name}): ${v.status} on ${v.node}\n`);
                        } else if (view === 'report' && selectedTaskId) {
                            ctx += `Analyzing specific Task ID: ${selectedTaskId}.\n`;
                            const taskEvents = events.filter(e => e.task_id === selectedTaskId);
                            ctx += `Telemtry events for this task: ${taskEvents.length}.\n`;
                        } else if (view === 'arena' && arenaTarget) {
                            ctx += `Active Arena Session: VM ${arenaTarget.vmid} on ${arenaTarget.node}.\n`;
                        } else if (view === 'tasks') {
                            ctx += `Viewing the Telemetry Reports dashboard.\n`;
                        }

                        return ctx;
                    })()}
                />

                <SubmissionModal
                    isOpen={showSubmissionModal}
                    onClose={() => setShowSubmissionModal(false)}
                    onSubmit={handleGlobalSubmission}
                    vms={vms}
                    preSelected={preSelectedVm || undefined}
                />
            </div>
        );
    } catch (err) {
        console.error("MALLAB-DEBUG: Render error", err);
        return <div className="p-10 text-red-500 font-mono">Render Error: {String(err)}</div>;
    }
}

function NavItem({ icon, label, active, onClick, disabled }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, disabled?: boolean }) {
    return (
        <button
            disabled={disabled}
            onClick={onClick}
            className={`nav-item ${active ? 'nav-item-active' : 'text-security-muted'} ${disabled ? 'opacity-10 cursor-not-allowed' : 'opacity-100'}`}
        >
            {icon}
            <span className="text-[9px] font-black uppercase tracking-tighter">{label}</span>
        </button>
    );
}

function MonitorPlaceholder() {
    return (
        <>
            <Box size={60} className="opacity-10" />
            <div className="text-center">
                <p className="font-bold uppercase tracking-[0.2em] text-xs mb-1">Station Idle</p>
                <p className="text-[10px] font-medium opacity-50 uppercase">Select a node to begin active interaction.</p>
            </div>
        </>
    );
}

function IntelHub() {
    const [tasks, setTasks] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadTasks = async () => {
            try {
                const data = await voodooApi.fetchTasks();
                setTasks(data);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        loadTasks();
    }, []);

    const totalDetections = tasks.reduce((acc: number, t: any) => acc + (t.verdict === 'Malicious' ? 1 : 0), 0);

    return (
        <div className="p-8 h-full bg-[#050505] overflow-y-auto custom-scrollbar">
            <div className="max-w-6xl mx-auto space-y-8">
                <div className="flex items-center justify-between border-b border-brand-500/20 pb-6">
                    <div>
                        <h2 className="text-4xl font-black text-white uppercase tracking-tighter flex items-center gap-4">
                            <Brain size={40} className="text-brand-500" />
                            Intelligence <span className="text-brand-500">Core</span>
                        </h2>
                        <p className="text-voodoo-toxic-green/50 text-[10px] font-bold uppercase tracking-[0.3em] mt-2">
                            Neural-Linked Threat Correlation & Global Intelligence Feed
                        </p>
                    </div>
                    <div className="flex gap-4">
                        <div className="bg-black/40 border border-brand-500/20 p-4 rounded-none min-w-[150px]">
                            <p className="text-[10px] font-bold text-zinc-500 uppercase">Active Scans</p>
                            <p className="text-2xl font-black text-white">{tasks.length}</p>
                        </div>
                        <div className="bg-black/40 border border-voodoo-toxic-green/20 p-4 rounded-none min-w-[150px]">
                            <p className="text-[10px] font-bold text-voodoo-toxic-green/50 uppercase">Threats Neutralized</p>
                            <p className="text-2xl font-black text-voodoo-toxic-green">{totalDetections}</p>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="py-20 flex flex-col items-center justify-center gap-4 opacity-50">
                        <Activity className="animate-spin text-brand-500" size={40} />
                        <p className="text-[10px] uppercase font-bold tracking-widest">Synchronizing Hive Mind...</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {tasks.slice(0, 6).map((task: any) => (
                            <div key={task.id} className="bg-voodoo-dark-800/30 border border-white/5 p-6 hover:border-brand-500/50 transition-all group">
                                <div className="flex justify-between items-start mb-4">
                                    <div className={`text-[10px] px-2 py-1 font-bold uppercase ${task.verdict === 'Malicious' ? 'bg-red-500/20 text-red-500' : 'bg-emerald-500/20 text-emerald-500'}`}>
                                        {task.verdict || 'Processing'}
                                    </div>
                                    <p className="text-[9px] font-mono text-zinc-600">ID: {task.id.slice(0, 8)}</p>
                                </div>
                                <h4 className="text-lg font-bold text-white mb-2 line-clamp-1 group-hover:text-brand-400 transition-colors uppercase">
                                    {task.filename}
                                </h4>
                                <div className="space-y-2 mb-6">
                                    <div className="flex justify-between items-center text-[10px]">
                                        <span className="text-zinc-500 uppercase font-black">Score</span>
                                        <span className="text-voodoo-toxic-green">{task.risk_score || 0}% Risk</span>
                                    </div>
                                    <div className="w-full bg-zinc-900 h-1 mt-1">
                                        <div className="bg-brand-500 h-full" style={{ width: `${task.risk_score || 0}%` }}></div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 text-[9px] text-zinc-500 font-bold uppercase tracking-widest">
                                    <span className="flex items-center gap-1"><Zap size={10} /> {task.status}</span>
                                    <span className="flex items-center gap-1"><LayoutDashboard size={10} /> Hive Intel</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
