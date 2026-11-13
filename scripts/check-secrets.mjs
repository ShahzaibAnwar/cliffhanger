#!/usr/bin/env node
/* Secret guard. Blocks a commit (or reports) if any credential or private file would be published.
     node scripts/check-secrets.mjs            check everything `git add -A` would publish
     node scripts/check-secrets.mjs --staged   check only staged files (used by the pre-commit hook)
   Checks: forbidden files (.env, settings.json, caches, builds), the actual values in your .env
   (compared in memory, never printed), common key formats, and private paths. Exit code 1 = blocked. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);
const staged = process.argv.includes('--staged');
const list = staged
  ? execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  : execFileSync('git', ['add', '-A', '--dry-run'], { encoding: 'utf8' }).split('\n').map(l => l.match(/^add '(.+)'$/)?.[1]).filter(Boolean);

const FORBIDDEN = [/(^|\/)\.env(\..*)?$/, /(^|\/)settings\.json$/, /(^|\/)sfx-cache\//, /(^|\/)build\//, /(^|\/)node_modules\//, /(^|\/)variants\//, /\.pem$|\.key$|id_rsa/];
const ALLOWED_ENV_TEMPLATE = /(^|\/)\.env\.example$/;
const secrets = {};
for (const f of ['.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?([^"'\s#]+)/);
    if (m && m[2].length >= 8) secrets[m[1]] = m[2];
  }
}
for (const [k, v] of Object.entries(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD/i.test(k) && v && v.length >= 16 && /ELEVEN|CLOUDFLARE|GEMINI|GOOGLE|OPENAI|FAL|REPLICATE/i.test(k)) secrets['env:' + k] = v;
const PATTERNS = {
  'Google API key': /AIza[0-9A-Za-z_\-]{35}/, 'ElevenLabs key': /\bsk_[0-9a-f]{40,}\b/, 'OpenAI key': /\bsk-(proj-)?[A-Za-z0-9]{32,}/,
  'Bearer token': /Bearer\s+[A-Za-z0-9_\-.]{30,}/, 'private key block': /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  'key assignment with a long literal': /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/i,
  'Windows user path': /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+/i,
};
const problems = [];
for (const f of list) {
  if (FORBIDDEN.some(re => re.test(f)) && !ALLOWED_ENV_TEMPLATE.test(f)) { problems.push(`forbidden file: ${f}`); continue; }
  if (!fs.existsSync(f)) continue;
  const txt = fs.readFileSync(f).toString('latin1');
  for (const [name, val] of Object.entries(secrets)) if (txt.includes(val)) problems.push(`${f}: contains the value of ${name}`);
  if (/\.(png|jpe?g|webp|gif|mp4|mp3|wav|woff2?)$/i.test(f)) continue;
  for (const [name, re] of Object.entries(PATTERNS)) if (re.test(txt)) problems.push(`${f}: looks like a ${name}`);
}
if (problems.length) {
  console.error('\n✖ SECRET GUARD: not safe to publish\n  ' + problems.join('\n  ') + '\n');
  process.exit(1);
}
console.log(`✓ secret guard: ${list.length} file(s) checked, ${Object.keys(secrets).length} secret value(s) compared, nothing found`);
