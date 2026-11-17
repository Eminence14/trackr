// One-command deploy to Vercel: `npm run deploy`.
// Copies the settings Trackr needs from your local .env into Vercel without printing any of them,
// then publishes a production build. Safe to run again after every change.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const VERCEL = 'npx --yes vercel@latest'
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts })
const quiet = (cmd, input) => { try { execSync(cmd, { stdio: ['pipe', 'ignore', 'pipe'], input }); return true } catch { return false } }
const step = (s) => console.log(`\n▶ ${s}`)

step('Installing packages')
run('npm install --no-audit --no-fund')

step('Bundling the server functions')
run('npm run build:api')

step('Checking your Vercel sign-in')
if (!quiet(`${VERCEL} whoami`)) {
  console.log('A browser window will open. Approve the sign-in, then come back here.')
  run(`${VERCEL} login`)
}

step('Linking this folder to the "trackr" project on Vercel')
if (!existsSync('.vercel/project.json') && !quiet(`${VERCEL} link --yes --project trackr`)) run(`${VERCEL} link --yes`)

step('Copying settings from .env (values are never shown)')
const env = existsSync('.env') ? readFileSync('.env', 'utf8') : ''
const wanted = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_FALLBACK_MODEL', 'RATE_LIMIT_PER_MIN', 'IMAGE_LIMIT_PER_MIN', 'AI_CONCURRENCY', 'READER_FALLBACK', 'ALLOWED_ORIGINS']
let copied = 0
for (const name of wanted) {
  // [^\\S\\n] is a space or tab, never a newline: a blank value must not swallow the next line.
  const m = env.match(new RegExp(`^[^\\S\\n]*${name}[^\\S\\n]*=[^\\S\\n]*([^\\n]*)$`, 'm'))
  const value = m?.[1]?.replace(/^['"]|['"]$/g, '').trim()
  if (!value) continue
  quiet(`${VERCEL} env rm ${name} production --yes`)
  if (quiet(`${VERCEL} env add ${name} production`, value)) { copied++; console.log(`  set ${name}`) }
  else console.log(`  could not set ${name}`)
}
if (!env.match(/^[^\S\n]*GEMINI_API_KEY[^\S\n]*=[^\S\n]*\S/m)) console.log('  GEMINI_API_KEY is missing from .env, so the AI reader will be off and the basic reader will be used.')
console.log(`  ${copied} setting(s) copied`)

step('Publishing to production')
run(`${VERCEL} deploy --prod --yes`)
console.log('\nDone. The address above ending in .vercel.app is your live Trackr.')
