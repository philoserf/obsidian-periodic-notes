import { type App, normalizePath, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_FORMAT } from "./constants";
import { FileSuggest, FolderSuggest } from "./fileSuggest";
import { validateFormat } from "./format";
import type PeriodicNotesPlugin from "./main";
import type { Granularity } from "./types";

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

export class SettingsTab extends PluginSettingTab {
  constructor(
    readonly app: App,
    readonly plugin: PeriodicNotesPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    for (const granularity of [
      "day",
      "week",
      "month",
      "year",
    ] as Granularity[]) {
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

    const formatSetting = new Setting(containerEl)
      .setName("Format")
      .setDesc("Moment.js date format string")
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_FORMAT[granularity])
          .setValue(config.format)
          .onChange(async (value) => {
            const error = validateFormat(value, granularity);
            formatSetting.descEl.setText(
              error || "Moment.js date format string",
            );
            formatSetting.descEl.toggleClass("has-error", !!error);
            this.plugin.settings.granularities[granularity].format = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName("Folder").addText((text) => {
      text.setValue(config.folder);
      new FolderSuggest(this.app, text.inputEl, async (value) => {
        const error = validateFolder(this.app, value);
        if (!error) {
          this.plugin.settings.granularities[granularity].folder = value;
          await this.plugin.saveSettings();
        }
      });
    });

    new Setting(containerEl).setName("Template").addText((text) => {
      text.setValue(config.templatePath ?? "");
      new FileSuggest(this.app, text.inputEl, async (value) => {
        const error = validateTemplate(this.app, value);
        if (!error) {
          this.plugin.settings.granularities[granularity].templatePath =
            value || undefined;
          await this.plugin.saveSettings();
        }
      });
    });
  }
}
