import React, { useEffect, useState } from 'react';
import {
    Activity,
    Brain,
    Biohazard,
    Zap,
    LayoutDashboard,
    Settings,
    Box,
    Layers,
    Server,
    Sliders,
    Shield
} from 'lucide-react';
import { AgentEvent, ViewModel, voodooApi, BASE_URL } from './voodooApi';
import LabDashboard from './LabDashboard';
import AnalysisArena from './AnalysisArena';
import TaskDashboard from './TaskDashboard';
import FloatingChat from './FloatingChat';
import LineagePage from './LineagePage';
import ReportView from './ReportView';
import SubmissionModal from './SubmissionModal';
import SettingsModal from './SettingsModal';
import DetoxDashboard from './DetoxDashboard';

export default function App() {
    // ── State ──
    const [view, setView] = useState<'tasks' | 'lab' | 'arena' | 'intel' | 'report' | 'lineage' | 'detox'>('lab');
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [events, setEvents] = useState<AgentEvent[]>([]);
    const [vms, setVms] = useState<ViewModel[]>([]);
    const [arenaTarget, setArenaTarget] = useState<ViewModel | null>(null);
    const [aiProvider, setAiProvider] = useState<string>('ollama');
    const [showSubmissionModal, setShowSubmissionModal] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [preSelectedVm, setPreSelectedVm] = useState<{ node: string, vmid: number } | null>(null);

    // ── Effects ──
    useEffect(() => {
        const loadVms = async () => {
            try {
                const data = await voodooApi.fetchVms();
                setVms(data);
            } catch (e) {
                console.error("Failed to fetch VMs", e);
            }
        };
        loadVms();
        const interval = setInterval(loadVms, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        // Load AI config
        voodooApi.getAIConfig().then(cfg => setAiProvider(cfg.provider))
            .catch(e => console.error("Failed to load AI config", e));
    }, []);

    // ── Handlers ──

    const handleSelectTask = async (taskId: string) => {
        setSelectedTaskId(taskId);
        try {
            const evts = await voodooApi.fetchHistory(taskId);
            setEvents(evts);
            setView('report');
        } catch (e) {
            console.error("Failed to load task events", e);
        }
    };

    const handleOpenLineage = async (taskId: string) => {
        setSelectedTaskId(taskId);
        try {
            const evts = await voodooApi.fetchHistory(taskId);
            setEvents(evts);
            setView('lineage');
        } catch (e) {
            console.error("Failed to load task events for lineage", e);
        }
    };

    const handleSelectVm = (node: string, vmid: number, mode: 'vnc' | 'spice-html5') => {
        const vm = vms.find(v => v.vmid === vmid && v.node === node);
        if (vm) {
            setArenaTarget(vm);
            setView('arena');
        }
    };

    const handleLaunchNativeSpice = async (node: string, vmid: number) => {
        try {
            const ticket = await voodooApi.getSpiceTicket(node, vmid);
            // Create .vv file content
            const vvContent = `[virt-viewer]
type=spice
host=${window.location.hostname}
port=${ticket.port}
password=${ticket.password}
tls-port=${ticket.tls_port || 0}
delete-this-file=1
title=VM-${vmid}
toggle-fullscreen=shift+f11
release-cursor=shift+f12
`;
            const blob = new Blob([vvContent], { type: 'application/x-virt-viewer' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `vm-${vmid}.vv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (e) {
            console.error("Failed to launch native SPICE", e);
            alert("Failed to generate SPICE ticket");
        }
    };

    const handleOpenSubmission = (vm?: { node: string, vmid: number }) => {
        setPreSelectedVm(vm || null);
        setShowSubmissionModal(true);
    };

    const handleGlobalSubmission = async (data: any) => {
        try {
            if (data.type === 'file' && data.file) {
                await voodooApi.submitSample({
                    file: data.file,
                    duration: data.duration,
                    mode: data.mode,
                    vmid: data.vmid,
                    node: data.node
                });
            } else if (data.type === 'url' && data.url) {
                await voodooApi.execUrl(data.url, data.duration, data.vmid, data.node);
            }
            setShowSubmissionModal(false);
            // Switch to tasks view to see the new task
            setView('tasks');
        } catch (e) {
            console.error("Submission failed", e);
            alert("Failed to submit task. Check console for details.");
        }
    };

    // ── Render ──

    return (
        <div className="flex h-screen w-screen bg-[#050505] text-white overflow-hidden font-sans selection:bg-brand-500/30 selection:text-brand-200">
            {/* Sidebar */}
            <div className="w-20 bg-[#080808] border-r border-white/5 flex flex-col items-center py-6 gap-6 z-50">
                <div className="mb-2">
                    <Biohazard size={28} className="text-voodoo-toxic-green animate-pulse-slow" />
                </div>

                <nav className="flex flex-col gap-4 w-full px-2">
                    <NavItem icon={<Activity size={20} />} label="Lab" active={view === 'lab'} onClick={() => setView('lab')} />
                    <NavItem icon={<LayoutDashboard size={20} />} label="Tasks" active={view === 'tasks'} onClick={() => setView('tasks')} />
                    <NavItem icon={<Zap size={20} />} label="Arena" active={view === 'arena'} onClick={() => setView('arena')} />
                    <NavItem icon={<Brain size={20} />} label="Intel" active={view === 'intel'} onClick={() => setView('intel')} />
                    <NavItem icon={<Shield size={20} />} label="Detox" active={view === 'detox'} onClick={() => setView('detox')} />
                </nav>

                <div className="mt-auto flex flex-col gap-4 w-full px-2">
                    <NavItem icon={<Settings size={20} />} label="Config" active={false} onClick={() => setShowSettingsModal(true)} />
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col relative overflow-hidden">
                {view === 'lab' && (
                    <LabDashboard
                        vms={vms}
                        onRefresh={() => voodooApi.fetchVms().then(setVms)}
                        onSelectVm={handleSelectVm}
                        onLaunchNativeSpice={handleLaunchNativeSpice}
                        onOpenSubmission={handleOpenSubmission}
                        onSelectTask={handleSelectTask}
                    />
                )}

                {view === 'tasks' && (
                    <TaskDashboard
                        onSelectTask={handleSelectTask}
                        onOpenSubmission={() => handleOpenSubmission()}
                        onOpenLineage={handleOpenLineage}
                    />
                )}

                {view === 'arena' && arenaTarget && (
                    <AnalysisArena
                        target={arenaTarget}
                        events={events} // Arena might fetch its own, but passing events is fine
                        onBack={() => setView('lab')}
                    />
                )}

                {view === 'arena' && !arenaTarget && (
                    <div className="h-full flex flex-col items-center justify-center text-security-muted space-y-6 animate-in fade-in duration-700">
                        <MonitorPlaceholder />
                        <button onClick={() => setView('lab')} className="btn-secondary">Return to Lab</button>
                    </div>
                )}

                {view === 'report' && (
                    <ReportView
                        taskId={selectedTaskId}
                        events={events}
                        onBack={() => setView('tasks')}
                        onOpenLineage={() => selectedTaskId && handleOpenLineage(selectedTaskId)}
                    />
                )}

                {view === 'lineage' && (
                    <LineagePage
                        taskId={selectedTaskId}
                        events={events}
                        onBack={() => setView('report')} // Back returns to report view usually? Or tasks?
                    />
                )}

                {view === 'intel' && <IntelHub />}

                {view === 'detox' && <DetoxDashboard />}

                {/* Global Floating Components */}
                <FloatingChat
                    activeTaskId={selectedTaskId || undefined}
                    activeProvider={aiProvider}
                    pageContext={(() => {
                        let ctx = `User is currently viewing the [${view.toUpperCase()}] page.\n`;
                        if (view === 'lab') {
                            ctx += `Visible VMs: ${vms.length}. Running: ${vms.filter(v => v.status === 'running').length}.\n`;
                        } else if (view === 'report' && selectedTaskId) {
                            ctx += `Analyzing specific Task ID: ${selectedTaskId}.\n`;
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

                <SettingsModal
                    isOpen={showSettingsModal}
                    onClose={() => setShowSettingsModal(false)}
                    onConfigUpdated={(provider) => setAiProvider(provider)}
                />
            </div>
        </div>
    );
}

// ── Subcomponents ──

function NavItem({ icon, label, active, onClick, disabled }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, disabled?: boolean }) {
    return (
        <button
            disabled={disabled}
            onClick={onClick}
            className={`flex flex-col items-center justify-center p-2 rounded-lg transition-all ${active ? 'bg-brand-500/20 text-brand-500' : 'text-zinc-600 hover:text-white hover:bg-white/5'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
            {icon}
            <span className="text-[9px] font-black uppercase tracking-tighter mt-1">{label}</span>
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
