/**
 * ExtensionDetox — Mission Control Dashboard
 * Real-time data fetching and UI rendering
 */

const API_BASE = window.location.origin;
const REFRESH_INTERVAL = 10000; // 10 seconds

// ── API Helpers ──────────────────────────────

async function fetchJSON(endpoint) {
    try {
        const resp = await fetch(`${API_BASE}${endpoint}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch (e) {
        console.error(`API error: ${endpoint}`, e);
        return null;
    }
}

function formatNumber(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
}

function getRiskColor(score) {
    if (score >= 0.7) return 'var(--accent-red)';
    if (score >= 0.35) return 'var(--accent-yellow)';
    if (score > 0) return 'var(--accent-cyan)';
    return 'var(--accent-green)';
}

function getRiskGradient(score) {
    if (score >= 0.7) return 'var(--gradient-danger)';
    if (score >= 0.35) return 'var(--gradient-warn)';
    return 'var(--gradient-success)';
}

function getStateBadge(state) {
    const map = {
        'QUEUED': 'badge-queued',
        'DOWNLOADING': 'badge-scanning',
        'STATIC_SCANNING': 'badge-scanning',
        'DETONATING': 'badge-suspicious',
        'CLEAN': 'badge-clean',
        'FLAGGED': 'badge-malicious',
        'REPORTED': 'badge-suspicious',
        'WHITELISTED': 'badge-clean',
    };
    return `<span class="badge ${map[state] || 'badge-queued'}">${state}</span>`;
}

// ── Dashboard Stats ──────────────────────────

async function loadDashboard() {
    const data = await fetchJSON('/api/dashboard');
    if (!data) return;

    // Update stat cards
    document.getElementById('valTotal').textContent = data.total_extensions;
    document.getElementById('subTotal').textContent =
        `${data.publishers} publishers (${data.verified_publishers} verified)`;
    document.getElementById('valClean').textContent = data.clean;
    document.getElementById('valFlagged').textContent = data.flagged;
    document.getElementById('valQueued').textContent = data.queued + data.scanning;
    document.getElementById('valBlocklist').textContent = data.blocklist_count;
    document.getElementById('valAvgRisk').textContent = data.average_risk_score.toFixed(3);

    // Risk ring
    const avg = data.average_risk_score;
    const circumference = 314.16;
    const offset = circumference * (1 - Math.min(avg, 1));
    const ringFill = document.getElementById('riskRingFill');
    ringFill.style.strokeDashoffset = offset;
    document.getElementById('riskRingValue').textContent = avg.toFixed(2);
    document.getElementById('riskRingValue').style.color = getRiskColor(avg);

    // Risk distribution bars
    const total = data.total_extensions || 1;
    updateBar('barClean', 'barCleanLabel', data.clean, total);
    updateBar('barSuspicious', 'barSuspiciousLabel', data.reported, total);
    updateBar('barMalicious', 'barMaliciousLabel', data.flagged, total);
    updateBar('barQueued', 'barQueuedLabel', data.queued, total);

    // Sparkline
    renderSparkline(data.recent_scores || []);
}

function updateBar(fillId, labelId, count, total) {
    const pct = Math.max((count / total) * 100, count > 0 ? 3 : 0);
    document.getElementById(fillId).style.width = pct + '%';
    document.getElementById(labelId).textContent = count;
}

function renderSparkline(scores) {
    const container = document.getElementById('sparkline');
    if (!scores.length) {
        container.innerHTML = '<div class="empty-state" style="width:100%;font-size:0.8rem;">No scan data yet</div>';
        return;
    }

    const max = Math.max(...scores, 0.1);
    container.innerHTML = scores.map((score, i) => {
        const pct = (score / max) * 100;
        const color = getRiskColor(score);
        return `<div class="bar" style="height:${Math.max(pct, 5)}%;background:${color};opacity:${0.5 + (i / scores.length) * 0.5};" title="Score: ${score.toFixed(3)}"></div>`;
    }).join('');
}

// ── Blocklist ────────────────────────────────

async function loadBlocklist() {
    const data = await fetchJSON('/api/blocklist');
    if (!data) return;

    document.getElementById('blocklistTotal').textContent = `${data.total} entries`;

    const container = document.getElementById('blocklistBars');
    if (!data.entries || !data.entries.length) {
        container.innerHTML = '<div class="empty-state"><div class="icon">🔍</div>No blocklist data</div>';
        return;
    }

    const maxCount = Math.max(...data.entries.map(e => e.count));
    const colors = {
        'Malware': 'var(--gradient-danger)',
        'Impersonation': 'var(--gradient-warn)',
        'Untrustworthy': 'var(--accent-secondary)',
    };

    container.innerHTML = data.entries.map(entry => {
        const pct = (entry.count / maxCount) * 100;
        const color = colors[entry.removal_type] || 'var(--accent-primary)';
        return `
            <div class="blocklist-bar">
                <span class="type-label">${entry.removal_type || 'Unknown'}</span>
                <div class="bar-track">
                    <div class="bar-fill" style="width:${pct}%;background:${color};">${entry.count}</div>
                </div>
            </div>
        `;
    }).join('');
}

// ── Queue ────────────────────────────────────

async function loadQueue() {
    const data = await fetchJSON('/api/queue');
    if (!data) return;

    const container = document.getElementById('queueList');
    document.getElementById('queueCount').textContent = `${data.queue.length} pending`;

    if (!data.queue.length) {
        container.innerHTML = '<div class="empty-state"><div class="icon">✅</div>Queue is empty — all clear!</div>';
        return;
    }

    container.innerHTML = data.queue.map(item => `
        <div class="queue-item">
            <div class="spinner"></div>
            <div class="ext-name">${item.extension_id}</div>
            <div class="ext-version">v${item.version}</div>
            ${getStateBadge(item.scan_state)}
        </div>
    `).join('');
}

// ── Extension Table ──────────────────────────

let currentFilter = null;

async function loadExtensions(state = null) {
    const params = state ? `?state=${state}` : '';
    const data = await fetchJSON(`/api/extensions${params}`);
    if (!data) return;

    const tbody = document.getElementById('extTableBody');

    if (!data.extensions || !data.extensions.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No extensions found</td></tr>';
        return;
    }

    tbody.innerHTML = data.extensions.map(ext => {
        const score = ext.composite_score ?? 0;
        const scoreColor = getRiskColor(score);
        const verified = ext.is_domain_verified
            ? '<span class="badge badge-verified">✓</span>'
            : '<span class="badge badge-unverified">—</span>';

        return `
            <tr>
                <td>
                    <div style="font-weight:600;">${ext.display_name || ext.extension_id}</div>
                    <div class="mono" style="font-size:0.72rem;color:var(--text-muted);">${ext.extension_id}</div>
                </td>
                <td class="mono" style="font-size:0.8rem;">${ext.version}</td>
                <td>
                    <div style="display:flex;align-items:center;gap:6px;">
                        ${verified}
                        <span style="font-size:0.85rem;">${ext.publisher_name || '—'}</span>
                    </div>
                </td>
                <td class="mono" style="font-size:0.85rem;">${formatNumber(ext.install_count || 0)}</td>
                <td>${getStateBadge(ext.scan_state)}</td>
                <td>
                    <div class="risk-bar" style="min-width:100px;">
                        <div class="risk-bar-track">
                            <div class="risk-bar-fill" style="width:${score * 100}%;background:${getRiskGradient(score)};"></div>
                        </div>
                        <span class="risk-bar-label mono" style="color:${scoreColor};">${score.toFixed(2)}</span>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function filterExtensions(state) {
    currentFilter = state;
    loadExtensions(state);
}

// ── Initialization ───────────────────────────

async function init() {
    // Load all panels
    await Promise.all([
        loadDashboard(),
        loadBlocklist(),
        loadQueue(),
        loadExtensions(),
    ]);

    // Hide loading screen
    document.getElementById('loadingScreen').classList.add('hidden');

    // Auto-refresh
    setInterval(() => {
        loadDashboard();
        loadQueue();
        loadExtensions(currentFilter);
    }, REFRESH_INTERVAL);
}

// Boot
document.addEventListener('DOMContentLoaded', init);
