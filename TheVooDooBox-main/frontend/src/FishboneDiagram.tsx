import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { AgentEvent } from './voodooApi';

interface FishboneProps {
    events: AgentEvent[];
    width?: number;
    height?: number;
    mitreData?: Map<number, string[]>;
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
}

// Force simulation node extends ProcessNode with D3 position fields
interface SimNode extends d3.SimulationNodeDatum {
    data: ProcessNode;
    radius: number;
    x?: number;
    y?: number;
    fx?: number | null;
    fy?: number | null;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
    source: number | SimNode;
    target: number | SimNode;
    timeDelta?: number;
}

// ── Color Palette ──
const COLOR = {
    root: '#666',
    target: '#ae00ff',    // Voodoo Purple
    shell: '#ff003c',     // Threat Red
    standard: '#00ff99',  // Toxic Green
    link: '#333',
    linkActive: '#ae00ff44',
    label: '#ccc',
    sublabel: '#666',
    timeDelta: '#555',
    bg: '#0a0a0a',
    glow: (c: string) => `${c}66`,
};

function nodeColor(name: string, type: string): string {
    if (type === 'root') return COLOR.root;
    const n = name.toLowerCase();
    if (n.includes('sample') || n.includes('artifact')) return COLOR.target;
    if (n.includes('cmd') || n.includes('powershell') || n.includes('wscript') || n.includes('cscript') || n.includes('mshta')) return COLOR.shell;
    return COLOR.standard;
}

function formatDelta(ms: number): string {
    if (ms <= 0) return '';
    if (ms < 1000) return `+${ms}ms`;
    if (ms < 60000) return `+${(ms / 1000).toFixed(1)}s`;
    return `+${(ms / 60000).toFixed(1)}m`;
}

// ── Build Hierarchy ──
function buildHierarchy(events: AgentEvent[], mitreData?: Map<number, string[]>): ProcessNode | null {
    if (!events || events.length === 0) return null;

    const processMap = new Map<number, ProcessNode>();

    const getOrCreate = (procId: number, pid: number, name: string): ProcessNode => {
        if (!processMap.has(procId)) {
            processMap.set(procId, {
                id: procId, pid, name,
                children: [], events: [], type: 'process',
                techniques: mitreData?.get(pid) || []
            });
        }
        return processMap.get(procId)!;
    };

    events.forEach(e => {
        const pId = e.process_id || 0;
        const node = getOrCreate(pId, e.process_id || 0, e.process_name || `Unknown (${pId})`);
        node.events.push(e);
        if (e.event_type === 'PROCESS_CREATE' && e.process_name) node.name = e.process_name;
    });

    // Start times
    processMap.forEach(node => {
        if (node.events.length > 0) {
            const create = node.events.find(e => e.event_type === 'PROCESS_CREATE');
            node.startTime = create ? create.timestamp : Math.min(...node.events.map(e => e.timestamp));
        }
    });

    // Parent→Child
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
    if (roots.length === 1) {
        roots[0].type = 'root';
        return roots[0];
    }

    const contextStart = Math.min(...roots.map(r => r.startTime || Infinity));
    return {
        id: -999, pid: 0, name: 'Detonation Context',
        children: roots, events: [], type: 'root',
        startTime: contextStart === Infinity ? 0 : contextStart
    };
}

// ── Flatten hierarchy into nodes & links for force simulation ──
function flatten(root: ProcessNode): { nodes: SimNode[]; links: SimLink[] } {
    const nodes: SimNode[] = [];
    const links: SimLink[] = [];
    const visited = new Set<number>();

    function walk(proc: ProcessNode, depth: number) {
        if (visited.has(proc.id)) return;
        visited.add(proc.id);

        const eventCount = proc.events.length;
        const radius = proc.type === 'root' ? 10 : Math.max(5, Math.min(14, 4 + eventCount * 0.8));

        const node: SimNode = { data: proc, radius };
        nodes.push(node);

        proc.children.forEach(child => {
            const timeDelta = (child.startTime && proc.startTime) ? child.startTime - proc.startTime : undefined;
            links.push({
                source: proc.id,
                target: child.id,
                timeDelta: timeDelta && timeDelta > 0 ? timeDelta : undefined
            });
            walk(child, depth + 1);
        });
    }

    walk(root, 0);
    console.log("[Fishbone] flatten result: nodes:", nodes.length, "links:", links.length);
    return { nodes, links };
}

// ────────────────────────────────────────────
// COMPONENT
// ────────────────────────────────────────────
export default function FishboneDiagram({ events, width = 800, height = 400, mitreData }: FishboneProps) {
    const svgRef = useRef<SVGSVGElement>(null);
    const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);

    const root = useMemo(() => {
        const r = buildHierarchy(events, mitreData);
        console.log("[Fishbone] root built:", !!r, "events:", events.length);
        return r;
    }, [events, mitreData]);

    const drawGalaxy = useCallback(() => {
        console.log("[Fishbone] drawGalaxy triggered. root:", !!root, "svgRef:", !!svgRef.current);
        if (!root || !svgRef.current) return;

        // Cleanup previous sim
        if (simRef.current) {
            console.log("[Fishbone] Stopping previous simulation");
            simRef.current.stop();
            simRef.current = null;
        }

        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        const { nodes, links } = flatten(root);

        // Map: id → SimNode for link resolution
        const nodeById = new Map<number, SimNode>();
        nodes.forEach(n => nodeById.set(n.data.id, n));

        // Resolve links to actual references
        const resolvedLinks: SimLink[] = links
            .map((l): SimLink | null => {
                const src = nodeById.get(l.source as number);
                const tgt = nodeById.get(l.target as number);
                if (!src || !tgt) return null;
                return {
                    source: src,
                    target: tgt,
                    timeDelta: l.timeDelta,
                };
            })
            .filter((l): l is SimLink => l !== null);

        console.log("[Fishbone] resolvedLinks after filter:", resolvedLinks.length);

        // ── Defs (gradients, glows) ──
        const defs = svg.append('defs');

        // Radial glow filter
        const glowFilter = defs.append('filter').attr('id', 'galaxy-glow');
        glowFilter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
        glowFilter.append('feMerge').selectAll('feMergeNode')
            .data(['blur', 'SourceGraphic'])
            .enter().append('feMergeNode')
            .attr('in', (d: any) => d);

        // ── Container group for zoom/pan ──
        const g = svg.append('g');

        const zoom = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.15, 5])
            .on('zoom', (event: any) => g.attr('transform', event.transform));

        svg.call(zoom)
            .call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2));

        // ── TEST CIRCLE at (0,0) ──
        g.append('circle').attr('r', 20).attr('fill', 'red').attr('opacity', 0.5);

        console.log("[Fishbone] Rendering", nodes.length, "nodes and", resolvedLinks.length, "links");

        // ── Links ──
        const linkSelection = g.selectAll('.galaxy-link')
            .data(resolvedLinks)
            .enter().append('line')
            .attr('class', 'galaxy-link')
            .attr('stroke', COLOR.link)
            .attr('stroke-width', 1)
            .attr('stroke-opacity', 0.4);

        // ── Time-delta labels on links ──
        const timeLabelSelection = g.selectAll('.galaxy-time')
            .data(resolvedLinks.filter(l => l.timeDelta))
            .enter().append('text')
            .attr('class', 'galaxy-time')
            .attr('text-anchor', 'middle')
            .attr('fill', COLOR.timeDelta)
            .attr('font-size', '8px')
            .attr('font-family', "'JetBrains Mono', monospace")
            .text((d: SimLink) => formatDelta(d.timeDelta!));

        // ── Node groups ──
        const nodeSelection = g.selectAll('.galaxy-node')
            .data(nodes)
            .enter().append('g')
            .attr('class', 'galaxy-node')
            .style('cursor', 'pointer')
            .call(d3.drag<SVGGElement, SimNode>()
                .on('start', (event: any, d: SimNode) => {
                    if (!event.active) simulation.alphaTarget(0.3).restart();
                    d.fx = d.x; d.fy = d.y;
                })
                .on('drag', (event: any, d: SimNode) => {
                    d.fx = event.x; d.fy = event.y;
                })
                .on('end', (event: any, d: SimNode) => {
                    if (!event.active) simulation.alphaTarget(0);
                    d.fx = null; d.fy = null;
                })
            );

        // Outer glow ring
        nodeSelection.append('circle')
            .attr('r', (d: SimNode) => d.radius + 4)
            .attr('fill', 'none')
            .attr('stroke', (d: SimNode) => COLOR.glow(nodeColor(d.data.name, d.data.type)))
            .attr('stroke-width', 2)
            .attr('stroke-opacity', 0.3)
            .attr('filter', 'url(#galaxy-glow)');

        // Core circle
        nodeSelection.append('circle')
            .attr('r', (d: SimNode) => d.radius)
            .attr('fill', (d: SimNode) => nodeColor(d.data.name, d.data.type))
            .attr('stroke', '#000')
            .attr('stroke-width', 1.5);

        // Inner bright dot (star effect)
        nodeSelection.append('circle')
            .attr('r', (d: SimNode) => Math.max(1.5, d.radius * 0.3))
            .attr('fill', '#fff')
            .attr('opacity', 0.6);

        // Process name label
        nodeSelection.append('text')
            .attr('dy', (d: SimNode) => -(d.radius + 6))
            .attr('text-anchor', 'middle')
            .attr('fill', COLOR.label)
            .attr('font-size', '10px')
            .attr('font-family', "'JetBrains Mono', monospace")
            .attr('font-weight', 'bold')
            .style('text-shadow', '0 2px 6px rgba(0,0,0,0.9)')
            .style('pointer-events', 'none')
            .text((d: SimNode) => d.data.name);

        // PID + event count sub-label
        nodeSelection.append('text')
            .attr('dy', (d: SimNode) => d.radius + 14)
            .attr('text-anchor', 'middle')
            .attr('fill', COLOR.sublabel)
            .attr('font-size', '8px')
            .attr('font-family', "'JetBrains Mono', monospace")
            .style('pointer-events', 'none')
            .text((d: SimNode) => {
                if (d.data.type === 'root') return '';
                return `PID:${d.data.pid} [${d.data.events.length}]`;
            });

        // MITRE Badges
        nodeSelection.each(function (this: SVGGElement, d: SimNode) {
            if (d.data.techniques && d.data.techniques.length > 0) {
                const g = d3.select(this as SVGGElement);
                const badges = d.data.techniques.slice(0, 3); // Max 3 badges

                badges.forEach((techId: string, i: number) => {
                    const bg = g.append('g')
                        .attr('transform', `translate(${(i * 24) - ((badges.length * 24) / 2) + 12}, ${d.radius + 24})`);

                    bg.append('rect')
                        .attr('x', -10)
                        .attr('y', -5)
                        .attr('width', 20)
                        .attr('height', 10)
                        .attr('rx', 2)
                        .attr('fill', '#ae00ff33')
                        .attr('stroke', '#ae00ff')
                        .attr('stroke-width', 0.5);

                    bg.append('text')
                        .attr('dy', 2)
                        .attr('text-anchor', 'middle')
                        .attr('font-size', '6px')
                        .attr('font-family', 'monospace')
                        .attr('fill', '#ae00ff')
                        .text(techId);
                });
            }
        });

        // ── Hover effects ──
        nodeSelection.on('mouseover', function (this: SVGGElement, _: any, d: SimNode) {
            d3.select(this).select('circle:nth-child(2)')
                .transition().duration(200)
                .attr('r', d.radius * 1.4)
                .attr('stroke-width', 2.5);
            d3.select(this).select('circle:first-child')
                .transition().duration(200)
                .attr('stroke-opacity', 0.8);

            // Highlight connected links
            linkSelection
                .attr('stroke', (l: SimLink) => {
                    const s = l.source as SimNode;
                    const t = l.target as SimNode;
                    return (s.data.id === d.data.id || t.data.id === d.data.id) ? nodeColor(d.data.name, d.data.type) : COLOR.link;
                })
                .attr('stroke-opacity', (l: SimLink) => {
                    const s = l.source as SimNode;
                    const t = l.target as SimNode;
                    return (s.data.id === d.data.id || t.data.id === d.data.id) ? 0.8 : 0.15;
                })
                .attr('stroke-width', (l: SimLink) => {
                    const s = l.source as SimNode;
                    const t = l.target as SimNode;
                    return (s.data.id === d.data.id || t.data.id === d.data.id) ? 2 : 1;
                });
        }).on('mouseout', function (this: SVGGElement, _: any, d: SimNode) {
            d3.select(this).select('circle:nth-child(2)')
                .transition().duration(300)
                .attr('r', d.radius)
                .attr('stroke-width', 1.5);
            d3.select(this).select('circle:first-child')
                .transition().duration(300)
                .attr('stroke-opacity', 0.3);

            linkSelection
                .attr('stroke', COLOR.link)
                .attr('stroke-opacity', 0.4)
                .attr('stroke-width', 1);
        });

        // ── Force Simulation ──
        const simulation = d3.forceSimulation<SimNode>(nodes)
            .force('link', d3.forceLink<SimNode, SimLink>(resolvedLinks)
                .id((d: SimNode) => d.data.id)
                .distance((d: SimLink) => {
                    const src = d.source as SimNode;
                    const tgt = d.target as SimNode;
                    return 60 + src.radius + tgt.radius;
                })
                .strength(0.7)
            )
            .force('charge', d3.forceManyBody<SimNode>()
                .strength((d: SimNode) => d.data.type === 'root' ? -400 : -200)
                .distanceMax(350)
            )
            .force('collision', d3.forceCollide<SimNode>()
                .radius((d: SimNode) => d.radius + 20)
                .strength(0.9)
            )
            .force('center', d3.forceCenter(0, 0).strength(0.05))
            .force('x', d3.forceX(0).strength(0.03))
            .force('y', d3.forceY(0).strength(0.03))
            .alpha(1)
            .alphaDecay(0.02)
            .on('tick', () => {
                if (simulation.alpha() > 0.98) console.log("[Fishbone] Simulation tick running: alpha =", simulation.alpha().toFixed(3));
                linkSelection
                    .attr('x1', (d: SimLink) => (d.source as SimNode).x!)
                    .attr('y1', (d: SimLink) => (d.source as SimNode).y!)
                    .attr('x2', (d: SimLink) => (d.target as SimNode).x!)
                    .attr('y2', (d: SimLink) => (d.target as SimNode).y!);

                timeLabelSelection
                    .attr('x', (d: SimLink) => ((d.source as SimNode).x! + (d.target as SimNode).x!) / 2)
                    .attr('y', (d: SimLink) => ((d.source as SimNode).y! + (d.target as SimNode).y!) / 2 - 6);

                nodeSelection.attr('transform', (d: SimNode) => `translate(${d.x},${d.y})`);
            });

        simRef.current = simulation;
    }, [root, width, height]);

    useEffect(() => {
        drawGalaxy();
        return () => { if (simRef.current) simRef.current.stop(); };
    }, [drawGalaxy]);

    return (
        <div className="w-full h-full bg-[#0a0a0a] border border-white/5 rounded-lg overflow-hidden relative">
            <div className="absolute top-2 left-2 text-[10px] uppercase font-black tracking-widest text-zinc-500 z-10">
                Process Galaxy
            </div>
            {(!events || events.length === 0) ? (
                <div className="flex items-center justify-center h-full text-zinc-700 text-xs font-mono uppercase">
                    No Telemetry Data
                </div>
            ) : !root ? (
                <div className="flex items-center justify-center h-full text-zinc-700 text-xs font-mono uppercase">
                    Failed to build process tree
                </div>
            ) : (
                <svg
                    ref={svgRef}
                    width={width}
                    height={height}
                    viewBox={`0 0 ${width} ${height}`}
                    className="block mx-auto cursor-grab active:cursor-grabbing"
                />
            )}
        </div>
    );
}
