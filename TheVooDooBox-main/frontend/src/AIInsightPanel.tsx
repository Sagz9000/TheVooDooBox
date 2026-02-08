import React, { useState } from 'react';
import { Brain, ShieldAlert, Clock, FileText, Globe, Terminal, Sparkles, Loader2, ChevronDown, ChevronRight, Share2 } from 'lucide-react';
import { voodooApi, ForensicReport, TimelineEvent, Artifacts, RelatedSample } from './voodooApi';

import VirusTotalCard from './VirusTotalCard';

interface AIInsightPanelProps {
    report: ForensicReport | null;
    loading: boolean;
    onAnalyze: () => void;
    taskId?: string;
    onSelectPid?: (pid: number) => void;
}

export default function AIInsightPanel({ report, loading, onAnalyze, taskId, onSelectPid }: AIInsightPanelProps) {
    const [expandedTimeline, setExpandedTimeline] = useState(true);
    const [expandedArtifacts, setExpandedArtifacts] = useState(true);
    const [expandedHive, setExpandedHive] = useState(true);

    const getVerdictColor = (verdict: string) => {
        switch (verdict) {
            case 'Malicious': return 'text-threat-critical border-threat-critical bg-threat-critical/10';
            case 'Suspicious': return 'text-threat-high border-threat-high bg-threat-high/10';
            case 'Benign': return 'text-threat-low border-threat-low bg-threat-low/10';
            default: return 'text-slate-500 border-slate-500 bg-slate-500/10';
        }
    };

    const getStageColor = (stage: string) => {
        if (!stage) return 'text-slate-400';
        const stageLower = stage.toLowerCase();
        if (stageLower.includes('execution')) return 'text-blue-400';
        if (stageLower.includes('persistence')) return 'text-orange-400';
        if (stageLower.includes('defense')) return 'text-purple-400';
        if (stageLower.includes('discovery')) return 'text-yellow-400';
        if (stageLower.includes('lateral')) return 'text-red-400';
        if (stageLower.includes('exfiltration')) return 'text-pink-400';
        return 'text-slate-400';
    };

    // Defensive check: if report is a string (error message) or empty object
    const isValidReport = report && typeof report === 'object' && 'verdict' in report;

    return (
        <div className="flex flex-col h-full bg-security-surface p-4 md:p-6 overflow-auto custom-scrollbar animate-in slide-in-from-right duration-500 min-h-0">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 md:mb-8 pb-4 border-b border-security-border gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-brand-600/10 rounded-lg shrink-0">
                        <Brain className="w-5 h-5 md:w-6 md:h-6 text-brand-500" />
                    </div>
                    <div>
                        <h2 className="text-base md:text-lg font-bold text-white leading-none">Forensic Analysis</h2>
                        <p className="text-[9px] md:text-[10px] text-slate-500 uppercase tracking-widest mt-1">Kill Chain Reconstruction</p>
                    </div>
                </div>
                <button
                    onClick={onAnalyze}
                    disabled={loading}
                    className="btn-primary h-8 px-3 text-[10px] flex items-center gap-2 shadow-lg shadow-brand-600/20 disabled:opacity-50 disabled:cursor-wait whitespace-nowrap w-full md:w-auto justify-center"
                >
                    {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    {loading ? 'ANALYZING...' : 'RUN ANALYTICS'}
                </button>
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
                        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-400 font-mono break-all max-w-full">
                            Error: {report}
                        </div>
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
                                {report.malware_family && (
                                    <div className="mt-3 sm:mt-2 text-xs text-slate-400">
                                        Family: <span className="text-white font-mono break-all">{report.malware_family}</span>
                                    </div>
                                )}
                            </div>
                            <div className="text-left sm:text-right w-full sm:w-auto">
                                <div className="text-3xl md:text-4xl font-black text-white tracking-tighter">{report.threat_score}</div>
                                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Threat Score</div>
                            </div>
                        </div>
                    </div>

                    {/* AI Reasoning (Forensic Analyst Log) */}
                    {report.thinking && (
                        <div className="space-y-3">
                            <details className="group bg-security-panel/40 border border-security-border/50 rounded-lg overflow-hidden">
                                <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-security-panel/60 transition-colors list-none">
                                    <div className="flex items-center gap-2">
                                        <Terminal size={12} className="text-brand-500" />
                                        <span className="text-[9px] text-slate-500 uppercase font-black tracking-[0.2em]">Forensic Analyst Log (Internal Reasoning)</span>
                                    </div>
                                    <ChevronDown size={14} className="text-slate-600 transition-transform group-open:rotate-180" />
                                </summary>
                                <div className="p-4 border-t border-security-border/30 bg-black/20">
                                    <div className="text-[11px] font-mono text-slate-500 leading-relaxed whitespace-pre-wrap select-text selection:bg-brand-500/30">
                                        {report.thinking}
                                    </div>
                                </div>
                            </details>
                        </div>
                    )}

                    {/* Threat Intelligence (VirusTotal) */}
                    {report.virustotal && (
                        <VirusTotalCard data={report.virustotal} />
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
                                                onClick={() => onSelectPid?.(event.related_pid)}
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
}
