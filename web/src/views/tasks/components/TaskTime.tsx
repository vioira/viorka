import { useEffect, useState } from 'react';
export default function TaskTime({ value }: { value: string }) {
  const [label, setLabel] = useState(value);
  useEffect(() => {
    setLabel(new Date(value).toLocaleString('zh-CN', { hour12: false }));
  }, [value]);
  return (
    <time className="tabular-nums" dateTime={value} title={value}>
      {label}
    </time>
  );
}
