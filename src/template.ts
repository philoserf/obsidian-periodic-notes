import { type App, Notice, normalizePath, type TFile } from "obsidian";

import { getFormat, join } from "./format";
import { applyTemplate } from "./templateRender";
import type { CacheEntry, Granularity, NoteConfig, Settings } from "./types";

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
