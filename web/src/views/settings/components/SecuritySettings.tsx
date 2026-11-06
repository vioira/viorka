import BackupSettings from './BackupSettings';
import PasskeySettings from './PasskeySettings';
import SessionHistory from './SessionHistory';

export default function SecuritySettings() {
  return (
    <div className="min-w-0 divide-y-[0.5px] divide-border">
      <PasskeySettings />
      <SessionHistory />
      <BackupSettings />
    </div>
  );
}
