import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { defineTool } from '@deepseek-ai/dsh-tools'

const execFileAsync = promisify(execFile)

export const inject = ['tools']

export const name = 'everything-search'

/**
 * The default ES binary location: the per-user WindowsApps folder, which ES's
 * installer puts on PATH but which execFile cannot resolve by bare name.
 * Resolved at load time from the environment so the plugin works under any user
 * profile; config.esPath overrides it.
 */
const DEFAULT_ES = join(
  process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
  'Microsoft',
  'WindowsApps',
  'es.exe',
)

/**
 * Name the target instance for messages: the default instance has no name.
 */
function describeInstance(config) {
  return config.instanceName ? ` for instance "${config.instanceName}"` : ''
}

/**
 * Run one ES query and return its result paths as UTF-8 strings.
 *
 * ES writes results to stdout in the console code page, which mangles any
 * non-ASCII path. Exporting to a UTF-8 JSON file instead keeps every path
 * intact, so every query goes through that route; the temp file is always
 * removed.
 */
async function runEs(config, args, signal) {
  const esPath = config.esPath || DEFAULT_ES
  const dir = await mkdtemp(join(tmpdir(), 'dsh-es-'))
  const outFile = join(dir, 'out.json')
  const argv = [
    ...(config.instanceName ? ['-instance', config.instanceName] : []),
    '-timeout', String(config.ipcTimeoutMs),
    ...args,
    '-export-json', outFile,
    '-utf8-bom',
  ]
  try {
    await execFileAsync(esPath, argv, {
      encoding: 'buffer',
      maxBuffer: config.maxBufferBytes,
      signal,
      windowsHide: true,
    })
    const text = await readFile(outFile, { encoding: 'utf8' })
    return parseExportedPaths(text)
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    // A missing output file on a non-zero exit means the export never ran; ES
    // reports that through its exit code, so surface it rather than the ENOENT.
    if (error?.code === 'ENOENT' && error?.syscall === 'open') {
      throw new Error(`ES did not write results${describeInstance(config)}.`)
    }
    const code = typeof error?.code === 'number' ? error.code : null
    const stderr = error?.stderr ? Buffer.from(error.stderr).toString('utf8').trim() : ''
    const hint =
      code === 8
        ? `Everything IPC not found${describeInstance(config)}. Everything must be running.`
        : stderr || error?.message || 'unknown ES failure'
    const err = new Error(hint)
    err.esExitCode = code
    throw err
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Run one ES command whose answer is plain ASCII text on stdout, such as the
 * version or a result count. Result-export switches do not apply here.
 */
async function runEsText(config, args, signal) {
  const esPath = config.esPath || DEFAULT_ES
  const argv = [
    ...(config.instanceName ? ['-instance', config.instanceName] : []),
    '-timeout', String(config.ipcTimeoutMs),
    ...args,
  ]
  try {
    const { stdout } = await execFileAsync(esPath, argv, {
      encoding: 'buffer',
      maxBuffer: config.maxBufferBytes,
      signal,
      windowsHide: true,
    })
    return stdout.toString('utf8')
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    const code = typeof error?.code === 'number' ? error.code : null
    const stderr = error?.stderr ? Buffer.from(error.stderr).toString('utf8').trim() : ''
    const hint =
      code === 8
        ? `Everything IPC not found${describeInstance(config)}. Everything must be running.`
        : stderr || error?.message || 'unknown ES failure'
    const err = new Error(hint)
    err.esExitCode = code
    throw err
  }
}

/**
 * Turn an ES JSON export into plain paths.
 *
 * ES writes a JSON array spread over lines: the opening bracket shares the
 * first object's line and the closing bracket shares the last one, with a
 * trailing comma on every object but the last. Stripping that framing per line
 * recovers one object per line, and a malformed line is skipped rather than
 * discarding the whole result.
 */
function parseExportedPaths(text) {
  const cleaned = text.replace(/^\uFEFF/, '').trim()
  if (!cleaned) return []
  // A single-object export may omit the array framing entirely, so fall back to
  // the whole text when it parses as one JSON value.
  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    try {
      const list = JSON.parse(cleaned)
      if (Array.isArray(list)) {
        return list.map((item) => item?.filename).filter((p) => typeof p === 'string')
      }
    } catch {
      // Fall through to line-by-line recovery below.
    }
  }
  const paths = []
  for (const raw of cleaned.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line) continue
    if (line.startsWith('[')) line = line.slice(1).trim()
    if (line.endsWith(']')) line = line.slice(0, -1).trim()
    if (line.endsWith(',')) line = line.slice(0, -1).trim()
    if (!line.startsWith('{') || !line.endsWith('}')) continue
    try {
      const record = JSON.parse(line)
      if (typeof record.filename === 'string') paths.push(record.filename)
    } catch {
      // Keep the other lines; one damaged record does not void the export.
    }
  }
  return paths
}

export function apply(ctx, config) {
  const settings = {
    esPath: DEFAULT_ES,
    instanceName: '',
    ipcTimeoutMs: 10000,
    maxResults: 200,
    maxBufferBytes: 32 * 1024 * 1024,
    ...config,
  }

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'everything_find',
    description:
      'Find files and folders anywhere on this machine by name, path, extension, size, date, or attributes. '
      + 'Reach for this first whenever you need to locate a file: do not recurse with glob, Get-ChildItem, os.walk '
      + 'or a directory listing to find one. Recursion only sees directories you already guessed, and it is slow. '
      + 'Everything keeps an NTFS index of every file, so this answers in milliseconds without walking directories — '
      + 'it is the fastest way to locate something whose location you do not know, and it reaches every drive at once. '
      + 'An empty result is evidence too: it means the name is absent from the indexed volumes, so report the scope '
      + 'you searched and the count rather than concluding from a single directory. '
      + 'The query language goes far beyond filenames: '
      + '"ext:docx;xlsx report" for Office files, "dm:today" or "dm:2026-11" for dated changes, '
      + '"size:>100mb" for large files, "dupe:size" to find files sharing a size, "/ad" for folders only, '
      + '"!ext:tmp" to exclude noise, "parent:E:\\JX" for direct children. '
      + 'Use everything_content instead when you need to match text inside files.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description:
          'Everything search syntax. Bare text matches filenames; combine with spaces (AND), | (OR), ! (NOT). '
          + 'Examples: "*.md", "ext:docx;pdf", "\\downloads", "dm:today *.pdf", "size:>1gb", "dupe:size", '
          + '"child:*.mp4" for folders containing mp4s, "/ad" for folders only.',
      },
      path: {
        type: 'string',
        description:
          'Restrict results to this folder. Strongly recommended: it turns a whole-disk scan into a subtree scan and keeps unrelated hits out.',
      },
      limit: {
        type: 'number',
        description: `Maximum results to return. Defaults to ${settings.maxResults}.`,
      },
      sort: {
        type: 'string',
        description: 'Optional sort property, e.g. name, path, size, date-modified. Prefix with "-" for descending, e.g. "-size".',
      },
      regex: {
        type: 'boolean',
        description: 'Treat query as a PCRE regular expression matched against the filename.',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          results: { type: 'array', items: { type: 'string' } },
          count: { type: 'number' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.count === 0
          ? 'No files found.'
          : `${value.count} result(s):\n${value.results.join('\n')}`,
      }],
    },
    async execute(args, exec) {
      const limit = Math.max(1, Math.min(2000, Math.floor(args.limit ?? settings.maxResults)))
      const argv = ['-n', String(limit)]
      if (args.path) argv.push('-path', args.path)
      if (args.sort) argv.push('-sort', args.sort.replace(/^-/, ''))
      if (args.sort?.startsWith('-')) argv.push('-sort-descending')
      // Regex and plain queries take different ES paths: the -regex switch and
      // the inline regex: modifier behave differently, and the modifier is the
      // one that keeps working alongside other Everything syntax.
      argv.push('-search', args.regex ? `regex:${args.query}` : args.query)

      const results = await runEs(settings, argv, exec.signal)
      return { results, count: results.length }
    },
  }), { name: 'everything_find' }))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'everything_content',
    description:
      'Find which files contain given text, across a folder or the whole machine and across every drive. '
      + 'Unlike a plain text search, Everything routes each file through the system IFilters, so it reads inside '
      + 'Word documents, PDFs, Excel sheets and other container formats that a byte-level search cannot open. '
      + 'Typical uses: which report mentions a project name, which spreadsheets contain an account number, '
      + 'which contracts mention a clause, which document has a person\'s name. '
      + 'It answers which files contain the text, not where inside them, so follow up with a line search when you need '
      + 'the matching lines themselves. It also reads container formats a byte-level search cannot open, which a plain '
      + 'text search will miss entirely. '
      + 'Narrow the search with path, extensions, or a size or date filter to keep it fast.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description:
          'Text to find inside files. Prefer a short word or two: long runs of underscores or punctuation get split differently '
          + 'and fall back to a slow read-every-file scan that may also miss. Multiple words are all required.',
      },
      path: {
        type: 'string',
        description: 'Folder to search within. Strongly recommended; narrows the scan before any file is opened.',
      },
      extensions: {
        type: 'string',
        description:
          'Restrict to these extensions, without dots, e.g. "docx;pdf" or "md;txt". '
          + 'The most effective way to keep a document search fast.',
      },
      limit: {
        type: 'number',
        description: `Maximum results. Defaults to ${Math.min(50, settings.maxResults)}.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          results: { type: 'array', items: { type: 'string' } },
          count: { type: 'number' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.count === 0
          ? 'No files matched the content.'
          : `${value.count} file(s) contain the text:\n${value.results.join('\n')}`,
      }],
    },
    async execute(args, exec) {
      const limit = Math.max(1, Math.min(500, Math.floor(args.limit ?? Math.min(50, settings.maxResults))))
      const terms = []
      if (args.extensions) terms.push(`ext:${args.extensions.replace(/\*/g, '').replace(/^\.+/, '').replace(/[;,]+/g, ';')}`)
      terms.push(`content:${args.query}`)

      const argv = ['-n', String(limit), '-search', terms.join(' ')]
      if (args.path) argv.push('-path', args.path)

      const results = await runEs(settings, argv, exec.signal)
      return { results, count: results.length }
    },
  }), { name: 'everything_content' }))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'everything_status',
    description:
      'Report whether the Everything index is reachable and how large it is. Use it to diagnose a failed everything_find or everything_content call before falling back to slower tools.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: {
          reachable: { type: 'boolean' },
          everythingVersion: { type: 'string' },
          indexedEntries: { type: 'number' },
          detail: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.reachable
          ? `Everything ${value.everythingVersion} reachable${describeInstance(settings)}, ${value.indexedEntries} entries indexed.`
          : `Everything unreachable: ${value.detail}`,
      }],
    },
    async execute(_args, exec) {
      try {
        const version = (await runEsText(settings, ['-get-everything-version'], exec.signal)).trim()
        const total = (await runEsText(settings, ['-get-result-count', '*'], exec.signal)).trim()
        return {
          reachable: true,
          everythingVersion: version,
          indexedEntries: Number(total) || 0,
          detail: 'ok',
        }
      } catch (error) {
        return {
          reachable: false,
          everythingVersion: '',
          indexedEntries: 0,
          detail: error?.message || String(error),
        }
      }
    },
  }), { name: 'everything_status' }))
}
