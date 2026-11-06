import { Select } from '@/components/arc/select/select';

const fingerprintOptions = [
  { value: 'chrome', label: 'Chrome' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'safari', label: 'Safari' },
  { value: 'edge', label: 'Edge' },
  { value: 'randomized', label: '随机' },
];

export function ClientFingerprintSelect({
  value,
  onValueChange,
  hideLabel = false,
}: {
  value: string;
  onValueChange: (value: string) => void;
  hideLabel?: boolean;
}) {
  return (
    <Select
      label="客户端指纹"
      hideLabel={hideLabel}
      value={value}
      onValueChange={onValueChange}
      options={fingerprintOptions}
    />
  );
}
