import React, { useState } from 'react';
import { Brain, Sparkles, AlertTriangle, CheckCircle, Loader2, TrendingUp } from 'lucide-react';
import { voodooApi, BASE_URL } from './voodooApi';

interface AIAnalysisProps {
    processes: Array<{
        pid: number;
        parent_pid?: number;
        name: string;
        status: string;
        behaviors: string[];
    }>;
    events: Array<{
        event_type: string;
        process_id: number;
        process_name: string;
        details: string;
        timestamp: number;
    }>;
}

interface AIReport {
    risk_score: number;
    threat_level: string;
    summary: string;
    suspicious_pids: number[];
    recommendations: string[];
}

export default function AIAnalysisButton({ processes, events }: AIAnalysisProps) {
    const [loading, setLoading] = useState(false);
    const [report, setReport] = useState<AIReport | null>(null);
    const [error, setError] = useState<string | null>(null);

    const runAnalysis = async () => {
        setLoading(true);
        setError(null);
        setReport(null);

        try {
            const response = await fetch(`${BASE_URL}/vms/analysis/ai-insight`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ processes, events })
            });

            if (!response.ok) {
                throw new Error(`Analysis failed: ${response.statusText}`);
            }

            const data: AIReport = await response.json();
            setReport(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    const getThreatColor = (level: string) => {
        const normalized = level.toLowerCase();
        if (normalized.includes('critical') || normalized.includes('high')) return 'text-threat-critical';
        if (normalized.includes('medium') || normalized.includes('suspicious')) return 'text-threat-high';
        return 'text-threat-low';
    };

    return (
        <div className="space-y-4">
            {/* Trigger Button */}
            <button
                onClick={runAnalysis}
                disabled={loading}
                className="btn-primary w-full h-10 relative overflow-hidden group shadow-[0_0_15px_rgba(57,255,20,0.1)] active:shadow-none"
            >
                {loading ? (
                    <div className="flex items-center justify-center gap-2">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Neural Syncing...</span>
                    </div>
                ) : (
                    <div className="flex items-center justify-center gap-2">
                        <Brain size={16} />
                        <span className="text-[10px] font-black uppercase tracking-widest">Run Neural Threat Analysis</span>
                        <Sparkles size={14} className="absolute right-3 opacity-30 group-hover:opacity-100 transition-opacity" />
                    </div>
                )}
            </button>

            {/* Error State */}
            {error && (
                <div className="card bg-threat-critical/10 border-threat-critical/30 p-4 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="flex items-start gap-3">
                        <AlertTriangle size={20} className="text-threat-critical flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="text-[10px] font-black text-threat-critical mb-1 uppercase tracking-widest">Analysis Offline</h4>
                            <p className="text-[10px] text-security-muted font-mono">{error}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Report Display */}
            {report && (
                <div className="card bg-security-surface border-security-border p-5 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 shadow-2xl">
                    {/* Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-security-border/50">
                        <div className="flex items-center gap-2">
                            <Brain size={18} className="text-brand-500" />
                            <h3 className="text-[11px] font-black text-white uppercase tracking-tight">AI Correlation Report</h3>
                        </div>
                        <div className="flex items-center gap-2">
                            <TrendingUp size={14} className={getThreatColor(report.threat_level)} />
                            <span className={`text-[10px] font-black uppercase tracking-widest ${getThreatColor(report.threat_level)}`}>
                                {report.threat_level}
                            </span>
                        </div>
                    </div>

                    {/* Risk Score */}
                    <div className="flex items-center gap-4">
                        <div className="flex-1">
                            <div className="text-[9px] font-black text-security-muted uppercase tracking-[0.2em] mb-2">Neural Threat Level</div>
                            <div className="h-1.5 bg-security-bg rounded-full overflow-hidden border border-white/5">
                                <div
                                    className={`h-full transition-all duration-1000 ${report.risk_score > 70 ? 'bg-threat-critical' :
                                        report.risk_score > 40 ? 'bg-threat-high' :
                                            'bg-threat-low'
                                        }`}
                                    style={{ width: `${report.risk_score}%` }}
                                />
                            </div>
                        </div>
                        <div className={`text-2xl font-black tabular-nums tracking-tighter ${report.risk_score > 70 ? 'text-threat-critical shadow-[0_0_10px_rgba(255,71,87,0.2)]' :
                            report.risk_score > 40 ? 'text-threat-high shadow-[0_0_10px_rgba(255,165,0,0.2)]' :
                                'text-voodoo-toxic-green shadow-[0_0_10px_rgba(57,255,20,0.2)]'
                            }`}>
                            {report.risk_score}%
                        </div>
                    </div>

                    {/* Summary */}
                    <div>
                        <div className="text-[9px] font-black text-security-muted uppercase tracking-[0.2em] mb-2">Executive Findings</div>
                        <p className="text-[11px] text-slate-300 leading-relaxed bg-black/40 p-3 rounded border border-security-border/30 italic">
                            "{report.summary}"
                        </p>
                    </div>

                    {/* Suspicious PIDs */}
                    {report.suspicious_pids.length > 0 && (
                        <div>
                            <div className="text-[9px] font-black text-security-muted uppercase tracking-[0.2em] mb-2">Primary Vectors</div>
                            <div className="flex flex-wrap gap-2">
                                {report.suspicious_pids.map(pid => (
                                    <span key={pid} className="px-2 py-1 bg-threat-critical/20 text-threat-critical border border-threat-critical/30 rounded text-[10px] font-mono font-bold">
                                        PID {pid}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Recommendations */}
                    {report.recommendations.length > 0 && (
                        <div>
                            <div className="text-[9px] font-black text-security-muted uppercase tracking-[0.2em] mb-2">Sanitization Protocol</div>
                            <ul className="space-y-2">
                                {report.recommendations.map((rec, i) => (
                                    <li key={i} className="flex items-start gap-2 text-[10px] text-slate-300">
                                        <CheckCircle size={14} className="text-voodoo-toxic-green flex-shrink-0 mt-0.5" />
                                        <span>{rec}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
