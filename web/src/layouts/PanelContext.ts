import type { Session } from '@/api/auth';
import type { SettingsResponse } from '@/api/settings';
export interface PanelContext extends Session {
  panelSettings: SettingsResponse | null;
  settingsError: string;
  reloadSettings: () => Promise<void>;
  updateSettings: (settings: SettingsResponse) => void;
}
