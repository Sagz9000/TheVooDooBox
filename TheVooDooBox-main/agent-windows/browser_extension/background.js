// VooDooBox Browser Telemetry Agent
// Connects to Local Rust Agent on Port 1337

const AGENT_URL = "http://127.0.0.1:1337/telemetry/browser";

// Helper to send data to agent
async function sendToAgent(eventType, details) {
    try {
        const payload = {
            timestamp: Date.now(),
            event_type: eventType,
            ...details
        };

        await fetch(AGENT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        // console.log(`[VooDooBox] Sent ${eventType}`);
    } catch (e) {
        // console.error("[VooDooBox] Failed to contact agent:", e);
        // Fail silently to avoid alerting malware (or annoying the user)
    }
}

// 1. Capture Main Navigation (Full URLs)
chrome.webNavigation.onCommitted.addListener((details) => {
    // We only care about main frame (0) or manual subframes, mainly main frame for now
    if (details.frameId === 0) {
        chrome.tabs.get(details.tabId, (tab) => {
            sendToAgent("BROWSER_NAVIGATE", {
                url: details.url,
                title: tab?.title || "Unknown",
                transition: details.transitionType,
                tab_id: details.tabId
            });
        });
    }
});

// 2. Capture Redirects (The Chain)
chrome.webRequest.onBeforeRedirect.addListener(
    (details) => {
        if (details.type === 'main_frame') {
            sendToAgent("BROWSER_REDIRECT", {
                source_url: details.url,
                target_url: details.redirectUrl,
                status_code: details.statusCode,
                ip: details.ip || "unknown"
            });
        }
    },
    { urls: ["<all_urls>"] }
);

// 3. Listen for DOM Snapshots from Content Script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "DOM_SNAPSHOT") {
        sendToAgent("BROWSER_DOM", {
            url: sender.tab.url,
            title: sender.tab.title,
            html_preview: message.html.substring(0, 65000), // Limit size for now
            tab_id: sender.tab.id
        });
    }
});
