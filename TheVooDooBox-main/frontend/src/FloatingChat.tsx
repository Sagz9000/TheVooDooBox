import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, X, Bot, Sparkles, Copy, Check, Terminal, ChevronDown } from 'lucide-react';
import { voodooApi } from './voodooApi';

const CodeBlock = ({ language, code }: { language: string, code: string }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="my-2 rounded-lg overflow-hidden border border-security-border bg-[#0d1117]">
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-security-border">
                <span className="text-xs text-slate-400 font-mono">{language || 'text'}</span>
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
                >
                    {copied ? <Check size={12} className="text-voodoo-toxic-green" /> : <Copy size={12} />}
                    {copied ? 'Copied!' : 'Copy'}
                </button>
            </div>
            <pre className="p-3 overflow-x-auto text-xs font-mono text-slate-300 leading-relaxed select-text cursor-text">
                <code>{code}</code>
            </pre>
        </div>
    );
};

const ThinkingBubble = ({ thought }: { thought: string }) => {
    return (
        <div className="flex justify-start mb-4 animate-in fade-in slide-in-from-left-2 duration-300">
            <div className="bg-security-panel/40 border border-brand-500/20 rounded-xl rounded-bl-none overflow-hidden max-w-[90%] shadow-lg shadow-brand-500/5">
                <div className="px-3 py-1.5 bg-brand-500/10 border-b border-brand-500/10 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Terminal size={10} className="text-brand-500" />
                        <span className="text-[8px] text-brand-500 uppercase font-black tracking-widest">Neural Chain-of-Thought</span>
                    </div>
                </div>
                <div className="p-3">
                    <div className="text-[10px] font-mono text-slate-500 leading-relaxed italic whitespace-pre-wrap">
                        {thought}
                    </div>
                </div>
            </div>
        </div>
    );
};

const FormattedMessage = ({ content }: { content: string }) => {
    const parts = content.split(/```(\w*)\n([\s\S]*?)```/g);

    if (parts.length === 1) {
        return <p className="whitespace-pre-wrap select-text cursor-text">{content}</p>;
    }

    const elements = [];
    for (let i = 0; i < parts.length; i += 3) {
        const text = parts[i];
        const lang = parts[i + 1];
        const code = parts[i + 2];

        if (text) {
            elements.push(<p key={`text-${i}`} className="whitespace-pre-wrap mb-2 select-text cursor-text">{text}</p>);
        }
        if (code !== undefined) {
            elements.push(<CodeBlock key={`code-${i}`} language={lang} code={code} />);
        }
    }

    return <div className="select-text cursor-text" style={{ userSelect: 'text' }}>{elements}</div>;
};

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    thought?: string;
}

const FloatingChat = ({ activeTaskId, pageContext, activeProvider }: { activeTaskId?: string | null, pageContext?: string, activeProvider?: string | null }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        {
            id: '1',
            role: 'assistant',
            content: "I am the VooDooBox Intelligence Core. How can I assist with your malware investigation today?",
            timestamp: Date.now()
        }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [thinkingText, setThinkingText] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Draggable state
    const [position, setPosition] = useState({ x: window.innerWidth - 80, y: window.innerHeight - 80 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    // Resize state
    const [size, setSize] = useState({ width: Math.min(450, window.innerWidth - 40), height: Math.min(600, window.innerHeight - 150) });
    const [isResizing, setIsResizing] = useState(false);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                setPosition({
                    x: e.clientX - dragOffset.x,
                    y: e.clientY - dragOffset.y
                });
            } else if (isResizing) {
                setSize({
                    width: Math.max(300, e.clientX - position.x),
                    height: Math.max(300, e.clientY - position.y)
                });
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            setIsResizing(false);
            document.body.style.userSelect = '';
        };

        if (isDragging || isResizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            document.body.style.userSelect = 'none';
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            document.body.style.userSelect = '';
        };
    }, [isDragging, dragOffset, isResizing, position]);

    const handleMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button') && !(e.target as HTMLElement).closest('.bubble-toggle')) {
            if (!(e.target as HTMLElement).closest('.drag-handle')) return;
        }

        setIsDragging(true);
        setDragOffset({
            x: e.clientX - position.x,
            y: e.clientY - position.y
        });
    };

    const handleResizeStart = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsResizing(true);
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        const resetPosition = () => {
            if (!isOpen) {
                setPosition({
                    x: window.innerWidth - 80,
                    y: window.innerHeight - 80
                });
            } else {
                // Adjust for viewport overflow
                const targetX = Math.min(window.innerWidth - size.width - 20, Math.max(20, position.x));
                const targetY = Math.min(window.innerHeight - size.height - 20, Math.max(20, position.y));

                if (targetX !== position.x || targetY !== position.y) {
                    setPosition({ x: targetX, y: targetY });
                }
            }
        };

        resetPosition();
        window.addEventListener('resize', resetPosition);
        return () => window.removeEventListener('resize', resetPosition);
    }, [isOpen, size.width, size.height]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input,
            timestamp: Date.now()
        };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);
        setThinkingText(null);

        // Add placeholder for AI response
        setMessages(prev => [...prev, { id: 'typing', role: 'assistant', content: '', timestamp: Date.now() }]);

        try {
            const data = await voodooApi.chat(
                input,
                messages.map(m => ({ role: m.role, content: m.content })),
                activeTaskId || undefined,
                pageContext,
                (thought) => {
                    setThinkingText(thought);
                    setMessages(prev => {
                        const lastMsg = prev[prev.length - 1];
                        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.id === 'typing') {
                            return [...prev.slice(0, -1), { ...lastMsg, thought }];
                        }
                        return prev;
                    });
                }
            );

            setMessages(prev => [...prev.filter(m => m.id !== 'typing'), {
                id: Date.now().toString(),
                role: 'assistant',
                content: data.response,
                timestamp: Date.now(),
                thought: thinkingText || undefined
            }]);
        } catch (error: any) {
            const errorMsg = error.message || 'AI Core offline';
            setMessages(prev => [...prev.filter(m => m.id !== 'typing'), { id: Date.now().toString(), role: 'assistant', content: `⚠️ Neural Sync Error: ${errorMsg}`, timestamp: Date.now() }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div
            className="fixed z-[100] flex flex-col items-end"
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                pointerEvents: 'none'
            }}
        >
            {isOpen && (
                <div
                    className="mb-4 bg-security-panel border border-security-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200 backdrop-blur-sm shadow-brand-500/10 relative"
                    style={{
                        pointerEvents: 'auto',
                        width: `${size.width}px`,
                        height: `${size.height}px`
                    }}
                >
                    <div
                        onMouseDown={handleMouseDown}
                        className="p-4 bg-security-surface/90 border-b border-security-border flex items-center justify-between cursor-move drag-handle select-none"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center border border-brand-500/30">
                                <Bot size={18} className="text-brand-500" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-white leading-none">Voodoo Assistant</h3>
                                <span className="text-[10px] text-brand-400 font-bold uppercase tracking-widest flex items-center gap-1 mt-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-voodoo-toxic-green animate-pulse"></span>
                                    AI Insight Active {activeProvider && `[${activeProvider}]`}
                                </span>
                            </div>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-security-muted hover:text-white transition-colors p-1">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar bg-black/20">
                        {messages.map((m, i) => (
                            <React.Fragment key={i}>
                                {m.thought && <ThinkingBubble thought={m.thought} />}
                                <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[90%] p-3.5 rounded-xl text-sm leading-relaxed shadow-sm ${m.role === 'user'
                                        ? 'bg-brand-600 text-white rounded-br-none'
                                        : 'bg-security-surface border border-security-border text-slate-200 rounded-bl-none'
                                        }`}>
                                        <FormattedMessage content={m.content} />
                                    </div>
                                </div>
                            </React.Fragment>
                        ))}
                        {isLoading && (
                            <div className="flex justify-start animate-pulse">
                                <div className="bg-security-surface border border-security-border px-4 py-3 rounded-xl rounded-bl-none flex items-center gap-3">
                                    <div className="flex gap-1">
                                        <div className="w-2 h-2 bg-brand-500 rounded-full animate-bounce"></div>
                                        <div className="w-2 h-2 bg-brand-500 rounded-full animate-bounce delay-75"></div>
                                        <div className="w-2 h-2 bg-brand-500 rounded-full animate-bounce delay-150"></div>
                                    </div>
                                    <span className="text-xs text-brand-400 font-mono tracking-wide">
                                        {thinkingText || "Processing..."}
                                    </span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    <div className="p-4 bg-security-surface border-t border-security-border">
                        <div className="relative">
                            <input
                                className="w-full bg-security-bg border border-security-border rounded-lg pl-4 pr-12 py-3 text-sm text-white placeholder-security-muted outline-none focus:border-brand-500 transition-all font-medium focus:ring-1 focus:ring-brand-500/50"
                                placeholder="Ask about threats or files..."
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                                disabled={isLoading}
                            />
                            <button
                                onClick={handleSend}
                                disabled={isLoading || !input.trim()}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-brand-500 text-white rounded-md hover:bg-brand-600 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Send size={16} />
                            </button>
                        </div>
                    </div>

                    <div
                        onMouseDown={handleResizeStart}
                        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end p-0.5 opacity-50 hover:opacity-100"
                    >
                        <svg width="6" height="6" viewBox="0 0 6 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M6 6H0L6 0V6Z" fill="#3b82f6" />
                        </svg>
                    </div>
                </div>
            )}

            <button
                onMouseDown={handleMouseDown}
                onClick={() => !isDragging && setIsOpen(!isOpen)}
                style={{ pointerEvents: 'auto' }}
                className={`w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 transform hover:scale-105 active:scale-95 cursor-move bubble-toggle ${isOpen ? 'bg-security-surface border border-security-border rotate-90' : 'bg-brand-600 hover:bg-brand-500 ring-2 ring-brand-500/30 shadow-brand-500/20'
                    }`}
            >
                {isOpen ? <X size={24} className="text-white" /> : <Sparkles size={24} className="text-white fill-white/20" />}
            </button>
        </div>
    );
}

export default FloatingChat;
