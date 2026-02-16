import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { AgentEvent } from './voodooApi';
import { Maximize2, Minimize2, ChevronRight, ChevronDown, Terminal, Radio, Search } from 'lucide-react';

// ── Types ──
interface ProcessLineageProps {
    events: AgentEvent[];
    width?: number; // Optional, if not provided will use container width
    height?: number; // Optional, if not provided will use container height
    mitreData?: Map<number, string[]>;
    printMode?: boolean; // Static render for PDF export
    onMaximize?: () => void; // Optional callback for full-screen mode
    isMaximized?: boolean;
    selectedPid?: number | null;
    onSelect?: (pid: number | null) => void;
}

interface ProcessNode {
    id: number;
    pid: number;
    name: string;
    children: ProcessNode[];
    events: AgentEvent[];
    type: 'root' | 'process';
    startTime?: number;
    techniques?: string[];
    commandLine?: string;
    _collapsed?: boolean;
    _childCount?: number; // Total descendants (for +N badge)
}

// D3 hierarchy node with coordinates
type TreeNode = d3.HierarchyPointNode<ProcessNode>;

// ── Constants ──
const NOISE_PROCESSES = new Set([
    'system', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe',
    'services.exe', 'lsass.exe', 'svchost.exe', 'dwm.exe', 'ctfmon.exe',
    'fontdrvhost.exe', 'spoolsv.exe', 'searchindexer.exe', 'taskhostw.exe',
    'sppsvc.exe', 'conhost.exe', 'voodoobox-agent-windows.exe',
    'voodoobox-agent.exe', 'audiodg.exe', 'sihost.exe', 'runtimebroker.exe',
    'shellexperiencehost.exe', 'startmenuexperiencehost.exe',
    'textinputhost.exe', 'dllhost.exe', 'searchui.exe',
    'microsoftedgeupdate.exe', 'wmiprvse.exe', 'wudfhost.exe',
    'officeclicktorun.exe', 'werfault.exe', 'trustedinstaller.exe',
    'tiworker.exe', 'taskmgr.exe', 'securityhealthservice.exe',
    'securityhealthsystray.exe', 'msmpeng.exe', 'nissrv.exe',
    'sgrmbroker.exe', 'registry', 'memory compression',
    'system idle process', 'mallab-agent.exe', 'mallab-agent',
]);

const SHELL_PROCESSES = new Set([
    'cmd.exe', 'powershell.exe', 'pwsh.exe', 'wscript.exe',
    'cscript.exe', 'mshta.exe', 'bash.exe', 'sh.exe',
]);

const NODE_W = 180;
const NODE_H = 48;
const NODE_GAP_X = 40;
const NODE_GAP_Y = 80;

// ── Color Palette (VooDoo Theme) ──
const COLOR = {
    root: { bg: '#1a1a1a', border: '#444', text: '#888', glow: 'none' },
    target: { bg: '#1a0028', border: '#ae00ff', text: '#d580ff', glow: '0 0 12px rgba(174,0,255,0.4)' },
    shell: { bg: '#280008', border: '#ff003c', text: '#ff6680', glow: '0 0 12px rgba(255,0,60,0.3)' },
    standard: { bg: '#001a0d', border: '#00ff99', text: '#66ffbb', glow: 'none' },
    link: '#555',
    linkGrad1: '#ae00ff',
    linkGrad2: '#00ff99',
    arrow: '#888',
    timeDelta: '#ae00ff88',
    tooltip: { bg: '#111', border: '#333', text: '#ccc' },
    badge: { bg: '#ae00ff22', border: '#ae00ff88', text: '#d580ff' },
    collapsed: { bg: '#1a1a0d', border: '#ffaa00', text: '#ffcc44' },
};

function getNodeStyle(name: string, type: string) {
    if (type === 'root') return COLOR.root;
    const n = name.toLowerCase();
    if (n.includes('sample') || n.includes('artifact') || n.includes('.exe') && !SHELL_PROCESSES.has(n) && !NOISE_PROCESSES.has(n)) {
        // Check if it's the "interesting" target — heuristic: not a shell, not noise
        if (n.includes('sample') || n.includes('artifact')) return COLOR.target;
    }
    if (SHELL_PROCESSES.has(n)) return COLOR.shell;
    return COLOR.standard;
}

function formatDelta(ms: number): string {
    if (ms <= 0) return '';
    if (ms < 1000) return `+${ms}ms`;
    if (ms < 60000) return `+${(ms / 1000).toFixed(1)}s`;
    return `+${(ms / 60000).toFixed(1)}m`;
}

// ── Count all descendants ──
function countDescendants(node: ProcessNode): number {
    let count = 0;
    for (const child of node.children) {
        count += 1 + countDescendants(child);
    }
    return count;
}

// ── Build Hierarchy with noise filtering ──
function buildHierarchy(events: AgentEvent[], mitreData?: Map<number, string[]>): ProcessNode | null {
    if (!events || events.length === 0) return null;

    const processMap = new Map<number, ProcessNode>();

    const getOrCreate = (procId: number, pid: number, name: string): ProcessNode => {
        if (!processMap.has(procId)) {
            processMap.set(procId, {
                id: procId, pid, name,
                children: [], events: [], type: 'process',
                techniques: mitreData?.get(pid) || [],
            });
        }
        return processMap.get(procId)!;
    };

    // Phase 1: Create nodes from events
    events.forEach(e => {
        const pId = e.process_id || 0;
        const node = getOrCreate(pId, e.process_id || 0, e.process_name || `PID ${pId}`);
        node.events.push(e);
        if (e.event_type === 'PROCESS_CREATE' && e.process_name) {
            node.name = e.process_name;
        }
        // Capture command line from PROCESS_CREATE details
        if (e.event_type === 'PROCESS_CREATE' && e.details && !node.commandLine) {
            node.commandLine = e.details;
        }
    });

    // Phase 2: Set start times
    processMap.forEach(node => {
        if (node.events.length > 0) {
            const create = node.events.find(e => e.event_type === 'PROCESS_CREATE');
            node.startTime = create ? create.timestamp : Math.min(...node.events.map(e => e.timestamp));
        }
    });

    // Phase 3: Filter noise BEFORE building parent-child links
    const noiseIds = new Set<number>();
    processMap.forEach((node, procId) => {
        if (NOISE_PROCESSES.has(node.name.toLowerCase())) {
            noiseIds.add(procId);
        }
    });
    noiseIds.forEach(id => processMap.delete(id));

    // Phase 4: Build parent-child relationships
    const roots: ProcessNode[] = [];
    processMap.forEach((node, procId) => {
        const create = node.events.find(e => e.event_type === 'PROCESS_CREATE');
        const any = node.events[0];
        const parentId = create?.parent_process_id || any?.parent_process_id;

        if (parentId && processMap.has(parentId) && parentId !== procId) {
            processMap.get(parentId)!.children.push(node);
        } else {
            roots.push(node);
        }
    });

    if (roots.length === 0) return null;

    // Sort children by start time
    const sortChildren = (node: ProcessNode) => {
        node.children.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
        node.children.forEach(sortChildren);
    };

    let root: ProcessNode;
    if (roots.length === 1) {
        root = roots[0];
        root.type = 'root';
    } else {
        const contextStart = Math.min(...roots.map(r => r.startTime || Infinity));
        root = {
            id: -999, pid: 0, name: 'Detonation Context',
            children: roots, events: [], type: 'root',
            startTime: contextStart === Infinity ? 0 : contextStart,
        };
    }

    sortChildren(root);

    // Count descendants for collapse badges
    const annotateCount = (node: ProcessNode) => {
        node._childCount = countDescendants(node);
        node.children.forEach(annotateCount);
    };
    annotateCount(root);

    return root;
}

// ── Get visible tree (respecting collapsed state) ──
function getVisibleTree(node: ProcessNode): ProcessNode {
    if (node._collapsed) {
        return { ...node, children: [] };
    }
    return { ...node, children: node.children.map(getVisibleTree) };
}

// ────────────────────────────────────────────
// COMPONENT
// ────────────────────────────────────────────
export default function ProcessLineage({
    events,
    width,
    height,
    mitreData,
    printMode = false,
    onMaximize,
    isMaximized,
    selectedPid,
    onSelect
}: ProcessLineageProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [, forceUpdate] = useState(0); // trigger re-render on collapse
    const [dimensions, setDimensions] = useState({ width: width || 800, height: height || 400 });

    // Sidebar state
    const [sidebarWidth, setSidebarWidth] = useState(240);
    const [isResizing, setIsResizing] = useState(false);
    const [expandedListNodes, setExpandedListNodes] = useState<Set<number>>(new Set([-999]));
    const [searchTerm, setSearchTerm] = useState('');

    // Handle resizing (main logic for Graph Container)
    useEffect(() => {
        if (width && height) {
            setDimensions({ width, height });
            return;
        }

        const resizeObserver = new ResizeObserver(entries => {
            if (entries[0]) {
                const { width, height } = entries[0].contentRect;
                setDimensions({ width, height: height || 400 }); // Ensure minimum height
            }
        });

        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => resizeObserver.disconnect();
    }, [width, height]);

    // Handle Sidebar Resizing
    const startResizing = useCallback(() => setIsResizing(true), []);
    const stopResizing = useCallback(() => setIsResizing(false), []);
    const resize = useCallback((e: MouseEvent) => {
        if (isResizing && rootRef.current) {
            const rootRect = rootRef.current.getBoundingClientRect();
            const newWidth = e.clientX - rootRect.left;
            // Min width 150, Max width 50% of screen or 600
            if (newWidth > 150 && newWidth < 600) {
                setSidebarWidth(newWidth);
            }
        }
    }, [isResizing]);

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stopResizing);
        }
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [isResizing, resize, stopResizing]);


    const root = useMemo(() => {
        return buildHierarchy(events, mitreData);
    }, [events, mitreData]);

    const drawTree = useCallback(() => {
        if (!root || !svgRef.current) return;

        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        // Build visible tree (respecting collapsed nodes)
        const visibleRoot = getVisibleTree(root);
        const hierarchy = d3.hierarchy(visibleRoot);

        // D3 tree layout
        const treeLayout = d3.tree<ProcessNode>()
            .nodeSize([NODE_W + NODE_GAP_X, NODE_H + NODE_GAP_Y])
            .separation((a: TreeNode, b: TreeNode) => a.parent === b.parent ? 1 : 1.3);

        const treeData = treeLayout(hierarchy) as TreeNode;
        const nodes = treeData.descendants();
        const links = treeData.links();

        // ── Defs ──
        const defs = svg.append('defs');

        // Arrow marker
        defs.append('marker')
            .attr('id', 'lineage-arrow')
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 10)
            .attr('refY', 5)
            .attr('markerWidth', 8)
            .attr('markerHeight', 8)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M 0 0 L 10 5 L 0 10 z')
            .attr('fill', COLOR.arrow);

        // Glow filter
        const glow = defs.append('filter').attr('id', 'node-glow');
        glow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur');
        glow.append('feMerge').selectAll('feMergeNode')
            .data(['blur', 'SourceGraphic'])
            .enter().append('feMergeNode')
            .attr('in', (d: string) => d);

        // ── Container group for zoom/pan ──
        const g = svg.append('g');

        if (!printMode) {
            const zoom = d3.zoom<SVGSVGElement, unknown>()
                .scaleExtent([0.15, 3])
                .on('zoom', (event: any) => g.attr('transform', event.transform));

            svg.call(zoom);

            // Auto-fit: compute bounds and center
            const xExtent = d3.extent(nodes, (d: TreeNode) => d.x) as [number, number];
            const yExtent = d3.extent(nodes, (d: TreeNode) => d.y) as [number, number];
            const treeBoundsW = (xExtent[1] - xExtent[0]) + NODE_W + 80;
            const treeBoundsH = (yExtent[1] - yExtent[0]) + NODE_H + 80;

            const scale = Math.min(dimensions.width / treeBoundsW, dimensions.height / treeBoundsH, 1);
            const tx = (dimensions.width / 2) - ((xExtent[0] + xExtent[1]) / 2) * scale;
            const ty = 40 * scale; // Small top margin

            svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
        } else {
            // Print mode: static transform to fit
            const xExtent = d3.extent(nodes, (d: TreeNode) => d.x) as [number, number];
            const yExtent = d3.extent(nodes, (d: TreeNode) => d.y) as [number, number];
            const treeBoundsW = (xExtent[1] - xExtent[0]) + NODE_W + 80;
            const treeBoundsH = (yExtent[1] - yExtent[0]) + NODE_H + 80;
            const scale = Math.min(dimensions.width / treeBoundsW, dimensions.height / treeBoundsH, 1);
            const tx = (dimensions.width / 2) - ((xExtent[0] + xExtent[1]) / 2) * scale;
            const ty = 30 * scale;
            g.attr('transform', `translate(${tx},${ty}) scale(${scale})`);
        }

        // ── Links (curved vertical paths) ──

        const linkGroup = g.selectAll('.lineage-link')
            .data(links)
            .enter().append('g')
            .attr('class', 'lineage-link');

        linkGroup.append('path')
            .attr('d', (d: any) => {
                const sourceX = d.source.x;
                const sourceY = d.source.y + NODE_H;
                const targetX = d.target.x;
                const targetY = d.target.y;
                const midY = (sourceY + targetY) / 2;
                return `M ${sourceX} ${sourceY} C ${sourceX} ${midY}, ${targetX} ${midY}, ${targetX} ${targetY}`;
            })
            .attr('fill', 'none')
            .attr('stroke', COLOR.link)
            .attr('stroke-width', 1.5)
            .attr('stroke-opacity', 0.6)
            .attr('marker-end', 'url(#lineage-arrow)');

        // Time delta labels on links
        linkGroup.each(function (this: SVGGElement, d: any) {
            const parentStart = d.source.data.startTime;
            const childStart = d.target.data.startTime;
            if (parentStart && childStart && childStart > parentStart) {
                const delta = childStart - parentStart;
                const midX = (d.source.x + d.target.x) / 2;
                const midY = (d.source.y + NODE_H + d.target.y) / 2;

                d3.select(this).append('text')
                    .attr('x', midX + 8)
                    .attr('y', midY)
                    .attr('text-anchor', 'start')
                    .attr('fill', COLOR.timeDelta)
                    .attr('font-size', '9px')
                    .attr('font-family', "'JetBrains Mono', monospace")
                    .attr('font-weight', 'bold')
                    .text(formatDelta(delta));
            }
        });

        // ── Node groups ──
        const nodeGroup = g.selectAll('.lineage-node')
            .data(nodes)
            .enter().append('g')
            .attr('class', 'lineage-node')
            .attr('transform', (d: TreeNode) => `translate(${d.x - NODE_W / 2}, ${d.y})`)
            .style('cursor', printMode ? 'default' : 'pointer');

        // Node card backgrounds (rounded rects)
        nodeGroup.append('rect')
            .attr('width', NODE_W)
            .attr('height', NODE_H)
            .attr('rx', 6)
            .attr('ry', 6)
            .attr('fill', (d: TreeNode) => {
                if (d.data._collapsed) return COLOR.collapsed.bg;
                return getNodeStyle(d.data.name, d.data.type).bg;
            })
            .attr('stroke', (d: TreeNode) => {
                if (selectedPid && d.data.pid === selectedPid) return '#ffffff'; // White border for selected
                if (d.data._collapsed) return COLOR.collapsed.border;
                return getNodeStyle(d.data.name, d.data.type).border;
            })
            .attr('stroke-width', (d: TreeNode) => {
                if (selectedPid && d.data.pid === selectedPid) return 3;
                return 1.5;
            })
            .style('box-shadow', (d: TreeNode) => getNodeStyle(d.data.name, d.data.type).glow);

        // Glow effect for target processes
        nodeGroup.filter((d: TreeNode) => {
            const n = d.data.name.toLowerCase();
            return n.includes('sample') || n.includes('artifact');
        }).select('rect')
            .attr('filter', 'url(#node-glow)');

        // Process name
        nodeGroup.append('text')
            .attr('x', 12)
            .attr('y', 18)
            .attr('fill', (d: TreeNode) => {
                if (d.data._collapsed) return COLOR.collapsed.text;
                return getNodeStyle(d.data.name, d.data.type).text;
            })
            .attr('font-size', '11px')
            .attr('font-family', "'JetBrains Mono', monospace")
            .attr('font-weight', 'bold')
            .text((d: TreeNode) => {
                const name = d.data.name;
                return name.length > 20 ? name.slice(0, 18) + '…' : name;
            });

        // PID + event count
        nodeGroup.append('text')
            .attr('x', 12)
            .attr('y', 34)
            .attr('fill', '#666')
            .attr('font-size', '9px')
            .attr('font-family', "'JetBrains Mono', monospace")
            .text((d: TreeNode) => {
                if (d.data.type === 'root' && d.data.id === -999) return 'Context Root';
                const evCount = d.data.events.length;
                return `PID:${d.data.pid}  [${evCount} events]`;
            });

        // Collapsed badge (+N)
        nodeGroup.filter((d: TreeNode) => !!(d.data._collapsed && d.data._childCount && d.data._childCount > 0))
            .append('g')
            .attr('transform', `translate(${NODE_W - 30}, 4)`)
            .call((g: d3.Selection<SVGGElement, TreeNode, SVGGElement, unknown>) => {
                g.append('rect')
                    .attr('width', 26)
                    .attr('height', 14)
                    .attr('rx', 3)
                    .attr('fill', COLOR.collapsed.border)
                    .attr('opacity', 0.3);
                g.append('text')
                    .attr('x', 13)
                    .attr('y', 10)
                    .attr('text-anchor', 'middle')
                    .attr('fill', COLOR.collapsed.text)
                    .attr('font-size', '9px')
                    .attr('font-weight', 'bold')
                    .attr('font-family', "'JetBrains Mono', monospace")
                    .text((d: TreeNode) => `+${d.data._childCount}`);
            });

        // MITRE technique badges
        nodeGroup.each(function (this: SVGGElement, d: TreeNode) {
            if (d.data.techniques && d.data.techniques.length > 0) {
                const badges = d.data.techniques.slice(0, 3);
                const badgeG = d3.select(this).append('g')
                    .attr('transform', `translate(0, ${NODE_H + 4})`);

                badges.forEach((techId: string, i: number) => {
                    const bw = techId.length * 6 + 10;
                    const bx = i * (bw + 3);
                    badgeG.append('rect')
                        .attr('x', bx)
                        .attr('y', 0)
                        .attr('width', bw)
                        .attr('height', 14)
                        .attr('rx', 3)
                        .attr('fill', COLOR.badge.bg)
                        .attr('stroke', COLOR.badge.border)
                        .attr('stroke-width', 0.5);

                    badgeG.append('text')
                        .attr('x', bx + bw / 2)
                        .attr('y', 10)
                        .attr('text-anchor', 'middle')
                        .attr('fill', COLOR.badge.text)
                        .attr('font-size', '8px')
                        .attr('font-family', "'JetBrains Mono', monospace")
                        .attr('font-weight', 'bold')
                        .text(techId);
                });
            }
        });

        // ── Interactivity (non-print only) ──
        if (!printMode) {
            // Click to Select Node
            nodeGroup.on('click', (_event: any, d: TreeNode) => {
                // If onSelect is provided, use it to set the global filter
                if (onSelect) {
                    // Toggle: if clicking the already selected node, deselect it (or keep it selected? modifying to deselect on second click makes sense for a filter)
                    // Actually, for a persistent filter, clicking another selects that one. user can clear filter via the top UI.
                    // Let's just select it.
                    onSelect(d.data.pid);
                }
            });

            // Hover tooltip
            nodeGroup.on('mouseover', function (this: SVGGElement, event: MouseEvent, d: TreeNode) {
                if (!tooltipRef.current || d.data.type === 'root') return;
                const tip = tooltipRef.current;
                const startStr = d.data.startTime ? new Date(d.data.startTime).toLocaleTimeString([], { hour12: false }) : 'N/A';
                const cmdLine = d.data.commandLine || d.data.events.find((e: AgentEvent) => e.event_type === 'PROCESS_CREATE')?.details || '';

                tip.innerHTML = `
                    <div style="font-size:11px;font-weight:bold;color:white;margin-bottom:4px">${d.data.name}</div>
                    <div style="font-size:9px;color:#888;font-family:monospace">
                        PID: ${d.data.pid}<br/>
                        Events: ${d.data.events.length}<br/>
                        Start: ${startStr}<br/>
                        ${d.data.techniques && d.data.techniques.length > 0 ? `MITRE: ${d.data.techniques.join(', ')}<br/>` : ''}
                        ${cmdLine ? `<div style="margin-top:4px;padding-top:4px;border-top:1px solid #333;word-break:break-all;color:#aaa">${cmdLine.length > 200 ? cmdLine.slice(0, 200) + '…' : cmdLine}</div>` : ''}
                    </div>
                `;
                tip.style.display = 'block';
                tip.style.left = `${event.offsetX + 16}px`;
                tip.style.top = `${event.offsetY - 10}px`;
            })
                .on('mousemove', function (event: MouseEvent) {
                    if (!tooltipRef.current) return;
                    tooltipRef.current.style.left = `${event.offsetX + 16}px`;
                    tooltipRef.current.style.top = `${event.offsetY - 10}px`;
                })
                .on('mouseout', function () {
                    if (tooltipRef.current) tooltipRef.current.style.display = 'none';
                });

            // Hover highlight links
            nodeGroup.on('mouseover.links', function (_event: MouseEvent, d: TreeNode) {
                linkGroup.select('path')
                    .attr('stroke', (l: any) => {
                        // Highlight if connected to hovered node OR if connected to selected node
                        const isHovered = l.source.data.id === d.data.id || l.target.data.id === d.data.id;
                        const isSelected = selectedPid && (l.source.data.pid === selectedPid || l.target.data.pid === selectedPid);

                        if (isHovered) return getNodeStyle(d.data.name, d.data.type).border;
                        if (isSelected) return '#ffffff';

                        return COLOR.link;
                    })
                    .attr('stroke-opacity', (l: any) => {
                        const isHovered = l.source.data.id === d.data.id || l.target.data.id === d.data.id;
                        const isSelected = selectedPid && (l.source.data.pid === selectedPid || l.target.data.pid === selectedPid);
                        return (isHovered || isSelected) ? 1 : 0.3;
                    })
                    .attr('stroke-width', (l: any) => {
                        const isHovered = l.source.data.id === d.data.id || l.target.data.id === d.data.id;
                        const isSelected = selectedPid && (l.source.data.pid === selectedPid || l.target.data.pid === selectedPid);
                        return (isHovered || isSelected) ? 2.5 : 1.5;
                    });
            }).on('mouseout.links', function () {
                // Return to state based on selection only
                linkGroup.select('path')
                    .attr('stroke', (l: any) => {
                        if (selectedPid && (l.source.data.pid === selectedPid || l.target.data.pid === selectedPid)) return '#ffffff';
                        return COLOR.link;
                    })
                    .attr('stroke-opacity', (l: any) => {
                        if (selectedPid && (l.source.data.pid === selectedPid || l.target.data.pid === selectedPid)) return 1;
                        return 0.6;
                    })
                    .attr('stroke-width', (l: any) => {
                        if (selectedPid && (l.source.data.pid === selectedPid || l.target.data.pid === selectedPid)) return 2.5;
                        return 1.5;
                    });
            });
        }

    }, [root, dimensions, printMode]);

    // Trigger redraw on collapse state changes
    useEffect(() => {
        drawTree();
    }, [drawTree]);

    // Recursive sidebar list renderer
    const renderSidebarNode = (node: ProcessNode, depth: number) => {
        const isExpanded = expandedListNodes.has(node.id);
        const hasChildren = node.children.length > 0;
        const style = getNodeStyle(node.name, node.type);

        const toggleExpand = (e: React.MouseEvent) => {
            e.stopPropagation();
            const newSet = new Set(expandedListNodes);
            if (newSet.has(node.id)) {
                newSet.delete(node.id);
            } else {
                newSet.add(node.id);
            }
            setExpandedListNodes(newSet);
        };

        const matchesSearch = !searchTerm || node.name.toLowerCase().includes(searchTerm.toLowerCase());

        return (
            <div key={node.id} className="select-none">
                {matchesSearch && (
                    <div
                        className={`flex items-center gap-1 py-1 px-2 hover:bg-white/5 cursor-pointer text-[10px] group transition-colors border-l-2`}
                        style={{
                            paddingLeft: `${depth * 12 + 8}px`,
                            borderLeftColor: style.border
                        }}
                        onClick={toggleExpand}
                    >
                        <div className="w-3 h-3 flex items-center justify-center shrink-0">
                            {hasChildren && (
                                isExpanded ? <ChevronDown size={10} className="text-zinc-500" /> : <ChevronRight size={10} className="text-zinc-500" />
                            )}
                        </div>
                        <div className="flex items-center gap-2 min-w-0">
                            {node.type === 'root' ? (
                                <Radio size={12} className="text-zinc-500 shrink-0" />
                            ) : (
                                <Terminal size={12} style={{ color: style.text }} className="shrink-0" />
                            )}
                            <span className="truncate font-mono" style={{ color: style.text }}>{node.name}</span>
                        </div>
                    </div>
                )}
                {isExpanded && hasChildren && (
                    <div>
                        {node.children.map(child => renderSidebarNode(child, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    if (!events || events.length === 0) {
        return (
            <div className="w-full h-full bg-[#0a0a0a] border border-white/5 rounded-lg overflow-hidden flex items-center justify-center">
                <span className="text-zinc-700 text-xs font-mono uppercase">No Telemetry Data</span>
            </div>
        );
    }

    if (!root) {
        return (
            <div className="w-full h-full bg-[#0a0a0a] border border-white/5 rounded-lg overflow-hidden flex items-center justify-center">
                <span className="text-zinc-700 text-xs font-mono uppercase">Failed to build process tree</span>
            </div>
        );
    }

    return (
        <div ref={rootRef} className={`w-full h-full bg-[#0a0a0a] border border-white/5 rounded-lg overflow-hidden relative flex ${printMode ? 'print-lineage-tree' : ''}`}>

            {/* Left Sidebar (Process List) - Only visible in non-print mode */}
            {!printMode && (
                <>
                    <div
                        style={{ width: sidebarWidth }}
                        className="flex-shrink-0 flex flex-col border-r border-white/5 bg-[#050505] overflow-hidden"
                    >
                        <div className="p-2 border-b border-white/5 shrink-0 flex items-center gap-2">
                            <div className="relative flex-1">
                                <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
                                <input
                                    type="text"
                                    placeholder="Filter Processes..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full bg-[#111] border border-white/5 rounded px-2 pl-6 py-1 text-[9px] text-zinc-300 outline-none focus:border-white/10"
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
                            {renderSidebarNode(root, 0)}
                        </div>
                    </div>

                    {/* Resizer */}
                    <div
                        onMouseDown={startResizing}
                        className={`w-1 cursor-col-resize hover:bg-brand-500 transition-colors z-50 flex-shrink-0 relative ${isResizing ? 'bg-brand-500' : 'bg-[#111] border-l border-white/5'}`}
                    >
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-4 w-0.5 bg-zinc-700 rounded-full"></div>
                    </div>
                </>
            )}

            {/* Right Pane: Graph */}
            <div ref={containerRef} className="flex-1 relative h-full min-w-0 bg-[#0a0a0a]">
                {!printMode && (
                    <div className="absolute top-2 left-2 text-[10px] uppercase font-black tracking-widest text-zinc-500 z-10 pointer-events-none">
                        Process Graph
                    </div>
                )}
                {!printMode && (
                    <div className="absolute top-2 right-2 flex items-center gap-3 z-10">
                        {onMaximize && (
                            <button
                                onClick={onMaximize}
                                className="p-1 hover:bg-white/10 rounded text-zinc-400 hover:text-white transition-colors"
                                title={isMaximized ? "Restore" : "Maximize"}
                            >
                                {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                            </button>
                        )}
                        <div className="flex items-center gap-1.5 text-[8px] uppercase tracking-wider font-bold">
                            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: COLOR.target.border }}></span>
                            <span className="text-zinc-600">Target</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[8px] uppercase tracking-wider font-bold">
                            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: COLOR.shell.border }}></span>
                            <span className="text-zinc-600">Shell</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[8px] uppercase tracking-wider font-bold">
                            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: COLOR.standard.border }}></span>
                            <span className="text-zinc-600">Process</span>
                        </div>
                    </div>
                )}
                <svg
                    ref={svgRef}
                    width={dimensions.width}
                    height={dimensions.height}
                    viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
                    className={`block mx-auto ${printMode ? '' : 'cursor-grab active:cursor-grabbing'}`}
                />
                {/* Tooltip container */}
                {!printMode && (
                    <div
                        ref={tooltipRef}
                        style={{
                            display: 'none',
                            position: 'absolute',
                            zIndex: 50,
                            background: COLOR.tooltip.bg,
                            border: `1px solid ${COLOR.tooltip.border}`,
                            borderRadius: '6px',
                            padding: '8px 12px',
                            maxWidth: '320px',
                            pointerEvents: 'none',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                        }}
                    />
                )}
            </div>
        </div>
    );
}

