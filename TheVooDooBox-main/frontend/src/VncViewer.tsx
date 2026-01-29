import { useRef, useEffect, useState } from 'react';
import RFB from '@novnc/novnc/core/rfb';
import { Loader2, MonitorOff, ShieldAlert } from 'lucide-react';
import { BASE_URL } from './voodooApi';

interface VncViewerProps {
    vncTarget: { node: string, vmid: number };
}

export default function VncViewer({ vncTarget }: VncViewerProps) {
    const { node, vmid } = vncTarget;
    const containerRef = useRef<HTMLDivElement>(null);
    const rfbRef = useRef<RFB | null>(null);
    const connectionStarted = useRef(false);
    const [status, setStatus] = useState("Initializing...");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (connectionStarted.current) return;
        connectionStarted.current = true;

        const connect = async () => {
            try {
                setStatus("Ticket Requested");
                const resp = await fetch(`${BASE_URL}/vms/${node}/${vmid}/vnc`, { method: 'POST' });

                if (!resp.ok) {
                    const errorBody = await resp.json().catch(() => ({}));
                    const msg = errorBody.error || errorBody.message || resp.statusText;
                    throw new Error(`Connection Rejected: ${msg}`);
                }

                const data = await resp.json();
                const ticket = data.ticket;
                const port = data.port;
                const password = data.password || ticket;
                const proxmoxHost = data.host;

                setStatus(`Tunnel Open (Port ${port})`);

                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                // Connect to Backend Relay (which proxies to Proxmox)
                // We pass the ticket as a query param so the backend can accept it (if needed for logging)
                // but primarily so the BACKEND can construct the upstream URL with it.
                // The backend relay does NOT inspect the RFB protocol, but passing it here keeps it consistent.
                const url = `${protocol}//${window.location.host}/vms/${node}/${vmid}/vnc-ws?port=${port}&ticket=${encodeURIComponent(ticket)}&host=${encodeURIComponent(proxmoxHost)}`;

                if (containerRef.current) {
                    const rfb = new RFB(containerRef.current, url, {
                        credentials: { password }
                    });

                    rfb.scaleViewport = true;
                    rfb.resizeSession = true;

                    rfb.addEventListener("connect", () => setStatus("Connected"));
                    rfb.addEventListener("disconnect", () => setStatus("Disconnected"));
                    rfb.addEventListener("credentialsrequired", () => setStatus("Auth Required"));

                    rfbRef.current = rfb;
                }

            } catch (err: any) {
                console.error("[VNC] Error:", err);
                setError(err.message);
                setStatus("Error");
            }
        };

        connect();

        return () => {
            if (rfbRef.current) rfbRef.current.disconnect();
            connectionStarted.current = false;
        }
    }, [node, vmid]);

    return (
        <div className="w-full h-full bg-black relative flex items-center justify-center overflow-hidden" ref={containerRef}>
            {error && (
                <div className="text-center p-8 bg-security-surface border border-threat-critical/20 rounded-2xl shadow-2xl animate-in zoom-in-95 duration-300 max-w-md">
                    <ShieldAlert className="w-16 h-16 text-threat-critical mx-auto mb-4 opacity-80" />
                    <h3 className="text-white font-bold text-lg mb-2">Bridge Link Failure</h3>
                    <p className="text-slate-500 text-xs leading-relaxed uppercase tracking-widest">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-6 px-4 py-2 bg-threat-critical text-white rounded font-bold text-[10px] uppercase"
                    >
                        Try Reconnect
                    </button>
                </div>
            )}

            {!error && status !== "Connected" && (
                <div className="text-center">
                    <Loader2 className="w-12 h-12 text-brand-500 animate-spin mx-auto mb-6 opacity-80" />
                    <div className="text-white text-lg font-black tracking-tighter uppercase mb-1">Engaging Target: Node-{vmid}</div>
                    <div className="text-brand-400/60 text-[10px] uppercase font-bold tracking-[0.3em]">{status}</div>
                </div>
            )}

            {status === "Disconnected" && !error && (
                <div className="absolute inset-0 bg-security-bg/80 backdrop-blur-sm flex flex-col items-center justify-center z-10 transition-all">
                    <MonitorOff className="w-16 h-16 text-slate-700 mb-4" />
                    <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Target Session Terminated</p>
                </div>
            )}
        </div>
    );
}
