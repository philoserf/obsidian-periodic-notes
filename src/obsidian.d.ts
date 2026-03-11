import "obsidian";
import type { LocaleOverride, WeekStartOption } from "./settings/localization";

declare module "obsidian" {
  export interface Workspace extends Events {
    on(
      name: "periodic-notes:settings-updated",
      callback: () => void,
      // biome-ignore lint/suspicious/noExplicitAny: Obsidian API lacks type
      ctx?: any,
    ): EventRef;
    on(
      name: "periodic-notes:resolve",
      callback: () => void,
      // biome-ignore lint/suspicious/noExplicitAny: Obsidian API lacks type
      ctx?: any,
    ): EventRef;
  }

  interface VaultSettings {
    localeOverride: LocaleOverride;
    weekStart: WeekStartOption;
  }

  interface Vault {
    config: Record<string, unknown>;
    getConfig<T extends keyof VaultSettings>(setting: T): VaultSettings[T];
    setConfig<T extends keyof VaultSettings>(
      setting: T,
      value: VaultSettings[T],
    ): void;
  }

  export interface PluginInstance {
    id: string;
  }

  export interface DailyNotesSettings {
    autorun?: boolean;
    format?: string;
    folder?: string;
    template?: string;
  }

  class DailyNotesPlugin implements PluginInstance {
    options?: DailyNotesSettings;
  }

  export interface App {
    internalPlugins: InternalPlugins;
    plugins: CommunityPluginManager;
  }

  export interface CommunityPluginManager {
    getPlugin(id: string): Plugin;
  }

  export interface InstalledPlugin {
    disable: (onUserDisable: boolean) => void;
    enabled: boolean;
    instance: PluginInstance;
  }

  export interface InternalPlugins {
    plugins: Record<string, InstalledPlugin>;
    getPluginById(id: string): InstalledPlugin;
  }

  interface NLDResult {
    formattedString: string;
    date: Date;
    moment: Moment;
  }

  interface NLDatesPlugin extends Plugin {
    parseDate(dateStr: string): NLDResult;
  }
}
