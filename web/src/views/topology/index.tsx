import EmptyStates from '@/components/empty-states';

export default function Page() {
  return (
    <EmptyStates
      variant="unknown"
      title="拓扑管理尚未接入"
      description="网络拓扑与中转规则管理暂不可用。"
    />
  );
}
