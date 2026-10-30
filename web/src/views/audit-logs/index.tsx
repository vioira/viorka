import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/arc/button/button";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import DataTable, { type DataColumn } from "@/components/data-table";
import { auditCsv } from "./export";
import { type AuditRecord, mockAudits } from "./mock-data";

function LocalTime({ value }: { value: string }) {
  const [label, setLabel] = useState(value);
  useEffect(() => {
    setLabel(new Date(value).toLocaleString("zh-CN", { hour12: false }));
  }, [value]);
  return (
    <time dateTime={value} className="tabular-nums" title={value}>
      {label}
    </time>
  );
}

const columns: DataColumn<AuditRecord>[] = [
  {
    key: "actor",
    label: "操作者",
    render: (_, row) => <span className="font-medium">{row.actor}</span>,
  },
  { key: "action", label: "动作" },
  { key: "target", label: "对象" },
  {
    key: "ip",
    label: "来源 IP",
    render: (_, row) => (
      <span className="font-mono text-text-secondary">{row.ip}</span>
    ),
  },
  {
    key: "time",
    label: "时间",
    render: (_, row) => <LocalTime value={row.time} />,
  },
];

export default function AuditLogsPage() {
  const [filter, setFilter] = useState("all");
  const { toast } = useToastStack();
  const records = mockAudits.filter(
    (record) => filter === "all" || record.kind === filter,
  );
  function exportCsv() {
    let url: string | undefined;
    try {
      url = URL.createObjectURL(
        new Blob([auditCsv(records)], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `viorka-audit-mock-${filter}.csv`;
      link.click();
      toast({
        type: "success",
        title: `已生成 ${records.length} 条演示记录的 CSV 并发起下载。`,
      });
    } catch {
      toast({
        type: "error",
        title: "无法生成 CSV，请重试或检查浏览器的下载设置。",
      });
    } finally {
      if (url) {
        const downloadUrl = url;
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-title text-(length:--text-2xl) font-medium">
              审计日志
            </h1>
            <span className="text-(length:--text-xs) text-text-secondary">
              演示数据
            </span>
          </div>
          <p className="mt-2 max-w-prose text-text-secondary">
            查看身份、令牌、发布与吊销等操作记录。日志不展示密钥与完整配置。
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={exportCsv}
          disabled={!records.length}
        >
          <Download size={16} aria-hidden="true" />
          导出 CSV
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <SegmentedControl
          label="筛选审计日志"
          value={filter}
          onValueChange={(value) => {
            setFilter(value);
          }}
          options={[
            { value: "all", label: "全部" },
            { value: "user", label: "用户操作" },
            { value: "system", label: "系统事件" },
          ]}
        />
        <p role="status" className="text-text-secondary tabular-nums">
          {records.length} 条记录
        </p>
      </div>
      <DataTable
        rows={records}
        columns={columns}
        rowKey="id"
        defaultSort={{ key: "time", direction: "desc" }}
        tableClassName="sm:min-w-[960px]"
        caption="审计日志（演示数据）"
        emptyMessage="当前筛选下没有审计记录，请切换到全部"
      />
      <p className="text-(length:--text-xs) text-text-secondary">
        当前展示 mock 数据，未连接审计接口。时间按浏览器时区显示；CSV
        包含当前筛选的全部记录，时间使用 UTC。
      </p>
    </>
  );
}
