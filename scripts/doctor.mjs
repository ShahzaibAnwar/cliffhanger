#!/usr/bin/env node
/* Setup check. Tells you what is installed, what is missing and how to fix it.
     node scripts/doctor.mjs
   Never prints key values: only whether each key is set. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readEnv, loadSettings } from './settings-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WIN = process.platform === 'win32';
const OS = WIN ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
let bad = 0, warn = 0;
const ok = (name, info = '') => console.log(`  ✔ ${name}${info ? '  ' + info : ''}`);
const fail = (name, fix) => { bad++; console.log(`  ✘ ${name}\n      fix: ${fix}`); };
const soft = (name, note) => { warn++; console.log(`  • ${name}  ${note}`); };
const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', shell: false }); return r.status === 0 ? (r.stdout || r.stderr || '').trim() : null; };
const INSTALL = {
  ffmpeg: { windows: 'winget install Gyan.FFmpeg', mac: 'brew install ffmpeg', linux: 'sudo apt install ffmpeg' },
  python: { windows: 'winget install Python.Python.3.12', mac: 'brew install python', linux: 'sudo apt install python3 python3-pip' },
};

export function pythonCmd() {
  if (process.env.PYTHON) return process.env.PYTHON;
  for (const c of WIN ? ['python', 'py', 'python3'] : ['python3', 'python']) if (run(c, ['--version'])?.startsWith('Python 3')) return c;
  return null;
}

async function main() {
  console.log(`Cliffhanger setup check (${OS}, node ${process.versions.node})\n\nRequired`);
  const major = +process.versions.node.split('.')[0];
  major >= 18 ? ok('Node.js', process.versions.node) : fail(`Node.js ${process.versions.node} is too old`, 'install Node 18 or newer from https://nodejs.org');

  for (const b of ['ffmpeg', 'ffprobe']) {
    const v = run(b, ['-version']);
    v ? ok(b, v.split('\n')[0].split(' ').slice(0, 3).join(' ')) : fail(`${b} not found on PATH`, INSTALL.ffmpeg[OS]);
  }

  const py = pythonCmd();
  if (!py) fail('Python 3 not found', INSTALL.python[OS]);
  else {
    ok('Python', `${run(py, ['--version'])} (${py})`);
    run(py, ['-c', 'import edge_tts']) !== null ? ok('edge-tts (free voices)') : fail('edge-tts Python package missing', `${py} -m pip install edge-tts`);
  }

  let chromium = null;
  try { ({ chromium } = await import('playwright-core')); ok('playwright-core'); }
  catch { fail('playwright-core not installed', `cd "${HERE}" && npm install`); }

  if (chromium) {
    const tries = [];
    if (process.env.CHROME_PATH) tries.push(['CHROME_PATH', { executablePath: process.env.CHROME_PATH }]);
    tries.push(['bundled Chromium', {}], ['Google Chrome', { channel: 'chrome' }], ['Microsoft Edge', { channel: 'msedge' }], ['Chromium', { channel: 'chromium' }]);
    let found = null;
    for (const [name, o] of tries) {
      try { const b = await chromium.launch(o); await b.close(); found = name; break; } catch { /* next */ }
    }
    found ? ok('Browser for rendering', found) : fail('No browser Playwright can launch', 'install Google Chrome, or run: npx playwright-core install chromium   (or set CHROME_PATH)');
  }

  console.log('\nOptional');
  const k = n => !!readEnv(n);
  k('ELEVENLABS_API_KEY') ? ok('ElevenLabs key', 'set') : soft('ElevenLabs key', 'not set: free Edge voices will be used');
  k('CLOUDFLARE_ACCOUNT_ID') && k('CLOUDFLARE_API_TOKEN') ? ok('Cloudflare Workers AI', 'set (free AI illustrations)') : soft('Cloudflare Workers AI', 'not set: hand-drawn art only');
  k('GEMINI_API_KEY') ? ok('Gemini key', 'set (images need billing)') : soft('Gemini key', 'not set (optional)');

  const s = loadSettings();
  const voices = s.voice?.elevenlabs?.voices || [];
  fs.existsSync(path.join(ROOT, 'settings.json')) ? ok('settings.json', `${voices.length} saved voice(s)`) : soft('settings.json', 'not created yet: run node scripts/settings.mjs');

  const gitDir = fs.existsSync(path.join(ROOT, '.git'));
  if (gitDir) {
    const hooks = run('git', ['-C', ROOT, 'config', 'core.hooksPath']);
    hooks === '.githooks' ? ok('Secret guard (pre-commit hook)', 'on') : soft('Secret guard (pre-commit hook)', 'off: run  git config core.hooksPath .githooks');
  }

  console.log(`\n${bad ? `${bad} problem(s) to fix` : 'Ready to make reels'}${warn ? ` · ${warn} optional item(s)` : ''}`);
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
