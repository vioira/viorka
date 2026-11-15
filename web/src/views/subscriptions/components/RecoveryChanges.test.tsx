import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToastStackProvider } from '@/components/arc/toast-stack/toast-stack';
import RecoveryChanges from './RecoveryChanges';

describe('recovery difference preview', () => {
  it('shows old and current values for routing-only differences and credential markers', () => {
    const html = renderToStaticMarkup(
      <ToastStackProvider>
        <RecoveryChanges
          changes={[
            { resource: '分流', field: '默认出口', before: 'direct', after: 'exit-1' },
            {
              resource: '出口 / exit-1',
              field: '凭证',
              before: '已隐藏',
              after: '已变化（值已隐藏）',
            },
            { resource: '服务 / one', field: '服务器名称', before: '', after: 'example.net' },
          ]}
        />
      </ToastStackProvider>,
    );
    for (const text of [
      '配置差异',
      '面板记录',
      '节点当前配置',
      '默认出口',
      'direct',
      'exit-1',
      '已变化（值已隐藏）',
      '未设置',
      'example.net',
    ]) {
      expect(html).toContain(text);
    }
  });
});
