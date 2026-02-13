import React, { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { AgentEvent } from './voodooApi';

interface FishboneProps {
    events: AgentEvent[];
    width?: number;
    height?: number;
}

interface ProcessNode {
    id: number; // process_id
    pid: number; // The OS PID (for display)
    name: string;
    children: ProcessNode[];
    events: AgentEvent[];
    type: 'root' | 'process';
    startTime?: number;
}

export default function FishboneDiagram({ events, width = 800, height = 400 }: FishboneProps) {
    const svgRef = useRef<SVGSVGElement>(null);
    const gRef = useRef<SVGGElement | null>(null);

    // Process events into a hierarchy
    const root = useMemo(() => {
        if (!events || events.length === 0) return null;

        // 1. Identify distinct processes by process_id (or fallback to pid if process_id is missing)
        // We use a Map<process_id, Node>
        const processMap = new Map<number, ProcessNode>();

        // Helper to get or create a node
        const getOrCreateNode = (procId: number, pid: number, name: string): ProcessNode => {
            if (!processMap.has(procId)) {
                processMap.set(procId, {
                    id: procId,
                    pid: pid,
                    name: name,
                    children: [],
                    events: [],
                    type: 'process'
                });
            }
            return processMap.get(procId)!;
        };

        // 2. Iterate events to build nodes and attach events
        events.forEach(e => {
            // Ensure we have a valid process_id. If 0 or undefined, we might need a fallback,
            // but usually the agent sends process_id.
            const pId = e.process_id || e.pid || 0; // Fallback to PID if process_id is missing
            const node = getOrCreateNode(pId, e.process_id || e.pid || 0, e.process_name || `Unknown (${pId})`);
            node.events.push(e);

            // Update name if we find a better one (e.g., from PROCESS_CREATE)
            if (e.event_type === 'PROCESS_CREATE' && e.process_name) {
                node.name = e.process_name;
            }
        });

        // 2.5 Calculate Start Times
        processMap.forEach(node => {
            if (node.events.length > 0) {
                // Determine start time based on the earliest event
                // If there's a PROCESS_CREATE, that's definitive. Otherwise min of all.
                const createEvent = node.events.find(e => e.event_type === 'PROCESS_CREATE');
                if (createEvent) {
                    node.startTime = createEvent.timestamp;
                } else {
                    node.startTime = Math.min(...node.events.map(e => e.timestamp));
                }
            }
        });

        // 3. Build Relationships (Parent -> Child)
        // We need to find the parent for each node.
        // We can look at PROCESS_CREATE events to find the parent_process_id.
        // Or we can just look at ANY event for that process, as they should all share the same parent_process_id
        // (assuming the agent sends it consistently).

        const roots: ProcessNode[] = [];

        processMap.forEach((node, procId) => {
            // Find a parent_process_id from the events of this process
            // systematic way: find the PROCESS_CREATE event
            const createEvent = node.events.find(e => e.event_type === 'PROCESS_CREATE');
            // fallback: any event
            const anyEvent = node.events[0];

            // The parent_process_id from the event
            const parentProcId = createEvent?.parent_process_id || anyEvent?.parent_process_id;

            if (parentProcId && processMap.has(parentProcId) && parentProcId !== procId) {
                // We found a parent in our map
                const parent = processMap.get(parentProcId)!;
                parent.children.push(node);
            } else {
                // No parent found in map -> It's a root (or orphan)
                roots.push(node);
            }
        });

        // 4. Create a single Virtual Root if multiple roots exist, or utilize the single root
        let hierarchyRoot: ProcessNode;

        if (roots.length === 0) {
            return null; // Should not happen if events > 0
        } else if (roots.length === 1) {
            hierarchyRoot = roots[0];
            hierarchyRoot.type = 'root'; // Mark as main root
            // Ensure root has a start time for delta calcs if needed (e.g. from its first child?)
            // If actual root, it has events.
        } else {
            // Multiple roots (e.g. system processes noise + actual malware)
            // We create a virtual "Detonation" root
            // Start time = min of all roots
            const contextStart = roots.length > 0
                ? Math.min(...roots.map(r => r.startTime || Infinity))
                : Date.now();

            hierarchyRoot = {
                id: 0,
                pid: 0,
                name: "Detonation Context",
                children: roots,
                events: [],
                type: 'root',
                startTime: contextStart === Infinity ? 0 : contextStart
            };
        }

        return d3.hierarchy(hierarchyRoot);
    }, [events]);

    useEffect(() => {
        if (!root || !svgRef.current) return;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove(); // Clear previous render

        const margin = { top: 20, right: 120, bottom: 20, left: 120 };
        const innerWidth = width - margin.left - margin.right;
        const innerHeight = height - margin.top - margin.bottom;

        // Container for Zoom
        const g = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        gRef.current = g.node();

        // Zoom Behavior
        const zoom = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.1, 4])
            .on("zoom", (event) => {
                g.attr("transform", event.transform);
            });

        svg.call(zoom)
            .call(zoom.transform, d3.zoomIdentity.translate(margin.left, margin.top));


        // Tree Layout - Horizontal
        // Note: d3.tree() expects [height, width] for horizontal layouts if we swap x/y later
        const treeLayout = d3.tree<ProcessNode>().size([innerHeight, innerWidth]);
        const treeData = treeLayout(root);

        // Links (Paths)
        g.selectAll(".link")
            .data(treeData.links())
            .enter().append("path")
            .attr("class", "link")
            .attr("d", d3.linkHorizontal<any, any>()
                .x(d => d.y)
                .y(d => d.x)
            )
            .attr("fill", "none")
            .attr("stroke", "#333")
            .attr("stroke-width", 1.5)
            .attr("opacity", 0.6);

        // Time Spread Labels
        g.selectAll(".time-label")
            .data(treeData.links())
            .enter().append("text")
            .attr("class", "time-label")
            .attr("x", d => (d.source.y + d.target.y) / 2)
            .attr("y", d => (d.source.x + d.target.x) / 2 - 4) // Slight offset above the link
            .attr("text-anchor", "middle")
            .style("fill", "#666")
            .style("font-size", "9px")
            .style("font-family", "'JetBrains Mono', monospace")
            .text(d => {
                const start = d.source.data.startTime;
                const end = d.target.data.startTime;
                if (start && end) {
                    const diff = end - start;
                    if (diff <= 0) return ""; // effectively instantaneous or weird order
                    if (diff < 1000) return `+${diff}ms`;
                    return `+${(diff / 1000).toFixed(2)}s`;
                }
                return "";
            });

        // Nodes (Groups)
        const nodes = g.selectAll(".node")
            .data(treeData.descendants())
            .enter().append("g")
            .attr("class", d => "node" + (d.children ? " node--internal" : " node--leaf"))
            .attr("transform", d => `translate(${d.y},${d.x})`);

        // Node Visuals (Circle vs Hexagon? Let's stick to Circles for now)
        nodes.append("circle")
            .attr("r", d => d.data.type === 'root' ? 6 : 4)
            .attr("fill", d => {
                if (d.data.type === 'root') return '#555'; // Grey for virtual root
                // Heuristic coloring
                const name = d.data.name.toLowerCase();
                if (name.includes('sample') || name.includes('artifact')) return '#ae00ff'; // Voodoo Purple (Target)
                if (name.includes('cmd') || name.includes('powershell')) return '#ff003c'; // Threat Red (Shells)
                return '#00ff99'; // Toxic Green (Standard)
            })
            .attr("stroke", "#000")
            .attr("stroke-width", 1.5)
            .attr("class", "transition-all duration-300 hover:r-6"); // simplistic hover effect class (controlled by CSS usually)

        // Labels (Process Name)
        nodes.append("text")
            .attr("dy", -8)
            .attr("x", 0)
            .style("text-anchor", "middle")
            .text(d => d.data.name)
            .style("fill", "#ccc")
            .style("font-size", "10px")
            .style("font-family", "'JetBrains Mono', monospace")
            .style("font-weight", "bold")
            .style("pointer-events", "none")
            .style("text-shadow", "0 2px 4px rgba(0,0,0,0.8)");

        // Sub-labels (PID | Events)
        nodes.append("text")
            .attr("dy", 14)
            .attr("x", 0)
            .style("text-anchor", "middle")
            .text(d => {
                if (d.data.type === 'root') return '';
                return `PID:${d.data.pid} [${d.data.events.length}]`;
            })
            .style("fill", "#666")
            .style("font-size", "8px")
            .style("font-family", "'JetBrains Mono', monospace");

    }, [root, width, height]);

    return (
        <div className="w-full h-full bg-[#0a0a0a] border border-white/5 rounded-lg overflow-hidden relative">
            <div className="absolute top-2 left-2 text-[10px] uppercase font-black tracking-widest text-zinc-500 z-10">
                Activity Flow (Fishbone)
            </div>
            {(!events || events.length === 0) ? (
                <div className="flex items-center justify-center h-full text-zinc-700 text-xs font-mono uppercase">
                    No Telemetry Data
                </div>
            ) : (
                <svg ref={svgRef} width={width} height={height} className="block mx-auto cursor-grab active:cursor-grabbing" />
            )}
        </div>
    );
}
