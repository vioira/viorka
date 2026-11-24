import { Check, Palette } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover';
import { ThemeSwitch } from '@/components/arc/theme-switch/theme-switch';
import { ToolbarIconButton } from '@/components/arc/toolbar-icon-button/toolbar-icon-button';
import { useTheme } from '@/hooks/use-theme';

const palettes = [
  { value: 'emerald-pulse', label: '翠脉新生', swatch: 'bg-(--palette-emerald-pulse)' },
  { value: 'cobalt-control', label: '钴蓝智控', swatch: 'bg-(--palette-cobalt-control)' },
  { value: 'iris-nebula', label: '鸢尾星云', swatch: 'bg-(--palette-iris-nebula)' },
  { value: 'nordic-slate', label: '北欧岩灰', swatch: 'bg-(--palette-nordic-slate)' },
];

export default function AppearanceSwitch() {
  const groupName = useId();
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { dark, toggleTheme } = useTheme();
  const [palette, setPalette] = useState(
    () =>
      palettes.find((item) => item.value === document.documentElement.dataset.palette) ??
      palettes[0],
  );

  function selectPalette(value: string) {
    const next = palettes.find((item) => item.value === value);
    if (!next) return;
    document.documentElement.dataset.palette = next.value;
    setPalette(next);
    try {
      localStorage.setItem('viorka.palette', next.value);
    } catch {
      // 存储不可用时，本次访问仍保留选择。
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <ToolbarIconButton aria-label={`切换主题色，当前为${palette.label}`} title="切换主题色">
            <Palette size={16} strokeWidth={1.75} aria-hidden="true" />
          </ToolbarIconButton>
        </PopoverTrigger>
        <PopoverContent
          ref={contentRef}
          align="end"
          className="w-56"
          aria-label="切换主题色"
          onOpenAutoFocus={(event) => {
            const selected = contentRef.current?.querySelector<HTMLInputElement>('input:checked');
            if (selected) {
              event.preventDefault();
              selected.focus();
            }
          }}
        >
          <fieldset className="m-0 grid min-w-0 gap-1 border-0 p-0">
            <legend className="mb-2 px-2 text-(length:--text-sm) font-medium">主题色</legend>
            {palettes.map((item) => (
              <label
                key={item.value}
                className="relative flex min-h-11 cursor-pointer items-center gap-3 rounded-(--radius-control) px-2 text-(length:--text-sm) hover:bg-(--surface-muted) has-checked:bg-(--surface-muted)"
              >
                <input
                  type="radio"
                  name={groupName}
                  value={item.value}
                  checked={palette.value === item.value}
                  className="absolute inset-0 size-full cursor-pointer appearance-none rounded-[inherit]"
                  onChange={() => selectPalette(item.value)}
                  onClick={(event) => {
                    if (event.detail > 0) setOpen(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectPalette(item.value);
                      setOpen(false);
                    }
                  }}
                />
                <span
                  aria-hidden="true"
                  className={`size-5 shrink-0 rounded-full border border-border ${item.swatch}`}
                />
                <span className="flex-1">{item.label}</span>
                {palette.value === item.value && <Check size={16} aria-hidden="true" />}
              </label>
            ))}
          </fieldset>
        </PopoverContent>
      </Popover>
      <ThemeSwitch
        theme={dark ? 'dark' : 'light'}
        variant="reveal"
        iconOnly
        label={dark ? '切换到浅色主题' : '切换到深色主题'}
        onThemeChange={toggleTheme}
      />
    </div>
  );
}
