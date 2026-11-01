export function buildInstallScript(origin: string, token?: string, reenrollNode?: string): string {
  const url = new URL(origin);
  if (
    url.protocol !== 'https:' ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    !/^https:\/\/([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])(:[0-9]{1,5})?$/.test(
      origin,
    )
  )
    throw new Error('面板当前公开地址必须为 HTTPS Origin，才能生成安装命令。');
  if (token !== undefined && !/^[a-f0-9]{64}$/.test(token))
    throw new Error('注册令牌格式无效，请重新生成。');
  if (reenrollNode !== undefined && (!token || !/^[a-zA-Z0-9_-]{1,128}$/.test(reenrollNode)))
    throw new Error('重新注册需要有效节点 ID 和令牌。');
  // Both values are validated before interpolating into shell arguments.
  return `curl -fsSL --proto '=https' --proto-redir '=https' 'https://raw.githubusercontent.com/vioira/viorka-agent/main/install.sh' | sh -s -- install --url='${origin}'${token === undefined ? '' : ` --token='${token}'`}${reenrollNode === undefined ? '' : ` --reenroll-node='${reenrollNode}'`}`;
}
