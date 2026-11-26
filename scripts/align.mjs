/* Subtitle words: the script's own tokens (vo) on the timing of what the voice actually said (vo_tts or vo).
   alignWords("In 2007, WonderByte.", [{w:'IN'},{w:'TWO'},{w:'THOUSAND'},{w:'SEVEN'},{w:'Wonder'},{w:'Byte'}] with s/e)
   → [{w:'In'},{w:'2007,'},{w:'WonderByte.'}] — numbers, joined/split words and re-spellings line up. */
const nzw = x => String(x).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
const NUMW = new Set('zero oh a one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion and point percent per cent first second third fourth fifth sixth seventh eighth ninth tenth twentieth hundredth thousandth th st nd rd minus degrees dollars dollar euros pounds rupees celsius fahrenheit kelvin kilometres kilometers km metres meters miles kg grams years'.split(' '));
export function alignWords(voText, spoken) {
  const toks = String(voText).split(/\s+/).filter(Boolean), N = toks.length, M = spoken.length;
  if (!N || !M) return spoken;
  const tn = toks.map(nzw), sn = spoken.map(w => nzw(w.w));
  const cost = (i, m, j, n) => {            // vo toks[i..i+m) ↔ spoken[j..j+n)
    const a = tn.slice(i, i + m).join(''), b = sn.slice(j, j + n).join('');
    if (a === b) return m === 1 && n === 1 ? 0 : 0.05;
    if (m === 1 && n === 1 && a && b && (a.startsWith(b) || b.startsWith(a)) && Math.min(a.length, b.length) >= 3) return 0.3;
    const sp = spoken.slice(j, j + n).map(w => String(w.w).toLowerCase().replace(/[^a-z]/g, ''));
    const hasDigit = /\d/.test(toks.slice(i, i + m).join(''));
    if (hasDigit && sp.filter(x => NUMW.has(x)).length * 2 >= n) return 0.2 + 0.01 * n;
    if (hasDigit && m === 1) { const al = a.replace(/\d+/g, ''); if (al.length >= 3 && b.startsWith(al) && NUMW.has(sp[sp.length - 1])) return 0.3 + 0.01 * n; }   // "Foton-M3" ← "Foton M three"
    return Math.max(m, n) + (m !== n ? 0.5 : 0);   // positional fallback (a re-spelled word stays 1:1)
  };
  const INF = 1e9, dp = Array.from({ length: N + 1 }, () => new Float64Array(M + 1).fill(INF)), bk = Array.from({ length: N + 1 }, () => new Array(M + 1));
  dp[0][0] = 0;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= M; j++) {
    if (dp[i][j] >= INF) continue;
    for (let m = 1; m <= 3 && i + m <= N; m++) for (let n = 1; n <= 9 && j + n <= M; n++) {
      if (m > 1 && n > 1 && m + n > 4) continue;
      const c = dp[i][j] + cost(i, m, j, n);
      if (c < dp[i + m][j + n]) { dp[i + m][j + n] = c; bk[i + m][j + n] = [m, n]; }
    }
  }
  if (dp[N][M] >= INF) return spoken;
  const out = []; let i = N, j = M;
  while (i > 0 && j > 0) {
    const [m, n] = bk[i][j], s0 = spoken[j - n].s, e0 = spoken[j - 1].e;
    for (let k = m - 1; k >= 0; k--) out.unshift({ w: toks[i - m + k], s: s0 + (e0 - s0) * k / m, e: s0 + (e0 - s0) * (k + 1) / m });
    i -= m; j -= n;
  }
  return out;
}
