import React from 'react';
import { Shield, ShieldAlert, Activity, Hash, Tag, Bug } from 'lucide-react';
import { VirusTotalData } from './voodooApi';

interface Props {
    data: VirusTotalData;
}

export default function VirusTotalCard({ data }: Props) {
    const isMalicious = data.malicious_votes > 0;
    const scoreColor = isMalicious ? 'text-red-500' : 'text-green-500';
    const borderColor = isMalicious ? 'border-red-500/30' : 'border-green-500/30';
    const bgColor = isMalicious ? 'bg-red-500/10' : 'bg-green-500/10';

    return (
        <div className={`rounded-xl border ${borderColor} ${bgColor} p-6 relative overflow-hidden group transition-all duration-300 hover:shadow-lg hover:shadow-red-900/10 uppercase`}>
            {/* Background Decor */}
            <div className="absolute -right-10 -top-10 opacity-5 group-hover:opacity-10 transition-opacity">
                <ShieldAlert size={150} />
            </div>

            <div className="flex flex-col md:flex-row gap-8 relative z-10">
                {/* Score Section */}
                <div className="flex flex-col items-center justify-center gap-2 min-w-[120px]">
                    <div className="relative w-24 h-24 flex items-center justify-center">
                        <div className="flex flex-col items-center justify-center border-4 border-black/30 rounded-full w-20 h-20">
                            <span className={`text-2xl font-black ${scoreColor}`}>{data.malicious_votes}</span>
                            <span className="text-[10px] text-zinc-500 font-bold">DETECTIONS</span>
                        </div>
                    </div>
                    <span className="text-[10px] font-bold tracking-widest text-zinc-400">VIRUSTOTAL SCORE</span>
                </div>

                {/* Details Section */}
                <div className="flex-1 space-y-4">
                    {/* Header */}
                    <div className="flex flex-col border-b border-white/5 pb-2">
                        <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-mono mb-1">
                            <Hash size={12} />
                            <span className="truncate max-w-[300px]">{data.hash}</span>
                        </div>
                        <h3 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
                            {data.threat_label || "Unknown Threat"}
                            {data.family_labels.length > 0 && (
                                <span className="px-2 py-0.5 rounded bg-red-500 text-white text-[10px] font-bold tracking-wider">
                                    {data.family_labels[0]}
                                </span>
                            )}
                        </h3>
                    </div>

                    {/* Metadata Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Family Labels */}
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-zinc-500">
                                <Bug size={12} />
                                Family Labels
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {data.family_labels.length > 0 ? data.family_labels.map((label, i) => (
                                    <span key={i} className="px-2 py-1 rounded bg-zinc-800 text-zinc-300 text-[10px] font-mono border border-white/5">
                                        {label}
                                    </span>
                                )) : <span className="text-zinc-600 text-[10px]">None identified</span>}
                            </div>
                        </div>

                        {/* Behavior Tags */}
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-zinc-500">
                                <Activity size={12} />
                                Sandbox Behaviors
                            </div>
                            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar">
                                {data.behavior_tags.length > 0 ? data.behavior_tags.slice(0, 15).map((label, i) => (
                                    <span key={i} className="px-2 py-1 rounded bg-blue-900/20 text-blue-300 border border-blue-500/20 text-[10px] font-mono whitespace-nowrap">
                                        {label}
                                    </span>
                                )) : <span className="text-zinc-600 text-[10px]">No behavioral tags</span>}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="absolute bottom-2 right-4 text-[9px] text-zinc-600 font-mono">
                Scanned: {new Date(data.scanned_at).toLocaleString()}
            </div>
        </div>
    );
}
