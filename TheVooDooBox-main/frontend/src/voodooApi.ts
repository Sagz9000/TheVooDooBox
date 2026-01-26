export interface AgentEvent {
    id?: number;
    event_type: string;
    process_id: number;
    parent_process_id: number;
    process_name: string;
    details: string;
    timestamp: number;
    task_id?: string;
}

export interface ViewModel {
    vmid: number;
    name: string;
    status: string;
    node: string;
    cpus: number;
    maxmem: number;
}

export interface GhidraFinding {
    address: string;
    function: string;
    description: string;
    severity: string;
}

export interface ForensicReport {
    verdict: 'Benign' | 'Suspicious' | 'Malicious';
    malware_family: string | null;
    threat_score: number;
    executive_summary: string;
    behavioral_timeline: TimelineEvent[];
    artifacts: Artifacts;
    virustotal?: VirusTotalData;
}

export interface VirusTotalData {
    hash: string;
    scanned_at: string;
    malicious_votes: number;
    total_votes: number;
    threat_label: string;
    family_labels: string[];
    behavior_tags: string[];
    sandbox_verdicts: string[];
}

export interface TimelineEvent {
    timestamp_offset: string;
    stage: string;
    event_description: string;
    technical_context: string;
    related_pid: number;
}

export interface Artifacts {
    dropped_files: string[];
    c2_domains: string[];
    mutual_exclusions: string[];
    command_lines: string[];
}

// Dynamically determine the base URL based on the current host
// If accessed via localhost, use localhost:8080
// If accessed via IP or domain, use the same host with port 8080
const getBaseUrl = () => {
    const hostname = window.location.hostname;

    // If running in development mode (localhost), use localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://localhost:8080';
    }

    // Otherwise, use the current hostname with port 8080
    return `http://${hostname}:8080`;
};

const BASE_URL = getBaseUrl();

// Export BASE_URL for use in other components
export { BASE_URL };

// Helper function to get screenshot URL
export const getScreenshotUrl = (filename: string) => `${BASE_URL}/screenshots/${filename}`;

export const voodooApi = {
    fetchVms: async (): Promise<ViewModel[]> => {
        const resp = await fetch(`${BASE_URL}/vms`);
        if (!resp.ok) throw new Error("Failed to fetch VMs");
        return resp.json();
    },

    controlVm: async (node: string, vmid: number, action: string) => {
        const resp = await fetch(`${BASE_URL}/vms/${node}/${vmid}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });
        return resp.ok;
    },

    revertVm: async (node: string, vmid: number, snapshot: string = 'GOLD_IMAGE') => {
        const resp = await fetch(`${BASE_URL}/vms/${node}/${vmid}/revert`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ snapshot })
        });
        return resp.ok;
    },

    fetchHistory: async (taskId?: string, searchTerm?: string): Promise<AgentEvent[]> => {
        let url = taskId ? `${BASE_URL}/vms/telemetry/history?task_id=${taskId}` : `${BASE_URL}/vms/telemetry/history`;
        if (searchTerm) {
            url += taskId ? `&search=${encodeURIComponent(searchTerm)}` : `?search=${encodeURIComponent(searchTerm)}`;
        }
        const resp = await fetch(url);
        if (!resp.ok) throw new Error("Failed to fetch history");
        return resp.json();
    },

    killProcess: async (pid: number) => {
        const resp = await fetch(`${BASE_URL}/vms/actions/terminate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pid })
        });
        return resp.ok;
    },

    getSpiceTicket: async (node: string, vmid: number) => {
        const resp = await fetch(`${BASE_URL}/vms/${node}/${vmid}/spice`, { method: 'POST' });
        if (!resp.ok) throw new Error("Failed to get SPICE ticket");
        return resp.json();
    },

    getVncTicket: async (node: string, vmid: number) => {
        const resp = await fetch(`${BASE_URL}/vms/${node}/${vmid}/vnc`, { method: 'POST' });
        if (!resp.ok) throw new Error("Failed to get VNC ticket");
        return resp.json();
    },

    execBinary: async (path: string, args?: string[]) => {
        const resp = await fetch(`${BASE_URL}/vms/actions/exec-binary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, args })
        });
        return resp.ok;
    },

    execUrl: async (url: string, duration?: number, vmid?: number, node?: string) => {
        const resp = await fetch(`${BASE_URL}/vms/actions/exec-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, analysis_duration: duration, vmid, node })
        });
        return resp.ok;
    },

    pivotBin: async (path: string) => {
        const resp = await fetch(`${BASE_URL}/vms/actions/pivot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
        return resp.ok;
    },

    getAIAnalysis: async (events: AgentEvent[]): Promise<ForensicReport> => {
        // Construct a simple process list from events for the analysis
        const processes = Array.from(new Set(events.map(e => e.process_id)))
            .map(pid => {
                const evt = events.find(e => e.process_id === pid);
                return {
                    pid: pid,
                    parent_pid: evt?.parent_process_id || 0,
                    name: evt?.process_name || 'unknown',
                    status: 'active',
                    behaviors: events.filter(e => e.process_id === pid).map(e => e.event_type)
                };
            });

        const resp = await fetch(`${BASE_URL}/vms/analysis/ai-insight`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                processes,
                events
            })
        });
        if (!resp.ok) throw new Error("Failed to get AI analysis");
        return resp.json();
    },

    listScreenshots: async (taskId?: string): Promise<string[]> => {
        const url = taskId ? `${BASE_URL}/vms/telemetry/screenshots?task_id=${taskId}` : `${BASE_URL}/vms/telemetry/screenshots`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch screenshots');
        return response.json();
    },

    fetchGhidraFindings: async (taskId: string): Promise<GhidraFinding[]> => {
        const resp = await fetch(`${BASE_URL}/tasks/${taskId}/ghidra-findings`);
        if (!resp.ok) throw new Error("Failed to fetch Ghidra findings");
        return resp.json();
    },

    getScreenshotUrl: (filename: string, taskId?: string) => {
        if (taskId) {
            return `${BASE_URL}/screenshots/${taskId}/${filename}`;
        }
        return `${BASE_URL}/screenshots/${filename}`;
    },

    deleteTask: async (id: string) => {
        const resp = await fetch(`${BASE_URL}/tasks/${id}`, { method: 'DELETE' });
        return resp.ok;
    },

    updateTaskVerdict: async (id: string, verdict: 'Malicious' | 'Benign' | 'Suspicious') => {
        const resp = await fetch(`${BASE_URL}/tasks/${id}/verdict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ verdict })
        });
        return resp.ok;
    },

    purgeAll: async () => {
        const resp = await fetch(`${BASE_URL}/tasks/purge`, { method: 'POST' });
        return resp.ok;
    },

    chat: async (message: string, history: Array<{ role: string; content: string }>, taskId?: string, pageContext?: string) => {
        const resp = await fetch(`${BASE_URL}/vms/ai/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, history, task_id: taskId, page_context: pageContext })
        });
        if (!resp.ok) throw new Error("Chat failed");
        return resp.json();
    },

    fetchGhidraScripts: async () => {
        const resp = await fetch(`${BASE_URL}/ghidra/scripts`);
        if (!resp.ok) throw new Error("Failed to fetch Ghidra scripts");
        return resp.json();
    },

    runGhidraScript: async (scriptName: string, taskId: string, binaryName: string, args: Record<string, any> = {}) => {
        const resp = await fetch(`${BASE_URL}/ghidra/run-script`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ script_name: scriptName, task_id: taskId, binary_name: binaryName, args })
        });
        return resp.ok;
    },

    downloadPdf: async (taskId: string, report: any) => {
        const resp = await fetch(`${BASE_URL}/tasks/${taskId}/report/pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(report)
        });
        if (!resp.ok) throw new Error("Failed to generate PDF");

        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `VooDooBox_Report_${taskId}_${new Date().getTime()}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    },

    fetchAIReport: async (taskId: string): Promise<ForensicReport | null> => {
        const resp = await fetch(`${BASE_URL}/tasks/${taskId}/ai-report`);
        if (!resp.ok) return null;
        return resp.json();
    },

    triggerTaskAnalysis: async (taskId: string) => {
        const resp = await fetch(`${BASE_URL}/tasks/${taskId}/analyze`, { method: 'POST' });
        if (!resp.ok) throw new Error("Failed to trigger task analysis");
        return resp.json();
    },

    downloadSample: async (taskId: string, filename: string) => {
        const resp = await fetch(`${BASE_URL}/tasks/${taskId}/sample`);
        if (!resp.ok) throw new Error("Failed to download sample");

        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }
};
