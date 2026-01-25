import React, { useState, useRef } from 'react';
import { X, Upload, Globe, Clock, Monitor, CheckCircle, XCircle, AlertCircle, Zap } from 'lucide-react';
import { ViewModel } from './mallabApi';

interface SubmissionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: SubmissionData & { vmid?: number, node?: string }) => void;
    vms: ViewModel[];
    preSelected?: { node: string, vmid: number };
}

export interface SubmissionData {
    type: 'file' | 'url';
    file?: File;
    url?: string;
    duration: number; // in minutes
}

export default function SubmissionModal({ isOpen, onClose, onSubmit, vms, preSelected }: SubmissionModalProps) {
    const [submissionType, setSubmissionType] = useState<'file' | 'url'>('file');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [urlInput, setUrlInput] = useState('');
    const [duration, setDuration] = useState(5);
    const [selectedVm, setSelectedVm] = useState<{ node: string, vmid: number } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Sync preSelected when modal opens
    React.useEffect(() => {
        if (isOpen && preSelected) {
            setSelectedVm(preSelected);
        } else if (isOpen) {
            setSelectedVm(null); // Default to Auto-select
        }
    }, [isOpen, preSelected]);

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

        onSubmit({
            type: submissionType,
            file: selectedFile || undefined,
            url: urlInput || undefined,
            duration,
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

    const availableVms = vms.filter(vm => vm.status === 'running');
    const busyVms = vms.filter(vm => vm.status !== 'running');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-security-surface border border-security-border rounded-xl shadow-2xl w-full max-w-2xl mx-4 animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-security-border shrink-0">
                    <div>
                        <h2 className="text-xl font-black text-white uppercase tracking-tight flex items-center gap-2">
                            <Upload className="text-brand-500" size={20} />
                            Submit New Analysis Task
                        </h2>
                        <p className="text-[10px] text-security-muted font-bold uppercase tracking-widest mt-1">
                            Configure Sandbox Detonation
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
                <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
                    {/* Submission Type Toggle */}
                    <div>
                        <label className="text-[10px] text-security-muted font-black uppercase tracking-widest mb-3 block">
                            Analysis Type
                        </label>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setSubmissionType('file')}
                                className={`flex-1 p-4 rounded-lg border-2 transition-all ${submissionType === 'file'
                                    ? 'bg-brand-500/10 border-brand-500 text-brand-500'
                                    : 'bg-security-panel border-security-border text-security-muted hover:border-security-muted'
                                    }`}
                            >
                                <Upload size={24} className="mx-auto mb-2" />
                                <div className="text-xs font-bold">File Upload</div>
                            </button>
                            <button
                                onClick={() => setSubmissionType('url')}
                                className={`flex-1 p-4 rounded-lg border-2 transition-all ${submissionType === 'url'
                                    ? 'bg-brand-500/10 border-brand-500 text-brand-500'
                                    : 'bg-security-panel border-security-border text-security-muted hover:border-security-muted'
                                    }`}
                            >
                                <Globe size={24} className="mx-auto mb-2" />
                                <div className="text-xs font-bold">URL Analysis</div>
                            </button>
                        </div>
                    </div>

                    {/* File Upload Zone */}
                    {submissionType === 'file' && (
                        <div>
                            <label className="text-[10px] text-security-muted font-black uppercase tracking-widest mb-3 block">
                                Sample File
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
                                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all ${isDragging
                                    ? 'border-brand-500 bg-brand-500/10'
                                    : selectedFile
                                        ? 'border-brand-500 bg-brand-500/5'
                                        : 'border-security-border bg-security-panel hover:border-security-muted'
                                    }`}
                            >
                                {selectedFile ? (
                                    <div className="space-y-2">
                                        <CheckCircle className="mx-auto text-brand-500" size={32} />
                                        <div className="text-sm font-bold text-white">{selectedFile.name}</div>
                                        <div className="text-xs text-security-muted">
                                            {(selectedFile.size / 1024).toFixed(2)} KB
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedFile(null);
                                            }}
                                            className="text-xs text-brand-500 hover:text-brand-400 underline"
                                        >
                                            Change File
                                        </button>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <Upload className="mx-auto text-security-muted" size={32} />
                                        <div className="text-sm font-bold text-white">
                                            Drop file here or click to browse
                                        </div>
                                        <div className="text-xs text-security-muted">
                                            Supports: EXE, DLL, PDF, DOC, ZIP, and more
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* URL Input */}
                    {submissionType === 'url' && (
                        <div>
                            <label className="text-[10px] text-security-muted font-black uppercase tracking-widest mb-3 block">
                                Target URL
                            </label>
                            <div className="relative">
                                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-security-muted" size={16} />
                                <input
                                    type="text"
                                    value={urlInput}
                                    onChange={(e) => setUrlInput(e.target.value)}
                                    placeholder="https://malicious-site.com/payload.exe"
                                    className="w-full bg-security-panel border border-security-border rounded-lg pl-10 pr-4 py-3 text-sm text-white placeholder-security-muted outline-none focus:border-brand-500/50 transition-colors font-mono"
                                />
                            </div>
                        </div>
                    )}

                    {/* Duration Slider */}
                    <div>
                        <label className="text-[10px] text-security-muted font-black uppercase tracking-widest mb-3 block flex items-center justify-between">
                            <span className="flex items-center gap-2">
                                <Clock size={12} />
                                Analysis Duration
                            </span>
                            <span className="text-brand-500 font-mono text-sm">{duration} min</span>
                        </label>
                        <input
                            type="range"
                            min="1"
                            max="60"
                            value={duration}
                            onChange={(e) => setDuration(parseInt(e.target.value))}
                            className="w-full h-2 bg-security-panel rounded-lg appearance-none cursor-pointer slider"
                            style={{
                                background: `linear-gradient(to right, rgb(var(--brand-500)) 0%, rgb(var(--brand-500)) ${((duration - 1) / 59) * 100}%, rgb(var(--security-panel)) ${((duration - 1) / 59) * 100}%, rgb(var(--security-panel)) 100%)`
                            }}
                        />
                        <div className="flex justify-between text-[9px] text-security-muted font-mono mt-1">
                            <span>1 min</span>
                            <span>30 min</span>
                            <span>60 min</span>
                        </div>
                    </div>

                    {/* Sandbox Selection */}
                    <div>
                        <label className="text-[10px] text-security-muted font-black uppercase tracking-widest mb-3 block flex items-center justify-between">
                            <span className="flex items-center gap-2">
                                <Monitor size={12} />
                                Target Sandbox
                            </span>
                            <span className="text-brand-500 font-bold uppercase text-[9px]">Manual Selection Available</span>
                        </label>
                        <div className="bg-black/20 rounded-lg border border-security-border overflow-hidden">
                            <div className="max-h-32 overflow-y-auto custom-scrollbar divide-y divide-security-border/30">
                                {/* Auto-select Option */}
                                <div
                                    onClick={() => setSelectedVm(null)}
                                    className={`p-3 flex items-center gap-3 cursor-pointer transition-all ${selectedVm === null ? 'bg-brand-500/10 border-l-2 border-brand-500' : 'hover:bg-security-panel'}`}
                                >
                                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedVm === null ? 'border-brand-500 bg-brand-500' : 'border-security-muted'}`}>
                                        {selectedVm === null && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className={`text-[11px] font-black ${selectedVm === null ? 'text-brand-500' : 'text-slate-300'}`}>AUTO-SELECT SYSTEM</span>
                                        <span className="text-[9px] text-security-muted font-bold uppercase">Dynamic resource allocation (Recommended)</span>
                                    </div>
                                    {selectedVm === null && <Zap size={12} className="ml-auto text-brand-500 animate-pulse" />}
                                </div>

                                {/* VM List */}
                                {vms.filter(vm => vm.vmid >= 300 && vm.vmid < 400).map((vm) => {
                                    const isSelected = selectedVm?.vmid === vm.vmid;
                                    const isReady = vm.status === 'running';

                                    return (
                                        <div
                                            key={vm.vmid}
                                            onClick={() => setSelectedVm({ node: vm.node, vmid: vm.vmid })}
                                            className={`p-3 flex items-center gap-3 cursor-pointer transition-all ${isSelected ? 'bg-brand-500/10 border-l-2 border-brand-500' : 'hover:bg-security-panel'}`}
                                        >
                                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${isSelected ? 'border-brand-500 bg-brand-500' : 'border-security-muted'}`}>
                                                {isSelected && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <span className={`text-[11px] font-black uppercase truncate ${isSelected ? 'text-brand-500' : 'text-slate-300'}`}>
                                                    {vm.name || `VM ${vm.vmid}`} (ID: {vm.vmid})
                                                </span>
                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                    <div className={`w-1.5 h-1.5 rounded-full ${isReady ? 'bg-brand-500' : 'bg-red-500'}`}></div>
                                                    <span className="text-[9px] text-security-muted font-bold uppercase">{vm.status}</span>
                                                    <span className="text-[9px] text-security-muted/50 border-l border-white/10 pl-1.5">{vm.node}</span>
                                                </div>
                                            </div>
                                            {!isReady && isSelected && (
                                                <div className="ml-auto flex items-center gap-1 text-[9px] text-red-500 font-black uppercase">
                                                    <AlertCircle size={10} /> Busy
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 p-6 border-t border-security-border bg-security-bg/50 shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg border border-security-border bg-security-panel text-white hover:bg-security-surface transition-colors text-sm font-bold"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="btn-primary px-6 py-2 shadow-lg shadow-brand-500/20"
                    >
                        <Upload size={16} strokeWidth={3} />
                        <span className="font-black">Submit Analysis</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
