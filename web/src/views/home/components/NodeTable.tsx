import { useState } from "react";
import { Button } from "@/components/arc/button/button";
import DataTable, { type DataColumn } from "@/components/data-table";
import Usage from "@/components/usage";
import type { OverviewNode } from "../mock-data";

const states = {
  online: { text: "在线", className: "text-success" },
  offline: { text: "离线", className: "text-danger" },
  degraded: { text: "受限", className: "text-warning" },
};
const columns: DataColumn<OverviewNode>[] = [
  {
    key: "id",
    label: "节点",
    render: (_, node) => <span className="font-medium">{node.id}</span>,
  },
  {
    key: "region",
    label: "地区 / 类型",
    render: (_, node) => (
      <div className="flex flex-wrap items-center">
        <span className="font-medium">{node.region}</span>
        <span className="mx-1">·</span>
        <span className="text-(length:--text-xs) text-text-secondary">
          {node.kind}
        </span>
      </div>
    ),
  },
  {
    key: "state",
    label: "状态",
    render: (_, node) => (
      <span
        className={`inline-flex items-center gap-2 ${states[node.state].className}`}
      >
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
        {states[node.state].text}
      </span>
    ),
  },
  { key: "engine", label: "引擎" },
  {
    key: "cpu",
    label: "CPU",
    numeric: true,
    render: (_, node) => <Usage value={node.cpu} label="CPU" />,
  },
  {
    key: "memory",
    label: "内存",
    numeric: true,
    render: (_, node) => <Usage value={node.memory} label="内存" />,
  },
  {
    key: "traffic",
    label: "今日流量",
    numeric: true,
    render: (_, node) =>
      node.traffic === null ? (
        <span className="text-text-secondary">无数据</span>
      ) : (
        `${node.traffic.toFixed(1)} GB`
      ),
  },
];

export default function NodeTable({ nodes }: { nodes: OverviewNode[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section
      aria-labelledby="nodes-heading"
      className="min-w-0 rounded-(--radius-panel) border-[0.5px] border-border bg-(--surface) p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="nodes-heading" className="font-medium">
          节点
        </h2>
        <Button
          variant="ghost"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls="overview-node-table"
        >
          {expanded ? "收起节点" : `查看全部 ${nodes.length} 个`}
        </Button>
      </div>
      <div id="overview-node-table">
        <DataTable
          tableClassName="sm:min-w-[960px]"
          rows={expanded ? nodes : nodes.slice(0, 5)}
          columns={columns}
          rowKey="id"
          caption="节点资源与运行状态（演示数据）"
          emptyMessage="暂无节点，请先注册 Agent"
        />
      </div>
      <p className="mt-3 text-(length:--text-xs) text-text-secondary">
        显示 {expanded ? nodes.length : Math.min(nodes.length, 5)} /{" "}
        {nodes.length} 个节点，排序作用于当前显示的记录。
      </p>
    </section>
  );
}
