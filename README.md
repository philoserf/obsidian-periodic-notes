# Periodic Notes for Obsidian

Create and manage daily, weekly, monthly, and yearly notes in [Obsidian](https://obsidian.md/).

Originally created by [Liam Cain](https://github.com/liamcain/obsidian-periodic-notes).

## Features

- Four granularities — daily, weekly, monthly, yearly — each independently enabled with its own format, folder, and template.
- Sidebar calendar view. Click any day, week, month, or year to open (or create) that note.
- Template tokens for date math, including offsets like `{{date+1d:YYYY-MM-DD}}`.
- Jump forwards or backwards to the closest existing note at the same granularity.
- Ribbon icon and full command palette integration.
- Cmd-click (macOS) / Ctrl-click to open in a split.

## Usage

- **Ribbon icon** — opens today's note for the first enabled granularity. Right-click for a menu of all enabled granularities.
- **Command palette** — `Open today's daily note`, `Jump forwards to closest weekly note`, etc. One set of commands per enabled granularity.
- **Calendar sidebar** — run `Periodic Notes: Show calendar` to add it to the right panel. Click a day, week number, month, or year to open or create that note. Right-click for delete/file-menu actions.

## Settings

Each granularity is configured independently:

| Setting  | Description                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| Enabled  | Turn this granularity on or off.                                                                              |
| Format   | Moment.js format string. Defaults: `YYYY-MM-DD` (day), `gggg-[W]ww` (week), `YYYY-MM` (month), `YYYY` (year). |
| Folder   | Folder where these notes live. Nested folders in the format string (e.g. `YYYY/MM/YYYY-MM-DD`) are supported. |
| Template | Path to a template file applied when a new note is created.                                                   |

## Template Tokens

Tokens are replaced when a new note is created from a template.

### All granularities

| Token                   | Replaced with                |
| ----------------------- | ---------------------------- |
| `{{date}}`, `{{title}}` | The new note's filename.     |
| `{{time}}`              | The current time as `HH:mm`. |

### Daily notes

| Token                           | Replaced with                                 |
| ------------------------------- | --------------------------------------------- |
| `{{yesterday}}`, `{{tomorrow}}` | Adjacent day formatted with the daily format. |
| `{{date:FMT}}`                  | Current date formatted with `FMT`.            |
| `{{date+1d:YYYY-MM-DD}}`        | Offset date, formatted. Supports `+` or `-`.  |
| `{{time+2h:HH:mm}}`             | Offset time, formatted.                       |

### Weekly notes

| Token                   | Replaced with                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `{{monday:YYYY-MM-DD}}` | Monday of the active week, formatted. Same for `sunday`…`saturday`. Format is required. |

### Monthly notes

| Token                  | Replaced with                                  |
| ---------------------- | ---------------------------------------------- |
| `{{month:MMMM YYYY}}`  | First day of the month, formatted.             |
| `{{month-1M:YYYY-MM}}` | Offset month (previous month here), formatted. |

### Yearly notes

| Token              | Replaced with                                |
| ------------------ | -------------------------------------------- |
| `{{year:YYYY}}`    | First day of the year, formatted.            |
| `{{year-1y:YYYY}}` | Offset year (previous year here), formatted. |

Offset units follow [Moment.js](https://momentjs.com/docs/#/manipulating/add/): `y` years, `M` months, `w` weeks, `d` days, `h` hours, `m` minutes, `s` seconds.

## Alternatives

- [Calendar](https://github.com/liamcain/obsidian-calendar-plugin) — sidebar calendar without periodic-note management.
- [Daily Notes](https://help.obsidian.md/daily-notes) — Obsidian core, daily granularity only.
- [liamcain/obsidian-periodic-notes](https://github.com/liamcain/obsidian-periodic-notes) — the original upstream this fork diverged from.

## Further reading

- [CHANGELOG](CHANGELOG.md) — release history.
- [THEORY.md](THEORY.md) — architecture and design rationale.
- [walkthrough.md](walkthrough.md) — code walkthrough for contributors.

## License

MIT — see [LICENSE](LICENSE).
