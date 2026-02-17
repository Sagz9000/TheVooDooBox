export interface AgentEvent {
    id?: number;
    event_type: string;
    process_id: number;
    parent_process_id: number;
    process_name: string;
    details: string;
    decoded_details?: string;
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
    verdict: string;
    malware_family: string;
    threat_score: number;
    executive_summary: string;
    static_analysis_insights: string[];
    behavioral_timeline: TimelineEvent[];
    artifacts: Artifacts;
    thinking?: string;
    virustotal?: VirusTotalData;
    related_samples?: RelatedSample[];
    recommended_actions?: RecommendedAction[];
    digital_signature?: string;
    mitre_matrix?: Record<string, MitreTechnique[]>;
}

export interface RecommendedAction {
    action: string;
    params: Record<string, string>;
    reasoning: string;
}

export interface MitreTechnique {
    id: string;
    name: string;
    evidence: string[];
    status: string;
}

export interface RelatedSample {
    task_id: string;
    verdict: string;
    malware_family: string;
    summary: string;
    tags: string[];
}

export interface VirusTotalData {
    hash: string;
    scanned_at: string;
    malicious_votes: number;
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
    related_pid: number | string;
}

export interface Artifacts {
    dropped_files: string[];
    c2_domains: string[];
    c2_ips?: string[];
    mutual_exclusions: string[];
    command_lines: string[];
}

export interface Note {
    id: string;
    task_id: string;
    author: string;
    content: string;
    is_hint: boolean;
    created_at: number;
}

export interface Tag {
    task_id: string;
    event_id: number;
    tag_type: 'Malicious' | 'Benign' | 'Ignored' | 'KeyArtifact';
    comment?: string;
}

export interface AnalysisTask {
    id: string;
    filename: string;
    original_filename?: string;
    file_hash?: string;
    status: string;
    verdict: string | null;
    risk_score: number | null;
    created_at: number;
    completed_at: number | null;
    sandbox_id: string | null;
    // Remnux Integration
    remnux_status?: string;
    remnux_report?: any; // Generic for now, can be structured later
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

    fetchTasks: async (): Promise<AnalysisTask[]> => {
        const resp = await fetch(`${BASE_URL}/tasks`);
        if (!resp.ok) throw new Error("Failed to fetch tasks");
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

    getAIAnalysis: async (events: AgentEvent[], mode: string = 'quick'): Promise<ForensicReport> => {
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
                events,
                mode
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

    connectTaskProgress: (onProgress: (event: TaskProgressEvent) => void): WebSocket => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Remove protocol if present in BASE_URL to get host
        const host = BASE_URL.replace(/^http(s)?:\/\//, '');
        const wsUrl = `${protocol}//${host}/ws/progress`;

        console.log(`[WS] Connecting to Progress Stream: ${wsUrl}`);
        const ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
            try {
                const data: TaskProgressEvent = JSON.parse(event.data);
                // Ensure data has the expected structure before calling callback
                if (data && data.task_id && data.stage) {
                    onProgress(data);
                }
            } catch (e) {
                console.error('[WS] Failed to parse progress event:', e);
            }
        };

        ws.onopen = () => console.log('[WS] Progress Stream Connected');
        ws.onerror = (e) => console.error('[WS] Progress Stream Error:', e);
        ws.onclose = () => console.log('[WS] Progress Stream Closed');

        return ws;
    },

    chat: async (
        message: string,
        history: Array<{ role: string; content: string }>,
        taskId?: string,
        pageContext?: string,
        onPartial?: (thought: string) => void
    ) => {
        const resp = await fetch(`${BASE_URL}/vms/ai/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, history, task_id: taskId, page_context: pageContext })
        });

        if (!resp.ok) {
            try {
                const errData = await resp.json();
                throw new Error(errData.response || errData.error || "Chat failed");
            } catch (e: any) {
                // If parsing failed or valid error wasn't found, rethrow original or generic
                if (e.message && e.message !== "Chat failed") throw e;
                throw new Error(`Chat failed: ${resp.status} ${resp.statusText}`);
            }
        }

        const reader = resp.body?.getReader();
        if (!reader) throw new Error("Failed to initialize stream reader");

        const decoder = new TextDecoder();
        let finalResponse = "";
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data: ')) {
                    const jsonStr = trimmed.substring(6).trim();
                    if (!jsonStr) continue;

                    try {
                        const event = JSON.parse(jsonStr);
                        if (event.Thought) {
                            if (onPartial) onPartial(event.Thought);
                        } else if (event.Final) {
                            finalResponse = event.Final;
                        } else if (event.type === 'error') {
                            throw new Error(event.content);
                        }
                    } catch (e) {
                        console.warn("Failed to parse SSE line:", line, e);
                    }
                }
            }
        }

        return { response: finalResponse, provider: "System" };
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
        let data = await resp.json();
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) { }
        }
        return data;
    },

    triggerTaskAnalysis: async (taskId: string, mode: string = 'quick', autoResponse: boolean = true) => {
        const resp = await fetch(`${BASE_URL}/tasks/${taskId}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode, auto_response: autoResponse })
        });
        if (!resp.ok) throw new Error("Failed to trigger task analysis");
        let data = await resp.json();
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) { }
        }
        return data;
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
    },

    addNote: async (taskId: string, content: string, is_hint: boolean) => {
        const resp = await fetch(`${BASE_URL}/tasks/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: taskId, content, is_hint })
        });
        if (!resp.ok) throw new Error("Failed to add note");
        return resp.json();
    },

    getNotes: async (taskId: string): Promise<Note[]> => {
        const resp = await fetch(`${BASE_URL}/tasks/${taskId}/notes`);
        if (!resp.ok) throw new Error("Failed to get notes");
        return resp.json();
    },

    addTag: async (taskId: string, eventId: number, tagType: string, comment?: string) => {
        const resp = await fetch(`${BASE_URL}/tasks/tags`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: taskId, event_id: eventId, tag_type: tagType, comment })
        });
        if (!resp.ok) throw new Error("Failed to add tag");
        return resp.json();
    },

    getTags: async (taskId: string): Promise<Tag[]> => {
        const resp = await fetch(`${BASE_URL}/tasks/${taskId}/tags`);
        if (!resp.ok) throw new Error("Failed to get tags");
        return resp.json();
    },
    getAIConfig: async (): Promise<{ provider: string, ai_mode?: string }> => {
        const resp = await fetch(`${BASE_URL}/vms/ai/config`);
        if (!resp.ok) throw new Error("Failed to fetch AI configuration");
        return resp.json();
    },

    setAIConfig: async (config: {
        provider: string,
        gemini_key?: string,
        gemini_model?: string,
        ollama_url?: string,
        ollama_model?: string,
        anthropic_key?: string,
        anthropic_model?: string,
        openai_key?: string,
        openai_model?: string,
        copilot_token?: string,
        copilot_model?: string
    }) => {
        const resp = await fetch(`${BASE_URL}/vms/ai/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        if (!resp.ok) throw new Error("Failed to update AI configuration");
        return resp.json();
    },

    getAIMode: async (): Promise<{ ai_mode: string }> => {
        const resp = await fetch(`${BASE_URL}/vms/ai/mode`);
        if (!resp.ok) throw new Error("Failed to fetch AI mode");
        return resp.json();
    },

    setAIMode: async (mode: string) => {
        const resp = await fetch(`${BASE_URL}/vms/ai/mode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode })
        });
        if (!resp.ok) throw new Error("Failed to update AI mode");
        return resp.json();
    },

    submitSample: async (data: {
        file: File;
        duration: number;
        mode: string;
        vmid?: number;
        node?: string;
    }) => {
        const formData = new FormData();
        formData.append('file', data.file);
        formData.append('analysis_duration', data.duration.toString());
        formData.append('analysis_mode', data.mode);
        if (data.vmid) formData.append('vmid', data.vmid.toString());
        if (data.node) formData.append('node', data.node);

        const resp = await fetch(`${BASE_URL}/vms/actions/submit`, {
            method: 'POST',
            body: formData,
        });
        if (!resp.ok) throw new Error("Failed to submit sample");
        return resp.json();
    },

    purgeAll: async () => {
        const resp = await fetch(`${BASE_URL}/tasks/purge`, { method: 'POST' });
        return resp.ok;
    },

    getSystemHealth: async () => {
        try {
            const resp = await fetch(`${BASE_URL}/health`);
            return resp.ok;
        } catch {
            return false;
        }
    }
};

export interface TaskProgressEvent {
    task_id: string;
    stage: string;
    message: string;
    percent: number;
    timestamp: number;
}
