import React, { useState, useEffect } from 'react';
import { Bug, Activity, Disc, Box, FileText, Play, Layers, Server, Sliders, Zap, MonitorPlay, ExternalLink } from 'lucide-react';
import { ViewModel, voodooApi, BASE_URL } from './voodooApi';

interface AnalysisTask {
    id: string;
    filename: string;
    original_filename: string;
    file_hash: string;
    status: string;
    verdict: string | null;
    risk_score: number | null;
    created_at: number;
    completed_at: number | null;
    verdict_manual?: boolean;
    sandbox_id: string | null;
}

interface Props {
    vms: ViewModel[];
    onRefresh: () => void;
    onSelectVm: (node: string, vmid: number, mode: 'vnc' | 'spice-html5') => void;
    onLaunchNativeSpice: (node: string, vmid: number) => void;
    onOpenSubmission: (vm?: { node: string, vmid: number }) => void;
    onSelectTask: (taskId: string) => void;
}

export default function LabDashboard({ vms, onRefresh, onSelectVm, onLaunchNativeSpice, onOpenSubmission, onSelectTask }: Props) {
    const [tasks, setTasks] = useState<AnalysisTask[]>([]);
    const [allowedVmIds, setAllowedVmIds] = useState<number[]>([]);
    const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);


    useEffect(() => {
        fetchTasks();
        const interval = setInterval(fetchTasks, 5000);
        return () => clearInterval(interval);
    }, []);

    // Load allowed VM IDs from localStorage on mount
    useEffect(() => {
        const saved = localStorage.getItem('voodoo_allowed_vms');
        if (saved) {
            try {
                setAllowedVmIds(JSON.parse(saved));
            } catch (e) {
                console.error("Failed to parse allowed VMs", e);
            }
        } else {
            // Default to all VMs if none saved
            setAllowedVmIds(vms.map(v => v.vmid));
        }
    }, [vms.length]);

    const saveAllowedVms = (ids: number[]) => {
        setAllowedVmIds(ids);
        localStorage.setItem('voodoo_allowed_vms', JSON.stringify(ids));
    };

    const fetchTasks = async () => {
        try {
            const response = await fetch(`${BASE_URL}/tasks`);
            if (response.ok) {
                const data: AnalysisTask[] = await response.json();
                setTasks(data);
            }
        } catch (error) {
            console.error('Failed to fetch tasks:', error);
        }
    };

    const handleOverrideVerdict = async (taskId: string, currentVerdict: string | null) => {
        const newVerdict = currentVerdict === 'Malicious' ? 'Benign' : 'Malicious';
        try {
            const success = await voodooApi.updateTaskVerdict(taskId, newVerdict);
            if (success) {
                fetchTasks();
            }
        } catch (error) {
            console.error('Failed to update verdict:', error);
        }
    };

    const activeVms = vms.filter(v => v.status === 'running' && allowedVmIds.includes(v.vmid));
    const filteredAllVms = vms.filter(v => allowedVmIds.includes(v.vmid));

    return (
        <div className="h-full bg-voodoo-void-black flex flex-col p-6 overflow-hidden relative">
            <div className="scanlines"></div>
            {/* Header Section */}
            <header className="flex justify-between items-center mb-6 relative z-10 shrink-0">
                <div className="flex items-center gap-4">
                    <img src="/logo.png" alt="THE VOODOOBOX" className="h-20 w-auto object-contain drop-shadow-[4px_4px_0px_rgba(0,0,0,1)]" />
                </div>

                <div className="flex gap-4">
                    <button
                        onClick={() => onOpenSubmission()}
                        className="btn-primary h-10 px-6 flex items-center gap-2 group shadow-[0_0_15px_rgba(57,255,20,0.2)] hover:bg-voodoo-toxic-green hover:text-black transition-all"
                    >
                        <Play fill="currentColor" size={14} />
                        <span className="font-black uppercase tracking-[0.2em] text-[10px]">Submit Sample</span>
                    </button>
                    <button
                        onClick={() => setIsFilterModalOpen(true)}
                        className="btn-secondary h-10 px-4 flex items-center gap-2 group shadow-sm hover:border-voodoo-purple hover:text-voodoo-purple border-voodoo-purple/30"
                    >
                        <Sliders size={16} />
                        <span className="font-bold uppercase tracking-widest text-[10px]">VM Filter</span>
                    </button>
                    <button
                        onClick={onRefresh}
                        className="btn-secondary h-10 px-4 flex items-center gap-2 group shadow-sm hover:border-voodoo-toxic-green hover:text-voodoo-toxic-green"
                    >
                        <Activity size={16} className="group-hover:rotate-180 transition-transform duration-500" />
                        <span className="font-bold">SYNC NULL-FIELD</span>
                    </button>
                </div>
            </header>

            {/* Main Workflow Rack */}
            <div className="flex-1 grid grid-cols-12 gap-6 min-h-0 relative z-10">

                {/* VM CRATE - Left Column (Span 4) */}
                <div className="col-span-4 flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <Server size={14} className="text-voodoo-purple" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-voodoo-purple bg-black/80 px-1">Active Nodes</span>
                        </div>
                        <span className="text-[9px] font-mono text-white/40">{activeVms.length} ONLINE</span>
                    </div>

                    <div className="flex-1 card bg-black/40 border-voodoo-border overflow-y-auto custom-scrollbar p-2 space-y-2">
                        {filteredAllVms.map((vm: ViewModel) => (
                            <VmCrateItem
                                key={vm.vmid}
                                vm={vm}
                                onSelect={onSelectVm}
                                onLaunchNativeSpice={onLaunchNativeSpice}
                                onOpenSubmission={onOpenSubmission}
                            />
                        ))}
                    </div>
                </div>

                {/* THE SEQUENCER (Analysis/Results) - Right Column (Span 8) */}
                <div className="col-span-8 flex flex-col min-h-0">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <Activity size={14} className="text-voodoo-toxic-green" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-voodoo-toxic-green bg-black/80 px-1">Cross-Platform Sandbox Instance</span>
                        </div>
                    </div>

                    <div className="flex-1 card flex flex-col bg-voodoo-industrial-gray border-voodoo-border relative overflow-hidden min-h-0">
                        {/* Compact Stats Header */}
                        <div className="h-12 bg-black/60 border-b border-voodoo-border px-6 flex items-center justify-between shrink-0">
                            <span className="text-[10px] font-black text-voodoo-toxic-green uppercase tracking-widest bg-black px-1">Analysis Queue</span>
                            <div className="flex gap-2">
                                <span className="status-badge text-voodoo-green border-voodoo-green/30">CLEAN: {tasks.filter((t: AnalysisTask) => t.verdict === 'Benign' || t.verdict === 'Clean').length}</span>
                                <span className="status-badge text-voodoo-purple border-voodoo-purple/30">MALICIOUS: {tasks.filter((t: AnalysisTask) => t.verdict === 'Malicious').length}</span>
                            </div>
                        </div>

                        {/* Setlist Data Table (Placeholder for now) */}
                        <div className="flex-1 bg-black/20 overflow-y-auto custom-scrollbar p-0">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-black/40 text-[9px] font-black uppercase tracking-widest text-white/40 sticky top-0 backdrop-blur-md z-10">
                                    <tr>
                                        <th className="p-3 border-b border-voodoo-border">Time</th>
                                        <th className="p-3 border-b border-voodoo-border">Sample</th>
                                        <th className="p-3 border-b border-voodoo-border">Verdict</th>
                                        <th className="p-3 border-b border-voodoo-border text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="text-xs font-mono">
                                    {tasks.map((task: AnalysisTask) => (
                                        <tr
                                            key={task.id}
                                            onClick={() => onSelectTask(task.id)}
                                            className="border-b border-voodoo-border/30 hover:bg-white/5 transition-colors group cursor-pointer"
                                        >
                                            <td className="p-3 text-white/50">{new Date(task.created_at).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}</td>
                                            <td className="p-3 text-white">
                                                <div className="flex items-center gap-2">
                                                    <Box size={12} className="text-voodoo-purple" />
                                                    <span className="truncate max-w-[200px]" title={task.original_filename || task.filename}>
                                                        {task.original_filename || task.filename}
                                                    </span>
                                                </div>
                                                <div className="text-[9px] text-white/30 break-all">
                                                    {task.file_hash ? `SHA: ${task.file_hash}` : `ID: ${task.id}`}
                                                </div>
                                            </td>
                                            <td className="p-3">
                                                <button
                                                    onClick={() => handleOverrideVerdict(task.id, task.verdict)}
                                                    className={`px-3 py-1 text-[10px] font-black uppercase tracking-wider border-2 transition-all hover:brightness-125 active:scale-95 flex items-center gap-2 shadow-sm ${task.verdict === 'Malicious' ? 'bg-voodoo-purple/20 text-voodoo-purple border-voodoo-purple' :
                                                        (task.verdict === 'Benign' || task.verdict === 'Clean') ? 'bg-voodoo-green/20 text-voodoo-green border-voodoo-green' :
                                                            'bg-white/5 text-white/60 border-white/20'
                                                        }`}
                                                    title={task.verdict_manual ? "Manual Override Active (Click to Toggle)" : "Click to Override AI Verdict"}
                                                >
                                                    <span className="w-2 h-2 rounded-full bg-current shadow-[0_0_8px_currentColor]"></span>
                                                    {task.verdict || "PENDING"}
                                                    {task.verdict_manual && <Zap size={10} className="text-voodoo-toxic-green" />}
                                                </button>
                                            </td>
                                            <td className="p-3 text-right">
                                                <button
                                                    onClick={() => onSelectTask(task.id)}
                                                    className="p-1 hover:text-white text-white/40 transition-colors"
                                                    title="View Detailed Report"
                                                >
                                                    <FileText size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {tasks.length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="p-10 text-center text-white/20 uppercase tracking-widest text-[10px]">
                                                Null Field - No Active Sequences
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Action Footer removed (button moved to top) */}
                    </div>
                </div>
            </div>

            {/* Footer Controls */}
            <footer className="mt-4 h-12 bg-black/80 border-t border-voodoo-border flex items-center justify-between px-6 relative z-10 backdrop-blur-sm">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-none bg-voodoo-toxic-green animate-pulse"></div>
                        <span className="text-[9px] font-black uppercase tracking-widest text-voodoo-toxic-green">Poison for the Mind</span>
                    </div>
                </div>

                <div className="flex gap-4">
                    <IconButton icon={<Layers />} label="Library" />
                    <IconButton icon={<Server />} label="Hardware" />
                    <IconButton icon={<Sliders />} label="Master" />
                </div>
            </footer>

            {/* VM Filter Modal */}
            {isFilterModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
                    <div className="card w-full max-w-md bg-voodoo-industrial-gray border-voodoo-purple flex flex-col shadow-[0_0_50px_rgba(168,85,247,0.2)]">
                        <div className="p-4 border-b border-voodoo-border flex justify-between items-center bg-black/40">
                            <div className="flex items-center gap-2">
                                <Sliders size={16} className="text-voodoo-purple" />
                                <h2 className="text-sm font-black uppercase tracking-widest text-white">VM ACCESS CONTROL</h2>
                            </div>
                            <button onClick={() => setIsFilterModalOpen(false)} className="text-white/40 hover:text-white transition-colors">✕</button>
                        </div>

                        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                            <p className="text-[10px] uppercase font-bold text-white/40 leading-relaxed mb-4">
                                Select the virtual machine instances authorized for analysis orchestration. Unauthorized nodes will be hidden from the crate.
                            </p>

                            <div className="space-y-2">
                                {vms.map((vm: ViewModel) => (
                                    <label key={vm.vmid} className="flex items-center justify-between p-3 border border-voodoo-border/50 hover:border-voodoo-purple/50 bg-black/30 cursor-pointer group transition-all">
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="checkbox"
                                                checked={allowedVmIds.includes(vm.vmid)}
                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                                    const next = e.target.checked
                                                        ? [...allowedVmIds, vm.vmid]
                                                        : allowedVmIds.filter((id: number) => id !== vm.vmid);
                                                    saveAllowedVms(next);
                                                }}
                                                className="w-4 h-4 accent-voodoo-purple bg-black border-voodoo-border"
                                            />
                                            <div className="flex flex-col">
                                                <span className="text-xs font-bold text-white group-hover:text-voodoo-purple transition-colors">{vm.name || `VM-${vm.vmid}`}</span>
                                                <span className="text-[9px] font-mono text-white/30 truncate">ID: {vm.vmid} • {vm.node}</span>
                                            </div>
                                        </div>
                                        <div className={`px-2 py-0.5 text-[8px] font-black uppercase tracking-tighter ${vm.status === 'running' ? 'bg-voodoo-green/20 text-voodoo-green' : 'bg-white/5 text-white/20'}`}>
                                            {vm.status}
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="p-4 bg-black/40 border-t border-voodoo-border flex gap-3">
                            <button
                                onClick={() => saveAllowedVms(vms.map(v => v.vmid))}
                                className="flex-1 py-2 text-[9px] font-black uppercase tracking-widest text-white/60 hover:text-white border border-white/10 hover:border-white/20 transition-all"
                            >
                                Allow All
                            </button>
                            <button
                                onClick={() => setIsFilterModalOpen(false)}
                                className="flex-1 py-2 bg-voodoo-purple text-white text-[9px] font-black uppercase tracking-widest hover:brightness-110 shadow-[0_0_15px_rgba(168,85,247,0.3)]"
                            >
                                Confirm Access
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function IconButton({ icon, label }: { icon: React.ReactNode, label: string }) {
    return (
        <button className="flex flex-col items-center gap-1 group text-white/40 hover:text-white transition-all">
            <div className="group-hover:scale-110 transition-transform">
                {React.cloneElement(icon as React.ReactElement, { size: 14 })}
            </div>
        </button>
    );
}

function VmCrateItem({ vm, onSelect, onLaunchNativeSpice, onOpenSubmission }: {
    vm: ViewModel,
    onSelect: (node: string, vmid: number, mode: 'vnc' | 'spice-html5') => void,
    onLaunchNativeSpice: (node: string, vmid: number) => void,
    onOpenSubmission: (vm?: { node: string, vmid: number }) => void
}) {
    return (
        <div className={`p-3 border transition-all group flex flex-col gap-2 ${vm.status === 'running'
            ? 'bg-voodoo-purple/10 border-voodoo-purple'
            : 'bg-transparent border-voodoo-border hover:bg-white/5 hover:border-white/10'
            }`}>

            <div className="flex items-center gap-3 cursor-pointer" onClick={() => onSelect(vm.node, vm.vmid, 'vnc')}>
                <div className={`p-1.5 ${vm.status === 'running' ? 'bg-voodoo-purple text-black' : 'bg-white/5 text-white/30'}`}>
                    <Disc size={14} className={vm.status === 'running' ? 'animate-spin-slow' : ''} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                        <h4 className="text-[11px] font-bold text-white truncate uppercase tracking-tighter">{vm.name || `VM-${vm.vmid}`}</h4>
                        <span className={`text-[9px] font-black uppercase tracking-wider ${vm.status === 'running' ? 'text-voodoo-green' : 'text-white/20'}`}>
                            {vm.status}
                        </span>
                    </div>
                    <p className="text-[9px] font-mono text-white/30 truncate">ID: {vm.vmid} • {vm.node}</p>
                </div>
            </div>

            {/* Quick Actions for Running VMs */}
            {vm.status === 'running' && (
                <div className="flex gap-2 mt-1 border-t border-white/10 pt-2">
                    <button
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); onSelect(vm.node, vm.vmid, 'vnc'); }}
                        className="flex-1 py-1 flex items-center justify-center gap-1 text-[8px] font-black uppercase bg-brand-500/20 text-brand-500 hover:bg-brand-500 hover:text-white transition-colors"
                    >
                        <MonitorPlay size={10} /> VNC
                    </button>
                    <button
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); onLaunchNativeSpice(vm.node, vm.vmid); }}
                        className="flex-1 py-1 flex items-center justify-center gap-1 text-[8px] font-black uppercase bg-white/5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
                    >
                        <ExternalLink size={10} /> SPICE
                    </button>
                    <button
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); onOpenSubmission({ node: vm.node, vmid: vm.vmid }); }}
                        className="flex-1 py-1 flex items-center justify-center gap-1 text-[8px] font-black uppercase bg-voodoo-toxic-green/10 text-voodoo-toxic-green hover:bg-voodoo-toxic-green hover:text-black transition-colors"
                    >
                        <Zap size={10} /> DETONATE
                    </button>
                </div>
            )}
        </div>
    );
}
