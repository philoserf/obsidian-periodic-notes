import {
  type App,
  debounce,
  normalizePath,
  PluginSettingTab,
  Setting,
} from "obsidian";
import { DEFAULT_FORMAT } from "./constants";
import { FileSuggest, FolderSuggest } from "./fileSuggest";
import { validateFormat } from "./format";
import type PeriodicNotesPlugin from "./main";
import { type Granularity, granularities } from "./types";

function validateTemplate(app: App, template: string): string {
  if (!template) return "";
  const file = app.metadataCache.getFirstLinkpathDest(template, "");
  return file ? "" : "Template file not found";
}

function validateFolder(app: App, folder: string): string {
  if (!folder || folder === "/") return "";
  return app.vault.getAbstractFileByPath(normalizePath(folder))
    ? ""
    : "Folder not found in vault";
}

const labels: Record<Granularity, string> = {
  day: "Daily Notes",
  week: "Weekly Notes",
  month: "Monthly Notes",
  year: "Yearly Notes",
};

// How a validated periodic-note text field binds to settings: validate on
// change, show the error (or the default description), flag the field, then
// store the raw value and save.
function addValidatedTextSetting(
  containerEl: HTMLElement,
  opts: {
    name: string;
    defaultDesc: string;
    placeholder?: string;
    value: string;
    validate: (value: string) => string;
    onChange: (value: string) => void;
    attachSuggest?: (inputEl: HTMLInputElement) => void;
  },
): void {
  const setting = new Setting(containerEl)
    .setName(opts.name)
    .setDesc(opts.defaultDesc)
    .addText((text) => {
      if (opts.placeholder) text.setPlaceholder(opts.placeholder);
      text.setValue(opts.value).onChange((value) => {
        const error = opts.validate(value);
        setting.descEl.setText(error || opts.defaultDesc);
        setting.descEl.toggleClass("has-error", !!error);
        opts.onChange(value);
      });
      opts.attachSuggest?.(text.inputEl);
    });
}

export class SettingsTab extends PluginSettingTab {
  private debouncedSave = debounce(() => this.plugin.saveSettings(), 500, true);

  constructor(
    readonly app: App,
    readonly plugin: PeriodicNotesPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    for (const granularity of granularities) {
      this.addGranularitySection(containerEl, granularity);
    }
  }

  private addGranularitySection(
    containerEl: HTMLElement,
    granularity: Granularity,
  ): void {
    const config = this.plugin.settings.granularities[granularity];

    containerEl.createEl("h3", { text: labels[granularity] });

    new Setting(containerEl).setName("Enabled").addToggle((toggle) =>
      toggle.setValue(config.enabled).onChange(async (value) => {
        this.plugin.settings.granularities[granularity].enabled = value;
        await this.plugin.saveSettings();
      }),
    );

    addValidatedTextSetting(containerEl, {
      name: "Format",
      defaultDesc: "Moment.js date format string",
      placeholder: DEFAULT_FORMAT[granularity],
      value: config.format,
      validate: (value) => validateFormat(value, granularity),
      onChange: (value) => {
        this.plugin.settings.granularities[granularity].format = value;
        this.debouncedSave();
      },
    });

    addValidatedTextSetting(containerEl, {
      name: "Folder",
      defaultDesc: "",
      value: config.folder,
      validate: (value) => validateFolder(this.app, value),
      onChange: (value) => {
        this.plugin.settings.granularities[granularity].folder = value;
        this.debouncedSave();
      },
      attachSuggest: (inputEl) => new FolderSuggest(this.app, inputEl),
    });

    addValidatedTextSetting(containerEl, {
      name: "Template",
      defaultDesc: "",
      value: config.templatePath ?? "",
      validate: (value) => validateTemplate(this.app, value),
      onChange: (value) => {
        this.plugin.settings.granularities[granularity].templatePath =
          value || undefined;
        this.debouncedSave();
      },
      attachSuggest: (inputEl) => new FileSuggest(this.app, inputEl),
    });
  }
}
