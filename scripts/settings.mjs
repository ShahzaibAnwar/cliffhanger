#!/usr/bin/env node
/* Cliffhanger settings.
     node settings.mjs                     open the settings page in your browser (local only)
     node settings.mjs --no-open [--port 4317]
     node settings.mjs show                print effective settings (API key is never printed)
     node settings.mjs add-voice <id|link> [--name "Deep narrator"] [--lang Hindi] [--notes "..."] [--default]
     node settings.mjs remove-voice <id>
     node settings.mjs set <dotted.path> <value>     e.g. set brand.name "CURIO FILES"   set audio.sfx false
     node settings.mjs path                 where settings.json lives */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSettings, saveSettings, parseVoiceId, keyStatus, writeKey, verifyVoice, addLibraryVoice, SETTINGS_PATH, envStatus, writeEnv } from './settings-lib.mjs';
const envAll = () => Object.fromEntries(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'GEMINI_API_KEY'].map(n => [n, envStatus(n)]));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'open';

function addVoice(s, input, meta = {}) {
  const id = parseVoiceId(input);
  if (!id) throw new Error(`Couldn't find a 20-character ElevenLabs voice ID in "${input}"`);
  const list = s.voice.elevenlabs.voices;
  const existing = list.find(v => v.voice_id === id);
  const entry = Object.assign(existing || { voice_id: id, name: '', language: '', notes: '' },
    Object.fromEntries(Object.entries(meta).filter(([, v]) => v != null && v !== '')));
  if (!entry.name) entry.name = `Voice ${list.length + (existing ? 0 : 1)}`;
  if (!existing) list.push(entry);
  if (meta.makeDefault || !s.voice.elevenlabs.default_voice_id) s.voice.elevenlabs.default_voice_id = id;
  delete entry.makeDefault;
  return entry;
}

if (cmd === 'path') { console.log(SETTINGS_PATH); process.exit(0); }
if (cmd === 'show') { console.log(JSON.stringify({ ...loadSettings(), elevenlabs_key: keyStatus() }, null, 2)); process.exit(0); }
if (cmd === 'add-voice') {
  const s = loadSettings();
  const e = addVoice(s, argv[1], { name: opt('name'), language: opt('lang'), notes: opt('notes'), makeDefault: argv.includes('--default') });
  saveSettings(s);
  console.log(`saved ${e.voice_id} as "${e.name}"${s.voice.elevenlabs.default_voice_id === e.voice_id ? ' (default)' : ''}`);
  process.exit(0);
}
if (cmd === 'remove-voice') {
  const s = loadSettings(); const id = parseVoiceId(argv[1]);
  s.voice.elevenlabs.voices = s.voice.elevenlabs.voices.filter(v => v.voice_id !== id);
  if (s.voice.elevenlabs.default_voice_id === id) s.voice.elevenlabs.default_voice_id = s.voice.elevenlabs.voices[0]?.voice_id || '';
  saveSettings(s); console.log('removed ' + id); process.exit(0);
}
if (cmd === 'set') {
  const s = loadSettings(); const keys = argv[1].split('.'); let v = argv[2];
  try { v = JSON.parse(v); } catch { /* plain string */ }
  let o = s; for (const k of keys.slice(0, -1)) o = o[k] = o[k] ?? {};
  o[keys[keys.length - 1]] = v; saveSettings(s); console.log(`${argv[1]} = ${JSON.stringify(v)}`); process.exit(0);
}

// ---------- settings page (127.0.0.1 only, token-protected) ----------
const token = crypto.randomBytes(16).toString('hex');
const page = fs.readFileSync(path.join(HERE, 'settings-ui.html'), 'utf8').replace('__TOKEN__', token);
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const readBody = req => new Promise((ok, bad) => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(e); } }); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/') {
    if (url.searchParams.get('t') !== token) return send(res, 403, 'Open the link printed in the terminal.', 'text/plain');
    return send(res, 200, page, 'text/html; charset=utf-8');
  }
  if (req.headers['x-token'] !== token) return send(res, 403, { error: 'bad token' });
  try {
    if (req.method === 'GET' && url.pathname === '/api/settings') return send(res, 200, { settings: loadSettings(), key: keyStatus(), env: envAll(), path: SETTINGS_PATH });
    if (req.method === 'POST' && url.pathname === '/api/env') {
      const b = await readBody(req); const v = String(b.value || '').trim();
      if (!['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'GEMINI_API_KEY'].includes(b.name)) return send(res, 400, { error: 'unknown key' });
      if (v && !/^[A-Za-z0-9_\-.]{16,200}$/.test(v)) return send(res, 400, { error: "That doesn't look like a valid key or ID." });
      writeEnv(b.name, v); return send(res, 200, { env: envAll() });
    }
    if (req.method === 'POST' && url.pathname === '/api/test-image') {
      const b = await readBody(req);
      const { generate } = await import('./imagegen.mjs');
      const dir = path.join(path.dirname(HERE), 'sfx-cache', 'image-test', String(Date.now()));
      try {
        const r = await generate({ image_prompt: String(b.prompt || 'a human heart').slice(0, 300), image_style: b.style || 'engraving' }, 'paper', loadSettings().images || {}, dir, { provider: b.provider || undefined });
        const mime = r.file.endsWith('.png') ? 'image/png' : r.file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        return send(res, 200, { ok: true, provider: r.provider, style: r.style, data: `data:${mime};base64,${fs.readFileSync(r.file).toString('base64')}` });
      } catch (e) { return send(res, 200, { ok: false, error: String(e.message || e).slice(0, 400) }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/settings') {
      const b = await readBody(req);
      if (!b || typeof b.settings !== 'object') return send(res, 400, { error: 'settings missing' });
      saveSettings(b.settings); return send(res, 200, { ok: true, path: SETTINGS_PATH });
    }
    if (req.method === 'POST' && url.pathname === '/api/parse-voice') {
      const b = await readBody(req); const id = parseVoiceId(b.input);
      return send(res, id ? 200 : 400, id ? { voice_id: id } : { error: 'No 20-character voice ID found in that text/link.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/verify') { const b = await readBody(req); return send(res, 200, await verifyVoice(b.voice_id)); }
    if (req.method === 'POST' && url.pathname === '/api/add-library') { const b = await readBody(req); return send(res, 200, await addLibraryVoice(b.voice_id, b.name)); }
    if (req.method === 'POST' && url.pathname === '/api/key') {
      const b = await readBody(req); const k = String(b.key || '').trim();
      if (k && !/^[A-Za-z0-9_\-]{20,200}$/.test(k)) return send(res, 400, { error: "That doesn't look like an ElevenLabs API key." });
      writeKey(k); return send(res, 200, { key: keyStatus() });
    }
    if (req.method === 'POST' && url.pathname === '/api/quit') { send(res, 200, { ok: true }); setTimeout(() => process.exit(0), 200); return; }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
});
const port = parseInt(opt('port', '4317'), 10);
server.on('error', e => { if (e.code === 'EADDRINUSE') { server.listen(0, '127.0.0.1'); } else throw e; });
server.listen(port, '127.0.0.1', () => {});
server.on('listening', () => {
  const link = `http://127.0.0.1:${server.address().port}/?t=${token}`;
  console.log(`Cliffhanger settings: ${link}\n(saves to ${SETTINGS_PATH}; press Ctrl+C or "Close" on the page to stop)`);
  if (!argv.includes('--no-open')) {
    const [c, a] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', link]] : process.platform === 'darwin' ? ['open', [link]] : ['xdg-open', [link]];
    spawn(c, a, { stdio: 'ignore', detached: true }).unref();
  }
});
