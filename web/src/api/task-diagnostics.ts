import { ApiError } from './client';

export const engineStages: Record<string, string> = {
  prepare: '准备执行',
  verify_binary: '验证引擎程序',
  install_dependencies: '安装系统依赖',
  download: '下载安装包',
  checksum: '校验安装包',
  extract: '解压安装包',
  install_binary: '安装二进制',
  install_service: '安装系统服务',
  backup: '备份旧版本',
  validate: '校验配置',
  preflight: '部署预检',
  apply_config: '写入配置',
  start: '启动引擎',
  stop: '停止引擎',
  enable: '启用开机自启',
  disable: '关闭开机自启',
  inspect: '检查引擎',
  health: '健康检查',
  rollback: '恢复旧版本',
  persist_state: '保存引擎状态',
  persist_result: '保存任务结果',
};
export type EngineDiagnostic = {
  stage: string;
  message: string;
  interrupted: boolean;
  http_status?: number;
  exit_code?: number;
};

export function parseEngineDiagnostic(result: unknown): EngineDiagnostic | undefined {
  if (!result || typeof result !== 'object' || !('engine' in result)) return undefined;
  const engine = result.engine;
  if (!engine || typeof engine !== 'object' || !('diagnostic' in engine)) return undefined;
  const diagnostic = engine.diagnostic as EngineDiagnostic | null;
  if (
    !diagnostic ||
    typeof diagnostic.stage !== 'string' ||
    !Object.hasOwn(engineStages, diagnostic.stage) ||
    typeof diagnostic.message !== 'string' ||
    [...diagnostic.message].length < 1 ||
    [...diagnostic.message].length > 512 ||
    /\p{Cc}/u.test(diagnostic.message) ||
    typeof diagnostic.interrupted !== 'boolean' ||
    (diagnostic.http_status !== undefined &&
      (!Number.isInteger(diagnostic.http_status) ||
        diagnostic.http_status < 100 ||
        diagnostic.http_status > 599)) ||
    (diagnostic.exit_code !== undefined &&
      (!Number.isInteger(diagnostic.exit_code) ||
        diagnostic.exit_code < 0 ||
        diagnostic.exit_code > 255))
  ) {
    throw new ApiError('任务诊断格式无效，请刷新重试。', 'invalid-response');
  }
  return diagnostic;
}
