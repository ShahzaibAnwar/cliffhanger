#!/usr/bin/env node
/* Learn from your own numbers. Lines each video's audience retention up with its scenes, then finds what works
   for YOUR audience across all videos, and writes learnings Claude reads before planning the next ones.

     node analytics.mjs retention <project> <file.csv>     import a retention curve (YouTube Studio export, or any
                                                            CSV with a time/position column and a retention % column)
     node analytics.mjs add <project> --views 12000 --avg 23.5 --likes 800 --shares 140 --saves 90 --comments 35 --follows 60
                                                            numbers from Instagram / TikTok / YouTube insights (any subset)
     node analytics.mjs point <project> 3=78 10=55 30=41    retention read off a screenshot: seconds=percent pairs
     node analytics.mjs show <project>                      where viewers left, scene by scene
     node analytics.mjs report [workspace]                  patterns across all videos → <workspace>/learnings.md (+ .json)

   Needs the video's timeline: render.mjs writes out/timeline.json on every render.
   No account connections: you export or read the numbers; nothing is sent anywhere. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings } from './settings-lib.mjs';

const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const A = proj => path.join(proj, 'analytics.json');
const load = proj => readJson(A(proj)) || { retention: [], metrics: {} };
const save = (proj, d) => { d.updated = new Date().toISOString(); fs.writeFileSync(A(proj), JSON.stringify(d, null, 1)); };
const timeline = proj => readJson(path.join(proj, 'out', 'timeline.json')) || readJson(path.join(proj, 'build', 'timeline.json'));

// CSV: find a position column (seconds, mm:ss or % of the video) and a retention column (%)
export function parseRetention(text, total) {
  const rows = text.trim().split(/\r?\n/).map(l => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim()));
  const head = rows.shift().map(h => h.toLowerCase());
  let ti = head.findIndex(h => /position|time|second|moment|elapsed/.test(h)); if (ti < 0) ti = 0;
  let ri = head.findIndex((h, i) => i !== ti && /retention|audience|watching|viewers|%/.test(h)); if (ri < 0) ri = ti === 0 ? 1 : 0;
  const isPct = /%|percent/.test(head[ti]) && !/sec/.test(head[ti]);
  const toS = v => { if (/:/.test(v)) { const p = v.split(':').map(Number); return p.reduce((a, b) => a * 60 + b, 0); } const n = parseFloat(v); return isPct ? n / 100 * total : n; };
  const pts = rows.map(r => ({ t: toS(r[ti]), r: parseFloat(String(r[ri]).replace('%', '')) })).filter(p => isFinite(p.t) && isFinite(p.r));
  const scale = Math.max(...pts.map(p => p.r)) <= 1.5 ? 100 : 1;               // 0..1 fractions → %
  return pts.map(p => ({ t: +p.t.toFixed(2), r: +(p.r * scale).toFixed(1) })).sort((a, b) => a.t - b.t);
}
const at = (curve, t) => {                     // retention % at time t (linear between points)
  if (!curve.length) return null;
  if (t <= curve[0].t) return curve[0].r;
  for (let i = 1; i < curve.length; i++) if (t <= curve[i].t) { const a = curve[i - 1], b = curve[i]; return a.r + (b.r - a.r) * (t - a.t) / Math.max(1e-6, b.t - a.t); }
  return curve[curve.length - 1].r;
};

// per scene: % of viewers lost while it was on screen, per second (so long and short scenes compare fairly)
export function perScene(proj) {
  const tl = timeline(proj), d = load(proj);
  if (!tl || !d.retention.length) return null;
  const rows = tl.scenes.map(s => {
    const r0 = at(d.retention, s.start), r1 = at(d.retention, s.end);
    return { ...s, r0, r1, lost: +(r0 - r1).toFixed(1), lost_per_s: +((r0 - r1) / Math.max(0.5, s.end - s.start)).toFixed(2) };
  });
  return { total: tl.total, hook3: at(d.retention, 3), end: at(d.retention, tl.total - 0.5), rows };
}

function show(proj) {
  const p = perScene(proj), d = load(proj);
  if (!p) { console.log('Need both out/timeline.json (render once) and retention data (analytics.mjs retention/point).'); return; }
  console.log(`${path.basename(proj)}: still watching at 3 s ${p.hook3?.toFixed(0)}% · at the end ${p.end?.toFixed(0)}%${d.metrics.avg ? ` · average watch ${d.metrics.avg}s of ${p.total.toFixed(0)}s` : ''}`);
  const worst = [...p.rows].sort((a, b) => b.lost_per_s - a.lost_per_s).slice(0, 3).map(r => r.id);
  for (const r of p.rows) console.log(`  ${worst.includes(r.id) ? '✘' : ' '} ${r.start.toFixed(1).padStart(5)}s ${r.id.padEnd(12)} ${String(r.r0?.toFixed(0)).padStart(3)}% → ${String(r.r1?.toFixed(0)).padStart(3)}%  (-${r.lost_per_s}/s)  ${r.visual || ''} ${r.headline ? '· ' + r.headline : ''}`);
  console.log(`biggest drops: ${worst.join(', ')} → look at what those scenes show and say`);
}

// ---------- patterns across every video in a workspace ----------
function report(ws) {
  const vids = [];
  for (const dname of fs.readdirSync(ws, { withFileTypes: true })) {
    if (!dname.isDirectory()) continue;
    const proj = path.join(ws, dname.name), d = readJson(A(proj)), tl = timeline(proj);
    if (!d || !tl) continue;
    const p = perScene(proj);
    vids.push({ name: dname.name, tl, d, p });
  }
  if (!vids.length) { console.log('No videos with analytics yet. Import some with: node analytics.mjs retention|add|point <project> ...'); return; }
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null, fmt = x => x == null ? '–' : x.toFixed(1);
  const group = (keyFn, valFn) => { const g = {}; for (const v of vids) { const k = keyFn(v), val = valFn(v); if (k == null || val == null) continue; (g[k] ||= []).push(val); } return Object.entries(g).map(([k, a]) => ({ k, n: a.length, avg: mean(a) })).sort((a, b) => b.avg - a.avg); };
  const hookKind = v => { const l = String(v.tl.hook || ''); return /\?\s*$/.test(l) ? 'question' : /\d/.test(l) ? 'number/stat' : /\b(you|your)\b/i.test(l) ? 'talks to "you"' : 'statement'; };
  const lenBand = v => v.tl.total < 40 ? 'under 40 s' : v.tl.total <= 60 ? '40–60 s' : v.tl.total <= 90 ? '60–90 s' : 'over 90 s';
  const hook = vids.map(v => v.p?.hook3).filter(x => x != null), endR = vids.map(v => v.p?.end).filter(x => x != null);
  const shareRate = v => v.d.metrics.views && v.d.metrics.shares != null ? v.d.metrics.shares / v.d.metrics.views * 1000 : null;
  const sceneTypes = {};
  for (const v of vids) for (const r of v.p?.rows || []) (sceneTypes[r.visual || 'other'] ||= []).push(r.lost_per_s);
  const types = Object.entries(sceneTypes).map(([k, a]) => ({ k, n: a.length, avg: mean(a) })).filter(x => x.n >= 2).sort((a, b) => a.avg - b.avg);
  const L = {
    videos: vids.length, hook3_avg: mean(hook), end_avg: mean(endR),
    by_hook: group(hookKind, v => v.p?.hook3), by_look: group(v => v.tl.look || 'case-file', v => v.p?.end), by_length: group(lenBand, v => v.p?.end),
    by_captions: group(v => v.tl.captions || 'none', v => v.p?.end), shares_per_1k: group(v => v.tl.look || 'case-file', shareRate),
    scene_types_best: types.slice(0, 4), scene_types_worst: types.slice(-4).reverse(),
  };
  const lines = [`# What works for this audience (${vids.length} video${vids.length > 1 ? 's' : ''})`, '',
    `Updated ${new Date().toISOString().slice(0, 10)} by analytics.mjs. Read this before planning new ideas and scripts.`,
    vids.length < 5 ? `\n> Only ${vids.length} video(s): treat these as hints, not rules. Patterns get reliable from about 10 videos.` : '', '',
    `- Still watching at 3 s: **${fmt(L.hook3_avg)}%** on average · at the end: **${fmt(L.end_avg)}%**`, ''];
  const tbl = (title, rows, unit) => { if (!rows.length) return; lines.push(`## ${title}`, '', ...rows.map(r => `- ${r.k}: ${fmt(r.avg)}${unit} (${r.n} video${r.n > 1 ? 's' : ''})`), ''); };
  tbl('Hook type → still watching at 3 s', L.by_hook, '%'); tbl('Look → still watching at the end', L.by_look, '%');
  tbl('Length → still watching at the end', L.by_length, '%'); tbl('Captions → still watching at the end', L.by_captions, '%');
  tbl('Shares per 1,000 views, by look', L.shares_per_1k, '');
  tbl('Scene types that hold viewers (lowest loss per second)', L.scene_types_best, '%/s'); tbl('Scene types that lose viewers', L.scene_types_worst, '%/s');
  const best = L.by_hook[0], worstType = L.scene_types_worst[0];
  lines.push('## Do more / do less', '');
  if (best && L.by_hook.length > 1) lines.push(`- Do more **${best.k}** hooks (best 3-second hold so far).`);
  if (L.by_look[0] && L.by_look.length > 1) lines.push(`- The **${L.by_look[0].k}** look keeps the most viewers to the end.`);
  if (worstType) lines.push(`- **${worstType.k}** scenes lose the most viewers per second: shorten them or add a beat.`);
  if (L.by_length[0] && L.by_length.length > 1) lines.push(`- **${L.by_length[0].k}** videos finish best.`);
  fs.writeFileSync(path.join(ws, 'learnings.md'), lines.filter(x => x !== undefined).join('\n') + '\n');
  fs.writeFileSync(path.join(ws, 'learnings.json'), JSON.stringify(L, null, 1));
  console.log(lines.join('\n')); console.log(`\n→ ${path.join(ws, 'learnings.md')}`);
}

function isMainModule(url) { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(url)); } catch { return false; } }
if (process.argv[1] && isMainModule(import.meta.url)) {
  const [cmd, projArg, ...rest] = process.argv.slice(2);
  const proj = projArg ? path.resolve(projArg) : null;
  if (cmd === 'retention') {
    const tl = timeline(proj); if (!tl) { console.error('Render the video first (out/timeline.json is missing).'); process.exit(1); }
    const curve = parseRetention(fs.readFileSync(path.resolve(rest[0]), 'utf8'), tl.total);
    const d = load(proj); d.retention = curve; save(proj, d); console.log(`${curve.length} retention points imported.`); show(proj);
  } else if (cmd === 'point') {
    const d = load(proj);
    for (const kv of rest) { const [t, r] = kv.split('=').map(parseFloat); if (isFinite(t) && isFinite(r)) d.retention.push({ t, r }); }
    d.retention.sort((a, b) => a.t - b.t); if (!d.retention.some(p => p.t === 0)) d.retention.unshift({ t: 0, r: 100 });
    save(proj, d); show(proj);
  } else if (cmd === 'add') {
    const d = load(proj);
    for (let i = 0; i < rest.length; i += 2) if (rest[i].startsWith('--')) d.metrics[rest[i].slice(2)] = isNaN(+rest[i + 1]) ? rest[i + 1] : +rest[i + 1];
    save(proj, d); console.log('metrics: ' + JSON.stringify(d.metrics));
  } else if (cmd === 'show') show(proj);
  else if (cmd === 'report') report(path.resolve(projArg || loadSettings().output?.projects_dir || '.'));
  else console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace('/*', '').trim());
}
