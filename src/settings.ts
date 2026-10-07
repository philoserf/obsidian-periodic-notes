import {
  type App,
  normalizePath,
  PluginSettingTab,
  type SettingDefinitionItem,
  TFolder,
} from "obsidian";
import type PeriodicNotesPlugin from "./main";
import { canonicalFolder, hasDotDotSegment, hasDotOnlySegment } from "./paths";
import {
  parseSettingKey,
  reject,
  settingDefinitions,
  type Validation,
  valid,
  warn,
} from "./settingsDefinitions";
import { sanitizeSettings } from "./settingsLoad";

/** The one folder normalization, shared by loading and by the settings tab. */
export const normalizeFolder = (folder: string): string =>
  canonicalFolder(normalizePath(folder));

function validateTemplate(app: App, template: string): Validation {
  if (!template) return valid;
  const file = app.metadataCache.getFirstLinkpathDest(template, "");
  return file ? valid : warn("Template file not found");
}

function validateFolder(app: App, folder: string): Validation {
  if (!folder || folder === "/") return valid;
  const normalized = normalizePath(folder);
  if (hasDotDotSegment(normalized)) {
    return reject("Folder would place notes outside the vault");
  }
  if (hasDotOnlySegment(normalized)) {
    return reject("Folder segments cannot be only dots");
  }
  // getAbstractFileByPath returns a TFile just as happily as a TFolder, so a
  // bare truthiness check reports a file sitting where the folder should be as
  // perfectly fine — and the problem only surfaces later, as a folder-collision
  // error at note creation, far from the field that caused it. A file in the
  // way is not a traversal risk, so this warns rather than blocking.
  const existing = app.vault.getAbstractFileByPath(normalized);
  if (!existing) return warn("Folder not found in vault");
  if (!(existing instanceof TFolder)) {
    return warn("That path is a file, not a folder");
  }
  return valid;
}

// Declarative settings (Obsidian 1.13, #335). The definitions live in
// settingsDefinitions.ts, where they are tested as data; this class only binds
// their keys to plugin.settings.
export class SettingsTab extends PluginSettingTab {
  constructor(
    override readonly app: App,
    readonly plugin: PeriodicNotesPlugin,
  ) {
    super(app, plugin);
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return settingDefinitions(this.plugin.settings, {
      folder: (value) => validateFolder(this.app, value),
      template: (value) => validateTemplate(this.app, value),
    });
  }

  override getControlValue(key: string): unknown {
    const parsed = parseSettingKey(key);
    if (!parsed) return undefined;
    return (
      this.plugin.settings.granularities[parsed.granularity][parsed.field] ?? ""
    );
  }

  // Every write goes through sanitizeSettings, the path a reload takes, so a
  // control stores exactly what the next load would produce. update()
  // refreshes the page entries' summary and warning.
  override async setControlValue(key: string, value: unknown): Promise<void> {
    const parsed = parseSettingKey(key);
    if (!parsed) return;
    const edited = structuredClone(this.plugin.settings);
    Object.assign(edited.granularities[parsed.granularity], {
      [parsed.field]: value,
    });
    this.plugin.settings = sanitizeSettings(edited, normalizeFolder);
    await this.plugin.saveSettings();
    this.update();
  }
}
