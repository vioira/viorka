const resultLabels: Record<string, string> = {
  ok: '已下发',
  unrecognized: '未识别客户端',
  no_services: '没有可用服务',
  forbidden: '权限不足',
  unavailable: '暂不可用',
};

export const resultLabel = (code: string) => resultLabels[code] ?? '未知';
