import React, { useState, useEffect } from 'react';
import { X, Settings, Cpu, Globe, Key, Save, AlertCircle, CheckCircle, Eye, EyeOff, Zap, Lock, Cloud } from 'lucide-react';
import { voodooApi } from './voodooApi';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfigUpdated: (provider: string) => void;
}

export default function SettingsModal({ isOpen, onClose, onConfigUpdated }: SettingsModalProps) {
    const [provider, setProvider] = useState<string>('ollama');
    const [geminiKey, setGeminiKey] = useState('');
    const [ollamaUrl, setOllamaUrl] = useState('');
    const [ollamaModel, setOllamaModel] = useState('');
    const [anthropicKey, setAnthropicKey] = useState('');
    const [anthropicModel, setAnthropicModel] = useState('');
    const [openaiKey, setOpenaiKey] = useState('');
    const [openaiModel, setOpenaiModel] = useState('');
    const [copilotToken, setCopilotToken] = useState('');
    const [copilotModel, setCopilotModel] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const [aiMode, setAiMode] = useState<string>('hybrid');

    useEffect(() => {
        if (isOpen) {
            voodooApi.getAIConfig().then((config: any) => {
                setProvider(config.provider ? config.provider.toLowerCase() : 'ollama');
                if (config.ai_mode) setAiMode(config.ai_mode);

                // Load existing keys/models if available
                if (config.gemini_key) setGeminiKey(config.gemini_key);
                if (config.ollama_url) setOllamaUrl(config.ollama_url);
                if (config.ollama_model) setOllamaModel(config.ollama_model);

                if (config.anthropic_key) setAnthropicKey(config.anthropic_key);
                if (config.anthropic_model) setAnthropicModel(config.anthropic_model);

                if (config.openai_key) setOpenaiKey(config.openai_key);
                if (config.openai_model) setOpenaiModel(config.openai_model);

                if (config.copilot_token) setCopilotToken(config.copilot_token);
                if (config.copilot_model) setCopilotModel(config.copilot_model);

            }).catch(err => console.error("Failed to fetch AI config", err));

            // Initial defaults from env-like behavior (only if empty)
            if (!ollamaUrl) setOllamaUrl('http://192.168.50.98:11434');
            if (!ollamaModel) setOllamaModel('llama-server');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSave = async () => {
        setIsSaving(true);
        setStatus(null);
        try {
            await voodooApi.setAIConfig({
                provider,
                gemini_key: geminiKey || undefined,
                ollama_url: ollamaUrl || undefined,
                ollama_model: ollamaModel || undefined,
                anthropic_key: anthropicKey || undefined,
                anthropic_model: anthropicModel || undefined,
                openai_key: openaiKey || undefined,
                openai_model: openaiModel || undefined,
                copilot_token: copilotToken || undefined,
                copilot_model: copilotModel || undefined,
            });
            await voodooApi.setAIMode(aiMode);
            setStatus({ type: 'success', message: 'Configuration Synchronized' });
            onConfigUpdated(provider);
            setTimeout(() => {
                setStatus(null);
            }, 3000);
        } catch (err) {
            setStatus({ type: 'error', message: String(err) });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-200 p-4">
            <div className="bg-security-surface border border-security-border rounded-xl shadow-2xl w-full max-w-xl animate-in zoom-in-95 duration-200 flex flex-col relative overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-security-border shrink-0">
                    <div>
                        <h2 className="text-xl font-black text-white uppercase tracking-tight flex items-center gap-2">
                            <Settings className="text-brand-500" size={20} />
                            Neural Core Configuration
                        </h2>
                        <p className="text-[10px] text-security-muted font-bold uppercase tracking-widest mt-1">
                            AI Provider & Intelligence Scaling
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
                <div className="p-6 space-y-8 overflow-y-auto custom-scrollbar">
                    {/* Provider Selection */}
                    <div>
                        <label className="text-[10px] text-security-muted font-black uppercase tracking-widest mb-4 block">
                            Intelligence Source
                        </label>
                        <div className="grid grid-cols-5 gap-2">
                            {/* Gemini */}
                            <button
                                onClick={() => setProvider('gemini')}
                                className={`flex-1 p-3 rounded-lg border-2 transition-all flex flex-col items-center justify-center gap-2 ${provider === 'gemini'
                                    ? 'bg-brand-500/10 border-brand-500 text-brand-500 shadow-[0_0_20px_rgba(59,130,246,0.1)]'
                                    : 'bg-security-panel border-security-border text-security-muted hover:border-security-muted'
                                    }`}
                            >
                                <Globe size={20} />
                                <div className="text-[8px] font-black uppercase tracking-widest text-center">Google Gemini</div>
                            </button>
                            {/* Ollama */}
                            <button
                                onClick={() => setProvider('ollama')}
                                className={`flex-1 p-3 rounded-lg border-2 transition-all flex flex-col items-center justify-center gap-2 ${provider === 'ollama'
                                    ? 'bg-brand-500/10 border-brand-500 text-brand-500 shadow-[0_0_20px_rgba(59,130,246,0.1)]'
                                    : 'bg-security-panel border-security-border text-security-muted hover:border-security-muted'
                                    }`}
                            >
                                <Cpu size={20} />
                                <div className="text-[8px] font-black uppercase tracking-widest text-center">Local Llama</div>
                            </button>
                            {/* Anthropic */}
                            <button
                                onClick={() => setProvider('anthropic')}
                                className={`flex-1 p-3 rounded-lg border-2 transition-all flex flex-col items-center justify-center gap-2 ${provider === 'anthropic'
                                    ? 'bg-purple-500/10 border-purple-500 text-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.1)]'
                                    : 'bg-security-panel border-security-border text-security-muted hover:border-security-muted'
                                    }`}
                            >
                                <Cpu size={20} />
                                <div className="text-[8px] font-black uppercase tracking-widest text-center">Anthropic</div>
                            </button>
                            {/* OpenAI */}
                            <button
                                onClick={() => setProvider('openai')}
                                className={`flex-1 p-3 rounded-lg border-2 transition-all flex flex-col items-center justify-center gap-2 ${provider === 'openai'
                                    ? 'bg-green-500/10 border-green-500 text-green-400 shadow-[0_0_20px_rgba(34,197,94,0.1)]'
                                    : 'bg-security-panel border-security-border text-security-muted hover:border-security-muted'
                                    }`}
                            >
                                <Cloud size={20} />
                                <div className="text-[8px] font-black uppercase tracking-widest text-center">OpenAI</div>
                            </button>
                            {/* Copilot */}
                            <button
                                onClick={() => setProvider('copilot')}
                                className={`flex-1 p-3 rounded-lg border-2 transition-all flex flex-col items-center justify-center gap-2 ${provider === 'copilot'
                                    ? 'bg-blue-500/10 border-blue-500 text-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.1)]'
                                    : 'bg-security-panel border-security-border text-security-muted hover:border-security-muted'
                                    }`}
                            >
                                <Key size={20} />
                                <div className="text-[8px] font-black uppercase tracking-widest text-center">Copilot</div>
                            </button>
                        </div>
                    </div>

                    {/* AI Strategy */}
                    <div>
                        <label className="text-[10px] text-security-muted font-black uppercase tracking-widest mb-4 block">
                            Analysis Strategy
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                            <button
                                onClick={() => setAiMode('hybrid')}
                                className={`p-4 rounded-lg border-2 transition-all flex flex-col items-center justify-center gap-2 ${aiMode === 'hybrid'
                                    ? 'bg-purple-500/10 border-purple-500 text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.1)]'
                                    : 'bg-security-panel border-security-border text-security-muted hover:border-security-muted'
                                    }`}
                            >
                                <Zap size={22} />
                                <div className="text-[10px] font-black uppercase tracking-widest">Hybrid</div>
                                <div className="text-[8px] opacity-60 font-medium text-center">Local Map → Cloud Reduce</div>
                            </button>
                            <button
                                onClick={() => setAiMode('local_only')}
                                className={`p-4 rounded-lg border-2 transition-all flex flex-col items-center justify-center gap-2 ${aiMode === 'local_only'
                                    ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
                                    : 'bg-security-panel border-security-border text-security-muted hover:border-security-muted'
                                    }`}
                            >
                                <Lock size={22} />
                                <div className="text-[10px] font-black uppercase tracking-widest">Local Only</div>
                                <div className="text-[8px] opacity-60 font-medium text-center">Air-Gapped / Zero Cost</div>
                            </button>
                            <button
                                onClick={() => setAiMode('cloud_only')}
                                className={`p-4 rounded-lg border-2 transition-all flex flex-col items-center justify-center gap-2 ${aiMode === 'cloud_only'
                                    ? 'bg-blue-500/10 border-blue-500 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.1)]'
                                    : 'bg-security-panel border-security-border text-security-muted hover:border-security-muted'
                                    }`}
                            >
                                <Cloud size={22} />
                                <div className="text-[10px] font-black uppercase tracking-widest">Cloud Only</div>
                                <div className="text-[8px] opacity-60 font-medium text-center">Full Gemini Power</div>
                            </button>
                        </div>
                    </div>

                    {/* Cloud Provider Config */}
                    {['anthropic', 'openai', 'copilot', 'gemini'].includes(provider) && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                            {provider === 'gemini' && (
                                <div>
                                    <label className="text-[10px] text-security-muted font-black uppercase tracking-widest mb-2 block flex items-center gap-2">
                                        <Key size={12} className="text-brand-500" />
                                        Gemini API Key
                                    </label>
                                    <div className="relative">
                                        <input
                                            type={showKey ? "text" : "password"}
                                            value={geminiKey}
                                            onChange={(e) => setGeminiKey(e.target.value)}
                                            placeholder="Enter your Gemini API key..."
                                            className="w-full bg-security-panel border border-security-border rounded-lg pl-4 pr-12 py-3 text-sm text-white focus:border-brand-500 transition-colors placeholder-security-muted font-mono"
                                        />
                                        <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-security-muted hover:text-white">
                                            {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {provider === 'anthropic' && (
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] text-security-muted font-black uppercase tracking-widest mb-2 block flex items-center gap-2">
                                            <Key size={12} className="text-purple-500" />
                                            Anthropic API Key
                                        </label>
                                        <div className="relative">
                                            <input
                                                type={showKey ? "text" : "password"}
                                                value={anthropicKey}
                                                onChange={(e) => setAnthropicKey(e.target.value)}
                                                placeholder="sk-ant-..."
                                                className="w-full bg-security-panel border border-security-border rounded-lg pl-4 pr-12 py-3 text-sm text-white focus:border-purple-500 transition-colors placeholder-security-muted font-mono"
                                            />
                                            <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-security-muted hover:text-white">
                                                {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-security-muted font-black uppercase tracking-widest mb-2 block flex items-center gap-2">
                                            <Cpu size={12} className="text-purple-500" />
                                            Model ID (Optional Override)
                                        </label>
                                        <input
                                            type="text"
                                            value={anthropicModel}
                                            onChange={(e) => setAnthropicModel(e.target.value)}
                                            placeholder="claude-3-5-sonnet-latest"
                                            className="w-full bg-security-panel border border-security-border rounded-lg px-4 py-3 text-sm text-white focus:border-purple-500 transition-colors font-mono"
                                        />
                                        <p className="text-[9px] text-zinc-500 mt-1 italic">
                                            Defaults to <code>claude-3-5-sonnet-latest</code>. Use specific IDs like <code>claude-3-7-sonnet-20250219</code> for newer models.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {provider === 'openai' && (
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] text-security-muted font-black uppercase tracking-widest mb-2 block flex items-center gap-2">
                                            <Key size={12} className="text-green-500" />
                                            OpenAI API Key
                                        </label>
                                        <div className="relative">
                                            <input
                                                type={showKey ? "text" : "password"}
                                                value={openaiKey}
                                                onChange={(e) => setOpenaiKey(e.target.value)}
                                                placeholder="sk-..."
                                                className="w-full bg-security-panel border border-security-border rounded-lg pl-4 pr-12 py-3 text-sm text-white focus:border-green-500 transition-colors placeholder-security-muted font-mono"
                                            />
                                            <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-security-muted hover:text-white">
                                                {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-security-muted font-black uppercase tracking-widest mb-2 block flex items-center gap-2">
                                            <Cpu size={12} className="text-green-500" />
                                            Model ID
                                        </label>
                                        <input
                                            type="text"
                                            value={openaiModel}
                                            onChange={(e) => setOpenaiModel(e.target.value)}
                                            placeholder="gpt-4o"
                                            className="w-full bg-security-panel border border-security-border rounded-lg px-4 py-3 text-sm text-white focus:border-green-500 transition-colors font-mono"
                                        />
                                    </div>
                                </div>
                            )}

                            {provider === 'copilot' && (
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] text-security-muted font-black uppercase tracking-widest mb-2 block flex items-center gap-2">
                                            <Key size={12} className="text-blue-500" />
                                            GitHub Copilot Token
                                        </label>
                                        <div className="relative">
                                            <input
                                                type={showKey ? "text" : "password"}
                                                value={copilotToken}
                                                onChange={(e) => setCopilotToken(e.target.value)}
                                                placeholder="ghu_..."
                                                className="w-full bg-security-panel border border-security-border rounded-lg pl-4 pr-12 py-3 text-sm text-white focus:border-blue-500 transition-colors placeholder-security-muted font-mono"
                                            />
                                            <button onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-security-muted hover:text-white">
                                                {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-security-muted font-black uppercase tracking-widest mb-2 block flex items-center gap-2">
                                            <Cpu size={12} className="text-blue-500" />
                                            Model ID
                                        </label>
                                        <input
                                            type="text"
                                            value={copilotModel}
                                            onChange={(e) => setCopilotModel(e.target.value)}
                                            placeholder="gpt-4"
                                            className="w-full bg-security-panel border border-security-border rounded-lg px-4 py-3 text-sm text-white focus:border-blue-500 transition-colors font-mono"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Ollama Config */}
                    {provider === 'ollama' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-2 duration-300">
                            <div className="space-y-2">
                                <label className="text-[10px] text-security-muted font-black uppercase tracking-widest block flex items-center gap-2">
                                    <Globe size={12} className="text-brand-500" />
                                    Host URL
                                </label>
                                <input
                                    type="text"
                                    value={ollamaUrl}
                                    onChange={(e) => setOllamaUrl(e.target.value)}
                                    placeholder="http://192.168.x.x:11434"
                                    className="w-full bg-security-panel border border-security-border rounded-lg px-4 py-3 text-sm text-white focus:border-brand-500 transition-colors font-mono"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] text-security-muted font-black uppercase tracking-widest block flex items-center gap-2">
                                    <Cpu size={12} className="text-brand-500" />
                                    Model Tag
                                </label>
                                <input
                                    type="text"
                                    value={ollamaModel}
                                    onChange={(e) => setOllamaModel(e.target.value)}
                                    placeholder="qwen2.5-coder:14b"
                                    className="w-full bg-security-panel border border-security-border rounded-lg px-4 py-3 text-sm text-white focus:border-brand-500 transition-colors font-mono"
                                />
                            </div>
                        </div>
                    )}

                    {status && (
                        <div className={`p-4 rounded-lg border animate-in fade-in zoom-in-95 duration-200 flex items-center gap-3 ${status.type === 'success'
                            ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400'
                            : 'bg-red-500/10 border-red-500/50 text-red-400'
                            }`}>
                            {status.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                            <span className="text-xs font-bold uppercase tracking-tight">{status.message}</span>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-security-border bg-security-bg/50 flex items-center justify-between gap-4">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 rounded-lg border border-security-border bg-security-panel text-xs text-white font-black uppercase tracking-widest hover:bg-security-surface transition-colors"
                    >
                        Close
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="btn-primary px-8 py-2.5 shadow-lg shadow-brand-500/20 flex items-center gap-2"
                    >
                        {isSaving ? (
                            <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                        ) : (
                            <Save size={16} strokeWidth={3} />
                        )}
                        <span className="font-black uppercase tracking-widest text-xs">Commit Changes</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
