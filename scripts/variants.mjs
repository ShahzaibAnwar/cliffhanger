#!/usr/bin/env node
/* Hook A/B variants: render the same reel with different opening scenes, to test which hook holds viewers.
     node variants.mjs <project> [--only b,c] [--after-vo "python path/to/your-tool.py {dir}"]

   In reel.json:  "hook_variants": [ { "id": "b", "vo": "...", "headline": ["...", "..."], "visual": {...}, ... }, ... ]
   Each variant replaces fields of the FIRST scene. Everything else (voiceover clips, images) is reused,
   so only the new hook line is voiced. Output: out/<slug>-hook-<id>.mp4 (+ cover, srt) next to the main video.
   --after-vo runs a command after the voiceover step ({dir} = the variant folder), e.g. your tighten tool. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pythonCmd } from './doctor.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2), opt = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : d; };
const proj = path.resolve(a.find(x => !x.startsWith('--')) || '.');
const reel = JSON.parse(fs.readFileSync(path.join(proj, 'reel.json'), 'utf8'));
let vars = reel.hook_variants || [];
if (opt('only')) { const keep = new Set(opt('only').split(',')); vars = vars.filter(v => keep.has(String(v.id))); }
if (!vars.length) { console.error('No "hook_variants" in reel.json (or none matched --only).'); process.exit(1); }
const slug = (reel.slug || reel.title || path.basename(proj)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const run = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false }); if (r.status !== 0) throw new Error(`${cmd} failed`); };

const results = [];
for (const v of vars) {
  const id = String(v.id || results.length + 2);
  const dir = path.join(proj, 'variants', `hook-${id}`);
  fs.mkdirSync(path.join(dir, 'build'), { recursive: true });
  const r2 = JSON.parse(JSON.stringify(reel));
  delete r2.hook_variants;
  r2.slug = `${slug}-hook-${id}`;
  const first = { ...r2.scenes[0], ...JSON.parse(JSON.stringify(v)) }; delete first.id; first.id = r2.scenes[0].id;
  r2.scenes[0] = first;
  if (r2.cover && (!r2.cover.scene || r2.cover.scene === first.id)) delete r2.cover;            // cover from the variant's own hook
  fs.writeFileSync(path.join(dir, 'reel.json'), JSON.stringify(r2, null, 1));
  // reuse everything already made: art (incl. AI images), voice clips + timings (only the new hook is voiced again)
  if (fs.existsSync(path.join(proj, 'art'))) fs.cpSync(path.join(proj, 'art'), path.join(dir, 'art'), { recursive: true });
  for (const sub of ['vo', 'vo_raw']) if (fs.existsSync(path.join(proj, 'build', sub))) fs.cpSync(path.join(proj, 'build', sub), path.join(dir, 'build', sub), { recursive: true });
  if (fs.existsSync(path.join(proj, 'build', 'timings.json'))) fs.copyFileSync(path.join(proj, 'build', 'timings.json'), path.join(dir, 'build', 'timings.json'));
  for (const f of ['.env']) if (fs.existsSync(path.join(proj, f))) fs.copyFileSync(path.join(proj, f), path.join(dir, f));
  console.log(`\n=== hook ${id}: ${first.vo}`);
  run(pythonCmd() || 'python', [path.join(HERE, 'voiceover.py'), dir]);
  if (opt('after-vo')) { const c = opt('after-vo').replace('{dir}', dir); const r = spawnSync(c, { stdio: 'inherit', shell: true }); if (r.status !== 0) throw new Error('after-vo command failed'); }
  run('node', [path.join(HERE, 'render.mjs'), dir]);
  const outV = path.join(dir, 'out', `${r2.slug}.mp4`);
  if (fs.existsSync(outV)) {
    fs.mkdirSync(path.join(proj, 'out'), { recursive: true });
    fs.copyFileSync(outV, path.join(proj, 'out', `${r2.slug}.mp4`));
    if (fs.existsSync(path.join(dir, 'out', 'cover.png'))) fs.copyFileSync(path.join(dir, 'out', 'cover.png'), path.join(proj, 'out', `cover-hook-${id}.png`));
    results.push({ id, hook: first.vo, video: path.join(proj, 'out', `${r2.slug}.mp4`) });
  }
}
console.log('\nHook variants ready (post them as separate tests, same caption, compare 3-second hold / average watch time):');
for (const r of results) console.log(`  ${r.id}: ${r.video}\n     "${r.hook}"`);
