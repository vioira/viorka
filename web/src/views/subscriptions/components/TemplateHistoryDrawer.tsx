import { RefreshCw, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import {
  getTemplateVersion,
  listTemplateHistory,
  restoreTemplateVersion,
  type TemplateRevision,
} from '@/api/subscription-template-history';
import type { SubscriptionTemplate } from '@/api/subscriptions';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent, useDrawerItem } from '@/components/arc/drawer/drawer';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import InitialSkeleton from '@/components/initial-skeleton';
import TemplateReviewDialog from './TemplateReviewDialog';

export default function TemplateHistoryDrawer({
  source,
  session,
  onClose,
  onRestored,
}: {
  source: SubscriptionTemplate | null;
  session: Session;
  onClose: () => void;
  onRestored: () => void;
}) {
  const shown = useDrawerItem(source);
  const { toast } = useToastStack();

  const [items, setItems] = useState<TemplateRevision[] | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<SubscriptionTemplate | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const listAbort = useRef<AbortController | null>(null);
  const snapAbort = useRef<AbortController | null>(null);

  const loadList = useCallback(
    async (templateId: string) => {
      listAbort.current?.abort();
      const controller = new AbortController();
      listAbort.current = controller;
      setLoadingList(true);
      setItems(null);
      setSelectedVersion(null);
      setSnapshot(null);
      try {
        const response = await listTemplateHistory(templateId, controller.signal);
        if (controller.signal.aborted) return;
        setItems(response.items);
        if (response.items.length > 0) {
          setSelectedVersion(response.items[0].version);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          toast({
            id: 'template-history',
            type: 'error',
            title: '未能读取历史版本',
            description: error instanceof Error ? error.message : '请重试读取。',
          });
        }
      } finally {
        if (!controller.signal.aborted) setLoadingList(false);
      }
    },
    [toast],
  );

  const loadSnapshot = useCallback(
    async (templateId: string, version: number) => {
      snapAbort.current?.abort();
      const controller = new AbortController();
      snapAbort.current = controller;
      setLoadingSnapshot(true);
      setSnapshot(null);
      try {
        const saved = await getTemplateVersion(templateId, version, controller.signal);
        if (!controller.signal.aborted) setSnapshot(saved);
      } catch (error) {
        if (!controller.signal.aborted) {
          toast({
            id: 'template-revision',
            type: 'error',
            title: '未能读取该版本内容',
            description: error instanceof Error ? error.message : '请刷新历史版本。',
          });
        }
      } finally {
        if (!controller.signal.aborted) setLoadingSnapshot(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (source) {
      setReviewing(false);
      void loadList(source.id);
    } else {
      listAbort.current?.abort();
      snapAbort.current?.abort();
    }
    return () => {
      listAbort.current?.abort();
      snapAbort.current?.abort();
    };
  }, [source, loadList]);

  useEffect(() => {
    if (source && selectedVersion !== null) {
      void loadSnapshot(source.id, selectedVersion);
    }
  }, [source, selectedVersion, loadSnapshot]);

  async function confirmRestore() {
    if (!source || !snapshot || restoring) return;
    setRestoring(true);
    try {
      await restoreTemplateVersion(source, snapshot.version, session);
      toast({ type: 'success', title: `已从版本 v${snapshot.version} 恢复模板` });
      setReviewing(false);
      onRestored();
    } catch (error) {
      toast({
        id: 'template-restore',
        type: 'error',
        title: '未能回退模板',
        description: error instanceof Error ? error.message : '请刷新后重试。',
      });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <>
      <Drawer
        open={source !== null && !reviewing}
        onOpenChange={(open) => {
          if (!open && !restoring) onClose();
        }}
      >
        <DrawerContent
          data-subscription-management
          side="right"
          className="w-[min(540px,100vw)]!"
          title={shown ? `${shown.name} / 版本历史` : '版本历史'}
          titleDetail={shown ? `当前 v${shown.version}` : undefined}
          description="保留最近 10 个归档版本，回退会生成新版本并记录审计。"
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                关闭
              </Button>
              <Button disabled={!snapshot || loadingSnapshot} onClick={() => setReviewing(true)}>
                <RotateCcw size={15} strokeWidth={1.75} aria-hidden="true" />
                检查回退影响
              </Button>
            </div>
          }
        >
          {shown && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <span className="text-(length:--text-xs) font-medium text-text-secondary">
                  归档版本列表
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={loadingList}
                  disabled={loadingList}
                  onClick={() => void loadList(shown.id)}
                >
                  <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
                  刷新
                </Button>
              </div>

              {items === null && loadingList && (
                <InitialSkeleton label="正在读取历史版本" lines={4} />
              )}
              {items === null && !loadingList && (
                <p className="py-8 text-center text-(length:--text-sm) text-text-secondary">
                  历史版本尚未读取，请点击刷新重试。
                </p>
              )}
              {items && items.length === 0 && (
                <p className="py-10 text-center text-(length:--text-sm) text-text-secondary">
                  尚无归档的历史版本
                </p>
              )}

              {items && items.length > 0 && (
                <>
                  <ul className="space-y-2" aria-label="历史版本时间线">
                    {items.map((item) => {
                      const active = selectedVersion === item.version;
                      return (
                        <li key={item.version}>
                          <button
                            type="button"
                            className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-(--radius-control) border-[1px] px-3.5 py-2.5 text-left transition-colors ${
                              active
                                ? 'border-(--table-row-selected-border) bg-(--table-row-selected)'
                                : 'border-border-subtle bg-surface hover:bg-(--table-row-hover)'
                            }`}
                            onClick={() => setSelectedVersion(item.version)}
                          >
                            <span className="text-(length:--text-sm) font-medium tabular-nums">
                              版本 v{item.version}
                            </span>
                            <span className="text-(length:--text-xs) tabular-nums text-text-secondary">
                              {new Date(item.archived_at).toLocaleString()} 归档
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  <section aria-label="所选版本快照" className="space-y-2.5 pt-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-(length:--text-xs) font-medium text-text-secondary">
                        {selectedVersion !== null ? `版本 v${selectedVersion} 快照` : '版本快照'}
                      </h3>
                      {snapshot && (
                        <div className="flex flex-wrap gap-1.5">
                          <Badge tone="neutral" size="sm" className="tabular-nums">
                            {snapshot.replacements.length} 条正则
                          </Badge>
                          <Badge tone="neutral" size="sm">
                            {snapshot.script ? '含 JavaScript' : '无脚本'}
                          </Badge>
                        </div>
                      )}
                    </div>
                    {loadingSnapshot ? (
                      <InitialSkeleton label="正在读取版本内容" lines={4} />
                    ) : snapshot ? (
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-(--radius-control) border-[1px] border-border bg-background p-3 font-mono text-(length:--text-xs)">
                        {snapshot.body}
                      </pre>
                    ) : (
                      <p className="py-4 text-(length:--text-xs) text-text-secondary">
                        未能读取该版本快照。
                      </p>
                    )}
                  </section>
                </>
              )}
            </div>
          )}
        </DrawerContent>
      </Drawer>

      {source && snapshot && reviewing && (
        <TemplateReviewDialog
          source={source}
          draft={{
            name: snapshot.name,
            format: snapshot.format,
            body: snapshot.body,
            replacements: snapshot.replacements,
            script: snapshot.script,
            version: source.version,
            expected_references: source.references,
            confirm: true,
          }}
          session={session}
          busy={restoring}
          restoreVersion={snapshot.version}
          onClose={() => setReviewing(false)}
          onConfirm={() => void confirmRestore()}
        />
      )}
    </>
  );
}
