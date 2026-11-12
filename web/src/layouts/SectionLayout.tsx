import { Outlet, useLocation, useNavigate, useOutletContext } from 'react-router';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs';

const sections = {
  proxy: {
    label: '代理',
    tabs: [
      { label: '服务列表', path: '/proxy/services' },
      { label: '协议配置', path: '/proxy/protocol-presets' },
      { label: '出口配置', path: '/proxy/outbounds' },
    ],
  },
  operations: {
    label: '运维',
    tabs: [
      { label: '任务中心', path: '/operations/tasks' },
      { label: '审计日志', path: '/operations/audit-logs' },
    ],
  },
};

export default function SectionLayout({ section }: { section: keyof typeof sections }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const context = useOutletContext();
  const { label, tabs } = sections[section];
  const active =
    tabs.find((tab) => pathname === tab.path || pathname.startsWith(`${tab.path}/`))?.path ??
    tabs[0].path;

  return (
    <Tabs value={active} onValueChange={(path) => void navigate(path)} className="min-w-0">
      <TabsList aria-label={`${label}分类`}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.path} value={tab.path} className="min-h-11">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent
          key={tab.path}
          value={tab.path}
          forceMount
          hidden={active !== tab.path}
          className="space-y-6"
        >
          {active === tab.path && <Outlet context={context} />}
        </TabsContent>
      ))}
    </Tabs>
  );
}
