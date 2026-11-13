// Shared settings helpers (used by settings.mjs and render.mjs).
// Effective settings = settings.example.json  <-  settings.json (user, git-ignored)  <-  reel.json (per reel)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SETTINGS_PATH = process.env.CLIFFHANGER_SETTINGS || path.join(SKILL_DIR, 'settings.json');
export const EXAMPLE_PATH = path.join(SKILL_DIR, 'settings.example.json');
export const ENV_PATH = path.join(SKILL_DIR, '.env');

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
export function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = isObj(base[k]) && isObj(over[k]) ? deepMerge(base[k], over[k]) : over[k];
  return out;
}
const readJson = p => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {});
export function loadSettings() { return deepMerge(readJson(EXAMPLE_PATH), readJson(SETTINGS_PATH)); }
export function saveSettings(s) { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2) + '\n'); }

// "AbCdEfGhIjKlMnOpQrSt", "https://elevenlabs.io/app/voice-library?voiceId=…", ".../voice-lab/share/<owner>/<id>"
export function parseVoiceId(input) {
  const s = String(input || '').trim();
  const q = s.match(/[?&](?:voiceId|voice_id)=([A-Za-z0-9]{20})\b/);
  if (q) return q[1];
  if (/^[A-Za-z0-9]{20}$/.test(s)) return s;
  const segs = s.split(/[/?#&=]/).filter(x => /^[A-Za-z0-9]{20}$/.test(x));
  return segs.length ? segs[segs.length - 1] : null;
}

// Secrets live in <skill>/.env (git-ignored) or real environment variables (which win).
export const SECRET_NAMES = ['ELEVENLABS_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'GEMINI_API_KEY'];
export function readEnv(name) {
  if (process.env[name]) return process.env[name];
  if (!fs.existsSync(ENV_PATH)) return null;
  const m = fs.readFileSync(ENV_PATH, 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*["']?([^"'\\r\\n]+)`, 'm'));
  return m ? m[1].trim() : null;
}
export function envStatus(name) {
  if (process.env[name]) return { has_key: true, source: 'environment variable' };
  return readEnv(name) ? { has_key: true, source: '.env file in the skill folder' } : { has_key: false, source: null };
}
export function writeEnv(name, val) {
  if (!SECRET_NAMES.includes(name)) throw new Error('unknown setting ' + name);
  let txt = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  txt = txt.replace(new RegExp(`^\\s*${name}\\s*=.*\\r?\\n?`, 'm'), '');
  if (val) txt = (txt && !txt.endsWith('\n') ? txt + '\n' : txt) + `${name}=${val}\n`;
  fs.writeFileSync(ENV_PATH, txt);
}
export const keyStatus = () => envStatus('ELEVENLABS_API_KEY');
export const readKey = () => readEnv('ELEVENLABS_API_KEY');
export const writeKey = key => writeEnv('ELEVENLABS_API_KEY', key);

export async function verifyVoice(voiceId) {
  const key = readKey();
  if (!key) return { ok: false, error: 'No ElevenLabs API key set yet, so the voice cannot be checked.' };
  const r = await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, { headers: { 'xi-api-key': key } });
  if (!r.ok) {
    const body = await r.text();
    if (r.status !== 404 && r.status !== 400) return { ok: false, error: `ElevenLabs ${r.status}: ${body.slice(0, 200)}` };
    const lib = await findLibraryVoice(voiceId, key);
    if (lib) return { ok: false, library: lib, error: `"${lib.name}" is in the public Voice Library but not in your My Voices yet.` };
    return { ok: false, error: `ElevenLabs can't find ${voiceId} in your account or the public Voice Library.` };
  }
  const v = await r.json();
  return { ok: true, name: v.name, labels: v.labels || {}, preview_url: v.preview_url || null, category: v.category };
}

// Public Voice Library lookup (the search box accepts a voice ID).
export async function findLibraryVoice(voiceId, key = readKey()) {
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/shared-voices?page_size=10&search=${encodeURIComponent(voiceId)}`, { headers: { 'xi-api-key': key } });
    if (!r.ok) return null;
    const v = ((await r.json()).voices || []).find(x => x.voice_id === voiceId);
    return v ? { name: v.name, public_owner_id: v.public_owner_id, preview_url: v.preview_url || null,
      language: v.language || '', accent: v.accent || '', description: (v.description || '').slice(0, 160) } : null;
  } catch { return null; }
}

// Add a Voice Library voice to the user's My Voices so the API can speak with it.
export async function addLibraryVoice(voiceId, newName) {
  const key = readKey();
  if (!key) return { ok: false, error: 'No ElevenLabs API key set.' };
  const lib = await findLibraryVoice(voiceId, key);
  if (!lib) return { ok: false, error: 'Voice not found in the public Voice Library.' };
  const r = await fetch(`https://api.elevenlabs.io/v1/voices/add/${lib.public_owner_id}/${voiceId}`, {
    method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ new_name: newName || lib.name }) });
  const body = await r.text();
  if (!r.ok) {
    const perm = /missing_permissions|permission/i.test(body);
    return { ok: false, error: perm
      ? 'Your API key is not allowed to add voices. Click the ➕ next to the voice on elevenlabs.io, or give the key the "Voices: write" permission.'
      : `ElevenLabs ${r.status}: ${body.slice(0, 200)}` };
  }
  let added = {}; try { added = JSON.parse(body); } catch { /* empty */ }
  return { ok: true, voice_id: added.voice_id || voiceId, name: newName || lib.name };
}
