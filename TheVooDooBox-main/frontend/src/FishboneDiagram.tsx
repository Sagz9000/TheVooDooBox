import React, { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { AgentEvent } from './voodooApi';

interface FishboneProps {
    events: AgentEvent[];
    width?: number;
    height?: number;
}

interface Node extends d3.HierarchyNode<any> {
    x: number;
    y: number;
}

export default function FishboneDiagram({ events, width = 800, height = 400 }: FishboneProps) {
    const svgRef = useRef<SVGSVGElement>(null);

    // Process events into a hierarchy
    const root = useMemo(() => {
        if (!events || events.length === 0) return null;

        // 1. Identify Processes
        const processes = new Map<number, any>();
        const processEvents = events.filter(e => e.event_type === 'PROCESS_CREATE');

        // Root identification (simplistic: lowest PID or first found)
        let rootPid = processEvents.length > 0 ? processEvents[0].pid : 0;

        // Build Process Map
        // If we have no explicit process create events, we might have to infer from "process_name" + "pid" in other events
        // For now, let's assume we build a tree from unique PIDs found in the stream

        const uniquePids = Array.from(new Set(events.map(e => e.pid).filter(p => p !== undefined && p !== null)));

        const hierarchyData: any = {
            name: "Detonation Root",
            pid: 0,
            children: []
        };

        // Group events by PID
        const eventsByPid = new Map<number, AgentEvent[]>();
        events.forEach(e => {
            if (!e.pid) return;
            if (!eventsByPid.has(e.pid)) eventsByPid.set(e.pid, []);
            eventsByPid.get(e.pid)?.push(e);
        });

        // Simple flat list to hierarchy for visualization (Star Topology for now if parent_pid is missing)
        // Ideally we use ppid, but let's see if we have it. AgentEvent doesn't explicitly guarantee ppid in all event types.
        // We will make a "Timeline Spine" where the main process is the spine, and children span off.

        // Strategy: 
        // Main Spine = The PID with the most events or the first one.
        // Branches = Other PIDs.

        if (uniquePids.length > 0) {
            const mainPid = uniquePids[0]; // Assumption
            hierarchyData.name = eventsByPid.get(mainPid)?.[0]?.process_name || `PID ${mainPid}`;
            hierarchyData.pid = mainPid;
            hierarchyData.type = "process";
            hierarchyData.events = eventsByPid.get(mainPid) || [];

            // Add other PIDs as children for the visual
            uniquePids.slice(1).forEach(pid => {
                const pEvents = eventsByPid.get(pid) || [];
                hierarchyData.children.push({
                    name: pEvents[0]?.process_name || `PID ${pid}`,
                    pid: pid,
                    type: "process",
                    events: pEvents,
                    children: []
                });
            });
        }

        return d3.hierarchy(hierarchyData);
    }, [events]);

    useEffect(() => {
        if (!root || !svgRef.current) return;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove(); // Clear previous render

        const margin = { top: 20, right: 90, bottom: 30, left: 90 };
        const innerWidth = width - margin.left - margin.right;
        const innerHeight = height - margin.top - margin.bottom;

        const g = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        // Tree Layout
        const treeLayout = d3.tree().size([innerHeight, innerWidth]);
        const treeData = treeLayout(root);

        // Links
        g.selectAll(".link")
            .data(treeData.links())
            .enter().append("path")
            .attr("class", "link")
            .attr("d", d3.linkHorizontal()
                .x((d: any) => d.y)
                .y((d: any) => d.x)
            )
            .attr("fill", "none")
            .attr("stroke", "#555")
            .attr("stroke-width", 2);

        // Nodes
        const nodes = g.selectAll(".node")
            .data(treeData.descendants())
            .enter().append("g")
            .attr("class", (d: any) => "node" + (d.children ? " node--internal" : " node--leaf"))
            .attr("transform", (d: any) => `translate(${d.y},${d.x})`);

        // Node Circles
        nodes.append("circle")
            .attr("r", 6)
            .attr("fill", (d: any) => d.data.type === 'process' ? '#ae00ff' : '#00ff99') // Toxic Green vs Voodoo Purple
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5);

        // Labels
        nodes.append("text")
            .attr("dy", ".35em")
            .attr("x", (d: any) => d.children ? -13 : 13)
            .style("text-anchor", (d: any) => d.children ? "end" : "start")
            .text((d: any) => d.data.name)
            .style("fill", "#ccc")
            .style("font-size", "10px")
            .style("font-family", "monospace");

        // Event "Ribs" (Simplified: count of events as subtitle)
        nodes.append("text")
            .attr("dy", "1.5em")
            .attr("x", (d: any) => d.children ? -13 : 13)
            .style("text-anchor", (d: any) => d.children ? "end" : "start")
            .text((d: any) => `${d.data.events?.length || 0} events`)
            .style("fill", "#666")
            .style("font-size", "8px");

    }, [root, width, height]);

    return (
        <div className="w-full h-full bg-[#0a0a0a] border border-white/5 rounded-lg overflow-hidden relative">
            <div className="absolute top-2 left-2 text-[10px] uppercase font-black tracking-widest text-zinc-500">
                Activity Flow (Fishbone)
            </div>
            <svg ref={svgRef} width={width} height={height} className="block mx-auto" />
        </div>
    );
}
