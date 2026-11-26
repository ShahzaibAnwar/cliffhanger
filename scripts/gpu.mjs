/* GPU first: dedicated GPU → integrated graphics → CPU. Shared by render.mjs and doctor.mjs.
   The browser draws on the high-performance (dedicated) GPU, and the encoder is chosen by a real test encode:
     1. dedicated GPU       NVIDIA NVENC → AMD AMF → Apple VideoToolbox (macOS)
     2. integrated graphics Intel Quick Sync → VAAPI (Linux) → Windows Media Foundation
     3. CPU                 libx264
   Override with settings.render.gpu or env CLIFFHANGER_GPU: auto (default) | nvidia | amd | apple | intel | off. */
import { spawnSync } from 'node:child_process';

export function gpuPref(settings = {}) { return String(process.env.CLIFFHANGER_GPU || settings.render?.gpu || 'auto').toLowerCase(); }
export function browserGpuArgs(GPU) {
  return GPU === 'off' ? [] : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-zero-copy',
    ...(GPU === 'intel' ? [] : ['--force_high_performance_gpu']), ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])];
}
export function pickEncoder(prev, GPU = 'auto') {
  const q = prev ? { x: '24', hw: '26', rate: '4M' } : { x: '19', hw: '20', rate: '8M' };
  const cands = {
    nvidia: { name: 'h264_nvenc', args: ['-c:v', 'h264_nvenc', '-preset', prev ? 'p2' : 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', q.hw, '-b:v', '0', '-maxrate', q.rate, '-bufsize', '16M', '-profile:v', 'high', '-vf', 'scale=out_range=tv,format=yuv420p', '-color_range', 'tv'] },
    intel: { name: 'h264_qsv', args: ['-c:v', 'h264_qsv', '-preset', prev ? 'veryfast' : 'medium', '-global_quality', q.hw, '-vf', 'scale=out_range=tv,format=nv12', '-color_range', 'tv'] },
    amd: { name: 'h264_amf', args: ['-c:v', 'h264_amf', '-quality', prev ? 'speed' : 'quality', '-rc', 'qvbr', '-qvbr_quality_level', q.hw, '-maxrate', q.rate, '-bufsize', '16M', '-vf', 'scale=out_range=tv,format=yuv420p', '-color_range', 'tv'] },
    apple: { name: 'h264_videotoolbox', args: ['-c:v', 'h264_videotoolbox', '-q:v', prev ? '55' : '68', '-maxrate', q.rate, '-bufsize', '16M', '-profile:v', 'high', '-vf', 'scale=out_range=tv,format=yuv420p', '-color_range', 'tv'] },
    vaapi: { name: 'h264_vaapi', args: ['-vaapi_device', '/dev/dri/renderD128', '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-qp', q.hw] },
    mf: { name: 'h264_mf (Windows)', args: ['-c:v', 'h264_mf', '-hw_encoding', '1', '-rate_control', 'u_vbr', '-b:v', prev ? '4M' : '8M', '-vf', 'scale=out_range=tv,format=nv12', '-color_range', 'tv'] },
  };
  // tier order: dedicated GPU, then integrated graphics, then CPU
  const tiers = { darwin: ['apple', 'nvidia', 'amd', 'intel'], linux: ['nvidia', 'amd', 'intel', 'vaapi'], win32: ['nvidia', 'amd', 'intel', 'mf'] }[process.platform] || ['nvidia', 'amd', 'intel'];
  const cpu = { name: 'libx264 (CPU)', args: ['-c:v', 'libx264', '-preset', prev ? 'veryfast' : 'medium', '-crf', q.x, '-maxrate', q.rate, '-bufsize', '16M', '-vf', 'scale=out_range=tv,format=yuv420p', '-color_range', 'tv'] };
  if (GPU === 'off') return { ...cpu, why: [] };
  const order = GPU in cands ? [GPU, ...tiers.filter(k => k !== GPU)] : tiers;
  const why = [];
  for (const k of order) {      // a real 0.2 s test encode: listed encoders can still fail (old driver, no device)
    const t = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...(k === 'vaapi' ? cands[k].args.slice(0, 2) : []), '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.2', ...(k === 'vaapi' ? cands[k].args.slice(2) : cands[k].args), '-f', 'null', '-'], { encoding: 'utf8' });
    if (t.status === 0) return { ...cands[k], why };
    const lines = (t.stderr || '').split('\n');
    const msg = lines.find(l => /minimum required/i.test(l)) || lines.find(l => /driver|not supported|No device|Cannot load|failed/i.test(l)) || 'unavailable';
    if (k === 'nvidia' || k === 'amd' || k === 'apple' || /minimum required/i.test(msg)) why.push(`${cands[k].name}: ${msg.replace(/^\[[^\]]*\]\s*/, '').trim()}`);
  }
  return { ...cpu, why };
}

