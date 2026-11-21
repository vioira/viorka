const installerURL = 'https://raw.githubusercontent.com/vioira/viorka-agent/main/install.sh';

// Match the HTTPS prefix accepted by install.sh.
export function normalizeGitHubProxy(value: string): string {
  const pattern =
    /^https:\/\/([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])(:[0-9]{1,5})?(\/[A-Za-z0-9._~/-]*)?$/;
  return pattern.test(value) ? value.replace(/\/+$/, '') : '';
}

export function buildInstallScript(
  origin: string,
  token?: string,
  reenrollNode?: string,
  registration = false,
  githubProxy?: string,
): string {
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
  const proxy = githubProxy === undefined ? undefined : normalizeGitHubProxy(githubProxy);
  if (proxy === '') throw new Error('GitHub 代理必须是有效的 HTTPS 地址。');
  const source = proxy ? `${proxy}/${installerURL}` : installerURL;
  const download = `curl -fsSL --proto '=https' --proto-redir '=https' '${source}'`;
  if (registration && (!token || reenrollNode)) throw new Error('批量注册需要有效的批量令牌。');
  const install = `install --url='${origin}'${proxy ? ` --github-proxy='${proxy}'` : ''}`;
  if (token === undefined) return `${download} | sh -s -- ${install}`;

  let args = install;
  if (registration) args += ' --registration';
  if (reenrollNode) args += ` --reenroll-node='${reenrollNode}'`;
  // Download first so stdin is available for the registration token.
  return `(installer=$(mktemp) && trap 'rm -f "$installer"' 0 && ${download} > "$installer" && printf '%s\\n' '${token}' | sh "$installer" ${args} --token-stdin)`;
}
