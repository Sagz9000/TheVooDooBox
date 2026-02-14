import React, { useMemo } from 'react';
import {
    ShieldAlert,
    ShieldCheck,
    ShieldQuestion,
    Activity,
    Globe,
    FileText,
    Server,
    Code2,
    Cpu,
    Zap,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    ExternalLink,
    ChevronRight,
    Target,
    Brain,
    Fingerprint,
    Clock,
    BarChart3,
    Sparkles,
    Lock,
} from 'lucide-react';
import { AgentEvent, ForensicReport, AnalysisTask } from './voodooApi';

interface NeuralReportProps {
    aiReport: ForensicReport | null;
    events: AgentEvent[];
    ghidraFindings: any[];
    task: AnalysisTask | null;
    taskId: string | null;
    onNavigateTab: (tab: string) => void;
}

// Threat score ring component
function ThreatScoreRing({ score }: { score: number }) {
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const progress = (score / 100) * circumference;
    const color = score >= 70 ? '#ef4444' : score >= 40 ? '#f97316' : '#22c55e';
    const glowColor = score >= 70 ? 'rgba(239,68,68,0.3)' : score >= 40 ? 'rgba(249,115,22,0.3)' : 'rgba(34,197,94,0.3)';

    return (
        <div className="relative w-36 h-36 flex items-center justify-center">
            <svg className="transform -rotate-90 w-36 h-36" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                <circle
                    cx="60" cy="60" r={radius} fill="none"
                    stroke={color} strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference - progress}
                    style={{ filter: `drop-shadow(0 0 8px ${glowColor})`, transition: 'stroke-dashoffset 1s ease-out' }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-black text-white" style={{ textShadow: `0 0 20px ${glowColor}` }}>{score}</span>
                <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">Threat Score</span>
            </div>
        </div>
    );
}

// Source status card
function SourceCard({ icon, label, available, count, onClick }: { icon: React.ReactNode; label: string; available: boolean; count?: number; onClick?: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`relative p-3 rounded-lg border transition-all text-left group ${available
                ? 'bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40 hover:bg-emerald-500/10'
                : 'bg-zinc-900/50 border-white/5 opacity-50'
                }`}
        >
            <div className="flex items-center gap-2 mb-1">
                <div className={`${available ? 'text-emerald-400' : 'text-zinc-600'}`}>{icon}</div>
                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">{label}</span>
                {available && <ChevronRight size={10} className="text-emerald-500/50 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />}
            </div>
            {available ? (
                <div className="flex items-center gap-1.5 mt-1">
                    <CheckCircle2 size={10} className="text-emerald-500" />
                    <span className="text-[9px] text-emerald-400 font-bold">{count !== undefined ? `${count} findings` : 'Available'}</span>
                </div>
            ) : (
                <div className="flex items-center gap-1.5 mt-1">
                    <XCircle size={10} className="text-zinc-600" />
                    <span className="text-[9px] text-zinc-600 font-bold">No data</span>
                </div>
            )}
        </button>
    );
}

export default function NeuralReport({ aiReport, events, ghidraFindings, task, taskId, onNavigateTab }: NeuralReportProps) {
    // Aggregate event stats
    const stats = useMemo(() => {
        const taskEvents = events.filter((e: AgentEvent) => !taskId || e.task_id === taskId);
        const processes = taskEvents.filter(e => e.event_type === 'PROCESS_CREATE');
        const network = taskEvents.filter(e => e.event_type.includes('NETWORK'));
        const files = taskEvents.filter(e => e.event_type.startsWith('FILE_'));
        const registry = taskEvents.filter(e => e.event_type.includes('REG_') || e.event_type.includes('REGISTRY'));

        return { total: taskEvents.length, processes: processes.length, network: network.length, files: files.length, registry: registry.length };
    }, [events, taskId]);

    const verdictConfig = useMemo(() => {
        const v = aiReport?.verdict?.toLowerCase() || '';
        if (v.includes('malicious') || v.includes('gamma')) return { label: 'MALICIOUS', icon: <ShieldAlert size={28} />, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', glow: 'shadow-[0_0_30px_rgba(239,68,68,0.15)]' };
        if (v.includes('suspicious') || v.includes('beta')) return { label: 'SUSPICIOUS', icon: <ShieldQuestion size={28} />, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30', glow: 'shadow-[0_0_30px_rgba(249,115,22,0.15)]' };
        return { label: 'BENIGN', icon: <ShieldCheck size={28} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', glow: 'shadow-[0_0_30px_rgba(34,197,94,0.15)]' };
    }, [aiReport]);

    const mitreCount = useMemo(() => {
        if (!aiReport?.mitre_matrix) return 0;
        return Object.values(aiReport.mitre_matrix).reduce((sum, techs) => sum + techs.length, 0);
    }, [aiReport]);

    // No AI report yet — show prompt
    if (!aiReport) {
        return (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 space-y-6">
                <div className="w-20 h-20 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center shadow-[0_0_40px_rgba(59,130,246,0.1)]">
                    <Brain size={40} className="text-brand-400 animate-pulse" />
                </div>
                <div>
                    <h2 className="text-lg font-black text-white uppercase tracking-wider mb-2">Neural Report Awaiting Analysis</h2>
                    <p className="text-sm text-zinc-500 max-w-md">
                        Run the AI analysis engine to generate the unified intelligence report.
                        Click <strong className="text-brand-400">Run Analytics</strong> in the header to begin.
                    </p>
                </div>
                <div className="grid grid-cols-2 gap-3 w-full max-w-sm text-left">
                    <div className="p-3 rounded-lg bg-zinc-900/50 border border-white/5">
                        <div className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-1">Telemetry Events</div>
                        <div className="text-xl font-black text-white">{stats.total}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-zinc-900/50 border border-white/5">
                        <div className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-1">Ghidra Findings</div>
                        <div className="text-xl font-black text-white">{ghidraFindings.length}</div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="absolute inset-0 overflow-y-auto custom-scrollbar">
            <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">

                {/* ═══ Section 1: Verdict Banner ═══ */}
                <div className={`relative rounded-xl border-2 ${verdictConfig.border} ${verdictConfig.bg} ${verdictConfig.glow} p-6 overflow-hidden`}>
                    {/* Background pattern */}
                    <div className="absolute inset-0 opacity-[0.03]" style={{
                        backgroundImage: 'repeating-linear-gradient(45deg, currentColor 0, currentColor 1px, transparent 0, transparent 50%)',
                        backgroundSize: '12px 12px'
                    }} />

                    <div className="relative flex flex-col md:flex-row items-center gap-6">
                        <ThreatScoreRing score={aiReport.threat_score} />

                        <div className="flex-1 text-center md:text-left">
                            <div className="flex items-center gap-3 justify-center md:justify-start mb-2">
                                <span className={verdictConfig.color}>{verdictConfig.icon}</span>
                                <h1 className={`text-2xl md:text-3xl font-black uppercase tracking-tight ${verdictConfig.color}`}>
                                    {verdictConfig.label}
                                </h1>
                            </div>

                            <div className="flex flex-wrap items-center gap-3 justify-center md:justify-start text-xs">
                                {aiReport.malware_family && aiReport.malware_family !== 'N/A' && aiReport.malware_family !== 'Unknown' && (
                                    <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 font-bold text-zinc-300">
                                        <Fingerprint size={11} className="inline mr-1.5 text-purple-400" />
                                        {aiReport.malware_family}
                                    </span>
                                )}
                                {aiReport.digital_signature && (
                                    <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 font-bold text-zinc-300">
                                        <Lock size={11} className="inline mr-1.5 text-yellow-400" />
                                        {aiReport.digital_signature.slice(0, 50)}
                                    </span>
                                )}
                                {mitreCount > 0 && (
                                    <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 font-bold text-zinc-300">
                                        <Target size={11} className="inline mr-1.5 text-red-400" />
                                        {mitreCount} MITRE Technique{mitreCount > 1 ? 's' : ''}
                                    </span>
                                )}
                            </div>

                            <p className="mt-3 text-sm text-zinc-400 leading-relaxed line-clamp-3">
                                {aiReport.executive_summary}
                            </p>
                        </div>
                    </div>
                </div>

                {/* ═══ Section 2: Data Source Coverage ═══ */}
                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <Sparkles size={14} className="text-brand-400" />
                        <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Intelligence Sources</h2>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                        <SourceCard
                            icon={<Activity size={14} />}
                            label="Sandbox"
                            available={stats.total > 0}
                            count={stats.total}
                            onClick={() => onNavigateTab('timeline')}
                        />
                        <SourceCard
                            icon={<Code2 size={14} />}
                            label="Ghidra"
                            available={ghidraFindings.length > 0}
                            count={ghidraFindings.length}
                            onClick={() => onNavigateTab('ghidra')}
                        />
                        <SourceCard
                            icon={<Globe size={14} />}
                            label="VirusTotal"
                            available={!!aiReport.virustotal}
                            count={aiReport.virustotal?.malicious_votes}
                            onClick={() => onNavigateTab('intelligence')}
                        />
                        <SourceCard
                            icon={<ShieldAlert size={14} />}
                            label="Remnux"
                            available={task?.remnux_status === 'Completed'}
                            onClick={() => onNavigateTab('remnux')}
                        />
                        <SourceCard
                            icon={<Brain size={14} />}
                            label="AI Engine"
                            available={true}
                            onClick={() => onNavigateTab('intelligence')}
                        />
                    </div>
                </div>

                {/* ═══ Section 3: Telemetry Overview ═══ */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                        { label: 'Processes', value: stats.processes, icon: <Cpu size={16} />, color: 'text-brand-400', tab: 'timeline' },
                        { label: 'Network', value: stats.network, icon: <Globe size={16} />, color: 'text-purple-400', tab: 'network' },
                        { label: 'File Ops', value: stats.files, icon: <FileText size={16} />, color: 'text-emerald-400', tab: 'files' },
                        { label: 'Registry', value: stats.registry, icon: <Server size={16} />, color: 'text-orange-400', tab: 'registry' },
                    ].map(stat => (
                        <button
                            key={stat.label}
                            onClick={() => onNavigateTab(stat.tab)}
                            className="p-4 rounded-lg bg-zinc-900/50 border border-white/5 hover:border-white/15 transition-all text-left group"
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className={stat.color}>{stat.icon}</span>
                                <ChevronRight size={12} className="text-zinc-700 group-hover:text-zinc-400 transition-colors" />
                            </div>
                            <div className="text-2xl font-black text-white">{stat.value}</div>
                            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-600">{stat.label}</div>
                        </button>
                    ))}
                </div>

                {/* ═══ Section 4: MITRE ATT&CK Techniques ═══ */}
                {aiReport.mitre_matrix && Object.keys(aiReport.mitre_matrix).length > 0 && (
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <Target size={14} className="text-red-400" />
                            <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">MITRE ATT&CK Coverage</h2>
                            <button onClick={() => onNavigateTab('tactics')} className="ml-auto text-[9px] font-bold text-brand-400 hover:text-brand-300 transition-colors flex items-center gap-1">
                                Full Matrix <ExternalLink size={9} />
                            </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                            {Object.entries(aiReport.mitre_matrix).map(([tactic, techniques]) => (
                                <div key={tactic} className="p-3 rounded-lg bg-zinc-900/50 border border-white/5">
                                    <div className="text-[9px] font-black uppercase tracking-widest text-red-400/70 mb-2">{tactic}</div>
                                    <div className="space-y-1.5">
                                        {techniques.map((t, i) => (
                                            <div key={i} className="flex items-start gap-2 text-xs">
                                                <span className="text-red-500/60 font-mono text-[10px] shrink-0 mt-0.5">{t.id}</span>
                                                <span className="text-zinc-400">{t.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ═══ Section 5: Key Behavioral Events ═══ */}
                {aiReport.behavioral_timeline && aiReport.behavioral_timeline.length > 0 && (
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <Clock size={14} className="text-yellow-400" />
                            <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Behavioral Timeline</h2>
                        </div>
                        <div className="relative pl-4 border-l border-white/10 space-y-3">
                            {aiReport.behavioral_timeline.slice(0, 8).map((evt, i) => (
                                <div key={i} className="relative group">
                                    <div className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-brand-500 bg-[#080808] group-hover:bg-brand-500 transition-colors" />
                                    <div className="p-3 rounded-lg bg-zinc-900/30 border border-white/5 group-hover:border-white/10 transition-colors">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-[9px] font-mono text-brand-400/70">{evt.timestamp_offset}</span>
                                            <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-white/5 text-zinc-500">{evt.stage}</span>
                                        </div>
                                        <p className="text-xs text-zinc-300 leading-relaxed">{evt.event_description}</p>
                                        {evt.technical_context && (
                                            <p className="text-[10px] text-zinc-600 mt-1 font-mono">{evt.technical_context}</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {aiReport.behavioral_timeline.length > 8 && (
                                <div className="text-[9px] text-zinc-600 font-bold pl-2">
                                    + {aiReport.behavioral_timeline.length - 8} more events →{' '}
                                    <button onClick={() => onNavigateTab('intelligence')} className="text-brand-400 hover:underline">View All</button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ═══ Section 6: Artifacts / IOCs ═══ */}
                {aiReport.artifacts && (
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <AlertTriangle size={14} className="text-orange-400" />
                            <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Indicators of Compromise</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {/* C2 Domains */}
                            {aiReport.artifacts.c2_domains.length > 0 && (
                                <div className="p-3 rounded-lg bg-zinc-900/50 border border-red-500/10">
                                    <div className="text-[9px] font-black uppercase tracking-widest text-red-400/70 mb-2 flex items-center gap-1.5">
                                        <Globe size={10} /> C2 Domains
                                    </div>
                                    <div className="space-y-1">
                                        {aiReport.artifacts.c2_domains.map((d, i) => (
                                            <div key={i} className="text-xs font-mono text-zinc-300 bg-black/30 px-2 py-1 rounded">{d}</div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* C2 IPs */}
                            {aiReport.artifacts.c2_ips && aiReport.artifacts.c2_ips.length > 0 && (
                                <div className="p-3 rounded-lg bg-zinc-900/50 border border-red-500/10">
                                    <div className="text-[9px] font-black uppercase tracking-widest text-red-400/70 mb-2 flex items-center gap-1.5">
                                        <Globe size={10} /> C2 IPs
                                    </div>
                                    <div className="space-y-1">
                                        {aiReport.artifacts.c2_ips.map((ip, i) => (
                                            <div key={i} className="text-xs font-mono text-zinc-300 bg-black/30 px-2 py-1 rounded">{ip}</div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Dropped Files */}
                            {aiReport.artifacts.dropped_files.length > 0 && (
                                <div className="p-3 rounded-lg bg-zinc-900/50 border border-orange-500/10">
                                    <div className="text-[9px] font-black uppercase tracking-widest text-orange-400/70 mb-2 flex items-center gap-1.5">
                                        <FileText size={10} /> Dropped Files
                                    </div>
                                    <div className="space-y-1">
                                        {aiReport.artifacts.dropped_files.map((f, i) => (
                                            <div key={i} className="text-xs font-mono text-zinc-300 bg-black/30 px-2 py-1 rounded truncate" title={f}>{f}</div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Suspicious Commands */}
                            {aiReport.artifacts.command_lines.length > 0 && (
                                <div className="p-3 rounded-lg bg-zinc-900/50 border border-yellow-500/10">
                                    <div className="text-[9px] font-black uppercase tracking-widest text-yellow-400/70 mb-2 flex items-center gap-1.5">
                                        <Zap size={10} /> Suspicious Commands
                                    </div>
                                    <div className="space-y-1">
                                        {aiReport.artifacts.command_lines.map((c, i) => (
                                            <div key={i} className="text-[10px] font-mono text-zinc-300 bg-black/30 px-2 py-1 rounded break-all">{c}</div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ═══ Section 7: VirusTotal Intelligence ═══ */}
                {aiReport.virustotal && (
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <BarChart3 size={14} className="text-blue-400" />
                            <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">VirusTotal Intelligence</h2>
                        </div>
                        <div className="p-4 rounded-lg bg-zinc-900/50 border border-white/5">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div>
                                    <div className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-1">Detections</div>
                                    <div className={`text-2xl font-black ${aiReport.virustotal.malicious_votes > 10 ? 'text-red-400' : aiReport.virustotal.malicious_votes > 0 ? 'text-orange-400' : 'text-emerald-400'}`}>
                                        {aiReport.virustotal.malicious_votes}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-1">Threat Label</div>
                                    <div className="text-sm font-bold text-zinc-300 truncate">{aiReport.virustotal.threat_label || 'None'}</div>
                                </div>
                                <div>
                                    <div className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-1">Family</div>
                                    <div className="text-sm font-bold text-zinc-300 truncate">
                                        {aiReport.virustotal.family_labels?.length > 0 ? aiReport.virustotal.family_labels.join(', ') : 'Unknown'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-1">Behavior Tags</div>
                                    <div className="flex flex-wrap gap-1">
                                        {aiReport.virustotal.behavior_tags?.slice(0, 4).map((tag, i) => (
                                            <span key={i} className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[8px] font-bold border border-blue-500/20">{tag}</span>
                                        ))}
                                        {(!aiReport.virustotal.behavior_tags || aiReport.virustotal.behavior_tags.length === 0) && (
                                            <span className="text-[10px] text-zinc-600">None reported</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ═══ Section 8: Static Analysis Insights ═══ */}
                {aiReport.static_analysis_insights && aiReport.static_analysis_insights.length > 0 && (
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <Code2 size={14} className="text-cyan-400" />
                            <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Static Analysis Insights</h2>
                            <button onClick={() => onNavigateTab('ghidra')} className="ml-auto text-[9px] font-bold text-brand-400 hover:text-brand-300 transition-colors flex items-center gap-1">
                                View Ghidra <ExternalLink size={9} />
                            </button>
                        </div>
                        <div className="space-y-1.5">
                            {aiReport.static_analysis_insights.map((insight, i) => (
                                <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-zinc-900/30 border border-white/5">
                                    <Code2 size={12} className="text-cyan-500/50 mt-0.5 shrink-0" />
                                    <span className="text-xs text-zinc-300 leading-relaxed">{insight}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ═══ Section 9: Recommended Actions ═══ */}
                {aiReport.recommended_actions && aiReport.recommended_actions.length > 0 && (
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <Zap size={14} className="text-yellow-400" />
                            <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Recommended Actions</h2>
                        </div>
                        <div className="space-y-2">
                            {aiReport.recommended_actions.map((action, i) => (
                                <div key={i} className="p-3 rounded-lg bg-zinc-900/50 border border-white/5 hover:border-yellow-500/20 transition-colors">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="w-5 h-5 rounded-full bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center text-[9px] font-black text-yellow-400">{i + 1}</span>
                                        <span className="text-xs font-bold text-zinc-200">{action.action}</span>
                                    </div>
                                    <p className="text-[10px] text-zinc-500 ml-7 leading-relaxed">{action.reasoning}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ═══ Section 10: Remnux Summary ═══ */}
                {task?.remnux_status === 'Completed' && task?.remnux_report && (
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <ShieldAlert size={14} className="text-purple-400" />
                            <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Remnux Static Analysis</h2>
                            <button onClick={() => onNavigateTab('remnux')} className="ml-auto text-[9px] font-bold text-brand-400 hover:text-brand-300 transition-colors flex items-center gap-1">
                                Full Report <ExternalLink size={9} />
                            </button>
                        </div>
                        <div className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/20">
                            <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar">
                                {typeof task.remnux_report === 'string' ? task.remnux_report : JSON.stringify(task.remnux_report, null, 2).slice(0, 1000)}
                            </pre>
                        </div>
                    </div>
                )}

                {/* Bottom spacer */}
                <div className="h-8" />
            </div>
        </div>
    );
}
