import React, { useEffect, useState } from 'react';
import { ArrowLeft, Clock, Activity, FileText } from 'lucide-react';
import { AgentEvent, AnalysisTask, voodooApi } from './voodooApi';
import ProcessLineage from './ProcessLineage';

interface LineagePageProps {
    taskId: string | null;
    events: AgentEvent[];
    onBack: () => void;
}

export default function LineagePage({ taskId, events: initialEvents, onBack }: LineagePageProps) {
    const [task, setTask] = useState<AnalysisTask | null>(null);
    const [events, setEvents] = useState<AgentEvent[]>(initialEvents);
    const [loading, setLoading] = useState(false);
    const [aiReport, setAiReport] = useState<any>(null);

    useEffect(() => {
        if (taskId) {
            setLoading(true);
            // Fetch task details
            voodooApi.fetchTasks().then(tasks => {
                const found = tasks.find(t => t.id === taskId);
                if (found) setTask(found);
            });

            // Fetch events if not enough provided
            if (initialEvents.length === 0) {
                voodooApi.fetchHistory(taskId).then(evts => {
                    setEvents(evts);
                    setLoading(false);
                });
            } else {
                setLoading(false);
            }

            // Fetch AI report for MITRE data
            voodooApi.getAIAnalysis(initialEvents.length > 0 ? initialEvents : []).then(report => {
                setAiReport(report);
            }).catch(e => console.error("Failed to fetch AI report for matrix", e));
        }
    }, [taskId]);

    const mitreData = (() => {
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
    })();

    return (
        <div className="flex flex-col h-full bg-[#050505] animate-in fade-in zoom-in duration-300">
            {/* Header */}
            <div className="h-14 border-b border-white/10 bg-[#0a0a0a] flex items-center justify-between px-6 shrink-0 z-20 shadow-xl">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-white/5 rounded-full text-zinc-400 hover:text-white transition-colors group"
                    >
                        <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
                    </button>
                    <div>
                        <h1 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">MAXIMIZED VIEW</h1>
                        <div className="flex items-center gap-2 text-white font-bold text-lg leading-none">
                            <Activity size={18} className="text-brand-500" />
                            Process Lineage Analysis
                        </div>
                    </div>
                </div>

                {task && (
                    <div className="flex items-center gap-6 text-xs font-mono text-zinc-400">
                        <div className="flex items-center gap-2">
                            <FileText size={14} className="text-zinc-600" />
                            <span className="text-white">{task.filename}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Clock size={14} className="text-zinc-600" />
                            <span>{new Date(task.created_at).toLocaleString()}</span>
                        </div>
                        <div className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border ${task.verdict === 'Malicious' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                            'bg-green-500/10 text-green-500 border-green-500/20'
                            }`}>
                            {task.verdict || 'PENDING'}
                        </div>
                    </div>
                )}
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-hidden relative bg-[#080808]">
                {loading ? (
                    <div className="absolute inset-0 flex items-center justify-center text-zinc-500 gap-2">
                        <Activity className="animate-spin" />
                        <span className="text-sm font-bold uppercase tracking-widest">Loading Telemetry...</span>
                    </div>
                ) : (
                    <ProcessLineage
                        events={events}
                        mitreData={mitreData}
                        isMaximized={true}
                        onMaximize={onBack} // Clicking maximize again (minimize) goes back
                    />
                )}
            </div>
        </div>
    );
}
