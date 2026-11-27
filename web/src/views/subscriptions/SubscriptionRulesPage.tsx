import { ExternalLink, FlaskConical, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  deleteSubscriptionRule,
  type SubscriptionRule,
  testSubscriptionRules,
} from '@/api/subscriptions';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { SearchField } from '@/components/arc/search-field/search-field';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import DataTable from '@/components/data-table';
import RuleEditorDrawer from './components/RuleEditorDrawer';
import { useDialogFocus } from './components/useDialogFocus';
import { useSubscriptionsContext } from './context';

const sampleUserAgents = [
  { label: 'Clash Verge', value: 'clash-verge/v2.2.3' },
  { label: 'sing-box', value: 'SFA/1.14.2 (sing-box)' },
  { label: 'Loon', value: 'Loon/3.3.1 (iOS)' },
];

export default function SubscriptionRulesPage() {
  const { session, isAdmin, rules, rulesLoading, templates, reloadRules, reloadTemplates } =
    useSubscriptionsContext();
  const navigate = useNavigate();
  const { toast } = useToastStack();
  const confirmationFocus = useDialogFocus();

  const [query, setQuery] = useState('');
  const [userAgent, setUserAgent] = useState('');
  const [testing, setTesting] = useState(false);
  const [matchedRuleId, setMatchedRuleId] = useState<string | null>(null);
  const [hasTested, setHasTested] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<SubscriptionRule | null>(null);
  const [deleting, setDeleting] = useState<SubscriptionRule | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const sortedRules = useMemo(
    () => [...(rules ?? [])].sort((a, b) => a.position - b.position),
    [rules],
  );
  const visible = useMemo(
    () =>
      sortedRules.filter((rule) =>
        `${rule.name} ${rule.conditions.map((condition) => condition.pattern).join(' ')}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [sortedRules, query],
  );

  async function runTest(overrideUA?: string) {
    const target = (overrideUA ?? userAgent).trim();
    if (!target || testing) return;
    if (overrideUA !== undefined) setUserAgent(overrideUA);
    setTesting(true);
    try {
      const result = await testSubscriptionRules(target, session);
      const matched = (rules ?? []).find((rule) => rule.id === result.rule_id);
      setHasTested(true);
      setMatchedRuleId(result.matched ? result.rule_id : null);
      toast({
        id: 'subscription-rule-test',
        type: result.matched ? 'info' : 'warning',
        title: result.matched ? `匹配规则：${matched?.name ?? result.rule_id}` : '没有匹配的规则',
        description: result.matched
          ? `输出模板：${templates?.find((template) => template.id === matched?.template_id)?.name ?? result.format}`
          : '检查 User-Agent 和已启用规则的条件。',
      });
    } catch (error) {
      toast({
        id: 'subscription-rule-test',
        type: 'error',
        title: '未能测试应用规则',
        description: error instanceof Error ? error.message : '请稍后重试。',
      });
    } finally {
      setTesting(false);
    }
  }

  async function removeRule() {
    if (!deleting || busyDelete) return;
    setBusyDelete(true);
    try {
      await deleteSubscriptionRule(deleting, session);
      setDeleting(null);
      toast({ type: 'success', title: '应用规则已删除' });
      void reloadRules();
      void reloadTemplates();
    } catch (error) {
      toast({
        id: 'subscription-rule-delete',
        type: 'error',
        title: '未能删除应用规则',
        description: error instanceof Error ? error.message : '请先移除订阅引用。',
      });
    } finally {
      setBusyDelete(false);
    }
  }

  return (
    <div className="min-w-0 space-y-5">
      {/* Compact Interactive User-Agent Simulator */}
      <form
        className="space-y-3 rounded-(--radius-panel) border-[1px] border-border bg-surface p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void runTest();
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-(length:--text-sm) font-medium">
            <FlaskConical
              size={16}
              strokeWidth={1.75}
              className="text-(--accent)"
              aria-hidden="true"
            />
            <span>客户端匹配模拟</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-(length:--text-xs) text-text-secondary">示例：</span>
            {sampleUserAgents.map((sample) => (
              <Button
                key={sample.label}
                type="button"
                size="sm"
                variant="secondary"
                disabled={rules === null || testing}
                onClick={() => void runTest(sample.value)}
              >
                {sample.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="min-w-0 flex-1 basis-64">
            <Input
              label="客户端 User-Agent"
              placeholder="粘贴客户端请求标识，检查命中的第一条已启用规则"
              value={userAgent}
              maxLength={1024}
              onChange={(event) => setUserAgent(event.target.value)}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            disabled={rules === null || !userAgent.trim()}
            loading={testing}
          >
            <FlaskConical size={15} strokeWidth={1.75} aria-hidden="true" />
            测试匹配
          </Button>
          {hasTested && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setHasTested(false);
                setMatchedRuleId(null);
              }}
            >
              <X size={15} strokeWidth={1.75} aria-hidden="true" />
              清除高亮
            </Button>
          )}
        </div>
      </form>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-60 max-w-xs">
          <SearchField
            label="搜索分发规则"
            hideLabel
            placeholder="搜索规则名称或客户端关键词"
            value={query}
            onValueChange={setQuery}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            loading={rulesLoading}
            variant="secondary"
            disabled={rulesLoading}
            onClick={() => {
              void reloadRules();
              void reloadTemplates();
            }}
          >
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
            刷新
          </Button>
          {isAdmin && (
            <Button
              disabled={rules === null || !templates?.length}
              onClick={() => {
                setEditingRule(null);
                setDrawerOpen(true);
              }}
            >
              <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
              添加规则
            </Button>
          )}
        </div>
      </div>

      <DataTable
        caption="分发规则"
        minWidth={760}
        loaded={rules !== null}
        loading={rulesLoading}
        emptyMessage={query ? '没有匹配的规则' : '暂无分发规则'}
        emptyState={{ variant: query ? 'no-results' : 'empty' }}
        rows={visible.map((rule) => ({ ...rule }))}
        rowKey="id"
        columns={[
          { key: 'position', label: '优先级', sortable: false, numeric: true, width: 88 },
          {
            key: 'name',
            label: '规则名称',
            sortable: false,
            render: (_, rule) => {
              const matched = hasTested && matchedRuleId === rule.id;
              return (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-medium">{rule.name}</span>
                  <Badge tone={rule.enabled ? 'success' : 'neutral'} size="sm">
                    {rule.enabled ? '已启用' : '已停用'}
                  </Badge>
                  {matched && (
                    <Badge tone="info" size="sm">
                      模拟命中
                    </Badge>
                  )}
                </div>
              );
            },
          },
          {
            key: 'conditions',
            label: '匹配条件',
            sortable: false,
            render: (_, rule) => (
              <div className="flex max-w-80 flex-wrap gap-1.5">
                {rule.conditions.length ? (
                  rule.conditions.map((condition) => (
                    <span
                      key={`${condition.kind}:${condition.pattern}`}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-md border-[1px] border-border-subtle px-2 py-0.5 text-(length:--text-xs)"
                    >
                      <span className="shrink-0 text-text-secondary">
                        {condition.kind === 'regex' ? '正则' : '包含'}
                      </span>
                      <span className="break-all font-mono">{condition.pattern}</span>
                    </span>
                  ))
                ) : (
                  <span className="text-(length:--text-xs) text-text-secondary">未设置条件</span>
                )}
              </div>
            ),
          },
          {
            key: 'template_id',
            label: '输出模板',
            sortable: false,
            render: (_, rule) => {
              const template = templates?.find((item) => item.id === rule.template_id);
              return (
                <div className="space-y-0.5">
                  {template && isAdmin ? (
                    <button
                      type="button"
                      className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-left text-(length:--text-sm) text-(--accent) hover:underline"
                      onClick={() => void navigate(`/subscriptions/templates/${template.id}/edit`)}
                    >
                      <span>{template.name}</span>
                      <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  ) : (
                    <p className="break-words">{template?.name ?? '模板尚未读取'}</p>
                  )}
                  <p className="font-mono text-(length:--text-xs) text-text-secondary">
                    {template?.format ?? rule.format}
                  </p>
                </div>
              );
            },
          },
          {
            key: 'references',
            label: '订阅引用',
            sortable: false,
            render: (_, rule) => <span className="tabular-nums">{rule.references} 个订阅</span>,
          },
          {
            key: 'actions',
            label: '操作',
            sortable: false,
            render: (_, rule) =>
              isAdmin ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!templates}
                    onClick={() => {
                      setEditingRule(rule);
                      setDrawerOpen(true);
                    }}
                  >
                    <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={rule.references > 0}
                    aria-label={
                      rule.references > 0
                        ? `${rule.name} 已被订阅引用，移除引用后可删除`
                        : `删除规则 ${rule.name}`
                    }
                    title={rule.references > 0 ? '移除订阅引用后可删除' : '删除规则'}
                    onClick={() => setDeleting(rule)}
                  >
                    <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <span className="text-(length:--text-xs) text-text-secondary">只读</span>
              ),
          },
        ]}
      />

      {templates && (
        <RuleEditorDrawer
          open={drawerOpen}
          rule={editingRule}
          templates={templates}
          session={session}
          onClose={() => setDrawerOpen(false)}
          onSaved={() => {
            setDrawerOpen(false);
            void reloadRules();
            void reloadTemplates();
          }}
        />
      )}

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !busyDelete) setDeleting(null);
        }}
      >
        <DialogContent
          {...confirmationFocus}
          data-subscription-management
          title="删除应用规则？"
          description={`将删除未被订阅引用的规则“${deleting?.name ?? ''}”。`}
          footer={
            <>
              <Button variant="secondary" disabled={busyDelete} onClick={() => setDeleting(null)}>
                取消
              </Button>
              <Button variant="danger" loading={busyDelete} onClick={() => void removeRule()}>
                <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                删除规则
              </Button>
            </>
          }
        />
      </Dialog>
    </div>
  );
}
