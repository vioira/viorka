import { useState } from 'react';
import type { Session } from '@/api/auth';
import {
  deleteSubscriptionRule,
  type SubscriptionRule,
  testSubscriptionRules,
} from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import DataTable from '@/components/data-table';
import RuleEditor from './RuleEditor';
import { useDialogFocus } from './useDialogFocus';

export default function RulesPanel({
  rules,
  loaded,
  loading,
  session,
  onChanged,
}: {
  rules: SubscriptionRule[];
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
          ? `输出格式：${result.format}`
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
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Input
            label="测试 User-Agent"
            maxLength={1024}
            value={userAgent}
            onChange={(event) => setUserAgent(event.target.value)}
          />
        </div>
        <Button variant="secondary" disabled={!loaded || busy} onClick={() => void test()}>
          测试匹配
        </Button>
        {admin && (
          <Button disabled={!loaded} onClick={() => setEditing(null)}>
            添加应用规则
          </Button>
        )}
      </div>
      <DataTable
        loaded={loaded}
        loading={loading}
        caption="应用规则"
        emptyMessage="暂无应用规则"
        rows={rules.map((rule) => ({ ...rule }))}
        rowKey="id"
        columns={[
          { key: 'name', label: '名称' },
          { key: 'format', label: '配置格式' },
          { key: 'position', label: '顺序', numeric: true },
          {
            key: 'enabled',
            label: '状态',
            render: (_, rule) => (rule.enabled ? '已启用' : '已停用'),
          },
          { key: 'references', label: '引用订阅', numeric: true },
          {
            key: 'actions',
            label: '操作',
            sortable: false,
            render: (_, rule) =>
              admin ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(rule)}>
                    编辑规则
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={rule.references > 0}
                    onClick={() => setDeleting(rule)}
                  >
                    删除规则
                  </Button>
                </div>
              ) : (
                '只读'
              ),
          },
        ]}
      />
      {editing !== undefined && (
        <RuleEditor
          rule={editing}
          session={session}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            onChanged();
          }}
        />
      )}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent
          {...confirmationFocus}
          title="删除应用规则？"
          description={`将删除“${deleting?.name ?? ''}”。此操作不会修改节点。`}
          footer={
            <Button variant="danger" loading={busy} onClick={() => void remove()}>
              删除规则
            </Button>
          }
        />
      </Dialog>
    </div>
  );
}
