import { BookOpen, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  type GeoCatalogSource,
  type GeoKind,
  getRoutingGeoCatalog,
  type RoutingGeoCatalog,
} from '@/api/outbounds';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import Pagination from '@/components/pagination';

const labels = { geosite: 'GeoSite', geoip: 'GeoIP' };
const categories = { geosite: '站点分类', geoip: 'IP 分类' };
const pageSizes = [10, 20, 50, 100];

export function useRoutingGeoCatalog(hasSavedCodes: boolean) {
  const [request, setRequest] = useState(hasSavedCodes ? 1 : 0);
  const [catalog, setCatalog] = useState<RoutingGeoCatalog>();
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const { toast, dismiss } = useToastStack();
  const errorId = useId();
  const refresh = useCallback(() => {
    setStatus('loading');
    setRequest((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    getRoutingGeoCatalog(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setCatalog(result);
        setStatus('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setStatus('failed');
        toast({
          id: errorId,
          type: 'error',
          title: 'Geo 分类目录读取失败',
          action: { label: '重试', onClick: refresh },
        });
      });
    return () => {
      controller.abort();
      dismiss(errorId);
    };
  }, [request, refresh, toast, dismiss, errorId]);
  return { catalog, status, refresh };
}

export function catalogHas(source: GeoCatalogSource, code: string) {
  return source.codes.includes(code) || source.built_in.includes(code);
}

type CatalogState = ReturnType<typeof useRoutingGeoCatalog>;

function GeoSelection({
  kind,
  state,
  values,
  onCancel,
  onConfirm,
}: {
  kind: GeoKind;
  state: CatalogState;
  values: string[];
  onCancel: () => void;
  onConfirm: (next: string[]) => void;
}) {
  const [selected, setSelected] = useState(values);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const source = state.catalog?.[kind];
  const valid = source && selected.every((code) => catalogHas(source, code));
  const needle = query.trim().toLowerCase();
  const matches = [...(source?.built_in ?? []), ...(source?.codes ?? [])].filter(
    (code) =>
      code.includes(needle) ||
      (kind === 'geoip' && code === 'private' && '非公网 ip'.includes(needle)),
  );
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const current = Math.min(page, pages);
  function changePage(next: number) {
    setPage(next);
    list.current?.scrollTo(0, 0);
  }
  return (
    <DialogContent
      title={`选择 ${labels[kind]}`}
      className="[--dialog-width:56rem]"
      aria-describedby={undefined}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        search.current?.focus();
      }}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!valid || state.status !== 'ready' || selected.length > 64}
            onClick={() => onConfirm(selected)}
          >
            确认选择
          </Button>
        </>
      }
    >
      <div className="min-w-0 space-y-3">
        <Input
          ref={search}
          label={`搜索${categories[kind]}`}
          hideLabel
          placeholder={`搜索${categories[kind]}`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            changePage(1);
          }}
        />
        <div className="grid min-w-0 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] border-y-[1px] border-border">
          <section aria-label="全部分类" className="min-w-0 pr-2 sm:pr-5">
            <div className="flex min-h-12 flex-wrap items-center gap-x-2">
              <h3 className="font-medium">全部分类</h3>
              {source && <span className="text-text-secondary tabular-nums">{matches.length}</span>}
            </div>
            <div
              ref={list}
              role="group"
              aria-label="分类列表"
              aria-busy={state.status === 'loading'}
              className="h-[min(46dvh,25rem)] overflow-y-auto overscroll-contain"
            >
              <div className="grid min-w-0 items-start gap-x-3 md:grid-cols-2">
                {matches.slice((current - 1) * pageSize, current * pageSize).map((code) => {
                  const checked = selected.includes(code);
                  return (
                    <div key={code} className="min-w-0 wrap-anywhere">
                      <Checkbox
                        label={code}
                        description={
                          source?.built_in.includes(code) ? '非公网 IP（引擎内置）' : undefined
                        }
                        checked={checked}
                        disabled={state.status !== 'ready' || (!checked && selected.length >= 64)}
                        onCheckedChange={(next) =>
                          setSelected((items) =>
                            next === true
                              ? [...items, code]
                              : items.filter((item) => item !== code),
                          )
                        }
                      />
                    </div>
                  );
                })}
              </div>
              {!matches.length && (
                <p role="status" className="py-2 text-text-secondary">
                  {source
                    ? '未找到匹配的分类'
                    : state.status === 'failed'
                      ? '目录尚未读取'
                      : '正在读取目录…'}
                </p>
              )}
              {state.status === 'failed' && (
                <Button type="button" variant="secondary" onClick={state.refresh}>
                  重新读取目录
                </Button>
              )}
            </div>
          </section>
          <section
            aria-label="已选分类"
            className="min-w-0 border-l-[1px] border-border pl-2 sm:pl-5"
          >
            <div className="flex min-h-12 flex-wrap items-center gap-x-2">
              <h3 className="font-medium">已选</h3>
              <span
                role="status"
                aria-label={`已选 ${selected.length} 项，最多 64 项`}
                className="text-text-secondary tabular-nums"
              >
                {selected.length} / 64
              </span>
            </div>
            <ul className="h-[min(46dvh,25rem)] overflow-y-auto overscroll-contain">
              {selected.map((code) => (
                <li
                  key={code}
                  className="flex min-h-(--control-height-md) items-center justify-between gap-1"
                >
                  <span className="min-w-0 wrap-anywhere">
                    {code}
                    {source && !catalogHas(source, code) && (
                      <span className="block text-(length:--text-xs) text-text-secondary">
                        已失效
                      </span>
                    )}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    aria-label={`移除 ${code}`}
                    onClick={(event) => {
                      const row = event.currentTarget.closest('li');
                      const sibling = row?.nextElementSibling ?? row?.previousElementSibling;
                      (sibling?.querySelector('button') ?? search.current)?.focus();
                      setSelected((items) => items.filter((item) => item !== code));
                    }}
                  >
                    <X size={16} aria-hidden="true" />
                  </Button>
                </li>
              ))}
              {!selected.length && <li className="py-2 text-text-secondary">尚未选择分类</li>}
            </ul>
          </section>
        </div>
        {source && (
          <Pagination
            label="分类分页"
            page={current}
            pageCount={pages}
            busy={state.status === 'loading'}
            onPageChange={changePage}
            pageSize={{
              value: pageSize,
              options: pageSizes,
              onChange: (size) => {
                setPageSize(size);
                changePage(1);
              },
            }}
          />
        )}
      </div>
    </DialogContent>
  );
}

export default function RoutingGeoPicker({
  kind,
  values,
  state,
  onChange,
  disabled,
}: {
  kind: GeoKind;
  values: string[];
  state: CatalogState;
  onChange: (values: string[]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const source = state.catalog?.[kind];
  const triggerId = useId();
  return (
    <div className="flex min-w-0 items-center gap-3 border-b-[1px] border-border py-2">
      <div className="min-w-0 flex-1">
        <label htmlFor={triggerId} className="flex cursor-pointer items-baseline gap-2 py-2">
          <span className="font-medium">{labels[kind]}</span>
          <span className="text-text-secondary">{categories[kind]}</span>
        </label>
        {!!values.length && (
          <div className="flex flex-wrap gap-1" role="group" aria-label={`已选 ${labels[kind]}`}>
            {values.map((code) => (
              <Button
                key={code}
                type="button"
                size="sm"
                variant="secondary"
                disabled={disabled}
                aria-label={`移除 ${labels[kind]} ${code}`}
                onClick={() => onChange(values.filter((item) => item !== code))}
              >
                <span className="max-w-48 truncate" title={code}>
                  {code}
                </span>
                {source && !catalogHas(source, code) && <span>已失效</span>}
                <X size={16} aria-hidden="true" />
              </Button>
            ))}
          </div>
        )}
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) state.refresh();
        }}
      >
        <DialogTrigger asChild>
          <Button
            id={triggerId}
            type="button"
            variant="ghost"
            aria-label={`选择 ${labels[kind]}`}
            title={`选择 ${labels[kind]}`}
            className="[--dialog-width:56rem]"
            disabled={disabled}
          >
            <BookOpen size={16} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </DialogTrigger>
        {open && (
          <GeoSelection
            kind={kind}
            state={state}
            values={values}
            onCancel={() => setOpen(false)}
            onConfirm={(next) => {
              onChange(next);
              setOpen(false);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
