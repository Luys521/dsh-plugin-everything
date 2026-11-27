// Keep the declared peer range honest against what npm actually publishes.
//
// DSH's plugin API is prerelease-versioned, and semver only lets a prerelease
// satisfy a range carrying a prerelease on the same major.minor.patch. A range
// pinned to one host line therefore stops matching the next one, silently. This
// check requires `latest` (what a plain install resolves to) to stay inside the
// range, and reports the other dist-tags as information rather than failing on
// lines the plugin has not been verified against.
import { readFile } from 'node:fs/promises'
import semver from 'semver'

const HOST = '@deepseek-ai/dsh-tools'
const registry = `https://registry.npmjs.org/${HOST.replace('/', '%2f')}`
const offline = process.argv.includes('--offline')

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const range = pkg.peerDependencies?.[HOST]
if (!range) {
  console.error(`no peerDependencies entry for ${HOST}`)
  process.exit(1)
}

let meta
try {
  const response = await fetch(registry, { headers: { accept: 'application/vnd.npm.install-v1+json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  meta = await response.json()
} catch (error) {
  if (!offline) {
    console.error(`cannot read the npm registry (${error.message}); rerun with --offline to skip`)
    process.exit(1)
  }
  console.warn(`registry unreachable (${error.message}); skipped`)
  process.exit(0)
}

const tags = Object.entries(meta['dist-tags'] ?? {})
if (tags.length === 0) {
  console.error('registry returned no dist-tags')
  process.exit(1)
}

let failures = 0
for (const [tag, version] of tags) {
  const covered = semver.satisfies(version, range, { includePrerelease: true })
  const required = tag === 'latest'
  const state = covered ? 'ok  ' : required ? 'FAIL' : 'warn'
  console.log(`${state} ${HOST}@${version} (${tag}) against ${range}`)
  if (!covered && required) failures += 1
}

if (failures > 0) {
  console.error(`\nlatest is outside ${range}. Widen peerDependencies before releasing.`)
  process.exit(1)
}
