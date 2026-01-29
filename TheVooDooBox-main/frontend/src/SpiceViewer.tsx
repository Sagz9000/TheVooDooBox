import React, { useEffect, useRef, useState } from 'react';
// @ts-ignore
import { SpiceMainConn } from '@spice-project/spice-html5';
import { Loader2, MonitorOff, ShieldAlert, Monitor, Wifi } from 'lucide-react';
import { BASE_URL } from './voodooApi';

interface SpiceViewerProps {
    node: string;
    vmid: number;
    onClose?: () => void;
}

declare global {
    interface Window {
        SpiceMainConn: any;
    }
}

export default function SpiceViewer({ node, vmid, onClose }: SpiceViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<string>('Initializing...');
    const [error, setError] = useState<string | null>(null);
    const connectionStarted = useRef(false);

    useEffect(() => {
        if (connectionStarted.current) return;

        let spiceConn: any = null;

        const init = async () => {
            connectionStarted.current = true;
            try {
                setStatus('Handshaking Protocol...');
                const response = await fetch(`${BASE_URL}/vms/${node}/${vmid}/spice`, {
                    method: 'POST'
                });

                if (!response.ok) throw new Error('Infrastructure Handshake Failed');
                const ticket = await response.json();

                spiceConn = connectToSpice(ticket);
            } catch (e: any) {
                setError(e.message);
                setStatus('Fault');
                connectionStarted.current = false;
            }
        };

        const connectToSpice = (ticket: any) => {
            if (!containerRef.current) return null;

            try {
                const protocol = BASE_URL.startsWith('https') ? 'wss:' : 'ws:';
                const hostUrl = BASE_URL.replace(/^https?:\/\//, '');
                const wsUrl = `${protocol}//${hostUrl}/vms/${node}/${vmid}/spice-ws?host=${encodeURIComponent(ticket.host)}`;

                console.log('[SPICE] Creating connection to:', wsUrl);

                const sc = new SpiceMainConn({
                    uri: wsUrl,
                    screen_id: 'spice-screen',
                    dump_id: 'spice-debug',
                    message_id: 'spice-message',
                    password: ticket.password,
                    onerror: (e: any) => {
                        console.error('[SPICE] Error:', e);
                        setStatus((prev: string) => {
                            if (prev === 'Active') return prev;
                            setError('Link error: ' + (e?.message || 'Handshake Interrupted'));
                            return 'Disconnected';
                        });
                    },
                    onsuccess: () => {
                        console.log('[SPICE] Connection successful');
                        setStatus('Active');
                        setError(null);
                    }
                });

                return sc;
            } catch (e: any) {
                console.error('[SPICE] Connection error:', e);
                setError(e.message);
                setStatus('Fault');
                return null;
            }
        };

        init();

        return () => {
            console.log('[SPICE] Cleanup - stopping connection');
            if (spiceConn) {
                try {
                    spiceConn.stop();
                } catch (e) {
                    console.error('[SPICE] Error during cleanup:', e);
                }
            }
            connectionStarted.current = false;
        };
    }, [node, vmid]);

    const [isDesktopActive, setIsDesktopActive] = useState(false);

    useEffect(() => {
        const monitor = setInterval(() => {
            const canvas = document.querySelector('#spice-screen canvas') as HTMLCanvasElement;
            if (canvas) {
                if (!isDesktopActive) setIsDesktopActive(true);
                canvas.style.maxWidth = '100%';
                canvas.style.maxHeight = '100%';
                canvas.style.width = 'auto';
                canvas.style.height = 'auto';
                canvas.style.objectFit = 'contain';
                canvas.style.display = 'block';
            }
        }, 1000);
        return () => clearInterval(monitor);
    }, [isDesktopActive]);

    return (
        <div className="w-full h-full bg-[#000000] relative flex items-center justify-center overflow-hidden">
            <style dangerouslySetInnerHTML={{
                __html: `
                #spice-screen {
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    width: 100% !important;
                    height: 100% !important;
                    background: #000;
                    margin: 0 auto;
                    overflow: hidden !important;
                }
                #spice-screen canvas {
                    max-width: 100% !important;
                    max-height: 100% !important;
                    width: auto !important;
                    height: auto !important;
                    object-fit: contain !important;
                    box-shadow: 0 0 100px rgba(59, 130, 246, 0.05);
                }
            `}} />

            {/* Connection Diagnostics Overlay */}
            {!isDesktopActive && !error && (
                <div className="absolute inset-0 z-40 bg-security-bg flex flex-col items-center justify-center p-6 space-y-6">
                    <div className="relative">
                        <Monitor size={64} className="text-brand-500/20" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="w-12 h-12 text-brand-500 animate-spin" />
                        </div>
                    </div>
                    <div className="text-center space-y-2">
                        <h3 className="text-white font-black text-xl tracking-tighter uppercase">Initializing Remote Buffer</h3>
                        <div className="flex items-center justify-center gap-3">
                            <span className="flex items-center gap-1.5 text-[10px] font-bold text-brand-500 uppercase tracking-widest bg-brand-500/10 px-2 py-0.5 rounded border border-brand-500/20">
                                <Wifi size={10} strokeWidth={3} /> {status}
                            </span>
                            <span className="text-[10px] font-bold text-security-muted">NODE::{node.toUpperCase()}</span>
                        </div>
                    </div>
                </div>
            )}

            {error && (
                <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-security-bg/95 backdrop-blur-sm">
                    <div className="text-center p-10 bg-security-surface border border-threat-critical rounded shadow-2xl max-w-sm animate-in zoom-in-95 duration-300">
                        <ShieldAlert className="w-16 h-16 text-threat-critical mx-auto mb-6" />
                        <h3 className="text-white font-bold text-xl mb-2 tracking-tight uppercase">Protocol Fault</h3>
                        <p className="text-security-muted text-[11px] leading-relaxed uppercase tracking-wider mb-8">{error}</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="w-full bg-threat-critical hover:bg-red-500 text-white py-3 rounded font-black text-[11px] uppercase tracking-widest transition-all shadow-lg"
                        >
                            Reconnect Stream
                        </button>
                    </div>
                </div>
            )}

            <div
                ref={containerRef}
                className="w-full h-full flex items-center justify-center relative z-10"
            >
                <div id="spice-screen"></div>
                <div id="spice-message" className="hidden"></div>
                <div id="spice-debug" className="hidden"></div>
            </div>

            {/* Subtle Overlay Status */}
            {isDesktopActive && (
                <div className="absolute bottom-4 left-4 z-20 pointer-events-none flex items-center gap-3">
                    <div className="flex items-center gap-2 px-2 py-1 bg-black/60 backdrop-blur-md border border-white/5 rounded text-[9px] font-bold text-brand-500 shadow-2xl">
                        <div className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-pulse"></div>
                        LINK::SECURE
                    </div>
                    <div className="px-2 py-1 bg-black/60 backdrop-blur-md border border-white/5 rounded text-[9px] font-bold text-security-muted shadow-2xl">
                        {node.toUpperCase()}[{vmid}]
                    </div>
                </div>
            )}
        </div>
    );
}
