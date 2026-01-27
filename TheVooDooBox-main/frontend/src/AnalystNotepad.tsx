import { useState, useEffect } from 'react';
import { voodooApi, Note } from './voodooApi';
import { Pencil, Send, Lightbulb, Clock } from 'lucide-react';

interface Props {
    taskId?: string;
    onNoteAdded?: () => void;
}

export default function AnalystNotepad({ taskId, onNoteAdded }: Props) {
    const [notes, setNotes] = useState<Note[]>([]);
    const [content, setContent] = useState('');
    const [isHint, setIsHint] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (taskId) {
            loadNotes();
        }
    }, [taskId]);

    const loadNotes = async () => {
        if (!taskId) return;
        try {
            const data = await voodooApi.getNotes(taskId);
            setNotes(data);
        } catch (e) {
            console.error(e);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!taskId || !content.trim()) return;

        setLoading(true);
        try {
            await voodooApi.addNote(taskId, content, isHint);
            setContent('');
            setIsHint(false);
            loadNotes();
            if (onNoteAdded) onNoteAdded();
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    if (!taskId) return <div className="p-4 text-slate-500 text-xs text-center">Select a task to view notes.</div>;

    return (
        <div className="flex flex-col h-full bg-slate-900 border-l border-white/5">
            <div className="p-3 border-b border-white/5 flex items-center gap-2 bg-slate-950">
                <Pencil size={14} className="text-brand-400" />
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Field Notes</span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                {notes.length === 0 ? (
                    <div className="text-center py-8 opacity-30">
                        <Pencil size={24} className="mx-auto mb-2" />
                        <p className="text-[10px] uppercase tracking-widest">No notes recorded</p>
                    </div>
                ) : (
                    notes.map((note) => (
                        <div key={note.id} className={`p-3 rounded-lg border text-sm ${note.is_hint ? 'bg-amber-500/10 border-amber-500/30' : 'bg-slate-800 border-white/5'}`}>
                            <div className="flex items-center justify-between mb-2">
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${note.is_hint ? 'text-amber-400' : 'text-slate-400'}`}>
                                    {note.is_hint ? <><Lightbulb size={10} className="inline mr-1" /> Hint</> : note.author}
                                </span>
                                <div className="flex items-center gap-1 text-[9px] text-slate-500 font-mono">
                                    <Clock size={10} />
                                    {new Date(note.created_at * 1000).toLocaleString()}
                                </div>
                            </div>
                            <p className="text-slate-300 whitespace-pre-wrap font-mono text-xs">{note.content}</p>
                        </div>
                    ))
                )}
            </div>

            <form onSubmit={handleSubmit} className="p-3 border-t border-white/5 bg-slate-950">
                <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Enter observations..."
                    className="w-full bg-slate-900 border border-white/10 rounded p-2 text-xs text-slate-300 focus:border-brand-500 outline-none resize-none h-20 mb-2 font-mono scrollbar-thin"
                />
                <div className="flex items-center justify-between">
                    <button
                        type="button"
                        onClick={() => setIsHint(!isHint)}
                        className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors ${isHint ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                        <Lightbulb size={12} />
                        {isHint ? 'AI Hint Active' : 'Mark as AI Hint'}
                    </button>
                    <button
                        type="submit"
                        disabled={loading || !content.trim()}
                        className="btn-primary py-1 px-3 text-[10px] flex items-center gap-2"
                    >
                        {loading ? 'Saving...' : <><Send size={12} /> Add Note</>}
                    </button>
                </div>
            </form>
        </div>
    );
}
