import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import {
  createEnrollment,
  type Enrollment,
  type EnrollmentRecord,
  listEnrollments,
  type NodeKind,
  revokeEnrollment,
} from '@/api/enrollment';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import DataTable, { type DataColumn } from '@/components/data-table';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import SettingsSection from './SettingsSection';

const kinds = [
  { value: 'vps', label: '公网 VPS' },
  { value: 'nat', label: 'NAT VPS' },
  { value: 'relay', label: '中转' },
];
const steps = [
  ['在面板生成令牌', '填写节点名称与类型，令牌有效期为 15 分钟。'],
  ['在节点运行 Agent', '使用 viorka-agent enroll，通过安全输入提供令牌。'],
  ['签名挑战并建立 WSS', 'Agent 本地生成密钥，面板只保存公钥。'],
  ['检查节点连接', '确认节点在线，完成首次只读检查。'],
];
export default function EnrollmentSettings() {
  const session = useOutletContext<Session>();
  const admin = session.user.role === 'admin';
  const [name, setName] = useState('');
  const [kind, setKind] = useState<NodeKind>('vps');
  const [result, setResult] = useState<Enrollment | null>(null);
  const [records, setRecords] = useState<EnrollmentRecord[]>([]);
  const [pending, setPending] = useState('');
  const busy = useRef(false);
  const [error, setError] = useToastFeedback('error');
  const [, setNotice] = useToastFeedback('success');
  const [now, setNow] = useState(0);
  const [after, setAfter] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const reload = useCallback(async () => {
    if (!admin) return;
    setLoading(true);
    setListError('');
    try {
      setRecords((await listEnrollments(after)).items);
    } catch (e) {
      setListError(e instanceof Error ? e.message : '无法加载令牌记录，请重试。');
    } finally {
      setLoading(false);
    }
  }, [admin, after]);
  useEffect(() => {
    if (!admin) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    listEnrollments(after, controller.signal)
      .then((v) => setRecords(v.items))
      .catch((e) => {
        if (!controller.signal.aborted)
          setListError(e instanceof Error ? e.message : '无法加载令牌记录，请重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [admin, after]);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (result && Date.parse(result.expires_at) <= now) setResult(null);
  }, [now, result]);
  async function generate() {
    if (!admin || busy.current) return;
    if (!name.trim() || new TextEncoder().encode(name.trim()).length > 128) {
      setError('请输入 1 到 128 字节的节点名称。');
      return;
    }
    busy.current = true;
    setPending('create');
    setError('');
    setNotice('');
    try {
      const token = await createEnrollment(session, name, kind);
      setResult(token);
      await reload();
      setNotice('注册令牌已生成，请在有效期内安全提供给 Agent。');
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : '无法生成令牌。'} 若请求超时或连接中断，创建结果可能未知；请勿连续重复提交，未使用的令牌将在 15 分钟后过期。`,
      );
    } finally {
      busy.current = false;
      setPending('');
    }
  }
  async function revoke(id: string) {
    if (!admin || busy.current) return;
    busy.current = true;
    setPending(id);
    setError('');
    setNotice('');
    try {
      await revokeEnrollment(session, id);
      await reload();
      if (result?.id === id) setResult(null);
      setNotice('注册令牌已吊销，已注册的节点不受影响。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '吊销未完成，请稍后重试。');
    } finally {
      busy.current = false;
      setPending('');
    }
  }
  const columns: DataColumn<EnrollmentRecord>[] = [
    {
      key: 'id',
      label: '令牌',
      render: (_, row) => (
        <span className="font-mono" title={row.id}>
          {row.id.slice(0, 8)}…
        </span>
      ),
    },
    {
      key: 'name',
      label: '节点',
      render: (_, row) => <span className="break-all">{row.name}</span>,
    },
    {
      key: 'expires_at',
      label: '到期时间',
      render: (_, row) => (
        <time className="tabular-nums" dateTime={row.expires_at}>
          {new Date(row.expires_at).toLocaleString('zh-CN')}
        </time>
      ),
    },
    {
      key: 'state',
      sortable: false,
      label: '状态',
      render: (_, row) =>
        ({
          active: Date.parse(row.expires_at) <= now ? '已过期' : '待使用',
          used: '已使用',
          expired: '已过期',
          revoked: '已吊销',
        })[row.state],
    },
    {
      key: 'actions',
      sortable: false,
      label: '操作',
      render: (_, row) => (
        <Button
          variant="ghost"
          disabled={
            !admin || !!pending || row.state !== 'active' || Date.parse(row.expires_at) <= now
          }
          loading={pending === row.id}
          onClick={() => revoke(row.id)}
          aria-label={`吊销 ${row.name} 的注册令牌`}
        >
          吊销令牌
        </Button>
      ),
    },
  ];
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <SettingsSection
          title="生成注册令牌"
          description="一次性令牌，15 分钟内有效。Agent 用它绑定 Ed25519 身份。明文仅保存在本次页面内存中。"
        >
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void generate();
            }}
          >
            <fieldset disabled={!admin || !!pending} className="min-w-0 space-y-5">
              <Input
                label="节点名称"
                placeholder="例如 jp-nat-03"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={128}
              />
              <SegmentedControl
                label="节点类型"
                value={kind}
                onValueChange={(value) => setKind(value as NodeKind)}
                options={kinds}
                className="[--control-height-sm:44px]"
              />
              <Button type="submit" loading={pending === 'create'}>
                生成令牌
              </Button>
            </fieldset>
            {!admin && <p className="text-(length:--text-xs)">仅管理员可生成或吊销注册令牌。</p>}
          </form>

          {result && (
            <div className="space-y-3">
              <Input
                label="注册令牌"
                readOnly
                value={result.token}
                onFocus={(event) => event.currentTarget.select()}
                description="点击选中后复制。令牌明文只显示这一次，关闭后无法找回。"
              />
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(result.token);
                    setNotice('注册令牌已复制。');
                  } catch {
                    setError('无法访问剪贴板，请选中令牌后手动复制。');
                  }
                }}
              >
                复制令牌
              </Button>
            </div>
          )}
        </SettingsSection>
        <SettingsSection title="令牌记录">
          <DataTable
            loading={loading}
            error={listError}
            onRetry={reload}
            columns={columns}
            rows={records}
            rowKey={(row) => row.id}
            caption="注册令牌记录"
            emptyMessage="暂无注册令牌"
            tableClassName="min-w-140"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!admin || loading} onClick={reload}>
              刷新记录
            </Button>
            <Button
              variant="secondary"
              disabled={!pages.length || loading}
              onClick={() => {
                setAfter(pages[pages.length - 1]);
                setPages(pages.slice(0, -1));
              }}
            >
              上一页
            </Button>
            <Button
              variant="secondary"
              disabled={records.length < 50 || loading}
              onClick={() => {
                setPages([...pages, after]);
                setAfter(records[records.length - 1].id);
              }}
            >
              下一页
            </Button>
          </div>
        </SettingsSection>
      </div>
      <SettingsSection title="注册流程">
        <ol className="space-y-6">
          {steps.map(([title, description], index) => (
            <li key={title} className="flex gap-4">
              <span className="text-text-secondary tabular-nums" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <h3 className="font-medium text-foreground">{title}</h3>
                <p className="mt-2 text-(length:--text-xs)">{description}</p>
              </div>
            </li>
          ))}
        </ol>
      </SettingsSection>
    </div>
  );
}
