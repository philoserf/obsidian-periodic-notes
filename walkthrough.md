# Obsidian Periodic Notes Walkthrough

*2026-04-03T18:39:57Z by Showboat 0.6.1*
<!-- showboat-id: f9a85741-ec19-4eea-a1ae-6b8d084968b3 -->

## Overview

**Obsidian Periodic Notes** is an Obsidian plugin for creating and managing daily, weekly, monthly, and yearly notes. It provides a sidebar calendar UI, template-based note creation, format-driven file resolution, and keyboard-navigable commands.

**Key technologies:** TypeScript, Svelte 5 (calendar UI only), Vite (bundler), Moment.js (dates), Obsidian Plugin API.

**Entry point:** `src/main.ts` exports a single `PeriodicNotesPlugin` class. Vite bundles everything into `main.js` (CommonJS) at the project root.

**Reading order:** types → constants → format → cache → template → commands → main → settings → calendar.

## Architecture

The source is organized into three layers:

1. **Core types and pure logic** — `types.ts`, `constants.ts`, `format.ts` (no Obsidian imports in `format.ts`)
2. **Plugin infrastructure** — `main.ts`, `cache.ts`, `template.ts`, `commands.ts`, `settings.ts`
3. **Calendar UI** — `calendar/` directory with Svelte 5 components and an Obsidian `ItemView` host

```bash
ls -1 src/*.ts src/calendar/*.ts src/calendar/*.svelte 2>/dev/null
```

```output
src/cache.test.ts
src/cache.ts
src/calendar/Arrow.svelte
src/calendar/Calendar.svelte
src/calendar/Day.svelte
src/calendar/Month.svelte
src/calendar/Nav.svelte
src/calendar/store.test.ts
src/calendar/store.ts
src/calendar/types.ts
src/calendar/utils.test.ts
src/calendar/utils.ts
src/calendar/view.ts
src/calendar/Week.svelte
src/commands.ts
src/constants.ts
src/fileSuggest.ts
src/format.test.ts
src/format.ts
src/icons.ts
src/main.ts
src/obsidian.d.ts
src/platform.ts
src/settings.ts
src/template.test.ts
src/template.ts
src/test-preload.ts
src/types.ts
```

## Types (`src/types.ts`)

The foundation. Four granularities, a per-granularity config shape, a top-level settings object, and a cache entry.

```bash
cat -n src/types.ts
```

```output
     1	import type { Moment } from "moment";
     2	
     3	export type Granularity = "day" | "week" | "month" | "year";
     4	export const granularities: Granularity[] = ["day", "week", "month", "year"];
     5	
     6	export interface NoteConfig {
     7	  enabled: boolean;
     8	  format: string;
     9	  folder: string;
    10	  templatePath?: string;
    11	}
    12	
    13	export interface Settings {
    14	  granularities: Record<Granularity, NoteConfig>;
    15	}
    16	
    17	export interface CacheEntry {
    18	  filePath: string;
    19	  date: Moment;
    20	  granularity: Granularity;
    21	  match: "filename" | "frontmatter";
    22	}
```

`Granularity` is a union of four string literals. `NoteConfig` holds per-granularity settings: whether it's enabled, the moment.js format string, the folder path, and an optional template file. `Settings` is a record keyed by granularity. `CacheEntry` tracks a resolved file with its parsed date and how it was matched (filename parsing or frontmatter key).

## Constants (`src/constants.ts`)

Default formats, weekday labels, and the factory for default settings.

```bash
cat -n src/constants.ts
```

```output
     1	import type { Granularity, NoteConfig, Settings } from "./types";
     2	
     3	export const DEFAULT_FORMAT: Record<Granularity, string> = {
     4	  day: "YYYY-MM-DD",
     5	  week: "gggg-[W]ww",
     6	  month: "YYYY-MM",
     7	  year: "YYYY",
     8	};
     9	
    10	export const DEFAULT_CONFIG: NoteConfig = {
    11	  enabled: false,
    12	  format: "",
    13	  folder: "",
    14	  templatePath: undefined,
    15	};
    16	
    17	export const DEFAULT_SETTINGS: Settings = {
    18	  granularities: {
    19	    day: { ...DEFAULT_CONFIG },
    20	    week: { ...DEFAULT_CONFIG },
    21	    month: { ...DEFAULT_CONFIG },
    22	    year: { ...DEFAULT_CONFIG },
    23	  },
    24	};
    25	
    26	export const WEEKDAYS = [
    27	  "sunday",
    28	  "monday",
    29	  "tuesday",
    30	  "wednesday",
    31	  "thursday",
    32	  "friday",
    33	  "saturday",
    34	] as const;
    35	
    36	export type WeekdayName = (typeof WEEKDAYS)[number];
    37	
    38	export const HUMANIZE_FORMAT: Partial<Record<Granularity, string>> = {
    39	  month: "MMMM YYYY",
    40	  year: "YYYY",
    41	};
    42	
    43	export const VIEW_TYPE_CALENDAR = "calendar";
    44	
    45	export const DISPLAYED_MONTH = Symbol("displayedMonth");
```

Key details: when `format` is empty string, the code falls back to `DEFAULT_FORMAT` for the granularity. Week format uses `gggg-[W]ww` (locale-aware ISO week). `DISPLAYED_MONTH` is a Symbol used as a Svelte context key to share the currently displayed month across calendar components.

## Format Utilities (`src/format.ts`)

Pure functions for format validation and path manipulation. This is the only core module with no Obsidian imports — directly testable.

```bash
cat -n src/format.ts
```

```output
     1	import { DEFAULT_FORMAT } from "./constants";
     2	import {
     3	  type Granularity,
     4	  granularities,
     5	  type NoteConfig,
     6	  type Settings,
     7	} from "./types";
     8	
     9	export function getFormat(
    10	  settings: Settings,
    11	  granularity: Granularity,
    12	): string {
    13	  return (
    14	    settings.granularities[granularity].format || DEFAULT_FORMAT[granularity]
    15	  );
    16	}
    17	
    18	export function getPossibleFormats(
    19	  settings: Settings,
    20	  granularity: Granularity,
    21	): string[] {
    22	  const format = settings.granularities[granularity].format;
    23	  if (!format) return [DEFAULT_FORMAT[granularity]];
    24	
    25	  const partialFormatExp = /[^/]*$/.exec(format);
    26	  if (partialFormatExp) {
    27	    const partialFormat = partialFormatExp[0];
    28	    return [format, partialFormat];
    29	  }
    30	  return [format];
    31	}
    32	
    33	export function getConfig(
    34	  settings: Settings,
    35	  granularity: Granularity,
    36	): NoteConfig {
    37	  return settings.granularities[granularity];
    38	}
    39	
    40	export function getEnabledGranularities(settings: Settings): Granularity[] {
    41	  return granularities.filter((g) => settings.granularities[g].enabled);
    42	}
    43	
    44	export function removeEscapedCharacters(format: string): string {
    45	  const withoutBrackets = format.replace(/\[[^\]]*\]/g, "");
    46	  return withoutBrackets.replace(/\\./g, "");
    47	}
    48	
    49	export function getBasename(format: string): string {
    50	  const isTemplateNested = format.indexOf("/") !== -1;
    51	  return isTemplateNested ? (format.split("/").pop() ?? "") : format;
    52	}
    53	
    54	export function isValidFilename(filename: string): boolean {
    55	  const illegalRe = /[?<>\\:*|"]/g;
    56	  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional filename validation
    57	  const controlRe = /[\x00-\x1f\x80-\x9f]/g;
    58	  const reservedRe = /^\.+$/;
    59	  const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
    60	
    61	  return (
    62	    !illegalRe.test(filename) &&
    63	    !controlRe.test(filename) &&
    64	    !reservedRe.test(filename) &&
    65	    !windowsReservedRe.test(filename)
    66	  );
    67	}
    68	
    69	export function validateFormat(
    70	  format: string,
    71	  granularity: Granularity,
    72	): string {
    73	  if (!format) return "";
    74	  if (!isValidFilename(format)) return "Format contains illegal characters";
    75	
    76	  if (granularity === "day") {
    77	    const testFormattedDate = window.moment().format(format);
    78	    const parsedDate = window.moment(testFormattedDate, format, true);
    79	    if (!parsedDate.isValid()) return "Failed to parse format";
    80	  }
    81	  return "";
    82	}
    83	
    84	function isMissingRequiredTokens(format: string): boolean {
    85	  const base = getBasename(format).replace(/\[[^\]]*\]/g, "");
    86	  return (
    87	    !["M", "D"].every((t) => base.includes(t)) ||
    88	    !(base.includes("Y") || base.includes("y"))
    89	  );
    90	}
    91	
    92	export function validateFormatComplexity(
    93	  format: string,
    94	  granularity: Granularity,
    95	): "valid" | "fragile-basename" | "loose-parsing" {
    96	  const testFormattedDate = window.moment().format(format);
    97	  const parsedDate = window.moment(testFormattedDate, format, true);
    98	  if (!parsedDate.isValid()) return "loose-parsing";
    99	
   100	  const strippedFormat = removeEscapedCharacters(format);
   101	  if (strippedFormat.includes("/")) {
   102	    if (granularity === "day" && isMissingRequiredTokens(format)) {
   103	      return "fragile-basename";
   104	    }
   105	  }
   106	  return "valid";
   107	}
   108	
   109	export function isIsoFormat(format: string): boolean {
   110	  const cleanFormat = removeEscapedCharacters(format);
   111	  return /w{1,2}/.test(cleanFormat);
   112	}
   113	
   114	export function join(...partSegments: string[]): string {
   115	  let parts: string[] = [];
   116	  for (let i = 0, l = partSegments.length; i < l; i++) {
   117	    parts = parts.concat(partSegments[i].split("/"));
   118	  }
   119	  const newParts = [];
   120	  for (let i = 0, l = parts.length; i < l; i++) {
   121	    const part = parts[i];
   122	    if (!part || part === ".") continue;
   123	    else newParts.push(part);
   124	  }
   125	  if (parts[0] === "") newParts.unshift("");
   126	  return newParts.join("/");
   127	}
```

Notable design:

- `getPossibleFormats()` returns both the full format (e.g. `YYYY/YYYY-MM-DD`) and just the basename (`YYYY-MM-DD`), allowing the cache to match files that were moved or exist at the root.
- `validateFormatComplexity()` classifies nested formats as `"fragile-basename"` when the basename alone lacks enough date tokens (M, D, Y) for unambiguous parsing.
- `isIsoFormat()` detects ISO week formats by checking for `w` tokens after stripping escaped characters.
- `join()` is a custom path joiner that normalizes slashes and removes empty/dot segments — needed because Obsidian vault paths use forward slashes on all platforms.

## Cache (`src/cache.ts`)

The cache is the central data structure. It maintains a dual-index map of every periodic note in the vault, enabling O(1) lookup by file path or by date+granularity.

```bash
cat -n src/cache.ts | head -60
```

```output
     1	import type { Moment } from "moment";
     2	import {
     3	  type App,
     4	  type CachedMetadata,
     5	  Component,
     6	  Notice,
     7	  parseFrontMatterEntry,
     8	  type TAbstractFile,
     9	  TFile,
    10	  TFolder,
    11	} from "obsidian";
    12	
    13	import {
    14	  getEnabledGranularities,
    15	  getFormat,
    16	  getPossibleFormats,
    17	  removeEscapedCharacters,
    18	  validateFormatComplexity,
    19	} from "./format";
    20	import type PeriodicNotesPlugin from "./main";
    21	import { applyTemplateToFile } from "./template";
    22	import { type CacheEntry, type Granularity, granularities } from "./types";
    23	
    24	export type { CacheEntry };
    25	
    26	function canonicalKey(granularity: Granularity, date: Moment): string {
    27	  return `${granularity}:${date.clone().startOf(granularity).toISOString()}`;
    28	}
    29	
    30	function pathWithoutExtension(file: TFile): string {
    31	  const extLen = file.extension.length + 1;
    32	  return file.path.slice(0, -extLen);
    33	}
    34	
    35	function getDateInput(
    36	  file: TFile,
    37	  format: string,
    38	  granularity: Granularity,
    39	): string {
    40	  if (validateFormatComplexity(format, granularity) === "fragile-basename") {
    41	    const fileName = pathWithoutExtension(file);
    42	    const strippedFormat = removeEscapedCharacters(format);
    43	    const nestingLvl = (strippedFormat.match(/\//g)?.length ?? 0) + 1;
    44	    const pathParts = fileName.split("/");
    45	    return pathParts.slice(-nestingLvl).join("/");
    46	  }
    47	  return file.basename;
    48	}
    49	
    50	export class NoteCache extends Component {
    51	  private byPath: Map<string, CacheEntry>;
    52	  private byKey: Map<string, CacheEntry>;
    53	
    54	  constructor(
    55	    readonly app: App,
    56	    readonly plugin: PeriodicNotesPlugin,
    57	  ) {
    58	    super();
    59	    this.byPath = new Map();
    60	    this.byKey = new Map();
```

```bash
cat -n src/cache.ts | tail -n +61 | head -80
```

```output
    61	
    62	    this.app.workspace.onLayoutReady(() => {
    63	      console.info("[Periodic Notes] initializing cache");
    64	      this.initialize();
    65	      this.registerEvent(
    66	        this.app.vault.on("create", (file) => {
    67	          if (file instanceof TFile) this.resolve(file, "create");
    68	        }),
    69	      );
    70	      this.registerEvent(
    71	        this.app.vault.on("delete", (file) => {
    72	          if (file instanceof TFile) this.remove(file.path);
    73	        }),
    74	      );
    75	      this.registerEvent(this.app.vault.on("rename", this.onRename, this));
    76	      this.registerEvent(
    77	        this.app.metadataCache.on("changed", this.onMetadataChanged, this),
    78	      );
    79	      this.registerEvent(
    80	        this.app.workspace.on(
    81	          "periodic-notes:settings-updated",
    82	          this.reset,
    83	          this,
    84	        ),
    85	      );
    86	    });
    87	  }
    88	
    89	  public reset(): void {
    90	    console.info("[Periodic Notes] resetting cache");
    91	    this.byPath.clear();
    92	    this.byKey.clear();
    93	    this.initialize();
    94	  }
    95	
    96	  private initialize(): void {
    97	    const settings = this.plugin.settings;
    98	    const visited = new Set<TFolder>();
    99	    const recurseChildren = (
   100	      folder: TFolder,
   101	      cb: (file: TAbstractFile) => void,
   102	    ) => {
   103	      if (visited.has(folder)) return;
   104	      visited.add(folder);
   105	      for (const c of folder.children) {
   106	        if (c instanceof TFile) cb(c);
   107	        else if (c instanceof TFolder) recurseChildren(c, cb);
   108	      }
   109	    };
   110	
   111	    const active = getEnabledGranularities(settings);
   112	    for (const granularity of active) {
   113	      const folder = settings.granularities[granularity].folder || "/";
   114	      const rootFolder = this.app.vault.getAbstractFileByPath(folder);
   115	      if (!(rootFolder instanceof TFolder)) continue;
   116	
   117	      recurseChildren(rootFolder, (file) => {
   118	        if (file instanceof TFile) {
   119	          this.resolve(file, "initialize");
   120	          const metadata = this.app.metadataCache.getFileCache(file);
   121	          if (metadata) this.onMetadataChanged(file, "", metadata);
   122	        }
   123	      });
   124	    }
   125	  }
   126	
   127	  private onMetadataChanged(
   128	    file: TFile,
   129	    _data: string,
   130	    cache: CachedMetadata,
   131	  ): void {
   132	    const settings = this.plugin.settings;
   133	    const active = getEnabledGranularities(settings);
   134	    if (active.length === 0) return;
   135	
   136	    for (const granularity of active) {
   137	      const folder = settings.granularities[granularity].folder || "/";
   138	      if (!file.path.startsWith(folder === "/" ? "" : `${folder}/`)) continue;
   139	      const frontmatterEntry = parseFrontMatterEntry(
   140	        cache.frontmatter,
```

```bash
cat -n src/cache.ts | tail -n +141 | head -100
```

```output
   141	        granularity,
   142	      );
   143	      if (!frontmatterEntry) continue;
   144	
   145	      const format = getFormat(settings, granularity);
   146	      if (typeof frontmatterEntry === "string") {
   147	        const date = window.moment(frontmatterEntry, format, true);
   148	        if (date.isValid()) {
   149	          this.set({
   150	            filePath: file.path,
   151	            date,
   152	            granularity,
   153	            match: "frontmatter",
   154	          });
   155	        }
   156	        return;
   157	      }
   158	    }
   159	  }
   160	
   161	  private onRename(file: TAbstractFile, oldPath: string): void {
   162	    if (file instanceof TFile) {
   163	      this.remove(oldPath);
   164	      this.resolve(file, "rename");
   165	    }
   166	  }
   167	
   168	  private resolve(
   169	    file: TFile,
   170	    reason: "create" | "rename" | "initialize" = "create",
   171	  ): void {
   172	    const settings = this.plugin.settings;
   173	    const active = getEnabledGranularities(settings);
   174	    if (active.length === 0) return;
   175	
   176	    const existing = this.byPath.get(file.path);
   177	    if (existing && existing.match === "frontmatter") return;
   178	
   179	    for (const granularity of active) {
   180	      const folder = settings.granularities[granularity].folder || "/";
   181	      if (!file.path.startsWith(folder === "/" ? "" : `${folder}/`)) continue;
   182	
   183	      const formats = getPossibleFormats(settings, granularity);
   184	      const dateInputStr = getDateInput(file, formats[0], granularity);
   185	      const date = window.moment(dateInputStr, formats, true);
   186	      if (date.isValid()) {
   187	        const entry: CacheEntry = {
   188	          filePath: file.path,
   189	          date,
   190	          granularity,
   191	          match: "filename",
   192	        };
   193	        this.set(entry);
   194	
   195	        if (reason === "create" && file.stat.size === 0) {
   196	          applyTemplateToFile(this.app, file, settings, entry).catch((err) => {
   197	            console.error("[Periodic Notes] failed to apply template", err);
   198	            new Notice(
   199	              `Periodic Notes: failed to apply template to "${file.path}". See console for details.`,
   200	            );
   201	          });
   202	        }
   203	
   204	        this.app.workspace.trigger("periodic-notes:resolve", granularity, file);
   205	        return;
   206	      }
   207	    }
   208	  }
   209	
   210	  private set(entry: CacheEntry): void {
   211	    const oldByPath = this.byPath.get(entry.filePath);
   212	    if (oldByPath) {
   213	      this.byKey.delete(canonicalKey(oldByPath.granularity, oldByPath.date));
   214	    }
   215	    const key = canonicalKey(entry.granularity, entry.date);
   216	    // Evict any other file that claims the same canonical key
   217	    const oldByKey = this.byKey.get(key);
   218	    if (oldByKey && oldByKey.filePath !== entry.filePath) {
   219	      this.byPath.delete(oldByKey.filePath);
   220	    }
   221	    this.byPath.set(entry.filePath, entry);
   222	    this.byKey.set(key, entry);
   223	  }
   224	
   225	  private remove(filePath: string): void {
   226	    const entry = this.byPath.get(filePath);
   227	    if (entry) {
   228	      this.byKey.delete(canonicalKey(entry.granularity, entry.date));
   229	      this.byPath.delete(filePath);
   230	    }
   231	  }
   232	
   233	  public getPeriodicNote(
   234	    granularity: Granularity,
   235	    targetDate: Moment,
   236	  ): TFile | null {
   237	    const key = canonicalKey(granularity, targetDate);
   238	    const entry = this.byKey.get(key);
   239	    if (!entry) return null;
   240	    const file = this.app.vault.getAbstractFileByPath(entry.filePath);
```

```bash
cat -n src/cache.ts | tail -n +240 | head -60
```

```output
   240	    const file = this.app.vault.getAbstractFileByPath(entry.filePath);
   241	    if (file instanceof TFile) return file;
   242	    this.remove(entry.filePath);
   243	    return null;
   244	  }
   245	
   246	  public getPeriodicNotes(
   247	    granularity: Granularity,
   248	    targetDate: Moment,
   249	    includeFinerGranularities = false,
   250	  ): CacheEntry[] {
   251	    const matches: CacheEntry[] = [];
   252	    const gIdx = granularities.indexOf(granularity);
   253	    for (const entry of this.byPath.values()) {
   254	      const eIdx = granularities.indexOf(entry.granularity);
   255	      if (
   256	        (granularity === entry.granularity ||
   257	          (includeFinerGranularities && eIdx <= gIdx)) &&
   258	        entry.date.isSame(targetDate, granularity)
   259	      ) {
   260	        matches.push(entry);
   261	      }
   262	    }
   263	    return matches;
   264	  }
   265	
   266	  public isPeriodic(targetPath: string, granularity?: Granularity): boolean {
   267	    const entry = this.byPath.get(targetPath);
   268	    if (!entry) return false;
   269	    if (!granularity) return true;
   270	    return granularity === entry.granularity;
   271	  }
   272	
   273	  public find(filePath: string | undefined): CacheEntry | null {
   274	    if (!filePath) return null;
   275	    return this.byPath.get(filePath) ?? null;
   276	  }
   277	
   278	  public findAdjacent(
   279	    filePath: string,
   280	    direction: "forwards" | "backwards",
   281	  ): CacheEntry | null {
   282	    const curr = this.find(filePath);
   283	    if (!curr) return null;
   284	
   285	    const sorted = Array.from(this.byKey.entries())
   286	      .filter(([key]) => key.startsWith(`${curr.granularity}:`))
   287	      .sort(([a], [b]) => a.localeCompare(b))
   288	      .map(([, entry]) => entry);
   289	
   290	    const idx = sorted.findIndex((e) => e.filePath === filePath);
   291	    if (idx === -1) return null;
   292	    const offset = direction === "forwards" ? 1 : -1;
   293	    return sorted[idx + offset] ?? null;
   294	  }
   295	}
```

### Cache data flow

1. **Initialization**: On layout ready, recurse each enabled granularity's configured folder. For every `.md` file, try filename parsing first, then check frontmatter.
2. **Live updates**: Vault events (`create`, `delete`, `rename`) and metadata changes trigger incremental updates. The `set()` method handles conflicts by evicting old entries for the same canonical key or file path.
3. **Resolution priority**: Frontmatter matches take precedence. In `resolve()`, if an existing entry was matched via frontmatter, filename-based re-resolution is skipped (line 177).
4. **Template auto-application**: When a newly created file has zero bytes (line 195), the cache automatically triggers template rendering — this is how creating a note also fills in its template.
5. **Canonical key**: `"${granularity}:${date.startOf(granularity).toISOString()}"` — normalizes dates to the start of their period so that e.g. any moment within Monday–Sunday maps to the same week key.

### `findAdjacent` (line 278)

Sorts all entries for the same granularity lexicographically by canonical key, then returns the entry at `idx ± 1`. This is **O(n)** on every call — flagged in issue #118 as a performance target for large vaults.

## Template Engine (`src/template.ts`)

Reads a template file and replaces `{{token}}` placeholders with computed date values.

```bash
cat -n src/template.ts
```

```output
     1	import type { Moment } from "moment";
     2	import { type App, Notice, normalizePath, type TFile } from "obsidian";
     3	
     4	import { WEEKDAYS } from "./constants";
     5	import { getFormat, join } from "./format";
     6	import type { CacheEntry, Granularity, NoteConfig, Settings } from "./types";
     7	
     8	function getDaysOfWeek(): string[] {
     9	  const { moment } = window;
    10	  let weekStart = moment.localeData().firstDayOfWeek();
    11	  const daysOfWeek = [...WEEKDAYS];
    12	  while (weekStart) {
    13	    const day = daysOfWeek.shift();
    14	    if (day) daysOfWeek.push(day);
    15	    weekStart--;
    16	  }
    17	  return daysOfWeek;
    18	}
    19	
    20	function getDayOfWeekNumericalValue(dayOfWeekName: string): number {
    21	  const index = getDaysOfWeek().indexOf(dayOfWeekName.toLowerCase());
    22	  return Math.max(0, index);
    23	}
    24	
    25	function replaceGranularityTokens(
    26	  contents: string,
    27	  date: Moment,
    28	  tokenPattern: string,
    29	  format: string,
    30	  startOfUnit?: Granularity,
    31	): string {
    32	  const pattern = new RegExp(
    33	    `{{\\s*(${tokenPattern})\\s*(([-+]\\d+)([ymwdhs]))?\\s*(:.+?)?}}`,
    34	    "gi",
    35	  );
    36	  const now = window.moment();
    37	  return contents.replace(
    38	    pattern,
    39	    (_, _token, calc, timeDelta, unit, momentFormat) => {
    40	      const periodStart = date.clone();
    41	      if (startOfUnit) {
    42	        periodStart.startOf(startOfUnit);
    43	      }
    44	      periodStart.set({
    45	        hour: now.get("hour"),
    46	        minute: now.get("minute"),
    47	        second: now.get("second"),
    48	      });
    49	      if (calc) {
    50	        periodStart.add(parseInt(timeDelta, 10), unit);
    51	      }
    52	      if (momentFormat) {
    53	        return periodStart.format(momentFormat.substring(1).trim());
    54	      }
    55	      return periodStart.format(format);
    56	    },
    57	  );
    58	}
    59	
    60	export function applyTemplate(
    61	  filename: string,
    62	  granularity: Granularity,
    63	  date: Moment,
    64	  format: string,
    65	  rawTemplateContents: string,
    66	): string {
    67	  let contents = rawTemplateContents
    68	    .replace(/{{\s*date\s*}}/gi, filename)
    69	    .replace(/{{\s*time\s*}}/gi, window.moment().format("HH:mm"))
    70	    .replace(/{{\s*title\s*}}/gi, filename);
    71	
    72	  if (granularity === "day") {
    73	    contents = contents
    74	      .replace(
    75	        /{{\s*yesterday\s*}}/gi,
    76	        date.clone().subtract(1, "day").format(format),
    77	      )
    78	      .replace(/{{\s*tomorrow\s*}}/gi, date.clone().add(1, "d").format(format));
    79	    contents = replaceGranularityTokens(contents, date, "date|time", format);
    80	  }
    81	
    82	  if (granularity === "week") {
    83	    contents = contents.replace(
    84	      new RegExp(`{{\\s*(${WEEKDAYS.join("|")})\\s*:(.*?)}}`, "gi"),
    85	      (_, dayOfWeek, momentFormat) => {
    86	        const day = getDayOfWeekNumericalValue(dayOfWeek);
    87	        return date.weekday(day).format(momentFormat.trim());
    88	      },
    89	    );
    90	  }
    91	
    92	  if (granularity === "month" || granularity === "year") {
    93	    contents = replaceGranularityTokens(
    94	      contents,
    95	      date,
    96	      granularity,
    97	      format,
    98	      granularity,
    99	    );
   100	  }
   101	
   102	  return contents;
   103	}
   104	
   105	export async function readTemplate(
   106	  app: App,
   107	  templatePath: string | undefined,
   108	  granularity: Granularity,
   109	): Promise<string> {
   110	  if (!templatePath || templatePath === "/") return "";
   111	  const { metadataCache, vault } = app;
   112	  const normalized = normalizePath(templatePath);
   113	
   114	  try {
   115	    const file = metadataCache.getFirstLinkpathDest(normalized, "");
   116	    return file ? vault.cachedRead(file) : "";
   117	  } catch (err) {
   118	    console.error(
   119	      `[Periodic Notes] Failed to read the ${granularity} note template '${normalized}'`,
   120	      err,
   121	    );
   122	    new Notice(`Failed to read the ${granularity} note template`);
   123	    return "";
   124	  }
   125	}
   126	
   127	export async function applyTemplateToFile(
   128	  app: App,
   129	  file: TFile,
   130	  settings: Settings,
   131	  entry: CacheEntry,
   132	): Promise<void> {
   133	  const format = getFormat(settings, entry.granularity);
   134	  const templateContents = await readTemplate(
   135	    app,
   136	    settings.granularities[entry.granularity].templatePath,
   137	    entry.granularity,
   138	  );
   139	  const rendered = applyTemplate(
   140	    file.basename,
   141	    entry.granularity,
   142	    entry.date,
   143	    format,
   144	    templateContents,
   145	  );
   146	  await app.vault.modify(file, rendered);
   147	}
   148	
   149	export async function getNoteCreationPath(
   150	  app: App,
   151	  filename: string,
   152	  config: NoteConfig,
   153	): Promise<string> {
   154	  const directory = config.folder ?? "";
   155	  const filenameWithExt = !filename.endsWith(".md")
   156	    ? `${filename}.md`
   157	    : filename;
   158	  const path = normalizePath(join(directory, filenameWithExt));
   159	  await ensureFolderExists(app, path);
   160	  return path;
   161	}
   162	
   163	async function ensureFolderExists(app: App, path: string): Promise<void> {
   164	  const dirs = path.replace(/\\/g, "/").split("/");
   165	  dirs.pop();
   166	  let current = "";
   167	  for (const dir of dirs) {
   168	    current = current ? `${current}/${dir}` : dir;
   169	    if (!app.vault.getAbstractFileByPath(current)) {
   170	      await app.vault.createFolder(current);
   171	    }
   172	  }
   173	}
```

### Template token resolution

`applyTemplate()` processes tokens in layers:

1. **Universal tokens**: `{{date}}`, `{{time}}`, `{{title}}` — simple string replacements.
2. **Day-specific**: `{{yesterday}}`, `{{tomorrow}}`, and dynamic `{{date+1d:YYYY-MM-DD}}` via `replaceGranularityTokens()`.
3. **Week-specific**: `{{monday:YYYY-MM-DD}}` resolves to that weekday's date within the note's week.
4. **Month/Year**: `{{month+1m:MMMM}}`, `{{year}}` with optional offset and format override.

The regex in `replaceGranularityTokens()` (line 32–34) captures: token name, optional `±Nd/w/m/y` offset, and optional `:format` suffix. The current time is injected into the period start so `{{time}}` reflects creation time.

**Concern:** The regexes on lines 32–34 and 84 are reconstructed on every call. Issue #115 tracks hoisting these as module-level constants.

## Commands (`src/commands.ts`)

Generates 5 commands per enabled granularity (open present, jump forwards/backwards, open next/previous) plus a ribbon context menu.

```bash
cat -n src/commands.ts
```

```output
     1	import {
     2	  type App,
     3	  type Command,
     4	  Menu,
     5	  Notice,
     6	  type Point,
     7	  TFile,
     8	} from "obsidian";
     9	import type PeriodicNotesPlugin from "./main";
    10	import { type Granularity, granularities } from "./types";
    11	
    12	interface GranularityLabel {
    13	  periodicity: string;
    14	  relativeUnit: string;
    15	  labelOpenPresent: string;
    16	}
    17	
    18	export const granularityLabels: Record<Granularity, GranularityLabel> = {
    19	  day: {
    20	    periodicity: "daily",
    21	    relativeUnit: "today",
    22	    labelOpenPresent: "Open today's daily note",
    23	  },
    24	  week: {
    25	    periodicity: "weekly",
    26	    relativeUnit: "this week",
    27	    labelOpenPresent: "Open this week's note",
    28	  },
    29	  month: {
    30	    periodicity: "monthly",
    31	    relativeUnit: "this month",
    32	    labelOpenPresent: "Open this month's note",
    33	  },
    34	  year: {
    35	    periodicity: "yearly",
    36	    relativeUnit: "this year",
    37	    labelOpenPresent: "Open this year's note",
    38	  },
    39	};
    40	
    41	async function jumpToAdjacentNote(
    42	  app: App,
    43	  plugin: PeriodicNotesPlugin,
    44	  direction: "forwards" | "backwards",
    45	): Promise<void> {
    46	  const activeFile = app.workspace.getActiveFile();
    47	  if (!activeFile) return;
    48	  const meta = plugin.findInCache(activeFile.path);
    49	  if (!meta) return;
    50	
    51	  const adjacent = plugin.findAdjacent(activeFile.path, direction);
    52	  if (adjacent) {
    53	    const file = app.vault.getAbstractFileByPath(adjacent.filePath);
    54	    if (file && file instanceof TFile) {
    55	      const leaf = app.workspace.getLeaf();
    56	      await leaf.openFile(file, { active: true });
    57	    }
    58	  } else {
    59	    const qualifier = direction === "forwards" ? "after" : "before";
    60	    new Notice(
    61	      `There's no ${granularityLabels[meta.granularity].periodicity} note ${qualifier} this`,
    62	    );
    63	  }
    64	}
    65	
    66	async function openAdjacentNote(
    67	  app: App,
    68	  plugin: PeriodicNotesPlugin,
    69	  direction: "forwards" | "backwards",
    70	): Promise<void> {
    71	  const activeFile = app.workspace.getActiveFile();
    72	  if (!activeFile) return;
    73	  const meta = plugin.findInCache(activeFile.path);
    74	  if (!meta) return;
    75	
    76	  const offset = direction === "forwards" ? 1 : -1;
    77	  const adjacentDate = meta.date.clone().add(offset, meta.granularity);
    78	  plugin.openPeriodicNote(meta.granularity, adjacentDate);
    79	}
    80	
    81	export function getCommands(
    82	  app: App,
    83	  plugin: PeriodicNotesPlugin,
    84	  granularity: Granularity,
    85	): Command[] {
    86	  const label = granularityLabels[granularity];
    87	
    88	  return [
    89	    {
    90	      id: `open-${label.periodicity}-note`,
    91	      name: label.labelOpenPresent,
    92	      checkCallback: (checking: boolean) => {
    93	        if (!plugin.settings.granularities[granularity].enabled) return false;
    94	        if (checking) return true;
    95	        plugin.openPeriodicNote(granularity, window.moment());
    96	      },
    97	    },
    98	    {
    99	      id: `next-${label.periodicity}-note`,
   100	      name: `Jump forwards to closest ${label.periodicity} note`,
   101	      checkCallback: (checking: boolean) => {
   102	        if (!plugin.settings.granularities[granularity].enabled) return false;
   103	        const activeFile = app.workspace.getActiveFile();
   104	        if (checking) {
   105	          if (!activeFile) return false;
   106	          return plugin.isPeriodic(activeFile.path, granularity);
   107	        }
   108	        jumpToAdjacentNote(app, plugin, "forwards");
   109	      },
   110	    },
   111	    {
   112	      id: `prev-${label.periodicity}-note`,
   113	      name: `Jump backwards to closest ${label.periodicity} note`,
   114	      checkCallback: (checking: boolean) => {
   115	        if (!plugin.settings.granularities[granularity].enabled) return false;
   116	        const activeFile = app.workspace.getActiveFile();
   117	        if (checking) {
   118	          if (!activeFile) return false;
   119	          return plugin.isPeriodic(activeFile.path, granularity);
   120	        }
   121	        jumpToAdjacentNote(app, plugin, "backwards");
   122	      },
   123	    },
   124	    {
   125	      id: `open-next-${label.periodicity}-note`,
   126	      name: `Open next ${label.periodicity} note`,
   127	      checkCallback: (checking: boolean) => {
   128	        if (!plugin.settings.granularities[granularity].enabled) return false;
   129	        const activeFile = app.workspace.getActiveFile();
   130	        if (checking) {
   131	          if (!activeFile) return false;
   132	          return plugin.isPeriodic(activeFile.path, granularity);
   133	        }
   134	        openAdjacentNote(app, plugin, "forwards");
   135	      },
   136	    },
   137	    {
   138	      id: `open-prev-${label.periodicity}-note`,
   139	      name: `Open previous ${label.periodicity} note`,
   140	      checkCallback: (checking: boolean) => {
   141	        if (!plugin.settings.granularities[granularity].enabled) return false;
   142	        const activeFile = app.workspace.getActiveFile();
   143	        if (checking) {
   144	          if (!activeFile) return false;
   145	          return plugin.isPeriodic(activeFile.path, granularity);
   146	        }
   147	        openAdjacentNote(app, plugin, "backwards");
   148	      },
   149	    },
   150	  ];
   151	}
   152	
   153	export function showContextMenu(
   154	  plugin: PeriodicNotesPlugin,
   155	  position: Point,
   156	): void {
   157	  const menu = new Menu();
   158	  const enabled = granularities.filter(
   159	    (g) => plugin.settings.granularities[g].enabled,
   160	  );
   161	
   162	  for (const granularity of enabled) {
   163	    const label = granularityLabels[granularity];
   164	    menu.addItem((item) =>
   165	      item
   166	        .setTitle(label.labelOpenPresent)
   167	        .setIcon(`calendar-${granularity}`)
   168	        .onClick(() => plugin.openPeriodicNote(granularity, window.moment())),
   169	    );
   170	  }
   171	
   172	  menu.showAtPosition(position);
   173	}
```

### Command architecture

`getCommands()` returns an array of 5 `Command` objects per granularity. Each uses `checkCallback` — Obsidian's pattern for conditionally-available commands. When `checking` is true, the callback returns a boolean for availability; when false, it executes the action.

Two navigation modes:
- **Jump** (`jumpToAdjacentNote`): Navigate to the nearest *existing* note via `findAdjacent()`.
- **Open** (`openAdjacentNote`): Add ±1 to the current date and open/create that note. Always lands on a note, even if it doesn't exist yet.

`showContextMenu()` builds a right-click menu for the ribbon icon showing all enabled granularities.

## Plugin Entry Point (`src/main.ts`)

The `PeriodicNotesPlugin` class ties everything together: loads settings, creates the cache, registers commands, and provides the public API that other modules call.

```bash
cat -n src/main.ts
```

```output
     1	import type { Moment } from "moment";
     2	import { addIcon, Plugin, type TFile } from "obsidian";
     3	
     4	import { NoteCache } from "./cache";
     5	import { CalendarView } from "./calendar/view";
     6	import { getCommands, granularityLabels, showContextMenu } from "./commands";
     7	import { DEFAULT_SETTINGS, VIEW_TYPE_CALENDAR } from "./constants";
     8	import { getConfig, getFormat } from "./format";
     9	import {
    10	  calendarDayIcon,
    11	  calendarMonthIcon,
    12	  calendarWeekIcon,
    13	  calendarYearIcon,
    14	} from "./icons";
    15	import { isMetaPressed } from "./platform";
    16	import { SettingsTab } from "./settings";
    17	import { applyTemplate, getNoteCreationPath, readTemplate } from "./template";
    18	import {
    19	  type CacheEntry,
    20	  type Granularity,
    21	  granularities,
    22	  type Settings,
    23	} from "./types";
    24	
    25	const langToMomentLocale: Record<string, string> = {
    26	  en: "en-gb",
    27	  zh: "zh-cn",
    28	  "zh-TW": "zh-tw",
    29	  ru: "ru",
    30	  ko: "ko",
    31	  it: "it",
    32	  id: "id",
    33	  ro: "ro",
    34	  "pt-BR": "pt-br",
    35	  cz: "cs",
    36	  da: "da",
    37	  de: "de",
    38	  es: "es",
    39	  fr: "fr",
    40	  no: "nn",
    41	  pl: "pl",
    42	  pt: "pt",
    43	  tr: "tr",
    44	  hi: "hi",
    45	  nl: "nl",
    46	  ar: "ar",
    47	  ja: "ja",
    48	};
    49	
    50	function configureLocale(): void {
    51	  const obsidianLang = localStorage.getItem("language") || "en";
    52	  const systemLang = navigator.language?.toLowerCase();
    53	  let momentLocale = langToMomentLocale[obsidianLang] ?? obsidianLang;
    54	  if (systemLang?.startsWith(obsidianLang)) {
    55	    momentLocale = systemLang;
    56	  }
    57	  const actual = window.moment.locale(momentLocale);
    58	  console.debug(
    59	    `[Periodic Notes] Configured locale: requested ${momentLocale}, got ${actual}`,
    60	  );
    61	}
    62	
    63	interface OpenOpts {
    64	  inNewSplit?: boolean;
    65	}
    66	
    67	export default class PeriodicNotesPlugin extends Plugin {
    68	  public settings!: Settings;
    69	  private ribbonEl!: HTMLElement | null;
    70	  private cache!: NoteCache;
    71	
    72	  async onload(): Promise<void> {
    73	    addIcon("calendar-day", calendarDayIcon);
    74	    addIcon("calendar-week", calendarWeekIcon);
    75	    addIcon("calendar-month", calendarMonthIcon);
    76	    addIcon("calendar-year", calendarYearIcon);
    77	
    78	    await this.loadSettings();
    79	    configureLocale();
    80	
    81	    this.ribbonEl = null;
    82	    this.cache = new NoteCache(this.app, this);
    83	
    84	    this.openPeriodicNote = this.openPeriodicNote.bind(this);
    85	    this.addSettingTab(new SettingsTab(this.app, this));
    86	
    87	    this.configureRibbonIcons();
    88	    this.configureCommands();
    89	
    90	    this.registerView(
    91	      VIEW_TYPE_CALENDAR,
    92	      (leaf) => new CalendarView(leaf, this),
    93	    );
    94	
    95	    this.addCommand({
    96	      id: "show-calendar",
    97	      name: "Show calendar",
    98	      checkCallback: (checking: boolean) => {
    99	        if (checking) {
   100	          return (
   101	            this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR).length === 0
   102	          );
   103	        }
   104	        this.app.workspace.getRightLeaf(false)?.setViewState({
   105	          type: VIEW_TYPE_CALENDAR,
   106	        });
   107	      },
   108	    });
   109	  }
   110	
   111	  private configureRibbonIcons(): void {
   112	    this.ribbonEl?.detach();
   113	
   114	    const granularity = granularities.find(
   115	      (g) => this.settings.granularities[g].enabled,
   116	    );
   117	    if (granularity) {
   118	      const label = granularityLabels[granularity];
   119	      this.ribbonEl = this.addRibbonIcon(
   120	        `calendar-${granularity}`,
   121	        label.labelOpenPresent,
   122	        (e: MouseEvent) => {
   123	          if (e.type !== "auxclick") {
   124	            this.openPeriodicNote(granularity, window.moment(), {
   125	              inNewSplit: isMetaPressed(e),
   126	            });
   127	          }
   128	        },
   129	      );
   130	      this.ribbonEl.addEventListener("contextmenu", (e: MouseEvent) => {
   131	        e.preventDefault();
   132	        showContextMenu(this, { x: e.pageX, y: e.pageY });
   133	      });
   134	    }
   135	  }
   136	
   137	  private configureCommands(): void {
   138	    for (const granularity of granularities) {
   139	      getCommands(this.app, this, granularity).forEach(
   140	        this.addCommand.bind(this),
   141	      );
   142	    }
   143	  }
   144	
   145	  async loadSettings(): Promise<void> {
   146	    const saved = await this.loadData();
   147	    const settings = structuredClone(DEFAULT_SETTINGS);
   148	    if (saved?.granularities) {
   149	      for (const g of granularities) {
   150	        if (saved.granularities[g]) {
   151	          settings.granularities[g] = {
   152	            ...settings.granularities[g],
   153	            ...saved.granularities[g],
   154	          };
   155	        }
   156	      }
   157	    }
   158	    this.settings = settings;
   159	  }
   160	
   161	  public async saveSettings(): Promise<void> {
   162	    await this.saveData(this.settings);
   163	    this.configureRibbonIcons();
   164	    this.app.workspace.trigger("periodic-notes:settings-updated");
   165	  }
   166	
   167	  public async createPeriodicNote(
   168	    granularity: Granularity,
   169	    date: Moment,
   170	  ): Promise<TFile> {
   171	    const config = getConfig(this.settings, granularity);
   172	    const format = getFormat(this.settings, granularity);
   173	    const filename = date.format(format);
   174	    const templateContents = await readTemplate(
   175	      this.app,
   176	      config.templatePath,
   177	      granularity,
   178	    );
   179	    const rendered = applyTemplate(
   180	      filename,
   181	      granularity,
   182	      date,
   183	      format,
   184	      templateContents,
   185	    );
   186	    const destPath = await getNoteCreationPath(this.app, filename, config);
   187	    return this.app.vault.create(destPath, rendered);
   188	  }
   189	
   190	  public getPeriodicNote(granularity: Granularity, date: Moment): TFile | null {
   191	    return this.cache.getPeriodicNote(granularity, date);
   192	  }
   193	
   194	  public getPeriodicNotes(
   195	    granularity: Granularity,
   196	    date: Moment,
   197	    includeFinerGranularities = false,
   198	  ): CacheEntry[] {
   199	    return this.cache.getPeriodicNotes(
   200	      granularity,
   201	      date,
   202	      includeFinerGranularities,
   203	    );
   204	  }
   205	
   206	  public isPeriodic(filePath: string, granularity?: Granularity): boolean {
   207	    return this.cache.isPeriodic(filePath, granularity);
   208	  }
   209	
   210	  public findAdjacent(
   211	    filePath: string,
   212	    direction: "forwards" | "backwards",
   213	  ): CacheEntry | null {
   214	    return this.cache.findAdjacent(filePath, direction);
   215	  }
   216	
   217	  public findInCache(filePath: string): CacheEntry | null {
   218	    return this.cache.find(filePath);
   219	  }
   220	
   221	  public async openPeriodicNote(
   222	    granularity: Granularity,
   223	    date: Moment,
   224	    opts?: OpenOpts,
   225	  ): Promise<void> {
   226	    const { inNewSplit = false } = opts ?? {};
   227	    const { workspace } = this.app;
   228	    let file = this.cache.getPeriodicNote(granularity, date);
   229	    if (!file) {
   230	      file = await this.createPeriodicNote(granularity, date);
   231	    }
   232	    const leaf = inNewSplit ? workspace.getLeaf("split") : workspace.getLeaf();
   233	    await leaf.openFile(file, { active: true });
   234	  }
   235	}
```

### Plugin lifecycle

1. **`onload()`** (line 72): Registers SVG icons, loads settings, configures locale, creates the `NoteCache`, adds the settings tab, ribbon icon, commands, and the calendar sidebar view.
2. **`loadSettings()`** (line 145): Loads saved data and merges per-granularity configs over defaults using `structuredClone` + spread. If saved data has no `granularities` key (pre-v2), defaults are used — no explicit migration needed.
3. **`saveSettings()`** (line 161): Persists, reconfigures the ribbon icon, and fires `periodic-notes:settings-updated` which triggers a full cache reset.
4. **`openPeriodicNote()`** (line 221): Lookup-or-create: check cache first, create via template if missing, then open in a leaf.
5. **`createPeriodicNote()`** (line 167): Reads template, applies tokens, ensures folder exists, creates file. Note: this also triggers `vault.on("create")` which the cache picks up — double template application is prevented because `createPeriodicNote` writes rendered content (non-empty), so the cache's zero-byte check (cache.ts line 195) won't fire.

### Locale configuration (line 50)

Maps Obsidian's language setting to a moment.js locale, with a fallback to the system locale if it's a more specific variant (e.g., `en` → `en-us` from `navigator.language`).

## Settings Tab (`src/settings.ts`)

Builds the settings UI using Obsidian's native `Setting` API.

```bash
cat -n src/settings.ts
```

```output
     1	import {
     2	  type App,
     3	  debounce,
     4	  normalizePath,
     5	  PluginSettingTab,
     6	  Setting,
     7	} from "obsidian";
     8	import { DEFAULT_FORMAT } from "./constants";
     9	import { FileSuggest, FolderSuggest } from "./fileSuggest";
    10	import { validateFormat } from "./format";
    11	import type PeriodicNotesPlugin from "./main";
    12	import { type Granularity, granularities } from "./types";
    13	
    14	function validateTemplate(app: App, template: string): string {
    15	  if (!template) return "";
    16	  const file = app.metadataCache.getFirstLinkpathDest(template, "");
    17	  return file ? "" : "Template file not found";
    18	}
    19	
    20	function validateFolder(app: App, folder: string): string {
    21	  if (!folder || folder === "/") return "";
    22	  return app.vault.getAbstractFileByPath(normalizePath(folder))
    23	    ? ""
    24	    : "Folder not found in vault";
    25	}
    26	
    27	const labels: Record<Granularity, string> = {
    28	  day: "Daily Notes",
    29	  week: "Weekly Notes",
    30	  month: "Monthly Notes",
    31	  year: "Yearly Notes",
    32	};
    33	
    34	export class SettingsTab extends PluginSettingTab {
    35	  private debouncedSave = debounce(() => this.plugin.saveSettings(), 500, true);
    36	
    37	  constructor(
    38	    readonly app: App,
    39	    readonly plugin: PeriodicNotesPlugin,
    40	  ) {
    41	    super(app, plugin);
    42	  }
    43	
    44	  display(): void {
    45	    const { containerEl } = this;
    46	    containerEl.empty();
    47	
    48	    for (const granularity of granularities) {
    49	      this.addGranularitySection(containerEl, granularity);
    50	    }
    51	  }
    52	
    53	  private addGranularitySection(
    54	    containerEl: HTMLElement,
    55	    granularity: Granularity,
    56	  ): void {
    57	    const config = this.plugin.settings.granularities[granularity];
    58	
    59	    containerEl.createEl("h3", { text: labels[granularity] });
    60	
    61	    new Setting(containerEl).setName("Enabled").addToggle((toggle) =>
    62	      toggle.setValue(config.enabled).onChange(async (value) => {
    63	        this.plugin.settings.granularities[granularity].enabled = value;
    64	        await this.plugin.saveSettings();
    65	      }),
    66	    );
    67	
    68	    const formatSetting = new Setting(containerEl)
    69	      .setName("Format")
    70	      .setDesc("Moment.js date format string")
    71	      .addText((text) => {
    72	        text
    73	          .setPlaceholder(DEFAULT_FORMAT[granularity])
    74	          .setValue(config.format)
    75	          .onChange(async (value) => {
    76	            const error = validateFormat(value, granularity);
    77	            formatSetting.descEl.setText(
    78	              error || "Moment.js date format string",
    79	            );
    80	            formatSetting.descEl.toggleClass("has-error", !!error);
    81	            this.plugin.settings.granularities[granularity].format = value;
    82	            this.debouncedSave();
    83	          });
    84	      });
    85	
    86	    const folderSetting = new Setting(containerEl)
    87	      .setName("Folder")
    88	      .addText((text) => {
    89	        text.setValue(config.folder).onChange(async (value) => {
    90	          const warning = validateFolder(this.app, value);
    91	          folderSetting.descEl.setText(warning || "");
    92	          folderSetting.descEl.toggleClass("has-error", !!warning);
    93	          this.plugin.settings.granularities[granularity].folder = value;
    94	          this.debouncedSave();
    95	        });
    96	        new FolderSuggest(this.app, text.inputEl);
    97	      });
    98	
    99	    const templateSetting = new Setting(containerEl)
   100	      .setName("Template")
   101	      .addText((text) => {
   102	        text.setValue(config.templatePath ?? "").onChange(async (value) => {
   103	          const error = validateTemplate(this.app, value);
   104	          templateSetting.descEl.setText(error || "");
   105	          templateSetting.descEl.toggleClass("has-error", !!error);
   106	          this.plugin.settings.granularities[granularity].templatePath =
   107	            value || undefined;
   108	          this.debouncedSave();
   109	        });
   110	        new FileSuggest(this.app, text.inputEl);
   111	      });
   112	  }
   113	}
```

The settings tab renders four identical sections (one per granularity), each with an enable toggle, format input with real-time validation, folder input with autocomplete, and template path input with autocomplete. The `debouncedSave` (line 35) uses Obsidian's built-in `debounce` to batch rapid text input changes into a single save-and-reset cycle.

## Supporting Modules

### Platform detection (`src/platform.ts`)

```bash
cat -n src/platform.ts
```

```output
     1	import { Platform } from "obsidian";
     2	
     3	export function isMetaPressed(e: MouseEvent | KeyboardEvent): boolean {
     4	  return Platform.isMacOS ? e.metaKey : e.ctrlKey;
     5	}
```

Single function. Abstracts the macOS Cmd / Windows Ctrl divergence.

### Icons (`src/icons.ts`)

```bash
cat -n src/icons.ts
```

```output
     1	export const calendarDayIcon = `
     2	<g>
     3	<path d="M24.78 3C22.646 3 20.9 4.746 20.9 6.88V10.76H9.26C7.223 10.76 5.38 12.312 5.38 14.543V92.628C5.38 93.695 6.059 94.859 6.835 95.344C7.611 95.926 8.387 96.12 9.26 96.12H90.74C91.613 96.12 92.389 95.926 93.165 95.344C93.941 94.762 94.62 93.695 94.62 92.628V14.543C94.62 12.506 92.971 10.76 90.934 10.76H79.1V6.88C79.1 4.746 77.354 3 75.22 3H71.34C69.206 3 67.46 4.746 67.46 6.88V10.76H32.54V6.88C32.54 4.746 30.794 3 28.66 3H24.78ZM24.78 6.88H28.66V18.52H24.78V6.88ZM71.34 6.88H75.22V18.52H71.34V6.88ZM9.26 14.64H20.9V18.52C20.9 20.654 22.646 22.4 24.78 22.4H28.66C30.794 22.4 32.54 20.654 32.54 18.52V14.64H67.46V18.52C67.46 20.654 69.206 22.4 71.34 22.4H75.22C77.354 22.4 79.1 20.654 79.1 18.52V14.64H90.74V28.22H9.26V14.64ZM9.26 32.1H90.74V92.24H9.26V32.1Z" fill="currentColor" stroke-width="1" stroke="currentColor"/>
     4	<path d="M55.2539 79.0024H49.3613V55.3319C49.3613 52.5068 49.4282 50.2668 49.5619 48.6119C49.1775 49.0131 48.701 49.4561 48.1327 49.9408C47.581 50.4256 45.7088 51.9635 42.516 54.5546L39.5571 50.8185L50.3393 42.3432H55.2539V79.0024Z" fill="currentColor"/>
     5	</g>
     6	`;
     7	
     8	export const calendarWeekIcon = `
     9	<g>
    10	<path d="M24.78 3C22.646 3 20.9 4.746 20.9 6.88V10.76H9.26C7.223 10.76 5.38 12.312 5.38 14.543V92.628C5.38 93.695 6.059 94.859 6.835 95.344C7.611 95.926 8.387 96.12 9.26 96.12H90.74C91.613 96.12 92.389 95.926 93.165 95.344C93.941 94.762 94.62 93.695 94.62 92.628V14.543C94.62 12.506 92.971 10.76 90.934 10.76H79.1V6.88C79.1 4.746 77.354 3 75.22 3H71.34C69.206 3 67.46 4.746 67.46 6.88V10.76H32.54V6.88C32.54 4.746 30.794 3 28.66 3H24.78ZM24.78 6.88H28.66V18.52H24.78V6.88ZM71.34 6.88H75.22V18.52H71.34V6.88ZM9.26 14.64H20.9V18.52C20.9 20.654 22.646 22.4 24.78 22.4H28.66C30.794 22.4 32.54 20.654 32.54 18.52V14.64H67.46V18.52C67.46 20.654 69.206 22.4 71.34 22.4H75.22C77.354 22.4 79.1 20.654 79.1 18.52V14.64H90.74V28.22H9.26V14.64ZM9.26 32.1H90.74V92.24H9.26V32.1Z" fill="currentColor" stroke-width="1" stroke="currentColor"/>
    11	<path d="M42.8799 78.3604L56.5679 48.6873H38.5698V43.7852H62.512V47.669L48.895 78.3604H42.8799Z" fill="currentColor"/>
    12	</g>
    13	`;
    14	
    15	export const calendarMonthIcon = `
    16	<g>
    17	<path d="M24.78 3C22.646 3 20.9 4.746 20.9 6.88V10.76H9.26C7.223 10.76 5.38 12.312 5.38 14.543V92.628C5.38 93.695 6.059 94.859 6.835 95.344C7.611 95.926 8.387 96.12 9.26 96.12H90.74C91.613 96.12 92.389 95.926 93.165 95.344C93.941 94.762 94.62 93.695 94.62 92.628V14.543C94.62 12.506 92.971 10.76 90.934 10.76H79.1V6.88C79.1 4.746 77.354 3 75.22 3H71.34C69.206 3 67.46 4.746 67.46 6.88V10.76H32.54V6.88C32.54 4.746 30.794 3 28.66 3H24.78ZM24.78 6.88H28.66V18.52H24.78V6.88ZM71.34 6.88H75.22V18.52H71.34V6.88ZM9.26 14.64H20.9V18.52C20.9 20.654 22.646 22.4 24.78 22.4H28.66C30.794 22.4 32.54 20.654 32.54 18.52V14.64H67.46V18.52C67.46 20.654 69.206 22.4 71.34 22.4H75.22C77.354 22.4 79.1 20.654 79.1 18.52V14.64H90.74V28.22H9.26V14.64ZM9.26 32.1H90.74V92.24H9.26V32.1Z" fill="currentColor" stroke-width="1" stroke="currentColor"/>
    18	<path d="M51.3075 52.8546C51.3075 54.9201 50.7057 56.6437 49.5022 58.0256C48.2986 59.3926 46.6046 60.3139 44.4204 60.7894V60.9677C47.0356 61.2946 48.9969 62.1118 50.3045 63.4194C51.6121 64.7122 52.2659 66.4358 52.2659 68.5904C52.2659 71.7257 51.1589 74.1477 48.9449 75.8565C46.7309 77.5504 43.5808 78.3974 39.4946 78.3974C35.8838 78.3974 32.8377 77.8105 30.3562 76.6366V71.9783C31.7381 72.6618 33.2018 73.1893 34.7471 73.5608C36.2924 73.9322 37.7784 74.118 39.2048 74.118C41.7309 74.118 43.618 73.6499 44.8661 72.7138C46.1143 71.7777 46.7384 70.3289 46.7384 68.3675C46.7384 66.629 46.0474 65.3511 44.6655 64.5339C43.2836 63.7166 41.1142 63.308 38.1573 63.308H35.3266V59.0509H38.2018C43.4025 59.0509 46.0028 57.2529 46.0028 53.657C46.0028 52.2603 45.5496 51.183 44.6432 50.4252C43.7368 49.6674 42.3995 49.2885 40.6313 49.2885C39.398 49.2885 38.2093 49.4668 37.0651 49.8234C35.921 50.1652 34.5688 50.8412 33.0086 51.8517L30.4454 48.1963C33.4321 45.9972 36.9017 44.8976 40.8542 44.8976C44.138 44.8976 46.7012 45.6034 48.5437 47.015C50.3863 48.4266 51.3075 50.3732 51.3075 52.8546Z" fill="currentColor"/>
    19	<path d="M69.6199 77.9516H64.382V56.9112C64.382 54.4 64.4415 52.4089 64.5603 50.9378C64.2186 51.2944 63.7951 51.6882 63.2899 52.1191C62.7995 52.55 61.1353 53.9171 58.2972 56.2202L55.6672 52.8992L65.2513 45.3657H69.6199V77.9516Z" fill="currentColor"/>
    20	</g>
    21	`;
    22	
    23	export const calendarYearIcon = `
    24	<g>
    25	<path d="M24.768 3C22.634 3 20.888 4.746 20.888 6.88V10.76H9.24804C7.21104 10.76 5.36804 12.312 5.36804 14.543V92.628C5.36804 93.695 6.04704 94.859 6.82304 95.344C7.59904 95.926 8.37504 96.12 9.24804 96.12H90.728C91.601 96.12 92.377 95.926 93.153 95.344C93.929 94.762 94.608 93.695 94.608 92.628V14.543C94.608 12.506 92.959 10.76 90.922 10.76H79.088V6.88C79.088 4.746 77.342 3 75.208 3H71.328C69.194 3 67.448 4.746 67.448 6.88V10.76H32.528V6.88C32.528 4.746 30.782 3 28.648 3H24.768ZM24.768 6.88H28.648V18.52H24.768V6.88ZM71.328 6.88H75.208V18.52H71.328V6.88ZM9.24804 14.64H20.888V18.52C20.888 20.654 22.634 22.4 24.768 22.4H28.648C30.782 22.4 32.528 20.654 32.528 18.52V14.64H67.448V18.52C67.448 20.654 69.194 22.4 71.328 22.4H75.208C77.342 22.4 79.088 20.654 79.088 18.52V14.64H90.728V28.22H9.24804V14.64ZM9.24804 32.1H90.728V92.24H9.24804V32.1Z" fill="currentColor" stroke="currentColor" stroke-width="0.17"/>
    26	<path d="M49.2303 60.2321L56.9421 45.3656H62.7371L51.8826 65.3139V77.9515H46.5333V65.4922L35.7234 45.3656H41.5184L49.2303 60.2321Z" fill="currentColor"/>
    27	</g>
    28	`;
```

Four SVG icon strings, each sharing the same calendar base shape but with a different number or letter overlaid (1 for day, 7 for week, 31 for month, Y for year). These are inner `<g>` groups — `addIcon()` wraps them in an `<svg>` element.

### File and Folder Suggest (`src/fileSuggest.ts`)

```bash
cat -n src/fileSuggest.ts
```

```output
     1	import {
     2	  AbstractInputSuggest,
     3	  type App,
     4	  type TFile,
     5	  type TFolder,
     6	} from "obsidian";
     7	
     8	export class FileSuggest extends AbstractInputSuggest<TFile> {
     9	  private onSelectCallback?: (value: string) => void;
    10	
    11	  constructor(
    12	    app: App,
    13	    inputEl: HTMLInputElement,
    14	    onSelectCallback?: (value: string) => void,
    15	  ) {
    16	    super(app, inputEl);
    17	    this.onSelectCallback = onSelectCallback;
    18	  }
    19	
    20	  getSuggestions(query: string): TFile[] {
    21	    const lowerQuery = query.toLowerCase();
    22	    return this.app.vault
    23	      .getMarkdownFiles()
    24	      .filter((file) => file.path.toLowerCase().contains(lowerQuery));
    25	  }
    26	
    27	  renderSuggestion(file: TFile, el: HTMLElement): void {
    28	    el.setText(file.path);
    29	  }
    30	
    31	  selectSuggestion(file: TFile): void {
    32	    this.setValue(file.path);
    33	    this.onSelectCallback?.(file.path);
    34	    this.close();
    35	  }
    36	}
    37	
    38	export class FolderSuggest extends AbstractInputSuggest<TFolder> {
    39	  private onSelectCallback?: (value: string) => void;
    40	
    41	  constructor(
    42	    app: App,
    43	    inputEl: HTMLInputElement,
    44	    onSelectCallback?: (value: string) => void,
    45	  ) {
    46	    super(app, inputEl);
    47	    this.onSelectCallback = onSelectCallback;
    48	  }
    49	
    50	  getSuggestions(query: string): TFolder[] {
    51	    const lowerQuery = query.toLowerCase();
    52	    return this.app.vault
    53	      .getAllFolders()
    54	      .filter((folder) => folder.path.toLowerCase().contains(lowerQuery));
    55	  }
    56	
    57	  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    58	    el.setText(folder.path);
    59	  }
    60	
    61	  selectSuggestion(folder: TFolder): void {
    62	    this.setValue(folder.path);
    63	    this.onSelectCallback?.(folder.path);
    64	    this.close();
    65	  }
    66	}
```

Two parallel classes extending `AbstractInputSuggest` — Obsidian's built-in autocomplete widget. `FileSuggest` filters markdown files; `FolderSuggest` filters folders. Both are attached to text inputs in the settings tab for template path and folder path fields.

## Calendar View (`src/calendar/`)

The calendar is a Svelte 5 sidebar panel mounted inside an Obsidian `ItemView`. The bridge between Obsidian and Svelte is the `CalendarView` class.

### View Host (`src/calendar/view.ts`)

```bash
cat -n src/calendar/view.ts
```

```output
     1	import type { Moment } from "moment";
     2	import { ItemView, Menu, type TFile, type WorkspaceLeaf } from "obsidian";
     3	import { VIEW_TYPE_CALENDAR } from "src/constants";
     4	import type PeriodicNotesPlugin from "src/main";
     5	import type { Granularity } from "src/types";
     6	import { mount, unmount } from "svelte";
     7	import Calendar from "./Calendar.svelte";
     8	import CalendarStore from "./store";
     9	
    10	interface CalendarExports {
    11	  tick: () => void;
    12	  setActiveFilePath: (path: string | null) => void;
    13	}
    14	
    15	export class CalendarView extends ItemView {
    16	  private calendar!: CalendarExports;
    17	  private plugin: PeriodicNotesPlugin;
    18	
    19	  constructor(leaf: WorkspaceLeaf, plugin: PeriodicNotesPlugin) {
    20	    super(leaf);
    21	    this.plugin = plugin;
    22	
    23	    this.registerEvent(
    24	      this.app.workspace.on("file-open", this.onFileOpen.bind(this)),
    25	    );
    26	  }
    27	
    28	  getViewType(): string {
    29	    return VIEW_TYPE_CALENDAR;
    30	  }
    31	
    32	  getDisplayText(): string {
    33	    return "Calendar";
    34	  }
    35	
    36	  getIcon(): string {
    37	    return "calendar-day";
    38	  }
    39	
    40	  async onClose(): Promise<void> {
    41	    if (this.calendar) {
    42	      unmount(this.calendar);
    43	    }
    44	  }
    45	
    46	  async onOpen(): Promise<void> {
    47	    const fileStore = new CalendarStore(this, this.plugin);
    48	
    49	    const cal = mount(Calendar, {
    50	      target: this.contentEl,
    51	      props: {
    52	        fileStore,
    53	        onHover: this.onHover.bind(this),
    54	        onClick: this.onClick.bind(this),
    55	        onContextMenu: this.onContextMenu.bind(this),
    56	      },
    57	    });
    58	    if (!("tick" in cal && "setActiveFilePath" in cal)) {
    59	      throw new Error("Calendar component missing expected exports");
    60	    }
    61	    this.calendar = cal as CalendarExports;
    62	  }
    63	
    64	  private onHover(
    65	    granularity: Granularity,
    66	    date: Moment,
    67	    file: TFile | null,
    68	    targetEl: EventTarget,
    69	    metaPressed: boolean,
    70	  ): void {
    71	    if (!metaPressed) return;
    72	    const formattedDate = date.format(
    73	      granularity === "day"
    74	        ? "YYYY-MM-DD"
    75	        : date.localeData().longDateFormat("L"),
    76	    );
    77	    this.app.workspace.trigger(
    78	      "link-hover",
    79	      this,
    80	      targetEl,
    81	      formattedDate,
    82	      file?.path ?? "",
    83	    );
    84	  }
    85	
    86	  private onClick(
    87	    granularity: Granularity,
    88	    date: Moment,
    89	    _existingFile: TFile | null,
    90	    inNewSplit: boolean,
    91	  ): void {
    92	    this.plugin.openPeriodicNote(granularity, date, { inNewSplit });
    93	  }
    94	
    95	  private onContextMenu(
    96	    _granularity: Granularity,
    97	    _date: Moment,
    98	    file: TFile | null,
    99	    event: MouseEvent,
   100	  ): void {
   101	    if (!file) return;
   102	    const menu = new Menu();
   103	    menu.addItem((item) =>
   104	      item
   105	        .setTitle("Delete")
   106	        .setIcon("trash")
   107	        .onClick(() => {
   108	          this.app.vault.trash(file, true);
   109	        }),
   110	    );
   111	    this.app.workspace.trigger(
   112	      "file-menu",
   113	      menu,
   114	      file,
   115	      "calendar-context-menu",
   116	      null,
   117	    );
   118	    menu.showAtPosition({ x: event.pageX, y: event.pageY });
   119	  }
   120	
   121	  private onFileOpen(_file: TFile | null): void {
   122	    if (!this.app.workspace.layoutReady) return;
   123	    if (this.calendar) {
   124	      const path = this.app.workspace.getActiveFile()?.path ?? null;
   125	      this.calendar.setActiveFilePath(path);
   126	      this.calendar.tick();
   127	    }
   128	  }
   129	}
```

The view mounts Svelte's `Calendar` component into the sidebar. Communication is bidirectional:

- **Obsidian → Svelte**: `tick()` (updates "today" if date rolled over) and `setActiveFilePath()` (highlights the currently open file) are exported from the Svelte component.
- **Svelte → Obsidian**: Callback props (`onHover`, `onClick`, `onContextMenu`) are passed in as props. `onHover` triggers Obsidian's `link-hover` for page previews on Cmd/Ctrl+hover. `onContextMenu` shows a delete menu plus Obsidian's standard file-menu event so other plugins can add items.

### Calendar Store (`src/calendar/store.ts`)

```bash
cat -n src/calendar/store.ts
```

```output
     1	import type { Moment } from "moment";
     2	import type { Component, TAbstractFile, TFile } from "obsidian";
     3	import { DEFAULT_FORMAT } from "src/constants";
     4	import type PeriodicNotesPlugin from "src/main";
     5	import type { Granularity } from "src/types";
     6	import { type Writable, writable } from "svelte/store";
     7	
     8	import type { FileMap, Month } from "./types";
     9	
    10	export default class CalendarStore {
    11	  // Svelte 5 runes don't track store auto-subscriptions.
    12	  // Bumping a counter triggers subscribers to re-read plugin state.
    13	  public store: Writable<number>;
    14	  private plugin: PeriodicNotesPlugin;
    15	
    16	  constructor(component: Component, plugin: PeriodicNotesPlugin) {
    17	    this.plugin = plugin;
    18	    this.store = writable(0);
    19	
    20	    plugin.app.workspace.onLayoutReady(() => {
    21	      const { vault, metadataCache, workspace } = plugin.app;
    22	      component.registerEvent(vault.on("create", this.bump, this));
    23	      component.registerEvent(vault.on("delete", this.bump, this));
    24	      component.registerEvent(vault.on("rename", this.onRename, this));
    25	      component.registerEvent(metadataCache.on("changed", this.bump, this));
    26	      component.registerEvent(
    27	        workspace.on("periodic-notes:resolve", this.bumpUnconditionally, this),
    28	      );
    29	      component.registerEvent(
    30	        workspace.on(
    31	          "periodic-notes:settings-updated",
    32	          this.bumpUnconditionally,
    33	          this,
    34	        ),
    35	      );
    36	      this.bump();
    37	    });
    38	  }
    39	
    40	  private bump(file?: TAbstractFile): void {
    41	    if (file && !this.plugin.isPeriodic(file.path)) return;
    42	    this.store.update((n) => n + 1);
    43	  }
    44	
    45	  private bumpUnconditionally(): void {
    46	    this.store.update((n) => n + 1);
    47	  }
    48	
    49	  private onRename(file: TAbstractFile, oldPath: string): void {
    50	    if (this.plugin.isPeriodic(file.path) || this.plugin.isPeriodic(oldPath)) {
    51	      this.store.update((n) => n + 1);
    52	    }
    53	  }
    54	
    55	  public getFile(date: Moment, granularity: Granularity): TFile | null {
    56	    return this.plugin.getPeriodicNote(granularity, date);
    57	  }
    58	
    59	  public isGranularityEnabled(granularity: Granularity): boolean {
    60	    return (
    61	      this.plugin.settings.granularities[granularity]?.enabled ??
    62	      granularity === "day"
    63	    );
    64	  }
    65	
    66	  public getEnabledGranularities(): Granularity[] {
    67	    return (["week", "month", "year"] as Granularity[]).filter(
    68	      (g) => this.plugin.settings.granularities[g]?.enabled,
    69	    );
    70	  }
    71	}
    72	
    73	export function fileMapKey(granularity: Granularity, date: Moment): string {
    74	  return `${granularity}:${date.format(DEFAULT_FORMAT[granularity])}`;
    75	}
    76	
    77	export function computeFileMap(
    78	  month: Month,
    79	  getFile: (date: Moment, granularity: Granularity) => TFile | null,
    80	  enabledGranularities: Granularity[],
    81	): FileMap {
    82	  const map: FileMap = new Map();
    83	  const displayedMonth = month[1].days[0];
    84	
    85	  for (const week of month) {
    86	    for (const day of week.days) {
    87	      map.set(fileMapKey("day", day), getFile(day, "day"));
    88	    }
    89	    if (enabledGranularities.includes("week")) {
    90	      const weekStart = week.days[0];
    91	      map.set(fileMapKey("week", weekStart), getFile(weekStart, "week"));
    92	    }
    93	  }
    94	
    95	  if (enabledGranularities.includes("month")) {
    96	    map.set(
    97	      fileMapKey("month", displayedMonth),
    98	      getFile(displayedMonth, "month"),
    99	    );
   100	  }
   101	  if (enabledGranularities.includes("year")) {
   102	    map.set(
   103	      fileMapKey("year", displayedMonth),
   104	      getFile(displayedMonth, "year"),
   105	    );
   106	  }
   107	
   108	  return map;
   109	}
```

### Store design pattern

The store uses a **counter-bump** pattern rather than storing actual file data. Svelte 5's `$derived.by()` does not track Svelte store auto-subscriptions, so the Calendar component subscribes to this Writable counter via `$state` + `$effect` + `.subscribe()`. When the counter bumps, derived state recomputes by querying the plugin cache directly.

`computeFileMap()` (line 77) pre-computes a `Map<string, TFile | null>` for every visible day, week, month, and year in the displayed month. This allows child components to do `$derived` lookups via `fileMapKey()` — a single Map.get() per cell instead of individual cache queries.

### Calendar Types (`src/calendar/types.ts`)

```bash
cat -n src/calendar/types.ts
```

```output
     1	import type { Moment } from "moment";
     2	import type { TFile } from "obsidian";
     3	import type { Granularity } from "src/types";
     4	
     5	export interface Week {
     6	  days: Moment[];
     7	  weekNum: number;
     8	}
     9	
    10	export type Month = Week[];
    11	
    12	export interface EventHandlers {
    13	  onHover: (
    14	    granularity: Granularity,
    15	    date: Moment,
    16	    file: TFile | null,
    17	    targetEl: EventTarget,
    18	    isMetaPressed: boolean,
    19	  ) => void;
    20	  onClick: (
    21	    granularity: Granularity,
    22	    date: Moment,
    23	    existingFile: TFile | null,
    24	    inNewSplit: boolean,
    25	  ) => void;
    26	  onContextMenu: (
    27	    granularity: Granularity,
    28	    date: Moment,
    29	    file: TFile | null,
    30	    event: MouseEvent,
    31	  ) => void;
    32	}
    33	
    34	export type FileMap = Map<string, TFile | null>;
```

`Month` is an array of `Week` objects (always 6 weeks for consistent table height). `EventHandlers` define the callback interface between Svelte components and the view host. `FileMap` is the pre-computed lookup map.

### Calendar Utilities (`src/calendar/utils.ts`)

```bash
cat -n src/calendar/utils.ts
```

```output
     1	import type { Moment } from "moment";
     2	import type { Month, Week } from "./types";
     3	
     4	export function getWeekdayLabels(): string[] {
     5	  return window.moment.weekdaysShort(true);
     6	}
     7	
     8	export function isWeekend(date: Moment): boolean {
     9	  return date.isoWeekday() === 6 || date.isoWeekday() === 7;
    10	}
    11	
    12	export function getStartOfWeek(days: Moment[]): Moment {
    13	  return days[0].clone();
    14	}
    15	
    16	export function getMonth(displayedMonth: Moment): Month {
    17	  const month: Month = [];
    18	  let week!: Week;
    19	
    20	  const startOfMonth = displayedMonth.clone().date(1);
    21	  const startOffset = startOfMonth.weekday();
    22	  let date: Moment = startOfMonth.clone().subtract(startOffset, "days");
    23	
    24	  for (let _day = 0; _day < 42; _day++) {
    25	    if (_day % 7 === 0) {
    26	      week = {
    27	        days: [],
    28	        weekNum: date.week(),
    29	      };
    30	      month.push(week);
    31	    }
    32	
    33	    week.days.push(date);
    34	    date = date.clone().add(1, "days");
    35	  }
    36	
    37	  return month;
    38	}
```

`getMonth()` generates exactly 42 days (6 × 7) starting from the weekday offset before the 1st of the month. Each day is a cloned Moment — mutation-safe. Weekend detection uses ISO weekday (6 = Saturday, 7 = Sunday).

### Root Component (`src/calendar/Calendar.svelte`)

```bash
cat -n src/calendar/Calendar.svelte
```

```output
     1	<script lang="ts">
     2	  import type { Moment } from "moment";
     3	  import { setContext } from "svelte";
     4	  import { writable } from "svelte/store";
     5	
     6	  import { DISPLAYED_MONTH } from "src/constants";
     7	  import Day from "./Day.svelte";
     8	  import type CalendarStore from "./store";
     9	  import { computeFileMap, fileMapKey } from "./store";
    10	  import Nav from "./Nav.svelte";
    11	  import type { FileMap, EventHandlers, Month } from "./types";
    12	  import { getMonth, getWeekdayLabels, isWeekend } from "./utils";
    13	  import Week from "./Week.svelte";
    14	
    15	  let {
    16	    fileStore,
    17	    onHover,
    18	    onClick,
    19	    onContextMenu,
    20	  }: {
    21	    fileStore: CalendarStore;
    22	    onHover: EventHandlers["onHover"];
    23	    onClick: EventHandlers["onClick"];
    24	    onContextMenu: EventHandlers["onContextMenu"];
    25	  } = $props();
    26	
    27	  let activeFilePath: string | null = $state(null);
    28	
    29	  let today: Moment = $state.raw(window.moment());
    30	
    31	  const displayedMonthStore = writable<Moment>(window.moment());
    32	  setContext(DISPLAYED_MONTH, displayedMonthStore);
    33	
    34	  let month: Month = $state.raw(getMonth(window.moment()));
    35	  let showWeeks: boolean = $state(false);
    36	  let fileMap: FileMap = $state.raw(new Map());
    37	
    38	  $effect(() => {
    39	    month = getMonth($displayedMonthStore);
    40	  });
    41	
    42	  // $derived.by() doesn't track Svelte store subscriptions,
    43	  // so we manually subscribe inside $effect and return the unsubscribe.
    44	  $effect(() => {
    45	    const currentMonth = month;
    46	    return fileStore.store.subscribe(() => {
    47	      showWeeks = fileStore.isGranularityEnabled("week");
    48	      fileMap = computeFileMap(
    49	        currentMonth,
    50	        (date, granularity) => fileStore.getFile(date, granularity),
    51	        fileStore.getEnabledGranularities(),
    52	      );
    53	    });
    54	  });
    55	
    56	  let eventHandlers: EventHandlers = $derived({
    57	    onHover,
    58	    onClick,
    59	    onContextMenu,
    60	  });
    61	
    62	  const daysOfWeek: string[] = getWeekdayLabels();
    63	
    64	  export function tick() {
    65	    const now = window.moment();
    66	    if (!now.isSame(today, "day")) {
    67	      today = now;
    68	    }
    69	  }
    70	
    71	  export function setActiveFilePath(path: string | null) {
    72	    activeFilePath = path;
    73	  }
    74	</script>
    75	
    76	<div id="calendar-container" class="container">
    77	  <Nav {fileMap} {today} {eventHandlers} />
    78	  <table class="calendar">
    79	    <colgroup>
    80	      {#if showWeeks}
    81	        <col />
    82	      {/if}
    83	      {#each month[1].days as date}
    84	        <col class:weekend={isWeekend(date)} />
    85	      {/each}
    86	    </colgroup>
    87	    <thead>
    88	      <tr>
    89	        {#if showWeeks}
    90	          <th>W</th>
    91	        {/if}
    92	        {#each daysOfWeek as dayOfWeek}
    93	          <th>{dayOfWeek}</th>
    94	        {/each}
    95	      </tr>
    96	    </thead>
    97	    <tbody>
    98	      {#each month as week (fileMapKey("week", week.days[0]))}
    99	        <tr>
   100	          {#if showWeeks}
   101	            <Week
   102	              {fileMap}
   103	              {activeFilePath}
   104	              {...week}
   105	              {...eventHandlers}
   106	            />
   107	          {/if}
   108	          {#each week.days as day (day.format())}
   109	            <Day
   110	              date={day}
   111	              {fileMap}
   112	              {today}
   113	              {activeFilePath}
   114	              {...eventHandlers}
   115	            />
   116	          {/each}
   117	        </tr>
   118	      {/each}
   119	    </tbody>
   120	  </table>
   121	</div>
   122	
   123	<style>
   124	  .container {
   125	    --color-background-heading: transparent;
   126	    --color-background-day: transparent;
   127	    --color-background-weeknum: transparent;
   128	    --color-background-weekend: transparent;
   129	
   130	    --color-arrow: var(--text-muted);
   131	    --color-button: var(--text-muted);
   132	
   133	    --color-text-title: var(--text-normal);
   134	    --color-text-heading: var(--text-muted);
   135	    --color-text-day: var(--text-normal);
   136	    --color-text-today: var(--interactive-accent);
   137	    --color-text-weeknum: var(--text-muted);
   138	  }
   139	
   140	  .container {
   141	    padding: 0 8px;
   142	  }
   143	
   144	  .weekend {
   145	    background-color: var(--color-background-weekend);
   146	  }
   147	
   148	  .calendar {
   149	    border-collapse: collapse;
   150	    width: 100%;
   151	  }
   152	
   153	  th {
   154	    background-color: var(--color-background-heading);
   155	    color: var(--color-text-heading);
   156	    font-size: 0.6em;
   157	    letter-spacing: 1px;
   158	    padding: 4px;
   159	    text-align: center;
   160	    text-transform: uppercase;
   161	  }
   162	</style>
```

Key Svelte 5 patterns:

- **`$state.raw()`** for Moment objects and Map (no deep reactivity proxy needed — these are opaque to Svelte).
- **`$effect` with `.subscribe()`** (lines 44–54): Works around the `$derived.by()` limitation with Svelte stores. Returns the unsubscribe function for automatic cleanup.
- **Context via writable store**: `displayedMonthStore` is set via `setContext(DISPLAYED_MONTH, ...)` so Nav can update the displayed month and all children react.
- **Keyed `{#each}`**: Week rows use `fileMapKey("week", week.days[0])` as the key; day cells use `day.format()`.

### Remaining Components

The child components (`Nav.svelte`, `Month.svelte`, `Day.svelte`, `Week.svelte`, `Arrow.svelte`) follow a consistent pattern: receive data via props, look up files from `fileMap` using `fileMapKey()`, and fire event handler callbacks. Here's the Day component as representative:

### Day Cell (`src/calendar/Day.svelte`)

```bash
cat -n src/calendar/Day.svelte
```

```output
     1	<script lang="ts">
     2	  import type { Moment } from "moment";
     3	  import { getContext } from "svelte";
     4	  import type { Writable } from "svelte/store";
     5	
     6	  import { isMetaPressed } from "src/platform";
     7	  import { DISPLAYED_MONTH } from "src/constants";
     8	  import { fileMapKey } from "./store";
     9	  import type { FileMap, EventHandlers } from "./types";
    10	
    11	  let {
    12	    date,
    13	    fileMap,
    14	    onHover,
    15	    onClick,
    16	    onContextMenu,
    17	    today,
    18	    activeFilePath = null,
    19	  }: {
    20	    date: Moment;
    21	    fileMap: FileMap;
    22	    onHover: EventHandlers["onHover"];
    23	    onClick: EventHandlers["onClick"];
    24	    onContextMenu: EventHandlers["onContextMenu"];
    25	    today: Moment;
    26	    activeFilePath: string | null;
    27	  } = $props();
    28	
    29	  const displayedMonth = getContext<Writable<Moment>>(DISPLAYED_MONTH);
    30	
    31	  let file = $derived(fileMap.get(fileMapKey("day", date)) ?? null);
    32	
    33	  function handleClick(event: MouseEvent) {
    34	    onClick?.("day", date, file, isMetaPressed(event));
    35	  }
    36	
    37	  function handleHover(event: PointerEvent) {
    38	    if (event.target) {
    39	      onHover?.("day", date, file, event.target, isMetaPressed(event));
    40	    }
    41	  }
    42	
    43	  function handleContextmenu(event: MouseEvent) {
    44	    onContextMenu?.("day", date, file, event);
    45	  }
    46	</script>
    47	
    48	<td>
    49	  <div
    50	    role="button"
    51	    tabindex="0"
    52	    class="day"
    53	    class:active={file !== null && file.path === activeFilePath}
    54	    class:adjacent-month={!date.isSame($displayedMonth, "month")}
    55	    class:has-note={file !== null}
    56	    class:today={date.isSame(today, "day")}
    57	    onclick={handleClick}
    58	    onkeydown={(e) => {
    59	      if (e.key === "Enter" || e.key === " ") {
    60	        e.preventDefault();
    61	        onClick?.("day", date, file, false);
    62	      }
    63	    }}
    64	    oncontextmenu={handleContextmenu}
    65	    onpointerenter={handleHover}
    66	  >
    67	    {date.format("D")}
    68	  </div>
    69	</td>
    70	
    71	<style>
    72	  .day {
    73	    background-color: var(--color-background-day);
    74	    border-radius: 4px;
    75	    color: var(--color-text-day);
    76	    cursor: pointer;
    77	    font-size: 0.8em;
    78	    height: 100%;
    79	    padding: 4px;
    80	    position: relative;
    81	    text-align: center;
    82	    transition:
    83	      background-color 0.1s ease-in,
    84	      color 0.1s ease-in;
    85	    vertical-align: baseline;
    86	  }
    87	  .day:hover {
    88	    background-color: var(--interactive-hover);
    89	  }
    90	
    91	  .day.active:hover {
    92	    background-color: var(--interactive-accent-hover);
    93	  }
    94	
    95	  .adjacent-month {
    96	    opacity: 0.25;
    97	  }
    98	
    99	  .has-note::after {
   100	    background-color: var(--text-muted);
   101	    border-radius: 50%;
   102	    content: "";
   103	    display: block;
   104	    height: 3px;
   105	    margin: 1px auto 0;
   106	    width: 3px;
   107	  }
   108	
   109	  .has-note.active::after {
   110	    background-color: var(--text-on-accent);
   111	  }
   112	
   113	  .today {
   114	    color: var(--interactive-accent);
   115	    font-weight: 600;
   116	  }
   117	
   118	  .day:active,
   119	  .active,
   120	  .active.today {
   121	    color: var(--text-on-accent);
   122	    background-color: var(--interactive-accent);
   123	  }
   124	</style>
```

Each Day cell is a `<div role="button">` with four CSS states: `active` (file is open), `adjacent-month` (faded, belongs to previous/next month), `has-note` (a small dot indicator via `::after`), and `today` (accent color, bold). The file lookup is `$derived` from the fileMap — a single Map.get() per render cycle.

Keyboard accessibility is provided via `onkeydown` for Enter/Space.

## Build Configuration (`vite.config.ts`)

```bash
cat -n vite.config.ts
```

```output
     1	import { copyFileSync } from "node:fs";
     2	import path from "node:path";
     3	import { svelte } from "@sveltejs/vite-plugin-svelte";
     4	import { defineConfig } from "vite";
     5	
     6	export default defineConfig({
     7	  plugins: [
     8	    svelte({ emitCss: false }),
     9	    {
    10	      name: "copy-styles",
    11	      writeBundle() {
    12	        copyFileSync("src/styles.css", "styles.css");
    13	      },
    14	    },
    15	  ],
    16	  resolve: {
    17	    alias: { src: path.resolve(__dirname, "src") },
    18	  },
    19	  build: {
    20	    lib: {
    21	      entry: "src/main.ts",
    22	      formats: ["cjs"],
    23	      fileName: () => "main.js",
    24	    },
    25	    outDir: ".",
    26	    emptyOutDir: false,
    27	    sourcemap: process.env.NODE_ENV === "DEV" ? "inline" : false,
    28	    rollupOptions: {
    29	      external: ["obsidian", "electron", "fs", "os", "path"],
    30	      output: { exports: "default" },
    31	    },
    32	  },
    33	});
```

Key build decisions:

- **`emitCss: false`**: Svelte component styles are inlined into JavaScript, not extracted to a separate CSS file. The `copy-styles` plugin handles `src/styles.css` separately (global plugin styles, not component styles).
- **`outDir: "."`** with **`emptyOutDir: false`**: Outputs `main.js` to the project root alongside `manifest.json` — the Obsidian plugin standard layout. `emptyOutDir: false` prevents Vite from wiping the project root.
- **`exports: "default"`**: Only the default export (the plugin class) is exposed — Obsidian expects this.
- **Externals**: `obsidian`, `electron`, and Node built-ins are not bundled — provided by the host.

## Concerns

### Code quality

1. **`findAdjacent` is O(n)** (cache.ts line 285): Sorts and filters all cache entries on every call. For vaults with thousands of periodic notes, this could cause noticeable lag when navigating. (Issue #118)

2. **Regex reconstruction per call** (template.ts lines 32–34, 84): `replaceGranularityTokens()` and the weekday regex in `applyTemplate()` create new RegExp objects on every invocation. These are static patterns that should be module-level constants. (Issue #115)

3. **Test files re-implement source functions** (issue #93): `template.test.ts` and `cache.test.ts` cannot import their modules directly (due to `obsidian` import side effects), so they re-implement the pure logic. This risks drift between test and source.

4. **Legacy Svelte store in Svelte 5 codebase** (issue #102): `CalendarStore` uses a Svelte 4 `Writable<number>` with manual `.subscribe()` because `$derived.by()` doesn't track store auto-subscriptions. The workaround is well-documented but adds complexity that Svelte 5 runes should eventually replace.

### Community standards

5. **No automated tests in CI for Svelte components**: While unit tests exist for `format.ts`, `store.ts`, and `utils.ts`, the Svelte components themselves have no test coverage. Calendar rendering, interaction handlers, and CSS state transitions are untested.

6. **`structuredClone` for settings merge** (main.ts line 147): This is correct and modern, but the minimum Obsidian version is 1.6.0 — `structuredClone` requires a sufficiently recent Electron. This is likely fine today but worth noting if the minimum version were ever lowered.

7. **No explicit error boundary in calendar**: If any Svelte component throws during rendering, the entire sidebar panel crashes silently. Obsidian plugins don't get error boundaries for free — a try/catch in the mount path or an `onError` handler would improve resilience.

8. **`readTemplate` swallows errors silently** (template.ts line 117): Returns empty string on failure after logging. Users get a Notice but the note is created without template content. This is defensible but could surprise users who don't notice the Notice.

