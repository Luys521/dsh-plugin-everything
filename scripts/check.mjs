// Static checks that do not need the host: syntax, manifest invariants, locale files.
import { spawnSync } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const failures = []

const fail = (message) => failures.push(message)
const exists = async (rel) => {
  try {
    await stat(join(root, rel))
    return true
  } catch {
    return false
  }
}

const readJson = async (rel) => JSON.parse(await readFile(join(root, rel), 'utf8'))

// 1. Syntax. `node --check` treats a bare .js as CommonJS on older Node lines,
//    so check a .mjs copy instead and delete it afterwards.
{
  const dir = await mkdtemp(join(tmpdir(), 'dsh-check-'))
  const copy = join(dir, 'index.mjs')
  try {
    await copyFile(join(root, 'index.js'), copy)
    const { status, stderr } = spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' })
    if (status !== 0) fail(`index.js does not parse:\n${stderr.trim()}`)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// 2. Files the manifest promises.
const pkg = await readJson('package.json')
for (const rel of [
  'index.js',
  'index.d.ts',
  'cordis.patch.yml',
  'icon.svg',
  'LICENSE',
  'README.md',
  'README.zh.md',
  'locale/en.json',
  'locale/zh.json',
]) {
  if (!(await exists(rel))) fail(`missing file: ${rel}`)
}

// 3. Manifest invariants the host relies on.
if (pkg.main !== './index.js') fail(`main should be ./index.js, got ${pkg.main}`)
if (pkg.exports?.['.']?.default !== './index.js') fail('exports["."].default should be ./index.js')
if (pkg.exports?.['.']?.types !== './index.d.ts') fail('exports["."].types should be ./index.d.ts')
if (pkg.exports?.['./package.json'] !== './package.json') fail('exports should expose ./package.json')
if (pkg.exports?.['./cordis.patch.yml'] !== './cordis.patch.yml') fail('exports should expose ./cordis.patch.yml')
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') fail('dsh.bundle.patch should be ./cordis.patch.yml')
if (!(await exists(pkg.dsh?.bundle?.patch ?? ''))) fail('dsh.bundle.patch points at a missing file')
if (!pkg.files?.includes('index.js')) fail('files should include index.js')
if (!pkg.files?.includes('index.d.ts')) fail('files should include index.d.ts')
if (!pkg.files?.includes('README.zh.md')) fail('files should include README.zh.md')
if (!pkg.peerDependencies?.['@deepseek-ai/dsh-tools']) fail('peerDependencies should declare @deepseek-ai/dsh-tools')

// 4. Locale files carry the keys the settings list reads.
for (const locale of ['en', 'zh']) {
  const meta = (await readJson(`locale/${locale}.json`))?.meta
  if (!meta?.title) fail(`locale/${locale}.json is missing meta.title`)
  if (!meta?.description) fail(`locale/${locale}.json is missing meta.description`)
  if (meta?.detail && !(await exists(meta.detail))) fail(`locale/${locale}.json meta.detail points at a missing file: ${meta.detail}`)
}

if (failures.length > 0) {
  console.error(`check failed (${failures.length}):`)
  for (const message of failures) console.error(`- ${message}`)
  process.exit(1)
}
console.log('check passed: syntax, manifest, locale files')
