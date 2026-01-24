import React, { useState } from 'react';
import { Play, Globe, FileCode, Send } from 'lucide-react';
import { voodooApi } from './voodooApi';

export default function ExecutionPanel() {
    const [binaryPath, setBinaryPath] = useState('');
    const [binaryArgs, setBinaryArgs] = useState('');
    const [url, setUrl] = useState('');
    const [status, setStatus] = useState('');

    const handleExecBinary = async () => {
        if (!binaryPath.trim()) {
            setStatus('Error: Binary path is required');
            return;
        }

        const args = binaryArgs.trim() ? binaryArgs.split(' ') : undefined;
        const success = await voodooApi.execBinary(binaryPath, args);

        if (success) {
            setStatus(`✓ Executed: ${binaryPath}`);
            setBinaryPath('');
            setBinaryArgs('');
        } else {
            setStatus('✗ Execution failed');
        }

        setTimeout(() => setStatus(''), 3000);
    };

    const handleExecUrl = async () => {
        if (!url.trim()) {
            setStatus('Error: URL is required');
            return;
        }

        const success = await voodooApi.execUrl(url);

        if (success) {
            setStatus(`✓ Opening: ${url}`);
            setUrl('');
        } else {
            setStatus('✗ Failed to open URL');
        }

        setTimeout(() => setStatus(''), 3000);
    };

    return (
        <div className="card bg-security-surface border-security-border p-6 space-y-6">
            <div>
                <h2 className="text-lg font-black text-white uppercase tracking-tight flex items-center gap-2 mb-1">
                    <Play className="text-brand-500" size={20} />
                    Remote Execution
                </h2>
                <p className="text-[10px] text-security-muted font-bold uppercase tracking-widest">
                    Execute binaries and open URLs in the sandbox
                </p>
            </div>

            {/* Binary Execution */}
            <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-black uppercase text-security-muted tracking-wider">
                    <FileCode size={14} />
                    <span>Binary Execution</span>
                </div>

                <input
                    type="text"
                    className="w-full bg-security-bg border border-security-border rounded px-3 py-2 text-xs text-white placeholder-security-muted outline-none focus:border-brand-500 transition-all font-mono"
                    placeholder="C:\Path\To\Binary.exe"
                    value={binaryPath}
                    onChange={(e) => setBinaryPath(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleExecBinary()}
                />

                <input
                    type="text"
                    className="w-full bg-security-bg border border-security-border rounded px-3 py-2 text-xs text-white placeholder-security-muted outline-none focus:border-security-muted transition-all font-mono"
                    placeholder="Arguments (optional)"
                    value={binaryArgs}
                    onChange={(e) => setBinaryArgs(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleExecBinary()}
                />

                <button
                    onClick={handleExecBinary}
                    className="btn-primary w-full h-9"
                >
                    <Play size={14} strokeWidth={3} />
                    Execute Binary
                </button>
            </div>

            {/* URL Execution */}
            <div className="space-y-3 pt-4 border-t border-security-border/30">
                <div className="flex items-center gap-2 text-xs font-black uppercase text-security-muted tracking-wider">
                    <Globe size={14} />
                    <span>URL Launcher</span>
                </div>

                <input
                    type="text"
                    className="w-full bg-security-bg border border-security-border rounded px-3 py-2 text-xs text-white placeholder-security-muted outline-none focus:border-brand-500 transition-all font-mono"
                    placeholder="https://example.com"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleExecUrl()}
                />

                <button
                    onClick={handleExecUrl}
                    className="btn-primary w-full h-9"
                >
                    <Send size={14} strokeWidth={3} />
                    Open URL
                </button>
            </div>

            {/* Status Message */}
            {status && (
                <div className={`p-3 rounded text-xs font-bold text-center ${status.startsWith('✓')
                    ? 'bg-threat-low/20 text-threat-low border border-threat-low/20'
                    : 'bg-threat-critical/20 text-threat-critical border border-threat-critical/20'
                    }`}>
                    {status}
                </div>
            )}
        </div>
    );
}
