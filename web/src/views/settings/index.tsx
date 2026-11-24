import { useSearchParams } from 'react-router';
import { Tabs, TabsContent, TabsTrigger } from '@/components/arc/tabs/tabs';
import { PageTabsList } from '@/components/page-tabs';
import BackupSettings from './components/BackupSettings';
import GeneralSettings from './components/GeneralSettings';
import SecuritySettings from './components/SecuritySettings';
import SessionHistory from './components/SessionHistory';
import StatusSettings from './components/StatusSettings';
export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab');
  const tab = ['security', 'sessions', 'backups', 'public-status'].includes(requestedTab ?? '')
    ? (requestedTab ?? 'general')
    : 'general';
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        setParams((current) => {
          const next = new URLSearchParams(current);
          next.set('tab', value);
          return next;
        });
      }}
      className="min-w-0"
    >
      <PageTabsList aria-label="系统设置分类">
        <TabsTrigger value="general">通用</TabsTrigger>
        <TabsTrigger value="security">安全</TabsTrigger>
        <TabsTrigger value="sessions">会话</TabsTrigger>
        <TabsTrigger value="public-status">公开状态页</TabsTrigger>
        <TabsTrigger value="backups">备份</TabsTrigger>
      </PageTabsList>
      <TabsContent value="public-status">
        <StatusSettings />
      </TabsContent>
      <TabsContent value="general">
        <GeneralSettings />
      </TabsContent>
      <TabsContent value="security">
        <SecuritySettings />
      </TabsContent>
      <TabsContent value="sessions">
        <SessionHistory />
      </TabsContent>
      <TabsContent value="backups">
        <BackupSettings />
      </TabsContent>
    </Tabs>
  );
}
