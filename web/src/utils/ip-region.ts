const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });

export function formatIPRegion(countryCode = '', region = ''): string {
  if (!countryCode) return '地区未知';
  const country = regionNames.of(countryCode) ?? countryCode;
  return `${country}${region === country ? '' : region}`;
}

export function sessionCountryCode(location = ''): string | undefined {
  return /^([A-Z]{2})(?: \/ |$)/.exec(location.trim())?.[1];
}

export function sessionRegion(location = ''): string {
  const value = location.trim();
  const [countryCode, ...regions] = value.split(' / ');
  if (/^[A-Z]{2}$/.test(countryCode)) {
    return formatIPRegion(countryCode, regions.at(-1)?.trim());
  }
  return !value || value === '归属地未知' ? formatIPRegion() : value;
}
