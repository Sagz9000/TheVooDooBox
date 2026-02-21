import React, { useState, useRef } from 'react';
import { X, Upload, Globe, Clock, Monitor, CheckCircle, AlertCircle, Zap, Brain } from 'lucide-react';
import { ViewModel } from './voodooApi';

interface SubmissionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: SubmissionData & { vmid?: number, node?: string }) => void;
    vms: ViewModel[];
    preSelected?: { node: string, vmid: number };
    vsixData?: { extension_id: string; version: string; display_name: string; risk_score: number | null };
}

export interface SubmissionData {
    type: 'file' | 'url' | 'vsix';
    file?: File;
    url?: string;
    vsix_extension_id?: string;
    vsix_version?: string;
    duration: number; // in minutes
    mode: 'quick' | 'deep';
    ai_strategy?: string; // 'global' | 'hybrid' | 'local_only' | 'cloud_only'
}

export default function SubmissionModal({ isOpen, onClose, onSubmit, vms, preSelected, vsixData }: SubmissionModalProps) {
    const [submissionType, setSubmissionType] = useState<'file' | 'url' | 'vsix'>(vsixData ? 'vsix' : 'file');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [urlInput, setUrlInput] = useState('');
    const [duration, setDuration] = useState(5);
    const [analysisMode, setAnalysisMode] = useState<'quick' | 'deep'>('quick');
    const [selectedVm, setSelectedVm] = useState<{ node: string, vmid: number } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [aiStrategy, setAiStrategy] = useState<string>('global');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Sync preSelected when modal opens
    React.useEffect(() => {
        if (isOpen && preSelected) {
            setSelectedVm(preSelected);
        } else if (isOpen) {
            setSelectedVm(null); // Default to Auto-select
        }

        if (isOpen && vsixData) {
            setSubmissionType('vsix');
        } else if (isOpen) {
            setSubmissionType('file');
        }
    }, [isOpen, preSelected, vsixData]);

    if (!isOpen) return null;

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) {
            setSelectedFile(file);
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleSubmit = () => {
        if (submissionType === 'file' && !selectedFile) {
            alert('Please select a file to upload');
            return;
        }
        if (submissionType === 'url' && !urlInput.trim()) {
            alert('Please enter a URL to analyze');
            return;
        }
        if (submissionType === 'vsix' && !vsixData) {
            alert('Missing extension metadata');
            return;
        }

        onSubmit({
            type: submissionType,
            file: selectedFile || undefined,
            url: urlInput || undefined,
            vsix_extension_id: vsixData?.extension_id,
            vsix_version: vsixData?.version,
            duration,
            mode: analysisMode,
            ai_strategy: aiStrategy !== 'global' ? aiStrategy : undefined,
            vmid: selectedVm?.vmid,
            node: selectedVm?.node
        });

        // Reset form
        setSelectedFile(null);
        setUrlInput('');
        setDuration(5);
        setSelectedVm(null);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-200 p-2 md:p-4">
            <div className="bg-security-surface border border-security-border rounded-xl shadow-2xl w-full max-w-2xl animate-in zoom-in-95 duration-200 max-h-[95vh] md:max-h-[90vh] flex flex-col relative overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 md:p-6 border-b border-security-border shrink-0">
                    <div>
                        <h2 className="text-lg md:text-xl font-black text-white uppercase tracking-tight flex items-center gap-2">
                            <Upload className="text-brand-500" size={20} />
                            Submit Forensic Task
                        </h2>
                        <p className="text-[10px] text-security-muted font-bold uppercase tracking-widest mt-1">
                            Sandbox Detonation Configuration
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-security-panel rounded-lg transition-colors text-security-muted hover:text-white"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 md:p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar min-h-0">
                    {/* Submission Type Toggle */}
                    {!vsixData ? (
                        <div>
                            <label className="text-[9px] md:text-[10px] text-security-muted font-black uppercase tracking-widest mb-3 block">
                                Target Acquisition
                            </label>
                            <div className="flex gap-4">
                                <button
                                    onClick={() => setSubmissionType('file')}
                                    className={`flex-1 p-4 rounded-lg border-2 transition-all flex flex-col items-center justify-center gap-2 ${submissionType === 'file'
                                        ? 'bg-brand-500/10 border-brand-500 text-brand-500 shadow-[0_0_20px_rgba(59,130,246,0.1)]'
                                        : 'bg-security-panel border-security-border text-security-muted hover:border-security-muted'
                                        }`}
                                >
                                    <Upload size={24} />
                                    <div className="text-[10px] md:text-xs font-black uppercase tracking-widest">Local Upload</div>
                                </button>
                                <button
                                    onClick={() => setSubmissionType('url')}
                                    className={`flex-1 p-4 rounded-lg border-2 transition-all flex flex-col items-center justify-center gap-2 ${submissionType === 'url'
                                        ? 'bg-brand-500/10 border-brand-500 text-brand-500 shadow-[0_0_20px_rgba(59,130,246,0.1)]'
                                        : 'bg-security-panel border-security-border text-security-muted hover:border-security-muted'
                                        }`}
                                >
                                    <Globe size={24} />
                                    <div className="text-[10px] md:text-xs font-black uppercase tracking-widest">URL Analysis</div>
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                            <label className="text-[9px] md:text-[10px] text-security-muted font-black uppercase tracking-widest mb-3 block">
                                Selected Extension Payload
                            </label>
                            <div className="p-4 rounded-lg border-2 border-brand-500 bg-brand-500/10 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <Zap size={24} className="text-brand-500 shrink-0" />
                                    <div className="flex flex-col min-w-0">
                                        <div className="text-white font-black truncate text-sm">
                                            {vsixData.display_name}
                                        </div>
                                        <div className="text-[10px] text-security-muted font-mono mt-1">
                                            {vsixData.extension_id} v{vsixData.version}
                                        </div>
                                    </div>
                                </div>
                                {vsixData.risk_score !== null && (
                                    <div className="shrink-0 flex flex-col items-end">
                                        <div className={`text-lg font-black ${vsixData.risk_score >= 0.4 ? 'text-red-500' : 'text-brand-500'}`}>
                                            {(vsixData.risk_score * 100).toFixed(0)}%
                                        </div>
                                        <div className="text-[8px] text-security-muted uppercase tracking-widest font-black">Risk Score</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* File Upload Zone */}
                    {submissionType === 'file' && (
                        <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                            <label className="text-[9px] md:text-[10px] text-security-muted font-black uppercase tracking-widest mb-3 block">
                                Sample Payload
                            </label>
                            <input
                                ref={fileInputRef}
                                type="file"
                                onChange={handleFileSelect}
                                className="hidden"
                            />
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                onDrop={handleDrop}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                className={`border-2 border-dashed rounded-lg p-6 md:p-10 text-center cursor-pointer transition-all ${isDragging
                                    ? 'border-brand-500 bg-brand-500/10'
                                    : selectedFile
                                        ? 'border-brand-500 bg-brand-500/5'
                                        : 'border-security-border bg-security-panel hover:border-security-muted'
                                    }`}
                            >
                                {selectedFile ? (
                                    <div className="space-y-2">
                                        <CheckCircle className="mx-auto text-brand-500" size={32} />
                                        <div className="text-sm font-bold text-white break-all max-w-[300px] mx-auto">{selectedFile.name}</div>
                                        <div className="text-[10px] font-mono text-security-muted">
                                            {(selectedFile.size / 1024).toFixed(2)} KB
                                        </div>
                                        <div className="text-[10px] text-brand-500 font-black uppercase tracking-widest mt-2">Click to replace</div>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <Upload className="mx-auto text-security-muted mb-2" size={32} />
                                        <div className="text-[11px] md:text-xs font-bold text-white uppercase tracking-wider">
                                            Detonate via Drop or Click
                                        </div>
                                        <div className="text-[9px] md:text-[10px] text-security-muted font-mono">
                                            EXE, DLL, PDF, JS, DOCM, VBS
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* URL Input */}
                    {submissionType === 'url' && (
                        <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                            <label className="text-[9px] md:text-[10px] text-security-muted font-black uppercase tracking-widest mb-3 block">
                                Target Remote URL
                            </label>
                            <div className="relative">
                                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-security-muted" size={16} />
                                <input
                                    type="text"
                                    value={urlInput}
                                    onChange={(e) => setUrlInput(e.target.value)}
                                    placeholder="https://c2-server.com/malicious.ps1"
                                    className="w-full bg-security-panel border border-security-border rounded-lg pl-10 pr-4 py-3 text-[11px] md:text-sm text-white placeholder-security-muted outline-none focus:border-brand-500/50 transition-colors font-mono"
                                />
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Duration Slider */}
                        <div className="space-y-4">
                            <label className="text-[9px] md:text-[10px] text-security-muted font-black uppercase tracking-widest block flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                    <Clock size={12} className="text-brand-500" />
                                    Detonation Time
                                </span>
                                <span className="text-brand-500 font-mono text-xs md:text-sm">{duration} min</span>
                            </label>
                            <div className="px-1">
                                <input
                                    type="range"
                                    min="1"
                                    max="60"
                                    value={duration}
                                    onChange={(e) => setDuration(parseInt(e.target.value))}
                                    className="w-full h-1.5 bg-security-panel rounded-lg appearance-none cursor-pointer slider accent-brand-500"
                                />
                                <div className="flex justify-between text-[8px] md:text-[9px] text-security-muted font-black uppercase tracking-tighter mt-2">
                                    <span>T+1m</span>
                                    <span>T+30m</span>
                                    <span>T+60m</span>
                                </div>
                            </div>
                        </div>
                        {/* Analysis Mode Toggle */}
                        <div className="space-y-4">
                            <label className="text-[9px] md:text-[10px] text-security-muted font-black uppercase tracking-widest block flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                    <Zap size={12} className={analysisMode === 'deep' ? 'text-brand-500' : 'text-slate-500'} />
                                    Forensic Depth
                                </span>
                                <span className="text-brand-500 font-mono text-xs md:text-sm uppercase">{analysisMode}</span>
                            </label>
                            <div className="flex bg-black/40 p-1 rounded-lg border border-security-border">
                                <button
                                    onClick={() => setAnalysisMode('quick')}
                                    className={`flex-1 py-2 rounded-md text-[10px] font-black uppercase transition-all ${analysisMode === 'quick' ? 'bg-brand-500 text-white shadow-lg' : 'text-security-muted hover:text-white'}`}
                                >
                                    Quick Scan
                                </button>
                                <button
                                    onClick={() => setAnalysisMode('deep')}
                                    className={`flex-1 py-2 rounded-md text-[10px] font-black uppercase transition-all ${analysisMode === 'deep' ? 'bg-purple-600 text-white shadow-lg' : 'text-security-muted hover:text-white'}`}
                                >
                                    Deep Dive (RAG)
                                </button>
                            </div>
                            <div className="text-[9px] text-security-muted leading-relaxed px-1">
                                {analysisMode === 'quick'
                                    ? "Standard heuristic analysis. Fast (1-2 mins). Good for initial triage."
                                    : "Full Vector Search & MITRE Mapping. Slower (5-10 mins). Best for complex threats."}
                            </div>
                        </div>

                        {/* AI Strategy Override */}
                        <div className="space-y-3">
                            <label className="text-[9px] md:text-[10px] text-security-muted font-black uppercase tracking-widest block flex items-center gap-2">
                                <Brain size={12} className="text-purple-500" />
                                AI Strategy
                            </label>
                            <select
                                value={aiStrategy}
                                onChange={(e) => setAiStrategy(e.target.value)}
                                className="w-full bg-security-panel border border-security-border rounded-lg px-3 py-2.5 text-[10px] text-white font-black uppercase tracking-widest cursor-pointer focus:border-brand-500 transition-colors appearance-none"
                                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                            >
                                <option value="global">⚡ Use Global Setting</option>
                                <option value="hybrid">⚡ Hybrid (Local → Cloud)</option>
                                <option value="local_only">🔒 Local Only (Air-Gapped)</option>
                                <option value="cloud_only">☁️ Cloud Only (Full Power)</option>
                            </select>
                            <div className="text-[8px] text-security-muted leading-relaxed px-1">
                                Override the global AI strategy for this submission only.
                            </div>
                        </div>

                        {/* Sandbox Selection */}
                        <div className="space-y-3">
                            <label className="text-[9px] md:text-[10px] text-security-muted font-black uppercase tracking-widest block flex items-center justify-between">
                                <span className="flex items-center gap-2">
                                    <Monitor size={12} className="text-brand-500" />
                                    Execution Unit
                                </span>
                            </label>
                            <div className="bg-black/40 rounded-lg border border-security-border overflow-hidden">
                                <div className="max-h-36 md:max-h-48 overflow-y-auto custom-scrollbar divide-y divide-security-border/30">
                                    <div
                                        onClick={() => setSelectedVm(null)}
                                        className={`p-3 flex items-center gap-3 cursor-pointer transition-all ${selectedVm === null ? 'bg-brand-500/10 border-l-2 border-brand-500' : 'hover:bg-security-panel'}`}
                                    >
                                        <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${selectedVm === null ? 'border-brand-500 bg-brand-500' : 'border-security-muted'}`}>
                                            {selectedVm === null && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <span className={`text-[10px] font-black uppercase leading-none ${selectedVm === null ? 'text-brand-500' : 'text-slate-300'}`}>Cloud Dynamic</span>
                                            <span className="text-[8px] text-security-muted font-bold uppercase mt-1 truncate">Auto-assign optimal node</span>
                                        </div>
                                        {selectedVm === null && <Zap size={10} className="ml-auto text-brand-500 animate-pulse" />}
                                    </div>

                                    {vms.filter(vm => vm.vmid >= 300 && vm.vmid < 400).map((vm) => {
                                        const isSelected = selectedVm?.vmid === vm.vmid;
                                        const isReady = vm.status === 'running';

                                        return (
                                            <div
                                                key={vm.vmid}
                                                onClick={() => setSelectedVm({ node: vm.node, vmid: vm.vmid })}
                                                className={`p-3 flex items-center gap-3 cursor-pointer transition-all ${isSelected ? 'bg-brand-500/10 border-l-2 border-brand-500' : 'hover:bg-security-panel'}`}
                                            >
                                                <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${isSelected ? 'border-brand-500 bg-brand-500' : 'border-security-muted'}`}>
                                                    {isSelected && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <span className={`text-[10px] font-black uppercase truncate leading-none ${isSelected ? 'text-brand-500' : 'text-slate-300'}`}>
                                                        {vm.name || `VM ${vm.vmid}`}
                                                    </span>
                                                    <div className="flex items-center gap-1.5 mt-1">
                                                        <div className={`w-1 h-1 rounded-full ${isReady ? 'bg-brand-500' : 'bg-red-500'}`}></div>
                                                        <span className="text-[8px] text-security-muted font-bold uppercase truncate">{vm.status} (ID {vm.vmid})</span>
                                                    </div>
                                                </div>
                                                {!isReady && isSelected && (
                                                    <div className="ml-auto flex items-center gap-1 text-[8px] text-red-500 font-black uppercase">
                                                        <AlertCircle size={8} /> Busy
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                {/* Footer */}
                <div className="flex items-center justify-between p-4 md:p-6 border-t border-security-border bg-security-bg/50 shrink-0 gap-4">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg border border-security-border bg-security-panel text-[11px] text-white font-black uppercase tracking-widest hover:bg-security-surface transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="btn-primary px-6 py-2 shadow-lg shadow-brand-500/20 text-[11px]"
                    >
                        <Upload size={14} strokeWidth={3} className="mr-2" />
                        <span className="font-black">Initiate Detonation</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
