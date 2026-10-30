import { useSearchParams } from 'react-router';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs';
import GeneralSettings from './components/GeneralSettings';
import SecuritySettings from './components/SecuritySettings';

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab');
  const tab = requestedTab === 'security' ? requestedTab : 'general';
  return (
    <>
      <div>
        <h1 className="font-title text-(length:--text-2xl) font-medium">系统设置</h1>
        <p className="mt-2 text-text-secondary">面板设置与安全。</p>
      </div>
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
        <TabsList aria-label="系统设置分类">
          <TabsTrigger value="general">通用</TabsTrigger>
          <TabsTrigger value="security">安全与备份</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <GeneralSettings />
        </TabsContent>
        <TabsContent value="security">
          <SecuritySettings />
        </TabsContent>
      </Tabs>
    </>
  );
}
