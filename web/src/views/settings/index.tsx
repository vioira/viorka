import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs';
import EnrollmentSettings from './components/EnrollmentSettings';
import GeneralSettings from './components/GeneralSettings';
import SecuritySettings from './components/SecuritySettings';

export default function SettingsPage() {
  return (
    <>
      <div>
        <h1 className="font-title text-(length:--text-2xl) font-medium">系统设置</h1>
        <p className="mt-2 text-text-secondary">面板、注册令牌与安全。</p>
      </div>
      <Tabs defaultValue="general" className="min-w-0 [--control-height-sm:44px]">
        <TabsList aria-label="系统设置分类">
          <TabsTrigger value="general">通用</TabsTrigger>
          <TabsTrigger value="tokens">注册令牌</TabsTrigger>
          <TabsTrigger value="security">安全与备份</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <GeneralSettings />
        </TabsContent>
        <TabsContent value="tokens">
          <EnrollmentSettings />
        </TabsContent>
        <TabsContent value="security">
          <SecuritySettings />
        </TabsContent>
      </Tabs>
    </>
  );
}
