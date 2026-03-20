import type { Moment } from "moment";
import { type App, Notice, normalizePath, type TFile } from "obsidian";

import { WEEKDAYS } from "./constants";
import { getFormat, join } from "./format";
import type { CacheEntry, Granularity, NoteConfig, Settings } from "./types";

function getDaysOfWeek(): string[] {
  const { moment } = window;
  let weekStart = moment.localeData().firstDayOfWeek();
  const daysOfWeek = [...WEEKDAYS];
  while (weekStart) {
    const day = daysOfWeek.shift();
    if (day) daysOfWeek.push(day);
    weekStart--;
  }
  return daysOfWeek;
}

function getDayOfWeekNumericalValue(dayOfWeekName: string): number {
  const index = getDaysOfWeek().indexOf(dayOfWeekName.toLowerCase());
  return Math.max(0, index);
}

function replaceGranularityTokens(
  contents: string,
  date: Moment,
  tokenPattern: string,
  format: string,
  startOfUnit?: Granularity,
): string {
  const pattern = new RegExp(
    `{{\\s*(${tokenPattern})\\s*(([-+]\\d+)([ymwdhs]))?\\s*(:.+?)?}}`,
    "gi",
  );
  const now = window.moment();
  return contents.replace(
    pattern,
    (_, _token, calc, timeDelta, unit, momentFormat) => {
      const periodStart = date.clone();
      if (startOfUnit) {
        periodStart.startOf(startOfUnit);
      }
      periodStart.set({
        hour: now.get("hour"),
        minute: now.get("minute"),
        second: now.get("second"),
      });
      if (calc) {
        periodStart.add(parseInt(timeDelta, 10), unit);
      }
      if (momentFormat) {
        return periodStart.format(momentFormat.substring(1).trim());
      }
      return periodStart.format(format);
    },
  );
}

export function applyTemplate(
  filename: string,
  granularity: Granularity,
  date: Moment,
  format: string,
  rawTemplateContents: string,
): string {
  let contents = rawTemplateContents
    .replace(/{{\s*date\s*}}/gi, filename)
    .replace(/{{\s*time\s*}}/gi, window.moment().format("HH:mm"))
    .replace(/{{\s*title\s*}}/gi, filename);

  if (granularity === "day") {
    contents = contents
      .replace(
        /{{\s*yesterday\s*}}/gi,
        date.clone().subtract(1, "day").format(format),
      )
      .replace(/{{\s*tomorrow\s*}}/gi, date.clone().add(1, "d").format(format));
    contents = replaceGranularityTokens(contents, date, "date|time", format);
  }

  if (granularity === "week") {
    contents = contents.replace(
      new RegExp(`{{\\s*(${WEEKDAYS.join("|")})\\s*:(.*?)}}`, "gi"),
      (_, dayOfWeek, momentFormat) => {
        const day = getDayOfWeekNumericalValue(dayOfWeek);
        return date.weekday(day).format(momentFormat.trim());
      },
    );
  }

  if (granularity === "month" || granularity === "year") {
    contents = replaceGranularityTokens(
      contents,
      date,
      granularity,
      format,
      granularity,
    );
  }

  return contents;
}

export async function readTemplate(
  app: App,
  templatePath: string | undefined,
  granularity: Granularity,
): Promise<string> {
  if (!templatePath || templatePath === "/") return "";
  const { metadataCache, vault } = app;
  const normalized = normalizePath(templatePath);

  try {
    const file = metadataCache.getFirstLinkpathDest(normalized, "");
    return file ? vault.cachedRead(file) : "";
  } catch (err) {
    console.error(
      `[Periodic Notes] Failed to read the ${granularity} note template '${normalized}'`,
      err,
    );
    new Notice(`Failed to read the ${granularity} note template`);
    return "";
  }
}

export async function applyTemplateToFile(
  app: App,
  file: TFile,
  settings: Settings,
  entry: CacheEntry,
): Promise<void> {
  const format = getFormat(settings, entry.granularity);
  const templateContents = await readTemplate(
    app,
    settings.granularities[entry.granularity].templatePath,
    entry.granularity,
  );
  const rendered = applyTemplate(
    file.basename,
    entry.granularity,
    entry.date,
    format,
    templateContents,
  );
  await app.vault.modify(file, rendered);
}

export async function getNoteCreationPath(
  app: App,
  filename: string,
  config: NoteConfig,
): Promise<string> {
  const directory = config.folder ?? "";
  const filenameWithExt = !filename.endsWith(".md")
    ? `${filename}.md`
    : filename;
  const path = normalizePath(join(directory, filenameWithExt));
  await ensureFolderExists(app, path);
  return path;
}

async function ensureFolderExists(app: App, path: string): Promise<void> {
  const dirs = path.replace(/\\/g, "/").split("/");
  dirs.pop();
  let current = "";
  for (const dir of dirs) {
    current = current ? `${current}/${dir}` : dir;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}
