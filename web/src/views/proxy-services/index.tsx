import { Link } from 'react-router';
export default function ProxyServicesPage() {
  return (
    <>
      <h1 className="text-(length:--text-xl) font-medium">代理服务</h1>
      <p className="text-text-secondary">
        服务归属固定节点和引擎。请进入节点详情的“引擎与服务”，安装引擎、编辑草稿并应用配置。
      </p>
      <Link to="/nodes" className="inline-flex min-h-11 items-center text-accent hover:underline">
        前往节点列表
      </Link>
    </>
  );
}
