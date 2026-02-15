import React, { useState, useMemo, useEffect } from 'react';

import {
    RefreshCw,
    Activity,
    Shield,
    Trash2,
    FileText,
    Play,
    Monitor,
    ChevronRight,
    ChevronDown,
    RefreshCcw,
    Brain,
    Clock,
    Search
} from 'lucide-react';
import { voodooApi, AgentEvent, BASE_URL, TaskProgressEvent, ForensicReport } from './voodooApi';
import GhidraConsole from './GhidraConsole';
import ProcessLineage from './ProcessLineage';
// ...

export default function TaskDashboard({ onSelectTask, onOpenSubmission, onOpenLineage }: {
    onSelectTask: (taskId: string) => void,
    onOpenSubmission: () => void,
    onOpenLineage: (taskId: string) => void
}) {
    // ...

    {
        expandedTab === 'fishbone' && (
            <div className="h-[400px]">
                <ProcessLineage
                    events={expandedEvents}
                    mitreData={(() => {
                        if (!aiReport || !aiReport.mitre_matrix) return undefined;
                        const map = new Map<number, string[]>();
                        Object.values(aiReport.mitre_matrix).flat().forEach((tech: any) => {
                            if (tech.evidence) {
                                tech.evidence.forEach((ev: string) => {
                                    const match = ev.match(/PID[:\s]+(\d+)/i);
                                    if (match && match[1]) {
                                        const pid = parseInt(match[1]);
                                        const existing = map.get(pid) || [];
                                        if (!existing.includes(tech.id)) existing.push(tech.id);
                                        map.set(pid, existing);
                                    }
                                });
                            }
                        });
                        return map;
                    })()}
                    onMaximize={() => onOpenLineage(task.id)}
                />
            </div>
        )
    }


    {
        expandedTab === 'screenshots' && (
            <div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {expandedScreenshots.length > 0 ? expandedScreenshots.map((filename, idx) => (
                        <div key={idx} className="group relative aspect-video bg-black border border-white/10 rounded overflow-hidden cursor-pointer hover:border-brand-500/50 transition-all">
                            <img
                                src={voodooApi.getScreenshotUrl(filename, task.id)}
                                alt={`Screenshot ${idx}`}
                                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                                onError={(e) => {
                                    // Fallback: try without task ID if nested fails, or vice versa? 
                                    // For now, just logging. A robust app might try an alternative path.
                                    console.warn(`Failed to load screenshot: ${filename}`);
                                    e.currentTarget.style.display = 'none';
                                    e.currentTarget.parentElement!.innerText = 'Image Load Error';
                                }}
                            />
                            <div className="absolute bottom-0 left-0 right-0 bg-black/80 p-1 text-[9px] font-mono text-center text-zinc-400 truncate">
                                {filename}
                            </div>
                        </div>
                    )) : (
                        <div className="col-span-full h-32 flex items-center justify-center text-zinc-600 border border-white/5 border-dashed rounded">
                            <span className="text-[10px] uppercase font-black tracking-widest">No Screenshots Available</span>
                        </div>
                    )}
                </div>
            </div>
        )
    }

                                                    </div >
                                                </div >
                                            )
}
                                        </React.Fragment >
                                    );
                                })}
{
    tasks.length === 0 && (
        <div className="p-12 text-center">
            <FileText className="mx-auto text-security-muted mb-4 opacity-50" size={48} />
            <p className="text-security-muted font-bold">No analysis tasks found.</p>
            <p className="text-xs text-security-muted/50 mt-2">Submit a sample to begin.</p>
        </div>
    )
}
                        </div >
                    </div >
                </div >
            </div >

    {/* Ghidra Fly-out Panel - Responsive Width */ }
{
    activeGhidraTask && (
        <div className="fixed inset-y-0 right-0 w-full sm:w-2/3 lg:w-[800px] z-[60] bg-[#0D1117] border-l border-security-border shadow-[0_0_50px_rgba(0,0,0,0.5)] animate-in slide-in-from-right duration-300">
            <GhidraConsole
                taskId={activeGhidraTask.id}
                filename={activeGhidraTask.filename}
                onClose={() => setActiveGhidraTask(null)}
            />
        </div>
    )
}
        </div >
    );
}
