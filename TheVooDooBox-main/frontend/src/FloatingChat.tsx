import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, X, Bot, Sparkles, Copy, Check } from 'lucide-react';
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
                    {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                    {copied ? 'Copied!' : 'Copy'}
                </button>
            </div>
            <pre className="p-3 overflow-x-auto text-xs font-mono text-slate-300 leading-relaxed select-text cursor-text">
                <code>{code}</code>
            </pre>
        </div>
    );
};

const FormattedMessage = ({ content }: { content: string }) => {
    // Regex to split by code blocks: ```language\ncode```
    // Captures: [pre-text, language, code, post-text...]
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

export default function FloatingChat({ activeTaskId, pageContext }: { activeTaskId?: string | null, pageContext?: string }) {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<{ role: 'user' | 'assistant', content: string }[]>([
        { role: 'assistant', content: 'Hello! I am your VOODOOBOX Analyst Assistant. I can investigate samples, query the knowledge base, and help you inspect telemetry.' }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Draggable state
    const [position, setPosition] = useState({ x: window.innerWidth - 100, y: window.innerHeight - 100 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    // Resize state
    const [size, setSize] = useState({ width: 450, height: 600 });
    const [isResizing, setIsResizing] = useState(false);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                setPosition({
                    x: e.clientX - dragOffset.x,
                    y: e.clientY - dragOffset.y
                });
            } else if (isResizing) {
                // Resize logic (bottom-left corner resize since it's anchored bottom-right)
                // Since the window is absolutely positioned by its top-left corner (but logically acts as bottom-right anchored contextually),
                // we simplified the drag logic to just top/left position.
                // Let's implement standard resizing.

                // Calculate new dimensions
                const newWidth = Math.max(300, e.clientX - position.x + size.width);
                // Wait, position is top-left.
                // If we resize from bottom-right (standard handle):
                // newWidth = e.clientX - position.x
                // newHeight = e.clientY - position.y

                // But the user requested "bottom-left" handle or standard? 
                // Usually chat bubbles are bottom-right of screen.
                // Our position state is standard (left/top). 

                setSize({
                    width: Math.max(300, e.clientX - position.x),
                    height: Math.max(400, e.clientY - position.y)
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

    // Handle snap-back and window resize
    useEffect(() => {
        const resetPosition = () => {
            if (!isOpen) {
                setPosition({
                    x: window.innerWidth - 80,
                    y: window.innerHeight - 80
                });
            } else {
                setPosition({
                    x: window.innerWidth - size.width - 40,
                    y: window.innerHeight - size.height - 100
                });
            }
        };

        resetPosition();
        window.addEventListener('resize', resetPosition);
        return () => window.removeEventListener('resize', resetPosition);
    }, [isOpen, size.width, size.height]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg = { role: 'user' as const, content: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);

        try {
            const data = await voodooApi.chat(
                userMsg.content,
                messages.map(m => ({ role: m.role, content: m.content })),
                activeTaskId || undefined,
                pageContext
            );

            setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
        } catch (error) {
            setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Error connecting to AI Agent. Please ensure the backend is running.' }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div
            className="fixed z-50 flex flex-col items-end"
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                // We removed the transform translate to make resizing math simpler. 
                // The position now represents the top-left corner of the chat window wrapper.
                pointerEvents: 'none'
            }}
        >
            {/* Chat Window */}
            {isOpen && (
                <div
                    className="mb-4 bg-security-panel border border-security-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200 backdrop-blur-sm shadow-brand-500/10 relative"
                    style={{
                        pointerEvents: 'auto',
                        width: `${size.width}px`,
                        height: `${size.height}px`
                    }}
                >
                    {/* Header (Drag Handle) */}
                    <div
                        onMouseDown={handleMouseDown}
                        className="p-4 bg-security-surface/90 border-b border-security-border flex items-center justify-between cursor-move drag-handle select-none"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center border border-brand-500/30">
                                <Bot size={18} className="text-brand-500" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-white leading-none">Analyst Assistant</h3>
                                <span className="text-[10px] text-brand-400 font-bold uppercase tracking-widest flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse"></span>
                                    VooDooBox Core
                                </span>
                            </div>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-security-muted hover:text-white transition-colors">
                            <X size={18} />
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar bg-black/20">
                        {messages.map((m, i) => (
                            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[90%] p-3.5 rounded-xl text-sm leading-relaxed shadow-sm ${m.role === 'user'
                                    ? 'bg-brand-600 text-white rounded-br-none'
                                    : 'bg-security-surface border border-security-border text-slate-200 rounded-bl-none'
                                    }`}>
                                    <FormattedMessage content={m.content} />
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="bg-security-surface border border-security-border px-4 py-3 rounded-xl rounded-bl-none flex items-center gap-2">
                                    <div className="w-2 h-2 bg-brand-500 rounded-full animate-bounce"></div>
                                    <div className="w-2 h-2 bg-brand-500 rounded-full animate-bounce delay-75"></div>
                                    <div className="w-2 h-2 bg-brand-500 rounded-full animate-bounce delay-150"></div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="p-4 bg-security-surface border-t border-security-border">
                        <div className="relative">
                            <input
                                className="w-full bg-security-bg border border-security-border rounded-lg pl-4 pr-12 py-3 text-sm text-white placeholder-security-muted outline-none focus:border-brand-500 transition-all font-medium focus:ring-1 focus:ring-brand-500/50"
                                placeholder="Ask about threats, processes, or logs..."
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

                    {/* Resize Handle */}
                    <div
                        onMouseDown={handleResizeStart}
                        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end p-0.5 opacity-50 hover:opacity-100"
                    >
                        <svg width="6" height="6" viewBox="0 0 6 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M6 6H0L6 0V6Z" fill="#475569" />
                        </svg>
                    </div>
                </div>
            )}

            {/* Bubble Toggle */}
            <button
                onMouseDown={handleMouseDown}
                onClick={() => !isDragging && setIsOpen(!isOpen)}
                style={{ pointerEvents: 'auto' }}
                className={`w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 transform hover:scale-105 active:scale-95 cursor-move bubble-toggle ${isOpen ? 'bg-security-surface border border-security-border rotate-90' : 'bg-brand-600 hover:bg-brand-500 ring-2 ring-brand-500/30'
                    }`}
            >
                {isOpen ? <X size={24} className="text-white" /> : <Sparkles size={24} className="text-white fill-white/20" />}
            </button>
        </div>
    );
}
