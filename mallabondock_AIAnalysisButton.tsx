import React, { useState } from 'react';
import { Brain, Sparkles, AlertTriangle, CheckCircle, Loader2, TrendingUp } from 'lucide-react';
import { BASE_URL } from './mallabApi';

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
                className="btn-primary w-full h-10 relative overflow-hidden group"
            >
                {loading ? (
                    <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Analyzing with AI...</span>
                    </>
                ) : (
                    <>
                        <Brain size={16} />
                        <span>Run AI Threat Analysis</span>
                        <Sparkles size={14} className="absolute right-3 opacity-50 group-hover:opacity-100 transition-opacity" />
                    </>
                )}
            </button>

            {/* Error State */}
            {error && (
                <div className="card bg-threat-critical/10 border-threat-critical/30 p-4">
                    <div className="flex items-start gap-3">
                        <AlertTriangle size={20} className="text-threat-critical flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="text-sm font-bold text-threat-critical mb-1">Analysis Failed</h4>
                            <p className="text-xs text-security-muted">{error}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Report Display */}
            {report && (
                <div className="card bg-security-surface border-security-border p-5 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {/* Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-security-border/50">
                        <div className="flex items-center gap-2">
                            <Brain size={18} className="text-brand-500" />
                            <h3 className="text-sm font-black text-white uppercase tracking-tight">AI Analysis Report</h3>
                        </div>
                        <div className="flex items-center gap-2">
                            <TrendingUp size={14} className={getThreatColor(report.threat_level)} />
                            <span className={`text-xs font-black uppercase ${getThreatColor(report.threat_level)}`}>
                                {report.threat_level}
                            </span>
                        </div>
                    </div>

                    {/* Risk Score */}
                    <div className="flex items-center gap-4">
                        <div className="flex-1">
                            <div className="text-[9px] font-black text-security-muted uppercase tracking-widest mb-2">Risk Score</div>
                            <div className="h-2 bg-security-bg rounded-full overflow-hidden">
                                <div
                                    className={`h-full transition-all duration-1000 ${report.risk_score > 70 ? 'bg-threat-critical' :
                                        report.risk_score > 40 ? 'bg-threat-high' :
                                            'bg-threat-low'
                                        }`}
                                    style={{ width: `${report.risk_score}%` }}
                                />
                            </div>
                        </div>
                        <div className={`text-2xl font-black tabular-nums ${report.risk_score > 70 ? 'text-threat-critical' :
                            report.risk_score > 40 ? 'text-threat-high' :
                                'text-threat-low'
                            }`}>
                            {report.risk_score}
                        </div>
                    </div>

                    {/* Summary */}
                    <div>
                        <div className="text-[9px] font-black text-security-muted uppercase tracking-widest mb-2">Summary</div>
                        <p className="text-xs text-slate-300 leading-relaxed bg-security-bg p-3 rounded border border-security-border/30">
                            {report.summary}
                        </p>
                    </div>

                    {/* Suspicious PIDs */}
                    {report.suspicious_pids.length > 0 && (
                        <div>
                            <div className="text-[9px] font-black text-security-muted uppercase tracking-widest mb-2">Suspicious Processes</div>
                            <div className="flex flex-wrap gap-2">
                                {report.suspicious_pids.map(pid => (
                                    <span key={pid} className="px-2 py-1 bg-threat-critical/20 text-threat-critical border border-threat-critical/30 rounded text-xs font-mono font-bold">
                                        PID {pid}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Recommendations */}
                    {report.recommendations.length > 0 && (
                        <div>
                            <div className="text-[9px] font-black text-security-muted uppercase tracking-widest mb-2">Recommendations</div>
                            <ul className="space-y-2">
                                {report.recommendations.map((rec, i) => (
                                    <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                        <CheckCircle size={14} className="text-brand-500 flex-shrink-0 mt-0.5" />
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
