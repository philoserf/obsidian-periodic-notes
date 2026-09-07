import { type App, Notice, normalizePath, type TFile, TFolder } from "obsidian";

import { getFormat } from "./format";
import { buildNotePath } from "./paths";
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
    // Awaited, not returned: returning the promise completes the try block, so
    // a later rejection has nothing to catch it and the specific error this
    // function exists to report is lost.
    return file ? await vault.cachedRead(file) : "";
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
    // The index holds this entry by reference, so the cached Moment never
    // crosses into rendering code — a token that mutates its argument would
    // otherwise corrupt the key the entry is indexed under.
    entry.date.clone(),
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
  const path = normalizePath(buildNotePath(directory, filenameWithExt));
  await ensureFolderExists(app, path);
  return path;
}

async function ensureFolderExists(app: App, path: string): Promise<void> {
  const dirs = path.replace(/\\/g, "/").split("/");
  dirs.pop();
  let current = "";
  for (const dir of dirs) {
    current = current ? `${current}/${dir}` : dir;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing instanceof TFolder) continue;

    // Asking only whether *something* is here would skip the create and let
    // note creation fail later with an error naming the leaf path, saying
    // nothing about the file sitting where a folder belongs.
    if (existing) {
      throw new Error(
        `Cannot create folder "${current}": a file already exists there`,
      );
    }

    try {
      await app.vault.createFolder(current);
    } catch (err) {
      // A second granularity creating into the same new folder, or Obsidian
      // Sync, can win the race between the check above and this call. Only a
      // genuine failure leaves nothing behind.
      if (!(app.vault.getAbstractFileByPath(current) instanceof TFolder)) {
        throw err;
      }
    }
  }
}
