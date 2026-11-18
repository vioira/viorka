import { useEffect, useRef, useState } from 'react';
import type { BrowserViewName, BrowserViewParams } from '@/api/browser-socket';
import { useBrowserSocket } from './realtime';
import { useToastFeedback } from './use-toast-feedback';

// One active consumer per named page projection. The generation stays with its listener.
export function useBrowserView<T>(
  name: BrowserViewName,
  params: BrowserViewParams | null,
  revision: number,
  parse: (value: unknown, previous?: T) => T,
  onData: (value: T) => void,
  pauseHidden = false,
) {
  const socket = useBrowserSocket();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, report] = useToastFeedback('error');
  const callback = useRef(onData);
  callback.current = onData;
  const key = params && JSON.stringify(params);
  useEffect(() => {
    void revision;
    if (!key) {
      setLoading(false);
      return;
    }
    const apply = callback.current;
    let remove: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout>;
    function fail(message: string) {
      setLoading(false);
      setFailed(true);
      report(message);
    }
    function waiting() {
      clearTimeout(timer);
      setLoading(true);
      timer = setTimeout(() => fail('实时数据读取超时，请刷新重试。'), 12000);
    }
    const sync = () => {
      remove?.();
      clearTimeout(timer);
      if (pauseHidden && document.hidden) {
        setLoading(false);
        return;
      }
      waiting();
      let previous: T | undefined;
      remove = socket.subscribeView(name, JSON.parse(key), (frame) => {
        clearTimeout(timer);
        if (frame.event === 'ready') {
          previous = undefined;
          waiting();
          return;
        }
        if (frame.event === 'closed' || frame.event === 'disconnected') {
          setLoading(false);
          setFailed(true);
          return;
        }
        if (frame.event !== name) {
          fail((frame.data as { message?: string })?.message || '实时数据读取失败，请刷新重试。');
          return;
        }
        try {
          previous = parse(frame.data, previous);
          apply(previous);
          setLoading(false);
          setFailed(false);
          report('');
        } catch (error) {
          fail(error instanceof Error ? error.message : '实时数据格式无效，请刷新重试。');
        }
      });
    };
    sync();
    if (pauseHidden) document.addEventListener('visibilitychange', sync);
    return () => {
      remove?.();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [socket, name, key, revision, parse, report, pauseHidden]);
  return { loading, failed };
}
