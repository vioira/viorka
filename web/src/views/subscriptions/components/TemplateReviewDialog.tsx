import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import {
  type AffectedSubscription,
  compareTemplate,
  listTemplateImpact,
  type TemplateComparison,
} from '@/api/subscription-template-history';
import type { SubscriptionTemplate, SubscriptionTemplateEdit } from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Select } from '@/components/arc/select/select';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useDialogFocus } from './useDialogFocus';

export function templateParams(query: string): Record<string, string> {
  const params: Record<string, string> = Object.create(null);
  for (const [key, value] of new URLSearchParams(query)) {
    if (Object.hasOwn(params, key)) throw new Error('预览参数不能重复。');
    params[key] = value;
  }
  return params;
}

function Comparison({ value }: { value: TemplateComparison }) {
  const { services, changed, start_line, before, after, truncated, before_invalid, after_invalid } =
    value;
  return (
    <section className="min-w-0 space-y-3" aria-label="脱敏输出差异">
      <p role="status" className="text-sm">
        {services} 个可导出服务。
        {before_invalid || after_invalid
          ? '请检查模板的输出。'
          : changed
            ? `首处变化位于第 ${start_line} 行。`
            : '两份脱敏输出相同。'}
        {truncated && '差异较长，仅显示前段。'}
      </p>
      {(changed || before_invalid || after_invalid) && (
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          {[
            { name: '当前版本', text: before, invalid: before_invalid },
            { name: '待保存版本', text: after, invalid: after_invalid },
          ].map((side) => (
            <div key={side.name} className="min-w-0 space-y-2">
              <h3 className="text-sm font-medium">{side.name}</h3>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-(--radius-md) border border-(--border-subtle) p-3 text-xs">
                {side.invalid ? '无法生成配置' : side.text || '此处无内容'}
              </pre>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function TemplateReviewDialog({
  source,
  draft,
  session,
  userAgent = '',
  query = '',
  busy,
  restoreVersion,
  onClose,
  onConfirm,
}: {
  source: SubscriptionTemplate;
  draft: SubscriptionTemplateEdit;
  session: Session;
  userAgent?: string;
  query?: string;
  busy: boolean;
  restoreVersion?: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { toast } = useToastStack();
  const focus = useDialogFocus();
  const [items, setItems] = useState<AffectedSubscription[] | null>(null);
  const [next, setNext] = useState('');
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [comparison, setComparison] = useState<TemplateComparison | null>(null);
  const listAbort = useRef<AbortController | null>(null);
  const compareAbort = useRef<AbortController | null>(null);
  const load = useCallback(
    async (after = '') => {
      listAbort.current?.abort();
      const controller = new AbortController();
      listAbort.current = controller;
      setLoading(true);
      try {
        const page = await listTemplateImpact(source.id, after, controller.signal);
        if (controller.signal.aborted) return;
        setItems((old) => (after ? [...(old ?? []), ...page.items] : page.items));
        if (!after) setSelected(page.items[0]?.id ?? '');
        setNext(page.next_cursor);
      } catch (error) {
        if (!controller.signal.aborted)
          toast({
            id: 'template-impact-load',
            type: 'error',
            title: '未能读取关联订阅',
            description: error instanceof Error ? error.message : '请重试读取。',
          });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [source.id, toast],
  );
  useEffect(() => {
    void load();
    return () => {
      listAbort.current?.abort();
      compareAbort.current?.abort();
    };
  }, [load]);
  async function compare() {
    if (!selected || checking) return;
    const controller = new AbortController();
    compareAbort.current = controller;
    setChecking(true);
    try {
      const result = await compareTemplate(
        source.id,
        selected,
        draft,
        userAgent,
        templateParams(query),
        session,
        controller.signal,
      );
      if (!controller.signal.aborted) setComparison(result);
    } catch (error) {
      if (!controller.signal.aborted)
        toast({
          id: 'template-compare',
          type: 'error',
          title: '未能比较订阅输出',
          description: error instanceof Error ? error.message : '请检查订阅与模板。',
        });
    } finally {
      if (!controller.signal.aborted) setChecking(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        {...focus}
        data-subscription-management
        className="[--dialog-width:760px]"
        title={restoreVersion ? `回退到版本 ${restoreVersion}？` : '保存共享配置模板？'}
        description={`“${source.name}”被 ${source.references} 条规则引用。保存后，命中这些规则的客户端将在下次拉取时使用新配置。`}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              返回
            </Button>
            <Button loading={busy} disabled={items === null} onClick={onConfirm}>
              {restoreVersion ? '确认回退模板' : '确认保存模板'}
            </Button>
          </>
        }
      >
        <div className="min-w-0 space-y-4">
          {items === null ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-(--text-secondary)">
                {loading ? '正在读取关联订阅' : '关联订阅尚未读取'}
              </span>
              {!loading && (
                <Button variant="secondary" onClick={() => void load()}>
                  重新读取
                </Button>
              )}
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm">当前没有订阅选用此模板的已启用规则。</p>
          ) : (
            <>
              <Select
                label="受影响的订阅"
                value={selected}
                options={items.map((item) => ({
                  value: item.id,
                  label: `${item.name}（${item.owner_name}）`,
                }))}
                onValueChange={(id) => {
                  compareAbort.current?.abort();
                  setChecking(false);
                  setComparison(null);
                  setSelected(id);
                }}
              />
              <p className="text-xs text-(--text-secondary)">
                比较保留所选订阅的服务名称、顺序和本机端口，公网地址与凭证使用示例值。
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  loading={checking}
                  disabled={busy}
                  onClick={() => void compare()}
                >
                  比较脱敏输出
                </Button>
                {next && (
                  <Button
                    variant="ghost"
                    loading={loading}
                    disabled={busy}
                    onClick={() => void load(next)}
                  >
                    加载更多订阅
                  </Button>
                )}
              </div>
            </>
          )}
          {comparison && <Comparison value={comparison} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
