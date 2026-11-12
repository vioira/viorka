import { Input } from '@/components/arc/input/input';

export type TCPProbeRow = { name: string; target: string };
const slots = [0, 1, 2] as const;

export function tcpProbeRows(targets: string[] = [], names: string[] = []): TCPProbeRow[] {
  return slots.map((index) => ({ name: names[index] ?? '', target: targets[index] ?? '' }));
}

export function tcpProbeConfig(rows: TCPProbeRow[]) {
  const filled = rows
    .map((row) => ({ name: row.name.trim(), target: row.target.trim() }))
    .filter((row) => row.name || row.target);
  if (filled.some((row) => !row.target)) throw new Error('请填写名称对应的 TCP 目标地址。');
  return { targets: filled.map((row) => row.target), names: filled.map((row) => row.name) };
}

export default function TCPProbeFields({
  rows,
  disabled,
  onChange,
}: {
  rows: TCPProbeRow[];
  disabled: boolean;
  onChange: (rows: TCPProbeRow[]) => void;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      {slots.map((index) => (
        <fieldset key={index} className="min-w-0">
          <legend className="mb-2 text-(length:--text-sm) text-foreground">TCP {index + 1}</legend>
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <Input
              label="名称"
              aria-label={`TCP ${index + 1} 名称`}
              value={rows[index].name}
              maxLength={64}
              placeholder="例如：香港节点"
              onChange={(event) =>
                onChange(
                  rows.map((row, i) => (i === index ? { ...row, name: event.target.value } : row)),
                )
              }
            />
            <Input
              label="TCP 目标"
              aria-label={`TCP ${index + 1} 目标`}
              value={rows[index].target}
              maxLength={259}
              placeholder="example.com:443"
              onChange={(event) =>
                onChange(
                  rows.map((row, i) =>
                    i === index ? { ...row, target: event.target.value } : row,
                  ),
                )
              }
            />
          </div>
        </fieldset>
      ))}
    </fieldset>
  );
}
