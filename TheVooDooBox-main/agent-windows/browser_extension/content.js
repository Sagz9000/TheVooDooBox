// VooDooBox Content Script
// Captures DOM after load

// Simple debounce to avoid spamming on dynamic pages
let hasSnapshot = false;

function snapshot() {
    if (hasSnapshot) return;
    hasSnapshot = true;

    // Capture the root HTML
    // We use documentElement.outerHTML to get everything including <html> tags
    const html = document.documentElement.outerHTML;

    chrome.runtime.sendMessage({
        type: "DOM_SNAPSHOT",
        html: html
    });
}

// Trigger on load
if (document.readyState === 'complete') {
    snapshot();
} else {
    window.addEventListener('load', snapshot);
}

// Also trigger if we detect significant DOM changes (optional, simplistic for now)
// setTimeout(snapshot, 2000); // Late snapshot for SPAs
