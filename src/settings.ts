import {
  type App,
  debounce,
  normalizePath,
  PluginSettingTab,
  Setting,
  type TextComponent,
} from "obsidian";
import { DEFAULT_FORMAT } from "./constants";
import { PathSuggest } from "./fileSuggest";
import { validateFormat } from "./format";
import type PeriodicNotesPlugin from "./main";
import { canonicalFolder, hasDotDotSegment } from "./paths";
import { type Granularity, granularities } from "./types";

// A field's verdict. A `blocking` value is never written to plugin.settings —
// it would corrupt note resolution or escape the vault. Everything else is
// advisory: the field warns but persists, so a folder that does not exist yet
// can still be configured ahead of the note that creates it.
type Validation = { error: string; blocking: boolean };

const valid: Validation = { error: "", blocking: false };
const warn = (error: string): Validation => ({ error, blocking: false });
const reject = (error: string): Validation => ({ error, blocking: true });

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
  return app.vault.getAbstractFileByPath(normalized)
    ? valid
    : warn("Folder not found in vault");
}

const labels: Record<Granularity, string> = {
  day: "Daily Notes",
  week: "Weekly Notes",
  month: "Monthly Notes",
  year: "Yearly Notes",
};

// How a validated periodic-note text field binds to settings: validate on
// change, show the error (or the default description), flag the field, then
// store the value and save — unless the error is a blocking one, in which case
// the previously stored value stands.
function addValidatedTextSetting(
  containerEl: HTMLElement,
  opts: {
    name: string;
    defaultDesc: string;
    placeholder?: string;
    value: string;
    validate: (value: string) => Validation;
    onChange: (value: string) => void;
    attachSuggest?: (
      text: TextComponent,
      applyChange: (value: string) => void,
    ) => void;
  },
): void {
  const setting = new Setting(containerEl)
    .setName(opts.name)
    .setDesc(opts.defaultDesc)
    .addText((text) => {
      if (opts.placeholder) text.setPlaceholder(opts.placeholder);

      // Shared by typing and by picking from the suggester, so a selection
      // gets the same validation, description update and save as a keystroke.
      const applyChange = (value: string) => {
        const { error, blocking } = opts.validate(value);
        setting.descEl.setText(error || opts.defaultDesc);
        setting.descEl.toggleClass("has-error", !!error);
        if (!blocking) opts.onChange(value);
      };

      text.setValue(opts.value).onChange(applyChange);
      opts.attachSuggest?.(text, applyChange);
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
      validate: (value) => {
        const error = validateFormat(value, granularity);
        return error ? reject(error) : valid;
      },
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
        this.plugin.settings.granularities[granularity].folder =
          canonicalFolder(normalizePath(value));
        this.debouncedSave();
      },
      attachSuggest: (text, applyChange) =>
        new PathSuggest(this.app, text.inputEl, () =>
          this.app.vault.getAllFolders(),
        ).onSelect((folder) => {
          text.setValue(folder.path);
          applyChange(folder.path);
        }),
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
      attachSuggest: (text, applyChange) =>
        new PathSuggest(this.app, text.inputEl, () =>
          this.app.vault.getMarkdownFiles(),
        ).onSelect((file) => {
          text.setValue(file.path);
          applyChange(file.path);
        }),
    });
  }
}
