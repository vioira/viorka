const numericHost = /^(?:\d+|0x[\da-f]+)(?:\.(?:\d+|0x[\da-f]+))*$/i;
const dnsLabel = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i;

export function validHost(host: string) {
  if (!host || host.length > 253 || host !== host.trim()) return false;
  if (host.includes(':')) {
    // Only pass a bare literal to the URL parser. It accepts paths and credentials otherwise.
    if (!/^[\da-f:.]+$/i.test(host)) return false;
    try {
      const ip = new URL(`http://[${host}]`).hostname;
      return ip !== '[::]' && !/^\[ff[\da-f]{2}:/.test(ip) && !/^\[::ffff:e[\da-f]{3}:/i.test(ip);
    } catch {
      return false;
    }
  }
  const labels = host.split('.');
  if (!numericHost.test(host)) return labels.every((label) => dnsLabel.test(label));
  return (
    labels.length === 4 &&
    labels.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255) &&
    host !== '0.0.0.0' &&
    !(Number(labels[0]) >= 224 && Number(labels[0]) <= 239)
  );
}

export function validDNSHost(host: string) {
  return !host.includes(':') && !numericHost.test(host) && validHost(host);
}
