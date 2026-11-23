import { useEffect, useRef, useState } from 'react';
import { type AlertTemplate, type EventMessages, previewAlertTemplate } from '@/api/alerts';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { Textarea } from '@/components/arc/textarea/textarea';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

const labels = { trigger: '首次触发', repeat: '持续提醒', recovery: '恢复' };
export default function TemplateEditor({
  initial,
  timezone,
  token,
  pending,
  cancel,
  save,
}: {
  initial: AlertTemplate;
  timezone: string;
  token: string;
  pending: boolean;
  cancel: () => void;
  save: (v: AlertTemplate) => void;
}) {
  const body = useRef<HTMLTextAreaElement>(null);
  const [v, set] = useState(initial);
  const [kind, choose] = useState<keyof EventMessages>('trigger');
  const [preview, show] = useState<EventMessages | null>(null);
  const [retry, setRetry] = useState<{ template: AlertTemplate } | null>(null);
  const [previewError, error] = useToastFeedback('error', 'notification-preview');
  function update(n: AlertTemplate) {
    set(n);
    show(null);
  }
  useEffect(() => {
    const ctl = new AbortController();
    if (![v.trigger, v.repeat, v.recovery].every((m) => m.title.trim() && m.body.trim())) return;
    const timer = window.setTimeout(
      () => {
        previewAlertTemplate(token, v, timezone, ctl.signal)
          .then((messages) => {
            if (!ctl.signal.aborted) show(messages);
          })
          .catch((e) => {
            if (!ctl.signal.aborted) error((e as Error).message);
          });
      },
      retry?.template === v ? 0 : 350,
    );
    return () => {
      window.clearTimeout(timer);
      ctl.abort();
    };
  }, [token, v, timezone, error, retry]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(v);
      }}
    >
      <fieldset disabled={pending} className="space-y-4">
        <Input
          label="模板名称"
          required
          maxLength={100}
          value={v.name}
          onChange={(e) => update({ ...v, name: e.target.value })}
        />
        <SegmentedControl
          label="通知阶段"
          value={kind}
          options={Object.entries(labels).map(([value, label]) => ({ value, label }))}
          onValueChange={(k) => choose(k as keyof EventMessages)}
        />
        <fieldset className="space-y-2">
          <legend>插入正文变量</legend>
          <div className="flex flex-wrap gap-1">
            {Object.entries({
              node: '节点',
              rule: '规则',
              metric: '监控项',
              basis: '判断依据',
              value: '判断值',
              threshold: '阈值',
              window: '窗口',
              time: '时间',
              duration: '持续时长',
              duration_zh: '中文时长',
              state: '状态',
            }).map(([key, label]) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  const field = body.current;
                  if (!field) return;
                  const variable = `{${key}}`,
                    start = field.selectionStart;
                  update({
                    ...v,
                    [kind]: {
                      ...v[kind],
                      body:
                        field.value.slice(0, start) +
                        variable +
                        field.value.slice(field.selectionEnd),
                    },
                  });
                  requestAnimationFrame(() => {
                    field.focus();
                    field.setSelectionRange(start + variable.length, start + variable.length);
                  });
                }}
              >
                <code className="font-mono">{`{${key}}`}</code> {label}
              </Button>
            ))}
          </div>
        </fieldset>
        <Input
          label="标题"
          required
          value={v[kind].title}
          onChange={(e) => update({ ...v, [kind]: { ...v[kind], title: e.target.value } })}
        />
        <Textarea
          label="正文"
          required
          ref={body}
          rows={4}
          value={v[kind].body}
          onChange={(e) => update({ ...v, [kind]: { ...v[kind], body: e.target.value } })}
        />
        {previewError && !preview && (
          <Button type="button" variant="secondary" onClick={() => setRetry({ template: v })}>
            重试预览
          </Button>
        )}
        <section
          aria-label="示例消息"
          className="min-h-32 space-y-2 rounded-(--radius-control) bg-surface-muted p-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium text-foreground">示例预览（{timezone}）</h3>
            <span className="text-(length:--text-xs)">纯文本</span>
          </div>
          {preview ? (
            <>
              <p className="break-words font-medium text-foreground">{preview[kind].title}</p>
              <p className="whitespace-pre-wrap break-words">{preview[kind].body}</p>
            </>
          ) : (
            <p role="status">
              {previewError
                ? '示例预览尚未读取'
                : !v[kind].title.trim() || !v[kind].body.trim()
                  ? '填写标题和正文后显示预览'
                  : '正在准备示例预览…'}
            </p>
          )}
        </section>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={pending}>
            保存模板
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              update(initial);
              cancel();
            }}
          >
            取消
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
