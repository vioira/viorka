export function buildInstallScript(origin: string, name: string): string {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password)
    throw new Error('面板当前公开地址必须为 HTTPS Origin，才能生成安装脚本。');
  // JSON escapes newlines and quotes; the quoted heredoc disables shell expansion.
  const config = JSON.stringify(
    {
      panel_url: origin,
      node_name: name,
      state_dir: './state',
      log_level: 'info',
    },
    null,
    2,
  );
  return `bash <<'VIORKA_INSTALL'
set -eu
set +x
umask 077
[ "$(uname -s)" = Linux ] || { echo '此安装包仅支持 Linux。' >&2; exit 1; }
case "$(uname -m)" in
  x86_64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo '仅支持 Linux amd64/arm64。' >&2; exit 1 ;;
esac
command -v curl >/dev/null || { echo '请先安装 curl。' >&2; exit 1; }
command -v sha256sum >/dev/null || { echo '请先安装 sha256sum。' >&2; exit 1; }
# 独立目录，拒绝覆盖已有安装或身份。
install_dir="$HOME/.local/share/viorka-agent"
mkdir -p "$HOME/.local/share"
mkdir "$install_dir" || { echo '安装目录已存在，请检查已有 Agent，勿重复注册。' >&2; exit 1; }
cd "$install_dir"
printf '安装目录：%s\\n' "$install_dir"
download() {
  curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 --max-time 180 "$@"
}
# 先解析正式版本，再从同一个版本下载二进制和校验值。
release_url=$(download --output /dev/null --write-out '%{url_effective}' https://github.com/vioira/viorka-agent/releases/latest)
release_tag=\${release_url##*/}
[[ "$release_tag" =~ ^v[0-9][0-9A-Za-z._-]*$ ]] || { echo '没有可用的正式 Release。' >&2; exit 1; }
asset="viorka-agent-linux-$arch"
base="https://github.com/vioira/viorka-agent/releases/download/$release_tag"
download --output viorka-agent.download "$base/$asset"
download --output viorka-agent.sha256 "$base/$asset.sha256"
checksum=$(cat viorka-agent.sha256)
[[ "$checksum" =~ ^[a-fA-F0-9]{64}$ ]] || { echo '安装包校验文件无效。' >&2; exit 1; }
printf '%s  viorka-agent.download\\n' "$checksum" | sha256sum --check --status
mv viorka-agent.download viorka-agent
chmod 700 viorka-agent
mkdir state
cat > agent.json <<'VIORKA_CONFIG'
${config}
VIORKA_CONFIG
./viorka-agent config-check --config agent.json
printf '粘贴注册令牌后按 Enter（输入隐藏）：' >/dev/tty
IFS= read -r -s enrollment_token </dev/tty
printf '\\n' >/dev/tty
printf '%s' "$enrollment_token" | ./viorka-agent enroll --config agent.json --token-stdin
unset enrollment_token
# 前台运行；关闭终端会停止 Agent，不安装系统服务。
exec ./viorka-agent run --config agent.json
VIORKA_INSTALL`;
}
