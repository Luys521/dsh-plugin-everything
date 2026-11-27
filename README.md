# dsh-plugin-everything

English | [中文](README.zh.md)

Whole-disk file search for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), backed by the Everything index.

Everything keeps a filename index of every NTFS volume and answers queries over local IPC. With this plugin installed, the agent locates any file on the machine in milliseconds instead of walking directory trees and guessing.

## The problem it solves

Left to itself, an agent finds files by recursing: `glob`, `Get-ChildItem`, `os.walk`. That approach fails in two ways:

- **It only sees the directories you guessed.** Guess wrong and you get nothing back — then the wrong conclusion that the file does not exist.
- **It is slow.** A few thousand files means walking a whole tree.

Everything's index already covers the disk and answers in milliseconds. Searching becomes a lookup instead of a traversal.

## Tools

| Tool | What it does | When to use |
|---|---|---|
| `everything_find` | Finds files and folders by name, path, extension, size, date, or attributes | First choice whenever a file must be located — do not recurse |
| `everything_content` | Searches file bodies; reads inside Word, PDF and Excel through the system IFilters, falling back to plain text when no IFilter exists | When you need to know *which file* mentions something, not the matching lines |
| `everything_status` | Reports whether the index is reachable and how many entries it holds | Run it first when either tool above fails |

`everything_content` answers only which files contain the text; it returns no line numbers. To see the matching lines, follow up with `grep` or `read`.

## Install

**Requirements**: Windows, and [Everything](https://www.voidtools.com/) 1.5 or newer installed and running.

1. Install the ES command line tool. Everything itself does **not** ship it:

   Download from [voidtools/ES releases](https://github.com/voidtools/ES/releases) and extract `es.exe` into `%LOCALAPPDATA%\Microsoft\WindowsApps` — that folder is on `PATH`, so the bare name resolves. Anywhere else works too, but then set `esPath` in the config.

2. Install the plugin:

   ```sh
   dsh plugin --profile web add github:Luys521/dsh-plugin-everything
   ```

3. Restart `dsh web`. Tool descriptions are read into memory at startup; editing the config on disk does not reload them.

## Configuration

Add this to DSH's `cordis.patch.yml`:

```yaml
- insert:
    - id: everything-search
      name: 'dsh-plugin-everything'
      config:
        instanceName: ''
```

| Key | Default | Meaning |
|---|---|---|
| `esPath` | `%LOCALAPPDATA%\Microsoft\WindowsApps\es.exe` | Path to the ES executable |
| `instanceName` | empty (default instance) | Everything instance name |
| `ipcTimeoutMs` | `10000` | Longest wait for the index to load, in milliseconds |
| `maxResults` | `200` | Default result cap |

### Content indexing (Everything side, optional)

This is a setting on Everything, not on the plugin. With content indexing off (the default) `content:` reads each file on demand — slow but complete. With it on, file text lives in memory and queries are fast, but they cover **only the indexed scope**.

In Everything, open **Tools → Options → Advanced**, type `content` into the settings filter, and adjust these three:

| Setting | Meaning |
|---|---|
| `content_indexing_enabled` | Master switch; `true` turns content indexing on |
| `content_indexing_include_only_folders` | Folders to index; empty means no restriction |
| `content_indexing_include_only_files` | File types to index; **defaults to `*.doc;*.docx;*.pdf;*.txt;*.xls;*.xlsx`** — append `*.md`, `*.csv`, `*.pptx` to this semicolon list if you need them |

To reach types outside that list you can also leave the index alone and have `es.exe` search with `notindexed:content:...`, which forces a live scan at the slow path. Fast and complete: pick one.

> A few early 1.5 builds (1.5.0.1391a, for instance) had a separate Content page on the left. The official options documentation lists only General / History / Indexes / Plugins / Advanced, so when there is no Content page, search by setting name as above.

## How it works

- Every query spawns `es.exe` and writes results with `-export-json` to a temporary file, which is then read back. ES prints to stdout in the console code page, which mangles non-ASCII paths; the JSON export preserves every character.
- One temporary directory per query, removed afterwards.

## Troubleshooting

Start with `everything_status`.

- `Everything IPC not found` — Everything is not running, or the build is too old. Early 1.5 builds (1.5.0.1404a) may not create the IPC window for the main instance; 1.5.0.1424b and later work.
- `ES not found` / `spawn ... ENOENT` — `es.exe` is not where the config expects it. Follow step 1 of the install, or set `esPath`.
- Indexed entries count is 0 — Everything is still building its index; wait.
- To target a named instance, start `Everything.exe -instance dsh` and set `instanceName: dsh`.

## Known limitations

- **Content search needs a scope.** `content:` has no index behind it by default and reads every candidate file. Constrain `path` or `extensions` and it answers in milliseconds; unconstrained it takes seconds across the disk. What you pay is time, not accuracy.
- **With content indexing on, `content:` searches only the indexed scope.** It covers the include-only folders and types (default `*.doc;*.docx;*.pdf;*.txt;*.xls;*.xlsx`), so types outside the list — `.md`, `.csv`, `.pptx` — come back **empty without an error**. See Configuration → Content indexing for the fix and its trade-off.
- **Scanned PDFs are invisible.** Content search needs a text layer; an image-only PDF has none, so no amount of searching finds it until it is OCR'd. Indexing does not change this.
- **Regex goes through the `regex:` modifier.** The plugin always builds `-search 'regex:...'`. When calling `es.exe` yourself, avoid the `-regex` switch — it behaves differently in combination with other syntax.
- **Only NTFS volumes are indexed by default.** FAT/exFAT and network paths need folder indexes configured in Everything first.
- **Windows only.**
- **The searchable set follows Everything's exclude settings.** The plugin applies no filter of its own; when results look wrong, run `everything_status` to confirm reachability and entry count.

## Compatibility

The plugin needs a host providing `@deepseek-ai/dsh-tools`. Its peer range is `^0.0.1-rc.1 || ^0.1.5-rc.2`:

- `0.1.5-rc.2` — verified locally: all three `defineTool` definitions, the `register` signature and the output schemas are accepted;
- `0.0.1-rc.1` — what npm's `latest` points at, so the version a plain `npm i @deepseek-ai/dsh-tools` installs.

Why an enumeration rather than one range: semver only lets a prerelease satisfy a range carrying a prerelease on the *same* `major.minor.patch`, so `^0.1.5-rc.2` never covers `0.2.x`. Every verified host line has to be listed separately.

`npm run check:peers` resolves the registry's dist-tags and fails when `latest` falls outside the range; `next` / `alpha` only warn — an unverified line is not claimed as supported. CI runs it on every push.

## Dependencies and acknowledgements

This plugin contains no Everything code or binaries. It calls the Everything and `es.exe` installations already on the machine.

| Component | Provider | Relationship |
|---|---|---|
| Everything (NTFS whole-disk index client) | [voidtools](https://www.voidtools.com/) | Queried over its IPC. Free but closed source; not redistributed here |
| ES command line `es.exe` | [voidtools/ES](https://github.com/voidtools/ES) | Invoked as a subprocess; its `-export-json` output is parsed. Not redistributed here |

- Everything and ES are copyright voidtools (author David Carpenter).
- This project is not affiliated with, sponsored by, or endorsed by voidtools. "Everything" is voidtools' product name, used here only to refer to it.
- The MIT license in this repository covers this repository's code only, not Everything or ES.
- If this plugin saves you time, remember the index is someone else's work — you can [donate to the Everything author](https://www.voidtools.com/donate/).

## Documentation

Deeper usage, a recommended search workflow, and advice on rephrasing keywords: [docs/DETAIL.md](docs/DETAIL.md) (Chinese).

## Development

```sh
npm install
npm run check        # syntax, manifest, peer range
npm run check:peers  # peer range against the registry's latest / next only
```

There is no build step: `index.js` is the shipped artifact, loaded by DSH as ESM.

## License

MIT, see [LICENSE](LICENSE).
