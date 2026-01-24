import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';

export interface Process {
    pid: number;
    parent_pid?: number;
    name: string;
    status: 'running' | 'terminated';
    behaviors: string[];
}

interface ProcessNode extends Process {
    id: string;
    children?: ProcessNode[];
}

interface ProcessTreeProps {
    processes: Record<number, Process>;
    selectedPid?: number;
    onNodeClick?: (pid: number) => void;
}

export default function ProcessTree({ processes, selectedPid, onNodeClick }: ProcessTreeProps) {
    const svgRef = useRef<SVGSVGElement>(null);

    const buildTree = (data: Record<number, Process>): ProcessNode | null => {
        const nodes: Record<number, ProcessNode> = {};
        let root: ProcessNode | null = null;

        Object.entries(data).forEach(([pid, p]) => {
            nodes[Number(pid)] = { ...p, id: pid.toString(), children: [] };
        });

        Object.entries(nodes).forEach(([, node]) => {
            if (node.parent_pid && nodes[node.parent_pid]) {
                nodes[node.parent_pid].children?.push(node);
            } else if (!root || node.pid === 4) {
                root = node;
            }
        });

        return root;
    };

    useEffect(() => {
        if (!svgRef.current) return;

        const treeData = buildTree(processes);
        if (!treeData) return;

        const width = 800;
        const height = 500;
        const margin = { top: 20, right: 160, bottom: 20, left: 160 };

        d3.select(svgRef.current).selectAll("*").remove();

        const svg = d3.select(svgRef.current)
            .attr("viewBox", `0 0 ${width} ${height}`)
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        const treeLayout = d3.tree<ProcessNode>().size([height - margin.top - margin.bottom, width - margin.left - margin.right]);

        const root = d3.hierarchy(treeData);
        treeLayout(root);

        // Links
        svg.selectAll(".link")
            .data(root.links())
            .enter()
            .append("path")
            .attr("d", d3.linkHorizontal<d3.HierarchyPointLink<ProcessNode>, d3.HierarchyPointNode<ProcessNode>>()
                .x((d: d3.HierarchyPointNode<ProcessNode>) => d.y)
                .y((d: d3.HierarchyPointNode<ProcessNode>) => d.x))
            .attr("fill", "none")
            .attr("stroke", "#334155")
            .attr("stroke-width", 1.5);

        // Nodes
        const node = svg.selectAll(".node")
            .data(root.descendants())
            .enter()
            .append("g")
            .attr("transform", (d: d3.HierarchyPointNode<ProcessNode>) => `translate(${d.y},${d.x})`)
            .on("click", (event: any, d: d3.HierarchyPointNode<ProcessNode>) => {
                if (onNodeClick) onNodeClick(d.data.pid);
            })
            .style("cursor", "pointer");

        node.append("circle")
            .attr("r", (d: d3.HierarchyPointNode<ProcessNode>) => d.data.pid === selectedPid ? 8 : 5)
            .attr("fill", (d: d3.HierarchyPointNode<ProcessNode>) => d.data.behaviors.length > 0 ? "#f43f5e" : "#0e91e9")
            .attr("stroke", "#141820")
            .attr("stroke-width", 2)
            .style("transition", "all 0.3s ease");

        node.append("text")
            .attr("dy", ".35em")
            .attr("x", (d: d3.HierarchyPointNode<ProcessNode>) => d.children ? -10 : 10)
            .attr("text-anchor", (d: d3.HierarchyPointNode<ProcessNode>) => d.children ? "end" : "start")
            .attr("fill", (d: d3.HierarchyPointNode<ProcessNode>) => d.data.pid === selectedPid ? "#ffffff" : "#94a3b8")
            .attr("font-family", "Inter, sans-serif")
            .attr("font-size", d.data.pid === selectedPid ? "12px" : "10px")
            .attr("font-weight", d.data.pid === selectedPid ? "bold" : "normal")
            .text((d: d3.HierarchyPointNode<ProcessNode>) => d.data.name);

    }, [processes, selectedPid]);

    return (
        <div className="w-full h-full bg-security-surface border border-security-border rounded-xl p-6 flex flex-col shadow-2xl">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-white font-bold flex items-center gap-2">Behavior Lineage</h3>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Process Relationship Tree</p>
                </div>
            </div>

            <div className="flex-1 overflow-auto bg-security-bg/50 rounded-lg flex items-center justify-center p-4 border border-security-border/50">
                <svg ref={svgRef} className="w-full h-full"></svg>
            </div>

            <div className="mt-4 flex gap-6 border-t border-security-border pt-4">
                <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    <div className="w-2 h-2 bg-brand-500 rounded-full"></div> Clean
                </div>
                <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    <div className="w-2 h-2 bg-threat-critical rounded-full"></div> Suspicious
                </div>
            </div>
        </div>
    );
}
