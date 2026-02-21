// ─────────────────────────────────────────────────────────────────────────────
// DetoxDashboard.tsx — ExtensionDetox Mission Control
// ─────────────────────────────────────────────────────────────────────────────
// React port of the standalone Mission Control UI, styled with TheVooDooBox's
// Tailwind tokens (voodoo-*, threat-*, brand-*).

import React, { useState, useEffect, useCallback } from 'react';
import {
    Shield, Activity, AlertTriangle, Search, CheckCircle,
    Clock, RefreshCw, ChevronRight, Package, Eye,
    Zap, Database, BarChart3, Crosshair, Play, Trash2
} from 'lucide-react';
import { voodooApi, type DetoxDashboardStats, type DetoxExtension, type ViewModel } from './voodooApi';
import SubmissionModal, { type SubmissionData } from './SubmissionModal';
import ExtensionDetailDrawer from './ExtensionDetailDrawer';

// ── Risk Badge ──────────────────────────────────────────────────────────────

function RiskBadge({ score }: { score: number | null }) {
    if (score === null || score === undefined) {
        return <span className="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-400">N/A</span>;
    }
    const color = score >= 7 ? 'bg-red-500/20 text-red-400 border-red-500/30'
        : score >= 4 ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
            : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    return (
        <span className={`px-2 py-0.5 rounded text-xs font-mono border ${color}`}>
            {score.toFixed(1)}
        </span>
    );
}

// ── State Badge ─────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: string | null }) {
    const s = state || 'pending';
    const styles: Record<string, string> = {
        clean: 'bg-emerald-500/20 text-emerald-400',
        flagged: 'bg-red-500/20 text-red-400',
        pending: 'bg-amber-500/20 text-amber-400',
    };
    const icons: Record<string, React.ReactNode> = {
        clean: <CheckCircle size={12} />,
        flagged: <AlertTriangle size={12} />,
        pending: <Clock size={12} />,
    };
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${styles[s] || styles.pending}`}>
            {icons[s] || icons.pending} {s.toUpperCase()}
        </span>
    );
}

// ── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color }: {
    icon: React.ReactNode;
    label: string;
    value: string | number;
    color: string;
}) {
    return (
        <div className="bg-voodoo-panel border border-voodoo-border rounded-xl p-4 flex items-center gap-4 hover:border-brand-500/30 transition-all">
            <div className={`p-3 rounded-lg ${color}`}>
                {icon}
            </div>
            <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
                <p className="text-2xl font-bold text-white font-mono">{value}</p>
            </div>
        </div>
    );
}

// ── Risk Ring ────────────────────────────────────────────────────────────────

function RiskRing({ clean, flagged, pending }: { clean: number; flagged: number; pending: number }) {
    const total = clean + flagged + pending || 1;
    const circumference = 2 * Math.PI * 60;
    const cleanPct = (clean / total) * circumference;
    const flaggedPct = (flagged / total) * circumference;

    return (
        <div className="flex flex-col items-center justify-center">
            <svg width="160" height="160" viewBox="0 0 140 140">
                <circle cx="70" cy="70" r="60" fill="none" stroke="#1a1a1a" strokeWidth="12" />
                <circle
                    cx="70" cy="70" r="60" fill="none"
                    stroke="#10b981" strokeWidth="12"
                    strokeDasharray={`${cleanPct} ${circumference}`}
                    strokeDashoffset="0"
                    transform="rotate(-90 70 70)"
                    className="transition-all duration-1000"
                />
                <circle
                    cx="70" cy="70" r="60" fill="none"
                    stroke="#ef4444" strokeWidth="12"
                    strokeDasharray={`${flaggedPct} ${circumference}`}
                    strokeDashoffset={`${-cleanPct}`}
                    transform="rotate(-90 70 70)"
                    className="transition-all duration-1000"
                />
                <text x="70" y="65" textAnchor="middle" fill="white" className="text-2xl font-bold" fontSize="28">{total}</text>
                <text x="70" y="85" textAnchor="middle" fill="#888" fontSize="11">EXTENSIONS</text>
            </svg>
            <div className="flex gap-4 mt-3 text-xs">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Clean ({clean})</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Flagged ({flagged})</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Pending ({pending})</span>
            </div>
        </div>
    );
}

// ── Main Dashboard ──────────────────────────────────────────────────────────

export default function DetoxDashboard() {
    const [stats, setStats] = useState<DetoxDashboardStats | null>(null);
    const [extensions, setExtensions] = useState<DetoxExtension[]>([]);
    const [vms, setVms] = useState<ViewModel[]>([]);
    const [filter, setFilter] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [manualScanId, setManualScanId] = useState('');

    // Sandbox Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedExtForSandbox, setSelectedExtForSandbox] = useState<DetoxExtension | null>(null);

    // Detail Drawer State
    const [drawerExtId, setDrawerExtId] = useState<number | null>(null);

    const loadData = useCallback(async () => {
        try {
            const [dashStats, extList, vmList] = await Promise.all([
                voodooApi.fetchDetoxDashboard(),
                voodooApi.fetchDetoxExtensions(filter || undefined),
                voodooApi.fetchVms(),
            ]);
            setStats(dashStats);
            setExtensions(extList);
            setVms(vmList);
        } catch (e) {
            console.error('[Detox] Failed to load data:', e);
        } finally {
            setLoading(false);
        }
    }, [filter]);

    const handlePurge = async (id: number) => {
        try {
            setScanning(true);
            await voodooApi.purgeDetoxExtension(id);
            await loadData(); // Refresh UI to remove the row
        } catch (err: any) {
            console.error('[Detox] Purge failed:', err);
            alert(`Failed to delete extension: ${err.message || err}`);
        } finally {
            setScanning(false);
        }
    };

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 15000); // Poll every 15s
        return () => clearInterval(interval);
    }, [loadData]);

    const triggerScrape = async () => {
        setScanning(true);
        try {
            const res = await voodooApi.triggerDetoxScrape(2);
            alert(`Scrape complete! Discovered ${res.extensions_discovered} extensions.`);
            await loadData();
        } catch (err) {
            console.error('[Detox] Scrape failed:', err);
            alert(`Scrape failed: ${err}`);
        } finally {
            setScanning(false);
        }
    };

    const handleManualScan = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!manualScanId.trim()) return;
        setScanning(true);
        try {
            await voodooApi.triggerDetoxScan(manualScanId.trim());
            setManualScanId('');
            await loadData();
        } catch (err) {
            console.error('[Detox] Failed manual scan:', err);
        } finally {
            setScanning(false);
        }
    };

    const openSandboxModal = (ext: DetoxExtension, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setSelectedExtForSandbox(ext);
        setIsModalOpen(true);
    };

    const handleSandboxSubmit = async (data: SubmissionData & { vmid?: number, node?: string }) => {
        if (!selectedExtForSandbox) return;
        try {
            await voodooApi.sendDetoxToSandbox(
                selectedExtForSandbox.extension_id,
                selectedExtForSandbox.version,
                data.duration,
                data.mode,
                data.vmid,
                data.node,
                data.ai_strategy
            );
            await loadData(); // Refresh UI to show state change
        } catch (err) {
            console.error('[Detox] Sandbox submission failed:', err);
            alert(`Failed to submit to sandbox: ${err}`);
        }
    };

    const filtered = extensions.filter(ext =>
        !searchTerm ||
        ext.extension_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (ext.display_name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <RefreshCw className="animate-spin text-brand-400" size={32} />
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto p-6 space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Shield className="text-brand-400" size={28} />
                    <div>
                        <h1 className="text-xl font-bold text-white">ExtensionDetox</h1>
                        <p className="text-xs text-gray-500">VS Code Extension Triage Engine</p>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
                    <form onSubmit={handleManualScan} className="flex flex-1 sm:flex-none gap-2">
                        <input
                            type="text"
                            placeholder="Extension ID (e.g. ms-python.python)"
                            value={manualScanId}
                            onChange={(e) => setManualScanId(e.target.value)}
                            className="bg-voodoo-panel border border-voodoo-border rounded-lg px-3 py-1.5 text-sm text-gray-300 font-mono focus:outline-none focus:border-brand-500 w-full sm:w-64"
                        />
                        <button
                            type="submit"
                            disabled={scanning || !manualScanId.trim()}
                            className="flex items-center justify-center gap-2 px-3 py-1.5 bg-voodoo-panel border border-voodoo-border hover:border-brand-500 text-brand-400 rounded-lg text-sm transition-colors disabled:opacity-50"
                        >
                            <Crosshair size={14} className={scanning && manualScanId ? 'animate-pulse text-[#39ff14]' : ''} />
                            Scan
                        </button>
                    </form>

                    <button
                        onClick={triggerScrape}
                        disabled={scanning}
                        className="flex items-center justify-center gap-2 px-4 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg text-sm transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                        <RefreshCw size={14} className={scanning && !manualScanId ? 'animate-spin' : ''} />
                        {scanning && !manualScanId ? 'Scanning...' : 'Scrape Marketplace'}
                    </button>
                </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={<Package size={20} className="text-brand-400" />} label="Total" value={stats?.total_extensions || 0} color="bg-brand-500/10" />
                <StatCard icon={<CheckCircle size={20} className="text-emerald-400" />} label="Clean" value={stats?.clean || 0} color="bg-emerald-500/10" />
                <StatCard icon={<AlertTriangle size={20} className="text-red-400" />} label="Flagged" value={stats?.flagged || 0} color="bg-red-500/10" />
                <StatCard icon={<BarChart3 size={20} className="text-cyan-400" />} label="Avg Risk" value={stats?.avg_risk_score?.toFixed(1) || '0.0'} color="bg-cyan-500/10" />
            </div>

            {/* Main Content: Ring + Table */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Risk Distribution Ring */}
                <div className="bg-voodoo-panel border border-voodoo-border rounded-xl p-6 flex flex-col items-center justify-center">
                    <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-4">Risk Distribution</h3>
                    <RiskRing
                        clean={stats?.clean || 0}
                        flagged={stats?.flagged || 0}
                        pending={stats?.pending || 0}
                    />
                    <div className="mt-4 text-center">
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                            <Database size={12} />
                            Blocklist: {stats?.blocklist_count || 0} entries
                        </div>
                    </div>
                </div>

                {/* Extension Table */}
                <div className="lg:col-span-3 bg-voodoo-panel border border-voodoo-border rounded-xl overflow-hidden">
                    {/* Table Header */}
                    <div className="p-4 border-b border-voodoo-border flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                            <Eye size={14} className="text-brand-400" />
                            Extension Queue
                        </h3>
                        <div className="flex items-center gap-2">
                            {/* Filters */}
                            {['', 'pending', 'clean', 'flagged'].map(f => (
                                <button
                                    key={f}
                                    onClick={() => setFilter(f)}
                                    className={`px-3 py-1 rounded text-xs transition-colors ${filter === f
                                        ? 'bg-brand-600 text-white'
                                        : 'bg-gray-800 text-gray-400 hover:text-white'
                                        }`}
                                >
                                    {f || 'All'}
                                </button>
                            ))}
                            {/* Search */}
                            <div className="relative ml-2">
                                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                                <input
                                    type="text"
                                    placeholder="Search..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    className="pl-7 pr-3 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-white w-40 focus:border-brand-500 outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Table Body */}
                    <div className="max-h-[500px] overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-voodoo-panel border-b border-voodoo-border">
                                <tr className="text-gray-500 uppercase tracking-wider">
                                    <th className="text-left p-3">Extension</th>
                                    <th className="text-left p-3">Version</th>
                                    <th className="text-center p-3">Installs</th>
                                    <th className="text-center p-3">State</th>
                                    <th className="text-center p-3">Risk</th>
                                    <th className="text-right p-3">Updated</th>
                                    <th className="text-right p-3">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="text-center p-8 text-gray-600">
                                            <Zap size={24} className="mx-auto mb-2 opacity-30" />
                                            No extensions found. Scrape the marketplace to begin.
                                        </td>
                                    </tr>
                                ) : (
                                    filtered.map(ext => (
                                        <tr
                                            key={ext.id}
                                            onClick={() => setDrawerExtId(ext.id)}
                                            className="border-b border-gray-900/50 hover:bg-gray-900/50 transition-colors cursor-pointer group"
                                        >
                                            <td className="p-3">
                                                <div className="flex items-center gap-2">
                                                    <Package size={14} className="text-gray-600 group-hover:text-brand-400 transition-colors" />
                                                    <div>
                                                        <p className="text-white font-medium">{ext.display_name || ext.extension_id}</p>
                                                        <p className="text-gray-600 text-[10px] font-mono">{ext.extension_id}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-3 font-mono text-gray-400">{ext.version}</td>
                                            <td className="p-3 text-center text-gray-400">{(ext.install_count || 0).toLocaleString()}</td>
                                            <td className="p-3 text-center"><StateBadge state={ext.latest_state} /></td>
                                            <td className="p-3 text-center"><RiskBadge score={ext.risk_score} /></td>
                                            <td className="p-3 text-right text-gray-600">
                                                <div className="flex items-center justify-end gap-1">
                                                    {ext.updated_at ? new Date(ext.updated_at).toLocaleDateString() : '—'}
                                                    <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 text-brand-400 transition-opacity" />
                                                </div>
                                            </td>
                                            <td className="p-3 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (window.confirm(`Are you sure you want to delete ${ext.extension_id} v${ext.version}? This will remove the VSIX file and all scan history.`)) {
                                                                handlePurge(ext.id);
                                                            }
                                                        }}
                                                        disabled={scanning}
                                                        title="Delete Extension"
                                                        className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded transition-colors disabled:opacity-30 disabled:hover:bg-red-500/10"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => openSandboxModal(ext, e)}
                                                        disabled={ext.latest_state === 'detonating' || ext.latest_state === 'scanning'}
                                                        title={ext.latest_state === 'detonating' ? "Already detonating" : "Send to Sandbox"}
                                                        className="p-1.5 bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 rounded transition-colors disabled:opacity-30 disabled:hover:bg-brand-500/10"
                                                    >
                                                        <Play size={14} className="ml-0.5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {selectedExtForSandbox && (
                <SubmissionModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    onSubmit={handleSandboxSubmit}
                    vms={vms}
                    vsixData={{
                        extension_id: selectedExtForSandbox.extension_id,
                        version: selectedExtForSandbox.version,
                        display_name: selectedExtForSandbox.display_name || selectedExtForSandbox.extension_id,
                        risk_score: selectedExtForSandbox.risk_score
                    }}
                />
            )}

            <ExtensionDetailDrawer
                extensionId={drawerExtId}
                onClose={() => setDrawerExtId(null)}
            />
        </div>
    );
}
