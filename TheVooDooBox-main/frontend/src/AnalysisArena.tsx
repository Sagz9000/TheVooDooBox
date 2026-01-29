import React, { useState, useEffect, useMemo } from 'react';
import {
    Monitor,
    Activity,
    ShieldAlert,
    Cpu,
    Terminal,
    ArrowLeft,
    RotateCcw,
    Zap,
    Maximize2,
    Database,
    Binary,
    Shield,
    X,
    MessageSquare,
    Image as ImageIcon,
    ChevronLeft,
    ChevronRight,
    ExternalLink
} from 'lucide-react';
import SpiceViewer from './SpiceViewer';
import VncViewer from './VncViewer';
import { AgentEvent, voodooApi, BASE_URL, ForensicReport, Tag } from './voodooApi';
import AIInsightPanel from './AIInsightPanel';
import AnalystNotepad from './AnalystNotepad';
import { Pencil } from 'lucide-react';

interface Props {
    target: { node: string, vmid: number, mode: 'vnc' | 'spice-html5' };
    events: AgentEvent[];
    onBack: () => void;
}

export default function AnalysisArena({ target, events, onBack }: Props) {
    const [fullScreen, setFullScreen] = useState(false);
    const [activeTab, setActiveTab] = useState<'telemetry' | 'intelligence' | 'notes'>('telemetry');
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, event: AgentEvent } | null>(null);
    const [tags, setTags] = useState<Tag[]>([]);
    const [aiReport, setAiReport] = useState<ForensicReport | null>(null);
    const [aiLoading, setAiLoading] = useState(false);
    const [screenshots, setScreenshots] = useState<string[]>([]);
    const [selectedScreenshot, setSelectedScreenshot] = useState<number>(0);
    const [showSpice, setShowSpice] = useState(!!target.mode);

    // Get the most recent task ID from events for this session
    const activeTaskId = useMemo(() => {
        // If there are events, find the most common non-null task_id or just the latest
        const latestWithId = events.slice().reverse().find(e => e.task_id);
        return latestWithId?.task_id;
    }, [events]);

    useEffect(() => {
        if (activeTaskId) {
            refreshTags();
        }
    }, [activeTaskId]);

    const refreshTags = async () => {
        if (!activeTaskId) return;
        try {
            const data = await voodooApi.getTags(activeTaskId);
            setTags(data);
        } catch (e) {
            console.error("Failed to fetch tags", e);
        }
    };

    const handleTag = async (type: Tag['tag_type']) => {
        if (!contextMenu || !activeTaskId) return;
        try {
            await voodooApi.addTag(activeTaskId, contextMenu.event.id || 0, type);
            refreshTags();
            setContextMenu(null);
        } catch (e) {
            console.error("Tagging failed", e);
        }
    };

    // Initial load + polling for screenshots
    React.useEffect(() => {
        const refreshScreenshots = async () => {
            try {
                const data = await voodooApi.listScreenshots();
                if (JSON.stringify(data) !== JSON.stringify(screenshots)) {
                    setScreenshots(data);
                    // Automatically point to newest if we had none
                    if (screenshots.length === 0 && data.length > 0) {
                        setSelectedScreenshot(data.length - 1);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch screenshots", e);
            }
        };

        refreshScreenshots();
        const interval = setInterval(refreshScreenshots, 5000);
        return () => clearInterval(interval);
    }, [screenshots]);

    const handleAIAnalysis = async () => {
        setAiLoading(true);
        try {
            const report = await voodooApi.getAIAnalysis(events);
            setAiReport(report);
        } catch (error) {
            console.error("AI Analysis failed:", error);
        } finally {
            setAiLoading(false);
        }
    };

    return (
        <div className="flex h-full flex-col bg-security-bg animate-in slide-in-from-right duration-500">
            {/* Analysis Control Bar */}
            <header className="h-12 border-b border-security-border bg-security-surface flex items-center justify-between px-6 z-20 shadow-lg">
                <div className="flex items-center gap-6 h-full">
                    <button
                        onClick={onBack}
                        className="p-1.5 hover:bg-security-panel rounded border border-transparent hover:border-security-border transition-all text-security-muted hover:text-white"
                        title="Back to Cluster"
                    >
                        <ArrowLeft size={16} />
                    </button>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <div className="p-1 bg-brand-500/10 rounded">
                                <Shield size={14} className="text-brand-500" />
                            </div>
                            <span className="text-xs font-bold text-white uppercase tracking-tight">Arena Session</span>
                        </div>
                        <div className="px-2 py-0.5 bg-security-panel border border-security-border rounded text-[10px] font-bold font-mono tracking-widest text-brand-500">
                            ID::QEMU-{target.vmid}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        className="btn-secondary h-7 px-3 text-[10px] font-bold border-threat-high/20 hover:bg-threat-high/5 hover:text-threat-high text-security-muted shadow-sm"
                        onClick={() => voodooApi.revertVm(target.node, target.vmid)}
                    >
                        <RotateCcw size={12} strokeWidth={3} /> EMERGENCY REVERT
                    </button>

                    <div className="w-px h-5 bg-security-border mx-1"></div>

                    <div className="flex items-center gap-1">
                        <button className="p-1.5 hover:bg-security-panel rounded text-security-muted hover:text-white transition-colors" title="Toggle Fullscreen" onClick={() => setFullScreen(!fullScreen)}>
                            <Maximize2 size={14} />
                        </button>
                    </div>
                </div>
            </header>

            <main className="flex-1 flex overflow-hidden">
                {/* Left: Enhanced Analysis Display */}
                <div className={`flex-1 relative bg-[#020202] flex flex-col transition-all ${fullScreen ? 'fixed inset-0 z-50 p-0' : ''}`}>

                    {/* Visual Evidence Header */}
                    <div className="h-10 bg-security-panel border-b border-security-border flex items-center justify-between px-4">
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] font-black uppercase tracking-widest text-security-muted">Visual Evidence</span>
                            <div className="px-2 py-0.5 bg-brand-500/10 rounded border border-brand-500/20 text-[9px] font-bold text-brand-500">
                                {screenshots.length} CAPTURES
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowSpice(!showSpice)}
                                className={`flex items-center gap-2 px-3 py-1 rounded text-[10px] font-bold transition-all ${showSpice
                                    ? 'bg-brand-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.5)]'
                                    : 'bg-security-surface border border-security-border text-security-muted hover:border-brand-500 hover:text-white'
                                    }`}
                            >
                                <ExternalLink size={12} /> {showSpice ? 'CLOSE INTERACTIVE' : `JUMP IN (LIVE ${target.mode === 'spice-html5' ? 'SPICE' : 'VNC'})`}
                            </button>
                        </div>
                    </div>

                    {/* Main Viewport */}
                    <div className="flex-1 relative flex items-center justify-center p-6 bg-black">
                        {showSpice ? (
                            <div className="w-full h-full rounded border border-brand-500/30 overflow-hidden relative shadow-2xl bg-black">
                                {target.mode === 'spice-html5' ? (
                                    <SpiceViewer node={target.node} vmid={target.vmid} />
                                ) : (
                                    <VncViewer vncTarget={{ node: target.node, vmid: target.vmid }} />
                                )}
                            </div>
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-6">
                                {screenshots.length > 0 ? (
                                    <>
                                        {/* Large Display */}
                                        <div className="relative group max-h-[80%] rounded border border-security-border overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.8)]">
                                            <img
                                                src={`${BASE_URL}/screenshots/${screenshots[selectedScreenshot]}`}
                                                className="max-w-full max-h-full object-contain"
                                                alt="Guest OS Evidence"
                                            />
                                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <p className="text-[10px] font-mono text-white/80">{screenshots[selectedScreenshot]}</p>
                                            </div>
                                        </div>

                                        {/* Filmstrip / Carousel Navigation */}
                                        <div className="flex items-center gap-4 bg-security-panel/50 p-2 rounded-full border border-security-border/50">
                                            <button
                                                onClick={() => setSelectedScreenshot(prev => Math.max(0, prev - 1))}
                                                className="p-2 hover:bg-white/10 rounded-full text-white transition-colors"
                                            >
                                                <ChevronLeft size={20} />
                                            </button>
                                            <div className="flex gap-2 px-2 border-l border-r border-security-border/30">
                                                {screenshots.slice(-8).map((s, idx) => {
                                                    const realIdx = screenshots.length - Math.min(8, screenshots.length) + idx;
                                                    return (
                                                        <button
                                                            key={s}
                                                            onClick={() => setSelectedScreenshot(realIdx)}
                                                            className={`w-8 h-5 rounded-sm border transition-all overflow-hidden bg-black ${selectedScreenshot === realIdx ? 'border-brand-500 scale-110 shadow-[0_0_10px_#a855f7]' : 'border-security-border/50 opacity-40 hover:opacity-100'
                                                                }`}
                                                        >
                                                            <img src={`${BASE_URL}/screenshots/${s}`} className="w-full h-full object-cover" />
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            <button
                                                onClick={() => setSelectedScreenshot(prev => Math.min(screenshots.length - 1, prev + 1))}
                                                className="p-2 hover:bg-white/10 rounded-full text-white transition-colors"
                                            >
                                                <ChevronRight size={20} />
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex flex-col items-center gap-4 opacity-20">
                                        <ImageIcon size={64} strokeWidth={1} />
                                        <p className="text-xs font-black uppercase tracking-[0.3em]">Awaiting Screenshot Signal...</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Overlay Controls for Fullscreen */}
                        {fullScreen && (
                            <button
                                onClick={() => setFullScreen(false)}
                                className="absolute top-6 right-6 p-2 bg-security-surface border border-security-border text-white rounded-full shadow-2xl z-50 hover:bg-security-panel transition-all"
                            >
                                <X size={20} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Right: Detailed Telemetry Inspector */}
                <aside className="w-[380px] border-l border-security-border bg-security-surface flex flex-col shadow-2xl">
                    <div className="flex border-b border-security-border bg-security-bg/30">
                        <button
                            onClick={() => setActiveTab('telemetry')}
                            className={`flex-1 py-3 text-[10px] font-extrabold uppercase tracking-widest transition-all relative ${activeTab === 'telemetry' ? 'text-brand-500' : 'text-security-muted'}`}
                        >
                            <span className="flex items-center justify-center gap-2">
                                <Binary size={12} /> Live Flow
                                {activeTab === 'telemetry' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-500"></div>}
                            </span>
                        </button>
                        <button
                            onClick={() => setActiveTab('intelligence')}
                            className={`flex-1 py-3 text-[10px] font-extrabold uppercase tracking-widest transition-all relative ${activeTab === 'intelligence' ? 'text-white' : 'text-security-muted'}`}
                        >
                            <span className="flex items-center justify-center gap-2">
                                <ShieldAlert size={12} /> AI Insight
                                {activeTab === 'intelligence' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white"></div>}
                            </span>
                        </button>
                        <button
                            onClick={() => setActiveTab('notes')}
                            className={`flex-1 py-3 text-[10px] font-extrabold uppercase tracking-widest transition-all relative ${activeTab === 'notes' ? 'text-brand-400' : 'text-security-muted'}`}
                        >
                            <span className="flex items-center justify-center gap-2">
                                <Pencil size={12} /> Notes
                                {activeTab === 'notes' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-400"></div>}
                            </span>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar bg-security-bg/10">
                        {activeTab === 'telemetry' ? (
                            events.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-security-muted/30 py-20 px-10 text-center">
                                    <Database size={40} className="mb-4" />
                                    <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] leading-relaxed">
                                        Awaiting Agent Initial Handshake...
                                    </p>
                                </div>
                            ) : (
                                events.slice().reverse().map((evt, i) => {
                                    const tag = tags.find(t => t.event_id === evt.id);
                                    const tagColors = {
                                        'Malicious': 'border-threat-critical shadow-[0_0_10px_rgba(248,81,73,0.3)]',
                                        'Benign': 'opacity-40 grayscale',
                                        'KeyArtifact': 'border-amber-500 shadow-[0_0_10px_rgba(242,192,55,0.3)]',
                                        'Ignored': 'opacity-20'
                                    };

                                    return (
                                        <div
                                            key={i}
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                setContextMenu({ x: e.clientX, y: e.clientY, event: evt });
                                            }}
                                            className={`bg-security-panel/40 border border-security-border rounded p-3 hover:border-brand-500 transition-all group relative animate-in slide-in-from-right duration-300 ${tag ? tagColors[tag.tag_type as keyof typeof tagColors] : ''}`}
                                        >
                                            {tag && (
                                                <div className="absolute -top-2 -right-2 px-1.5 py-0.5 rounded bg-black border border-white/10 text-[8px] font-black uppercase tracking-tighter shadow-lg z-10">
                                                    {tag.tag_type}
                                                </div>
                                            )}
                                            <div className="flex justify-between items-start mb-1.5">
                                                <span className={`text-[9px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded ${evt.event_type.includes("ERROR") || evt.process_name.includes("malware")
                                                    ? "bg-threat-critical/20 text-threat-critical border border-threat-critical/20"
                                                    : "bg-brand-500/10 text-brand-500 border border-brand-500/20"
                                                    }`}>
                                                    {evt.event_type}
                                                </span>
                                                <span className="text-[9px] font-mono text-security-muted">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-white font-mono text-[11px] font-bold">
                                                <Terminal size={10} className="text-security-muted" />
                                                <span className="truncate">{evt.process_name}</span>
                                                <span className="px-1 bg-security-bg text-security-muted rounded text-[9px] font-bold border border-security-border">PID {evt.process_id}</span>
                                            </div>
                                            <div className="mt-2 text-[10px] text-security-muted leading-relaxed font-mono italic break-words border-t border-security-border/30 pt-1.5">
                                                {evt.details}
                                            </div>
                                        </div>
                                    );
                                })
                            )
                        ) : activeTab === 'intelligence' ? (
                            <AIInsightPanel
                                report={aiReport}
                                loading={aiLoading}
                                onAnalyze={handleAIAnalysis}
                            />
                        ) : (
                            <AnalystNotepad
                                taskId={activeTaskId}
                                onNoteAdded={() => setActiveTab('intelligence')} // Pivot back after hint?
                            />
                        )}
                    </div>

                    {/* Dynamic Status Footer */}
                    <div className="p-4 bg-security-panel border-t border-security-border">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col">
                                <span className="text-[9px] text-security-muted font-bold uppercase tracking-widest">Capture Active</span>
                                <span className="text-brand-500 text-lg font-black font-mono tracking-tighter tabular-nums">{events.length}</span>
                            </div>
                            <div className="flex flex-col items-end">
                                <span className="text-[9px] text-security-muted font-bold uppercase tracking-widest">Arena Health</span>
                                <div className="flex items-center gap-2 mt-1">
                                    <div className="w-1.5 h-1.5 rounded-full bg-threat-low shadow-[0_0_5px_#238636]"></div>
                                    <span className="text-white text-xs font-bold font-mono">STABLE</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </aside>
            </main>

            {/* Context Menu for Tagging */}
            {contextMenu && (
                <>
                    <div className="fixed inset-0 z-[100]" onClick={() => setContextMenu(null)}></div>
                    <div
                        className="fixed z-[101] bg-slate-900 border border-white/10 shadow-2xl rounded p-1 w-48 font-mono"
                        style={{ top: contextMenu.y, left: contextMenu.x }}
                    >
                        <div className="px-2 py-1.5 text-[9px] text-slate-500 border-b border-white/5 mb-1 uppercase font-black tracking-widest">
                            Tag Telemetry
                        </div>
                        <ContextMenuItem label="Malicious" color="text-threat-critical" onClick={() => handleTag('Malicious')} />
                        <ContextMenuItem label="Key Artifact" color="text-amber-400" onClick={() => handleTag('KeyArtifact')} />
                        <ContextMenuItem label="Benign / Noise" color="text-slate-400" onClick={() => handleTag('Benign')} />
                        <ContextMenuItem label="Ignore Entirely" color="text-slate-600" onClick={() => handleTag('Ignored')} />
                    </div>
                </>
            )}
        </div>
    );
}

function ContextMenuItem({ label, color, onClick }: { label: string, color: string, onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`w-full text-left px-3 py-1.5 text-[10px] font-bold uppercase tracking-tight hover:bg-white/5 rounded transition-all ${color}`}
        >
            {label}
        </button>
    );
}

const XCircle = ({ size }: { size: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
);
