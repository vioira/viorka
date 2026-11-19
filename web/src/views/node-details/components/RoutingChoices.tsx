import { Check } from 'lucide-react';
import { Button } from '@/components/arc/button/button';

export default function RoutingChoices({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={selected ? 'secondary' : 'ghost'}
            aria-pressed={selected}
            onClick={() => onValueChange(option.value)}
          >
            {selected && <Check size={16} strokeWidth={1.75} aria-hidden="true" />}
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
