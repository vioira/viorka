import { Outlet, useLocation, useNavigate, useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { Tabs, TabsContent, TabsTrigger } from '@/components/arc/tabs/tabs';
import { PageTabsList } from '@/components/page-tabs';

const primaryTabs = [
  { path: '/proxy/services', label: '代理服务' },
  { path: '/proxy/protocol-presets', label: '协议配置' },
  { path: '/proxy/outbounds', label: '出口配置' },
] as const;

export default function ProxyLayout() {
  const session = useOutletContext<Session>();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const normalizedPath =
    pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  const activeTab = primaryTabs.find((tab) => tab.path === normalizedPath)?.path ?? null;

  return (
    <div className="min-w-0">
      {activeTab ? (
        <Tabs value={activeTab} onValueChange={(path) => void navigate(path)} className="min-w-0">
          <PageTabsList aria-label="代理分类">
            {primaryTabs.map((tab) => (
              <TabsTrigger key={tab.path} value={tab.path}>
                {tab.label}
              </TabsTrigger>
            ))}
          </PageTabsList>
          {primaryTabs.map((tab) => (
            <TabsContent
              key={tab.path}
              value={tab.path}
              forceMount
              hidden={activeTab !== tab.path}
              className="space-y-6"
            >
              {activeTab === tab.path && <Outlet context={session} />}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <Outlet context={session} />
      )}
    </div>
  );
}
