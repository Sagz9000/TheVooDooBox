import React, { useEffect, useState } from 'react';
import { X, RefreshCw, AlertTriangle, CheckCircle, Shield, FileJson, BrainCircuit, Activity, FileText } from 'lucide-react';
import { voodooApi, type DetoxExtensionDetail, type DetoxScanHistory } from './voodooApi';

interface DrawerProps {
    extensionId: number | null;
    onClose: () => void;
}

export default function ExtensionDetailDrawer({ extensionId, onClose }: DrawerProps) {
    const [detail, setDetail] = useState<DetoxExtensionDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState<'overview' | 'ai' | 'raw'>('overview');

    useEffect(() => {
        if (!extensionId) {
            setDetail(null);
            setActiveTab('overview');
            return;
        }

        let mounted = true;
        setLoading(true);
        setError('');

        voodooApi.fetchDetoxExtensionDetail(extensionId)
            .then(data => {
                if (mounted) setDetail(data);
            })
            .catch(err => {
                if (mounted) setError(err.toString());
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });

        return () => { mounted = false; };
    }, [extensionId]);

    if (!extensionId) return null;

    const ext = detail?.extension;
    const latestScan = detail?.scans?.[0]; // Usually the most recent scan
    const findings = latestScan?.findings_json; // This is now the full ThreatReport JSON object

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity"
                onClick={onClose}
            />

            {/* Drawer */}
            <div className="fixed inset-y-0 right-0 w-full md:w-[600px] lg:w-[800px] bg-voodoo-base border-l border-voodoo-border shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ease-in-out">

                {/* Header */}
                <div className="p-6 border-b border-voodoo-border flex items-start justify-between bg-voodoo-panel">
                    <div className="flex gap-4 items-start">
                        <div className="p-3 bg-brand-500/10 text-brand-400 rounded-xl">
                            <Shield size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                {ext?.display_name || 'Loading...'}
                                {ext?.version && <span className="text-xs font-mono text-gray-500 bg-gray-800 px-2 py-0.5 rounded">v{ext.version}</span>}
                            </h2>
                            <p className="text-sm font-mono text-gray-400 mt-1">{ext?.extension_id}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content Body */}
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-64 text-brand-400">
                            <RefreshCw className="animate-spin mb-4" size={32} />
                            <p>Analyzing behavioral patterns...</p>
                        </div>
                    ) : error ? (
                        <div className="p-6">
                            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex gap-3 text-red-400">
                                <AlertTriangle size={20} className="shrink-0" />
                                <div>
                                    <h4 className="font-bold">Failed to load details</h4>
                                    <p className="text-sm">{error}</p>
                                </div>
                            </div>
                        </div>
                    ) : detail ? (
                        <div className="p-6 space-y-6">

                            {/* Stats Row */}
                            <div className="grid grid-cols-3 gap-4">
                                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">State</p>
                                    <p className="text-lg font-bold text-white capitalize">{ext?.latest_state || 'Unknown'}</p>
                                </div>
                                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Risk Score</p>
                                    <p className={`text-lg font-bold font-mono ${(ext?.risk_score ?? 0) >= 0.7 ? 'text-red-400' :
                                            (ext?.risk_score ?? 0) >= 0.4 ? 'text-amber-400' : 'text-emerald-400'
                                        }`}>
                                        {ext?.risk_score?.toFixed(2) || '0.00'}
                                    </p>
                                </div>
                                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Installs</p>
                                    <p className="text-lg font-bold text-white">{(ext?.install_count || 0).toLocaleString()}</p>
                                </div>
                            </div>

                            {/* Tabs */}
                            <div className="flex gap-2 border-b border-voodoo-border">
                                {[
                                    { id: 'overview', icon: Activity, label: 'Overview' },
                                    { id: 'ai', icon: BrainCircuit, label: 'AI Vibe Check' },
                                    { id: 'raw', icon: FileJson, label: 'Raw Findings' }
                                ].map(t => (
                                    <button
                                        key={t.id}
                                        onClick={() => setActiveTab(t.id as any)}
                                        className={`flex items-center gap-2 px-4 py-2 border-b-2 text-sm transition-colors ${activeTab === t.id
                                                ? 'border-brand-500 text-brand-400'
                                                : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600'
                                            }`}
                                    >
                                        <t.icon size={16} />
                                        {t.label}
                                    </button>
                                ))}
                            </div>

                            {/* Tab Content */}
                            <div className="py-2">

                                {activeTab === 'overview' && (
                                    <div className="space-y-6">
                                        <div>
                                            <h3 className="text-sm font-bold text-white mb-2">Verdict Status</h3>
                                            <div className="p-4 bg-gray-900 border border-gray-800 rounded-lg">
                                                <p className="text-sm text-gray-300">
                                                    Static Pipeline: <span className="font-mono text-brand-400">{findings?.verdict || 'PENDING'}</span>
                                                </p>
                                                {findings?.escalated_to_chamber && (
                                                    <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm flex gap-2">
                                                        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                                                        <div>
                                                            <p className="font-bold">Sandbox Escalation Recommended</p>
                                                            <ul className="list-disc pl-4 mt-1 opacity-80">
                                                                {findings?.escalation_reasons?.map((r: string, i: number) => <li key={i}>{r}</li>)}
                                                            </ul>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <h3 className="text-sm font-bold text-white mb-2">Finding Counts</h3>
                                            <div className="grid grid-cols-4 gap-2">
                                                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-center">
                                                    <p className="text-2xl font-bold text-red-500">{findings?.critical_findings?.length ?? 0}</p>
                                                    <p className="text-[10px] text-red-400/70 uppercase">Critical</p>
                                                </div>
                                                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded text-center">
                                                    <p className="text-2xl font-bold text-amber-500">{findings?.high_findings?.length ?? 0}</p>
                                                    <p className="text-[10px] text-amber-400/70 uppercase">High</p>
                                                </div>
                                                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded text-center">
                                                    <p className="text-2xl font-bold text-yellow-500">{findings?.medium_findings?.length ?? 0}</p>
                                                    <p className="text-[10px] text-yellow-500/70 uppercase">Medium</p>
                                                </div>
                                                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded text-center">
                                                    <p className="text-2xl font-bold text-blue-500">{findings?.info_findings?.length ?? 0}</p>
                                                    <p className="text-[10px] text-blue-400/70 uppercase">Info</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'ai' && (
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between p-4 bg-brand-500/10 border border-brand-500/30 rounded-lg">
                                            <div className="flex items-center gap-3">
                                                <BrainCircuit className="text-brand-400" size={24} />
                                                <div>
                                                    <h3 className="font-bold text-white">Neural Vibe Check</h3>
                                                    <p className="text-xs text-brand-400/70">Static Code Analysis Evaluator</p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-2xl font-mono font-bold text-brand-400">
                                                    {findings?.ai_vibe_score?.toFixed(2) || 'N/A'}
                                                </p>
                                                <p className="text-[10px] uppercase text-gray-500">AI Risk Score</p>
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                                                <FileText size={16} className="text-gray-400" />
                                                LLM Reasoning Logic
                                            </h4>
                                            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-sm text-gray-300 max-h-[400px] overflow-y-auto whitespace-pre-wrap">
                                                {latestScan?.raw_ai_response || "No raw AI reasoning available in the database for this scan."}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'raw' && (
                                    <div className="space-y-2">
                                        <h3 className="text-sm font-bold text-white flex justify-between items-center">
                                            Full ThreatReport Object
                                            <span className="text-[10px] font-normal text-gray-500 font-mono">
                                                scanned_at: {latestScan?.completed_at ? new Date(latestScan.completed_at).toLocaleString() : 'N/A'}
                                            </span>
                                        </h3>
                                        <div className="bg-[#0d1117] rounded-lg border border-gray-800 overflow-hidden">
                                            <pre className="p-4 text-xs font-mono text-green-400 max-h-[600px] overflow-y-auto">
                                                {findings ? JSON.stringify(findings, null, 2) : "No findings_json available."}
                                            </pre>
                                        </div>
                                    </div>
                                )}

                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-500">
                            No data available
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
