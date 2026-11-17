import { FlaskConical, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Session } from '@/api/auth';
import {
  deleteSubscriptionRule,
  type SubscriptionRule,
  type SubscriptionTemplate,
  testSubscriptionRules,
} from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import { Input } from '@/components/arc/input/input';
import { SearchField } from '@/components/arc/search-field/search-field';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import DataTable from '@/components/data-table';
import RuleEditor from './RuleEditor';
import { useDialogFocus } from './useDialogFocus';

export default function RulesPanel({
  rules,
  templates,
  loaded,
  loading,
  session,
  onChanged,
}: {
  rules: SubscriptionRule[];
  templates: SubscriptionTemplate[] | null;
  loaded: boolean;
  loading: boolean;
  session: Session;
  onChanged: () => void;
}) {
  const { toast } = useToastStack();
  const confirmationFocus = useDialogFocus();
  const [editing, setEditing] = useState<SubscriptionRule | null | undefined>();
  const [deleting, setDeleting] = useState<SubscriptionRule | null>(null);
  const [userAgent, setUserAgent] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [testing, setTesting] = useState(false);
  const admin = session.user.role === 'admin';
  async function test() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await testSubscriptionRules(userAgent, session);
      const matched = rules.find((rule) => rule.id === result.rule_id);
      toast({
        id: 'subscription-rule-test',
        type: 'info',
        title: result.matched ? `匹配规则：${matched?.name ?? result.rule_id}` : '没有匹配的规则',
        description: result.matched
          ? `配置模板：${templates?.find((template) => template.id === matched?.template_id)?.name ?? result.format}`
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
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await deleteSubscriptionRule(deleting, session);
      setDeleting(null);
      toast({ type: 'success', title: '应用规则已删除' });
      onChanged();
    } catch (error) {
      toast({
        id: 'subscription-rule-delete',
        type: 'error',
        title: '未能删除应用规则',
        description: error instanceof Error ? error.message : '请先移除订阅引用。',
      });
    } finally {
      setBusy(false);
    }
  }
  if (editing !== undefined && templates)
    return (
      <RuleEditor
        rule={editing}
        templates={templates}
        session={session}
        onClose={() => setEditing(undefined)}
        onSaved={() => {
          setEditing(undefined);
          onChanged();
        }}
      />
    );
  const visible = rules.filter((rule) =>
    `${rule.name} ${rule.conditions.map((condition) => condition.pattern).join(' ')}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 max-w-md flex-1 basis-64">
          <SearchField
            label="搜索应用规则"
            hideLabel
            placeholder="搜索规则名称或客户端关键词"
            value={query}
            onValueChange={setQuery}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" aria-expanded={testing} onClick={() => setTesting(!testing)}>
            <FlaskConical size={16} aria-hidden="true" />
            测试客户端
          </Button>
          <Button loading={loading} variant="secondary" disabled={loading} onClick={onChanged}>
            <RefreshCw size={16} aria-hidden="true" />
            刷新规则
          </Button>
          {admin && (
            <Button disabled={!loaded || !templates?.length} onClick={() => setEditing(null)}>
              <Plus size={16} aria-hidden="true" />
              添加规则
            </Button>
          )}
        </div>
      </div>
      {testing && (
        <form
          className="flex flex-wrap items-end gap-3 border-y border-(--border-subtle) py-5"
          onSubmit={(event) => {
            event.preventDefault();
            void test();
          }}
        >
          <div className="min-w-0 flex-1 basis-64">
            <Input
              label="客户端 User-Agent"
              placeholder="粘贴客户端请求标识，检查使用哪条规则"
              value={userAgent}
              maxLength={1024}
              onChange={(event) => setUserAgent(event.target.value)}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            disabled={!loaded || !userAgent.trim()}
            loading={busy}
          >
            <FlaskConical size={16} aria-hidden="true" />
            测试匹配
          </Button>
        </form>
      )}
      <p className="text-sm text-(--text-secondary)">
        按优先级从上到下匹配，命中第一条已启用规则后使用其配置模板。
      </p>
      <DataTable
        caption="应用规则"
        loaded={loaded}
        loading={loading}
        emptyMessage={query ? '没有匹配的规则' : '暂无应用规则'}
        emptyState={{ variant: query ? 'no-results' : 'empty' }}
        rows={visible.map((rule) => ({ ...rule }))}
        rowKey="id"
        columns={[
          { key: 'position', label: '优先级', sortable: false, numeric: true },
          {
            key: 'name',
            label: '规则',
            sortable: false,
            render: (_, rule) => (
              <div>
                <p className="break-all font-medium">{rule.name}</p>
                <p className="mt-1 text-xs text-(--text-secondary)">
                  {rule.enabled ? '已启用' : '已停用'}
                </p>
              </div>
            ),
          },
          {
            key: 'conditions',
            label: '客户端匹配条件',
            sortable: false,
            render: (_, rule) => (
              <div className="max-w-80 space-y-1 break-all">
                {rule.conditions.length ? (
                  rule.conditions.map((condition) => (
                    <p key={`${condition.kind}:${condition.pattern}`} className="text-sm">
                      <span className="mr-2 text-xs text-(--text-secondary)">
                        {condition.kind === 'regex' ? '正则' : '包含'}
                      </span>
                      {condition.pattern}
                    </p>
                  ))
                ) : (
                  <span className="text-(--text-secondary)">未设置条件</span>
                )}
              </div>
            ),
          },
          {
            key: 'template_id',
            label: '输出模板',
            sortable: false,
            render: (_, rule) => (
              <div>
                <p className="break-words">
                  {templates?.find((template) => template.id === rule.template_id)?.name ??
                    '模板尚未读取'}
                </p>
                <p className="mt-1 text-xs text-(--text-secondary)">{rule.references} 个订阅引用</p>
              </div>
            ),
          },
          {
            key: 'actions',
            label: '操作',
            sortable: false,
            render: (_, rule) =>
              admin ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    disabled={!templates}
                    onClick={() => setEditing(rule)}
                  >
                    <Pencil size={16} aria-hidden="true" />
                    编辑
                  </Button>
                  <DropdownMenu
                    label="更多操作"
                    items={[
                      {
                        label: rule.references ? '移除订阅引用后可删除' : '删除规则',
                        icon: <Trash2 size={16} aria-hidden="true" />,
                        disabled: rule.references > 0,
                        destructive: true,
                        onSelect: () => setDeleting(rule),
                      },
                    ]}
                  />
                </div>
              ) : (
                '只读'
              ),
          },
        ]}
      />
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent
          {...confirmationFocus}
          data-subscription-management
          title="删除应用规则？"
          description={`将删除“${deleting?.name ?? ''}”。`}
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>
                取消
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void remove()}>
                <Trash2 size={16} aria-hidden="true" />
                删除规则
              </Button>
            </>
          }
        />
      </Dialog>
    </div>
  );
}
