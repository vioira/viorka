const flags = import.meta.glob<string>('/node_modules/flag-icons/flags/4x3/*.svg', {
  eager: true,
  import: 'default',
  query: '?url&no-inline',
});

export function CountryFlag({
  code = '',
  standalone = false,
  className = '',
}: {
  code?: string;
  standalone?: boolean;
  className?: string;
}) {
  const country = code.trim().toLowerCase();
  const src =
    /^[a-z]{2}$/.test(country) && flags[`/node_modules/flag-icons/flags/4x3/${country}.svg`];
  return src ? (
    <img
      width={20}
      height={15}
      src={src}
      alt={standalone ? country.toUpperCase() : ''}
      className={`inline-block shrink-0 align-middle ${className}`}
    />
  ) : null;
}
