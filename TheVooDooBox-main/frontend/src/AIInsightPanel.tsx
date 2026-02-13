import React, { useState } from 'react';
import { Brain, ShieldAlert, Clock, FileText, Globe, Terminal, Sparkles, Loader2, ChevronDown, ChevronRight, Share2, Zap, ShieldCheck } from 'lucide-react';
import { voodooApi, ForensicReport, TimelineEvent, Artifacts, RelatedSample, RecommendedAction } from './voodooApi';

import VirusTotalCard from './VirusTotalCard';

interface AIInsightPanelProps {
    report: ForensicReport | null;
    loading: boolean;
    onAnalyze: (mode: string, autoResponse: boolean) => void;
    taskId?: string;
    onSelectPid?: (pid: number) => void;
}

const AIInsightPanel = ({ report, loading, onAnalyze, taskId, onSelectPid }: AIInsightPanelProps) => {
    const [analysisMode, setAnalysisMode] = useState<'quick' | 'deep'>('quick');
    const [autoResponse, setAutoResponse] = useState(true);
    const [expandedTimeline, setExpandedTimeline] = useState(true);
    const [expandedHive, setExpandedHive] = useState(true);
    const [expandedArtifacts, setExpandedArtifacts] = useState(true);

    const isValidReport = report && typeof report === 'object' && report.verdict;

    const getVerdictColor = (verdict: string) => {
        switch (verdict) {
            case 'Malicious': return 'bg-threat-critical/20 text-threat-critical border-threat-critical/40';
            case 'Suspicious': return 'bg-threat-high/20 text-threat-high border-threat-high/40';
            case 'Benign': return 'bg-threat-low/20 text-threat-low border-threat-low/40';
            default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
        }
    };

    const getStageColor = (stage: string) => {
        const s = stage.toLowerCase();
        if (s.includes('persistence')) return 'text-purple-400';
        if (s.includes('c2') || s.includes('network')) return 'text-threat-critical';
        if (s.includes('execution')) return 'text-threat-high';
        if (s.includes('discovery')) return 'text-yellow-400';
        return 'text-slate-400';
    };

    return (
        <div className="flex flex-col h-full bg-security-surface p-4 md:p-6 overflow-auto custom-scrollbar animate-in slide-in-from-right duration-500 min-h-0">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 md:mb-8 pb-4 border-b border-security-border gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-brand-600/10 rounded-lg shrink-0">
                        <Brain className="w-5 h-5 md:w-6 md:h-6 text-brand-500" />
                    </div>
                    <div>
                        <h2 className="text-base md:text-lg font-bold text-white leading-none uppercase tracking-tighter">Neural Correlation Engine</h2>
                        <p className="text-[9px] md:text-[10px] text-brand-500 uppercase font-black tracking-[0.2em] mt-1">Advanced AI Threat Insight</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto">
                    <div className="flex bg-black/40 rounded-lg p-1 border border-white/10 checkbox-wrapper items-center gap-2 px-3">
                        <input
                            type="checkbox"
                            id="auto-response"
                            checked={autoResponse}
                            onChange={(e) => setAutoResponse(e.target.checked)}
                            className="accent-brand-500 w-3 h-3"
                        />
                        <label htmlFor="auto-response" className="text-[10px] uppercase font-bold text-slate-400 cursor-pointer select-none flex items-center gap-1">
                            <Zap size={10} className={autoResponse ? "text-brand-400 fill-brand-400" : "text-slate-600"} />
                            Auto-Response
                        </label>
                    </div>

                    <div className="flex bg-black/40 rounded-lg p-1 border border-white/10">
                        <button
                            onClick={() => setAnalysisMode('quick')}
                            className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${analysisMode === 'quick' ? 'bg-brand-500 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
                                }`}
                        >
                            Quick Scan
                        </button>
                        <button
                            onClick={() => setAnalysisMode('deep')}
                            className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${analysisMode === 'deep' ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
                                }`}
                        >
                            Deep Dive
                        </button>
                    </div>
                    <button
                        onClick={() => onAnalyze(analysisMode, autoResponse)}
                        disabled={loading}
                        className="btn-primary h-8 px-3 text-[10px] flex items-center gap-2 shadow-lg shadow-brand-600/20 disabled:opacity-50 disabled:cursor-wait whitespace-nowrap flex-1 md:flex-initial justify-center"
                    >
                        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        {loading ? 'ANALYZING...' : 'RUN ANALYTICS'}
                    </button>
                </div>
            </div>

            {!isValidReport && !loading && (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4">
                    <div className="w-16 h-16 bg-security-panel border border-security-border rounded-2xl flex items-center justify-center mb-4 text-slate-700">
                        <ShieldAlert size={32} />
                    </div>
                    <h3 className="text-slate-300 font-bold">No Analysis Found</h3>
                    <p className="text-xs text-slate-500 mt-1 max-w-[250px]">
                        {taskId ? 'Run analytics to perform deep-dive forensic correlation for this task.' : 'Correlation requires an active telemetry session.'}
                    </p>
                    {report && typeof report === 'string' && (
                        (() => {
                            try {
                                const parsed = JSON.parse(report);
                                // If successful, we shouldn't be here, but we can't easily switch the prop type.
                                // Instead, we'll render a special "Recovered" view or just reload the component with the object.
                                // Quick fix: If we can parse it, let's treat it as a valid object by casting.
                                // However, React props are read-only. We should handle this upstream or use a local state.
                                return (
                                    <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded text-[10px] text-yellow-400 font-mono break-all max-w-full">
                                        Warning: Report received as raw text. Please refresh the analysis. <br />
                                        <div className="mt-2 text-xs text-white opacity-50 max-h-32 overflow-auto">{report}</div>
                                    </div>
                                );
                            } catch (e) {
                                return (
                                    <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-400 font-mono break-all max-w-full">
                                        Error: {report}
                                    </div>
                                );
                            }
                        })()
                    )}
                </div>
            )}

            {loading && (
                <div className="flex-1 flex flex-col items-center justify-center py-12">
                    <Loader2 className="w-10 h-10 text-brand-500 animate-spin mb-4" />
                    <p className="text-brand-400 text-xs font-mono animate-pulse uppercase tracking-widest">Reconstructing attack timeline...</p>
                </div>
            )}

            {isValidReport && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-8">
                    {/* Verdict Card */}
                    <div className="p-4 md:p-5 bg-security-panel border border-security-border rounded-xl relative overflow-hidden shadow-inner">
                        <div className="text-[9px] text-slate-500 uppercase font-black tracking-[0.2em] mb-4">Classification</div>
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 sm:gap-4">
                            <div className="w-full sm:w-auto">
                                <div className={`inline-flex px-4 py-2 rounded-lg text-sm font-black uppercase tracking-widest border-2 w-full sm:w-auto justify-center ${getVerdictColor(report.verdict)}`}>
                                    {report.verdict}
                                </div>
                                <div className="mt-3 sm:mt-2 text-xs text-slate-400">
                                    Family: <span className="text-white font-mono break-all">{report.malware_family}</span>
                                </div>
                                {report.digital_signature && (
                                    <div className="mt-2 text-xs text-slate-400 flex items-center gap-2">
                                        <ShieldCheck size={12} className={report.digital_signature.includes("Signed by") ? "text-green-400" : "text-slate-500"} />
                                        Signature: <span className={`font-mono break-all ${report.digital_signature.includes("Signed by") ? "text-green-400" : "text-slate-500"}`}>{report.digital_signature}</span>
                                    </div>
                                )}
                            </div>
                            <div className="text-left sm:text-right w-full sm:w-auto">
                                <div className="text-3xl md:text-4xl font-black text-white tracking-tighter">{report.threat_score}</div>
                                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Threat Score</div>
                            </div>
                        </div>
                    </div>

                    {/* Static Analysis Insights (Ghidra) */}
                    {report.static_analysis_insights && report.static_analysis_insights.length > 0 && (
                        <div className="space-y-3">
                            <div className="text-[9px] text-slate-500 uppercase font-black tracking-[0.2em]">Static Analysis Insights (Ghidra)</div>
                            <div className="grid grid-cols-1 gap-2">
                                {report.static_analysis_insights.map((insight, i) => (
                                    <div key={i} className="flex gap-3 p-3 bg-brand-500/5 border border-brand-500/10 rounded-lg">
                                        <div className="p-1.5 bg-brand-500/10 rounded shrink-0 h-fit">
                                            <FileText size={12} className="text-brand-400" />
                                        </div>
                                        <div className="text-[11px] text-slate-300 leading-relaxed font-mono">
                                            {insight}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* AI Reasoning & Thinking */}
                    {report.thinking && (
                        <div className="space-y-3">
                            <div className="text-[9px] text-slate-500 uppercase font-black tracking-[0.2em]">Forensic Reasoning (Chain of Thought)</div>
                            <div className="p-4 bg-security-panel/40 border border-security-border/50 rounded-lg">
                                <div className="text-[11px] font-mono text-slate-400 leading-relaxed whitespace-pre-wrap select-text selection:bg-brand-500/30 max-h-[300px] overflow-auto custom-scrollbar">
                                    {report.thinking}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Threat Intelligence (VirusTotal) */}
                    {report.virustotal && (
                        <VirusTotalCard data={report.virustotal} />
                    )}

                    {/* Recommended Actions */}
                    {report.recommended_actions && report.recommended_actions.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Zap size={14} className="text-yellow-400 fill-yellow-400" />
                                <div className="text-[9px] text-slate-500 uppercase font-black tracking-[0.2em]">Recommended Actions</div>
                            </div>
                            <div className="grid grid-cols-1 gap-3">
                                {report.recommended_actions.map((action, i) => (
                                    <div key={i} className="flex flex-col bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3 relative overflow-hidden">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-black text-yellow-400 uppercase tracking-wider bg-yellow-500/10 px-2 py-0.5 rounded border border-yellow-500/20">
                                                    {action.action}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-[11px] text-slate-300 mb-2 font-mono leading-relaxed">
                                            {action.reasoning}
                                        </div>
                                        {Object.keys(action.params).length > 0 && (
                                            <div className="bg-black/40 rounded p-2 border border-white/5">
                                                <div className="text-[9px] text-slate-500 uppercase font-bold mb-1">Parameters</div>
                                                <div className="grid grid-cols-1 gap-1">
                                                    {Object.entries(action.params).map(([k, v], j) => (
                                                        <div key={j} className="flex items-start gap-2 text-[10px] font-mono">
                                                            <span className="text-slate-500">{k}:</span>
                                                            <span className="text-slate-300 break-all">{v}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Executive Summary */}
                    <div className="space-y-3">
                        <div className="text-[9px] text-slate-500 uppercase font-black tracking-[0.2em]">Executive Summary</div>
                        <div className="text-xs md:text-sm text-slate-300 leading-relaxed bg-security-highlight p-4 rounded-lg border-l-4 border-brand-500 italic shadow-lg">
                            "{report.executive_summary}"
                        </div>
                    </div>

                    {/* Behavioral Timeline */}
                    <div className="space-y-3">
                        <button
                            onClick={() => setExpandedTimeline(!expandedTimeline)}
                            className="w-full flex items-center justify-between text-[9px] text-slate-500 uppercase font-black tracking-[0.2em] hover:text-brand-400 transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <Clock size={12} className="text-brand-500" />
                                Attack Timeline ({report.behavioral_timeline.length} Events)
                            </div>
                            {expandedTimeline ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>

                        {expandedTimeline && (
                            <div className="space-y-3">
                                {report.behavioral_timeline.map((event, i) => (
                                    <div key={i} className="bg-security-panel border border-security-border rounded-lg p-3 md:p-4 hover:border-brand-500/30 transition-colors group">
                                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 mb-2">
                                            <div className="flex items-center gap-3">
                                                <span className="text-[9px] md:text-[10px] font-mono text-slate-600 bg-black/40 px-2 py-1 rounded border border-white/5 whitespace-nowrap">
                                                    {event.timestamp_offset}
                                                </span>
                                                <span className={`text-[11px] font-bold uppercase tracking-wider ${getStageColor(event.stage)}`}>
                                                    {event.stage}
                                                </span>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    const pid = typeof event.related_pid === 'string'
                                                        ? parseInt(event.related_pid.replace(/\D/g, ''))
                                                        : event.related_pid;
                                                    if (!isNaN(pid)) onSelectPid?.(pid);
                                                }}
                                                className="px-2 py-1 bg-brand-500/10 text-brand-400 border border-brand-500/30 rounded font-mono text-[9px] md:text-[10px] font-bold hover:bg-brand-500 hover:text-white transition-all w-full sm:w-auto text-center"
                                            >
                                                PID {event.related_pid}
                                            </button>
                                        </div>
                                        <div className="text-xs md:text-sm text-white font-semibold mb-1 leading-snug">{event.event_description}</div>
                                        <div className="text-[11px] md:text-xs text-slate-400 font-mono leading-relaxed break-words opacity-80">{event.technical_context}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Hive Mind / Related Samples */}
                    {report.related_samples && report.related_samples.length > 0 && (
                        <div className="space-y-3">
                            <button
                                onClick={() => setExpandedHive(!expandedHive)}
                                className="w-full flex items-center justify-between text-[9px] text-slate-500 uppercase font-black tracking-[0.2em] hover:text-brand-400 transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <Share2 size={12} className="text-purple-400" />
                                    The Hive Mind (Related Samples)
                                </div>
                                {expandedHive ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>

                            {expandedHive && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {report.related_samples.map((sample, i) => (
                                        <div key={i} className="bg-security-panel border border-security-border rounded-lg p-3 hover:border-purple-500/50 transition-colors group relative overflow-hidden">
                                            <div className="absolute top-0 right-0 p-1.5 opacity-10 group-hover:opacity-20 transition-opacity">
                                                <Share2 size={40} />
                                            </div>
                                            <div className="flex items-center justify-between mb-2 relative z-10">
                                                <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${sample.verdict === 'Malicious' ? 'bg-threat-critical/20 text-threat-critical border-threat-critical/20' :
                                                    sample.verdict === 'Suspicious' ? 'bg-threat-high/20 text-threat-high border-threat-high/20' :
                                                        'bg-brand-500/10 text-brand-500 border-brand-500/20'
                                                    }`}>
                                                    {sample.verdict}
                                                </span>
                                                <span className="text-[9px] font-mono text-slate-500">{sample.malware_family}</span>
                                            </div>
                                            <div className="text-[10px] text-slate-400 mb-2 font-mono h-12 overflow-hidden relative z-10">
                                                {sample.summary}
                                            </div>
                                            <div className="flex flex-wrap gap-1 relative z-10">
                                                {sample.tags.slice(0, 3).map((tag, t) => (
                                                    <span key={t} className="text-[8px] px-1 py-0.5 rounded bg-white/5 text-slate-400 border border-white/5">
                                                        {tag}
                                                    </span>
                                                ))}
                                                {sample.tags.length > 3 && (
                                                    <span className="text-[8px] px-1 py-0.5 rounded bg-white/5 text-slate-500">+{sample.tags.length - 3}</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Artifacts / IOCs */}
                    <div className="space-y-3">
                        <button
                            onClick={() => setExpandedArtifacts(!expandedArtifacts)}
                            className="w-full flex items-center justify-between text-[9px] text-slate-500 uppercase font-black tracking-[0.2em] hover:text-brand-400 transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <ShieldAlert size={12} className="text-threat-high" />
                                Indicators of Compromise
                            </div>
                            {expandedArtifacts ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>

                        {expandedArtifacts && (
                            <div className="grid grid-cols-1 gap-4">
                                {/* C2 Domains */}
                                {report.artifacts.c2_domains.length > 0 && (
                                    <div className="bg-threat-critical/5 border border-threat-critical/20 rounded-lg p-4">
                                        <div className="flex items-center gap-2 mb-3">
                                            <Globe size={14} className="text-threat-critical" />
                                            <span className="text-[9px] font-bold uppercase tracking-wider text-threat-critical">Network Indicators</span>
                                        </div>
                                        <div className="space-y-1.5">
                                            {report.artifacts.c2_domains.map((domain, i) => (
                                                <div key={i} className="text-[10px] md:text-xs font-mono text-slate-300 bg-black/40 px-3 py-2 rounded border border-threat-critical/30 break-all leading-none">
                                                    {domain}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Dropped Files */}
                                {report.artifacts.dropped_files.length > 0 && (
                                    <div className="bg-threat-high/5 border border-threat-high/20 rounded-lg p-4">
                                        <div className="flex items-center gap-2 mb-3">
                                            <FileText size={14} className="text-threat-high" />
                                            <span className="text-[9px] font-bold uppercase tracking-wider text-threat-high">Dropped Files</span>
                                        </div>
                                        <div className="space-y-1.5">
                                            {report.artifacts.dropped_files.map((file, i) => (
                                                <div key={i} className="text-[10px] md:text-xs font-mono text-slate-300 bg-black/40 px-3 py-2 rounded border border-threat-high/30 break-all leading-normal">
                                                    {file}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Command Lines */}
                                {report.artifacts.command_lines.length > 0 && (
                                    <div className="bg-brand-500/5 border border-brand-500/20 rounded-lg p-4">
                                        <div className="flex items-center gap-2 mb-3">
                                            <Terminal size={14} className="text-brand-400" />
                                            <span className="text-[9px] font-bold uppercase tracking-wider text-brand-400">Suspicious Commands</span>
                                        </div>
                                        <div className="space-y-2">
                                            {report.artifacts.command_lines.map((cmd, i) => (
                                                <div key={i} className="text-[10px] md:text-xs font-mono text-slate-300 bg-black/60 px-3 py-2 rounded border border-brand-500/30 break-all leading-relaxed">
                                                    {cmd}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Mutual Exclusions */}
                                {report.artifacts.mutual_exclusions.length > 0 && (
                                    <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-4">
                                        <div className="flex items-center gap-2 mb-3">
                                            <ShieldAlert size={14} className="text-purple-400" />
                                            <span className="text-[9px] font-bold uppercase tracking-wider text-purple-400">Mutex / Exclusions</span>
                                        </div>
                                        <div className="space-y-1.5">
                                            {report.artifacts.mutual_exclusions.map((mutex, i) => (
                                                <div key={i} className="text-[10px] md:text-xs font-mono text-slate-300 bg-black/40 px-3 py-2 rounded border border-purple-500/30 break-all leading-none">
                                                    {mutex}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AIInsightPanel;
