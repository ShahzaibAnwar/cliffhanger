#!/usr/bin/env python3
"""Cliffhanger voiceover: one TTS clip per scene + word timings.

    python voiceover.py <project-dir>                 # synthesize (cached; only changed lines are re-generated)
    python voiceover.py <project-dir> --force         # ignore cache
    python voiceover.py <project-dir> --voice <id>    # use this ElevenLabs voice (must be in your saved list)
    python voiceover.py --list-my-voices              # voices saved in settings (* = default)
    python voiceover.py --list-voices [elevenlabs|edge] [--lang hi]

Defaults come from settings.json (edit with: node scripts/settings.mjs); reel.json "voice" overrides them.

Provider is chosen by reel.json -> voice.provider: "elevenlabs" | "edge" | "auto" (default).
"auto" uses ElevenLabs when ELEVENLABS_API_KEY is set, otherwise free Microsoft Edge neural voices.
Writes build/vo/<scene>.mp3 and build/timings.json  {provider, scenes:{id:{file,duration,words:[{w,s,e}]}}}
"""
import asyncio, base64, hashlib, json, os, subprocess, sys, urllib.request, urllib.error

ELEVEN_DEFAULT_VOICE = "nPczCjzI2devNBz1zQrb"   # "Brian" premade: deep, documentary narrator
ELEVEN_DEFAULT_MODEL = "eleven_multilingual_v2"
EDGE_DEFAULT_VOICE = "en-US-AndrewMultilingualNeural"


def die(msg):
    print("ERROR: " + msg, file=sys.stderr)
    sys.exit(1)


def load_env_file(proj):
    """Allow a .env next to reel.json (never commit it)."""
    for p in (os.path.join(proj, ".env"), os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")):
        if os.path.exists(p):
            for line in open(p, encoding="utf-8"):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


SKILL_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))


def _merge(a, b):
    if isinstance(a, dict) and isinstance(b, dict):
        out = dict(a)
        for k, v in b.items():
            out[k] = _merge(a.get(k), v) if k in a else v
        return out
    return a if b is None else b


def load_settings():
    """settings.example.json <- settings.json (user's, git-ignored). Edit via: node scripts/settings.mjs"""
    s = {}
    for name in ("settings.example.json", os.environ.get("CLIFFHANGER_SETTINGS") or "settings.json"):
        p = name if os.path.isabs(name) else os.path.join(SKILL_DIR, name)
        if os.path.exists(p):
            s = _merge(s, json.load(open(p, encoding="utf-8")))
    return s


def probe_duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
                       capture_output=True, text=True)
    return float(r.stdout.strip())


# ---------------- ElevenLabs ----------------
def eleven_request(method, url, body=None):
    key = os.environ.get("ELEVENLABS_API_KEY")
    req = urllib.request.Request(url, method=method, headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "application/json"},
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise ElevenError(e.code, e.read().decode(errors="replace")[:800])


class ElevenError(Exception):
    def __init__(self, code, body):
        super().__init__(f"ElevenLabs {code}: {body}")
        self.code, self.body = code, body


def eleven_tts(text, cfg, out_mp3, prev_text=None, next_text=None):
    voice = cfg.get("voice_id", ELEVEN_DEFAULT_VOICE)
    model = cfg.get("model_id", ELEVEN_DEFAULT_MODEL)
    body = {
        "text": text,
        "model_id": model,
        "voice_settings": {
            "stability": cfg.get("stability", 0.38),
            "similarity_boost": cfg.get("similarity_boost", 0.8),
            "style": cfg.get("style", 0.35),
            "use_speaker_boost": cfg.get("use_speaker_boost", True),
            "speed": cfg.get("speed", 1.05),
        },
    }
    if cfg.get("language_code"):
        body["language_code"] = cfg["language_code"]
    if cfg.get("stitch", not model.startswith("eleven_v3")):   # request stitching keeps prosody continuous across scenes
        if prev_text:
            body["previous_text"] = prev_text
        if next_text:
            body["next_text"] = next_text
    fmt = cfg.get("output_format", "mp3_44100_128")
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps?output_format={fmt}"
    # Newer/other models may reject request stitching or some voice settings: retry with less.
    fallbacks = [lambda b: b,
                 lambda b: {k: v for k, v in b.items() if k not in ("previous_text", "next_text")},
                 lambda b: {**{k: v for k, v in b.items() if k not in ("previous_text", "next_text")},
                            "voice_settings": {k: b["voice_settings"][k] for k in ("stability", "similarity_boost")}}]
    res, err = None, None
    for i, fb in enumerate(fallbacks):
        try:
            res = eleven_request("POST", url, fb(body))
            if i:
                print(f"  ! {model} rejected some options; used a simpler request")
            break
        except ElevenError as e:
            err = e
            if e.code == 404 or "voice_not_found" in e.body:
                die(f"ElevenLabs can't use voice {voice}. If it's a Voice Library voice, open the settings page "
                    f"(node scripts/settings.mjs) → Check on ElevenLabs → Add to My Voices.")
            if e.code in (401, 403):
                die(f"ElevenLabs refused the key ({e.code}): {e.body[:300]}")
            if e.code not in (400, 422):
                die(str(e))
    if res is None:
        die(str(err))
    with open(out_mp3, "wb") as f:
        f.write(base64.b64decode(res["audio_base64"]))
    al = res.get("alignment") or res.get("normalized_alignment") or {}
    chars, st, en = al.get("characters", []), al.get("character_start_times_seconds", []), al.get("character_end_times_seconds", [])
    words, cur = [], None
    for c, s, e in zip(chars, st, en):
        if c.isspace():
            if cur:
                words.append(cur)
                cur = None
            continue
        if cur is None:
            cur = {"w": c, "s": s, "e": e}
        else:
            cur["w"] += c
            cur["e"] = e
    if cur:
        words.append(cur)
    return words


# ---------------- Edge (free) ----------------
async def _edge(text, cfg, out_mp3):
    import edge_tts
    kw = dict(voice=cfg.get("voice", EDGE_DEFAULT_VOICE), rate=cfg.get("rate", "+6%"))
    if cfg.get("pitch"):
        kw["pitch"] = cfg["pitch"]
    try:
        return await _edge_once(edge_tts, text, kw, out_mp3)
    except edge_tts.exceptions.NoAudioReceived:
        if "pitch" not in kw:
            raise
        print("  ! edge rejected pitch setting, retrying without it")
        kw.pop("pitch")
        return await _edge_once(edge_tts, text, kw, out_mp3)


async def _edge_once(edge_tts, text, kw, out_mp3):
    try:
        com = edge_tts.Communicate(text, boundary="WordBoundary", **kw)
    except TypeError:
        com = edge_tts.Communicate(text, **kw)
    words = []
    with open(out_mp3, "wb") as f:
        async for ch in com.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                s = ch["offset"] / 1e7
                words.append({"w": ch["text"], "s": s, "e": s + ch["duration"] / 1e7})
    return words


def edge_tts_synth(text, cfg, out_mp3):
    try:
        import edge_tts  # noqa: F401
    except ImportError:
        die("edge-tts not installed. Run: python -m pip install edge-tts   (or set ELEVENLABS_API_KEY)")
    import time
    for attempt in range(5):                 # the free service throttles bursts; back off and retry
        try:
            return asyncio.run(_edge(text, cfg, out_mp3))
        except Exception as e:
            if attempt == 4:
                die(f"edge-tts failed after retries: {type(e).__name__}: {e}")
            wait = 3 * (attempt + 1)
            print(f"  ! edge-tts {type(e).__name__}, retrying in {wait}s")
            time.sleep(wait)


# ---------------- main ----------------
def list_voices(which, lang):
    if which == "elevenlabs":
        if not os.environ.get("ELEVENLABS_API_KEY"):
            die("ELEVENLABS_API_KEY not set")
        res = eleven_request("GET", "https://api.elevenlabs.io/v1/voices")
        for v in res.get("voices", []):
            lab = v.get("labels", {})
            print(f"{v['voice_id']}  {v['name']:<22} {lab.get('gender','')}/{lab.get('age','')}/{lab.get('accent','')}  {lab.get('use_case', lab.get('description',''))}")
    else:
        import edge_tts
        vs = asyncio.run(edge_tts.list_voices())
        for v in vs:
            if lang and not v["Locale"].lower().startswith(lang.lower()):
                continue
            print(f"{v['ShortName']:<36} {v['Gender']:<7} {', '.join(v.get('VoiceTag', {}).get('VoicePersonalities', []))}")


def main():
    for stream in (sys.stdout, sys.stderr):      # Windows consoles default to cp1252
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    a = sys.argv[1:]
    if "--list-voices" in a:
        rest = [x for x in a if not x.startswith("--")]
        lang = a[a.index("--lang") + 1] if "--lang" in a else None
        load_env_file(os.getcwd())
        list_voices(rest[0] if rest else ("elevenlabs" if os.environ.get("ELEVENLABS_API_KEY") else "edge"), lang)
        return
    settings = load_settings()
    svoice = settings.get("voice", {})
    sel = svoice.get("elevenlabs", {})
    my_voices = sel.get("voices", [])
    if "--list-my-voices" in a:
        for v in my_voices:
            star = "*" if v["voice_id"] == sel.get("default_voice_id") else " "
            print(f"{star} {v['voice_id']}  {v.get('name',''):<24} {v.get('language',''):<12} {v.get('notes','')}")
        if not my_voices:
            print("(no voices saved — add some with: node scripts/settings.mjs)")
        return
    rest = [x for i, x in enumerate(a) if not x.startswith("--") and (i == 0 or a[i - 1] != "--voice")]
    proj = os.path.abspath(rest[0] if rest else ".")
    force = "--force" in a
    load_env_file(proj)
    reel = json.load(open(os.path.join(proj, "reel.json"), encoding="utf-8"))
    vcfg = reel.get("voice", {})
    provider = vcfg.get("provider") or svoice.get("provider", "auto")
    if provider == "auto":
        provider = "elevenlabs" if os.environ.get("ELEVENLABS_API_KEY") else "edge"
    if provider == "elevenlabs" and not os.environ.get("ELEVENLABS_API_KEY"):
        die("voice provider is 'elevenlabs' but ELEVENLABS_API_KEY is not set (settings page, env var, or .env).")
    if provider == "elevenlabs":
        base = {k: v for k, v in sel.items() if k not in ("voices", "default_voice_id")}
        base["voice_id"] = sel.get("default_voice_id") or ELEVEN_DEFAULT_VOICE
        pcfg = _merge(base, vcfg.get("elevenlabs", {}))
        if "--voice" in a:
            pcfg["voice_id"] = a[a.index("--voice") + 1]
        allowed = {v["voice_id"]: v for v in my_voices}
        if svoice.get("only_my_voices", True) and allowed and pcfg["voice_id"] not in allowed:
            choices = ", ".join("%s (%s)" % (k, v.get("name", "")) for k, v in allowed.items())
            die(f"voice {pcfg['voice_id']} is not in your saved voices (settings: only_my_voices). Use one of: {choices}")
        name = allowed.get(pcfg["voice_id"], {}).get("name", "")
        print(f"ElevenLabs voice: {pcfg['voice_id']} {name}  model: {pcfg.get('model_id', ELEVEN_DEFAULT_MODEL)}")
    else:
        pcfg = _merge(svoice.get("edge", {}), vcfg.get("edge", {}))
        print(f"Edge voice: {pcfg.get('voice', EDGE_DEFAULT_VOICE)}")
    vo_dir = os.path.join(proj, "build", "vo")
    os.makedirs(vo_dir, exist_ok=True)
    tpath = os.path.join(proj, "build", "timings.json")
    old = json.load(open(tpath, encoding="utf-8")) if os.path.exists(tpath) else {"scenes": {}}
    scenes = reel["scenes"]
    out = {"provider": provider, "scenes": {}}
    lines = [(s.get("id") or f"s{i+1}", (s.get("vo") or "").strip()) for i, s in enumerate(scenes)]
    total = 0.0
    for i, (sid, text) in enumerate(lines):
        if not text:
            continue
        prev_t = " ".join(t for _, t in lines[max(0, i - 2):i] if t) or None
        next_t = " ".join(t for _, t in lines[i + 1:i + 2] if t) or None
        say = scenes[i].get("vo_tts") or text           # optional pronunciation-only override
        h = hashlib.sha1(json.dumps([provider, pcfg, say, prev_t if provider == "elevenlabs" else None], sort_keys=True).encode()).hexdigest()[:16]
        mp3 = os.path.join(vo_dir, f"{sid}.mp3")
        rel = os.path.relpath(mp3, proj).replace("\\", "/")
        cached = old["scenes"].get(sid)
        if not force and cached and cached.get("hash") == h and os.path.exists(mp3):
            out["scenes"][sid] = cached
            total += cached["duration"]
            print(f"  = {sid} cached ({cached['duration']:.2f}s)")
            continue
        if provider == "elevenlabs":
            words = eleven_tts(say, pcfg, mp3, prev_t, next_t)
        else:
            words = edge_tts_synth(say, pcfg, mp3)
        dur = probe_duration(mp3)
        out["scenes"][sid] = {"file": rel, "duration": round(dur, 3), "hash": h, "words": [{"w": w["w"], "s": round(w["s"], 3), "e": round(w["e"], 3)} for w in words]}
        total += dur
        print(f"  + {sid} {dur:.2f}s  {len(words)} words  | {text[:60]}")
        json.dump({**old, **out, "scenes": {**old["scenes"], **out["scenes"]}}, open(tpath, "w", encoding="utf-8"), ensure_ascii=False, indent=1)  # checkpoint
    json.dump(out, open(tpath, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"voiceover: {provider}, {len(out['scenes'])} clips, {total:.1f}s of speech -> {tpath}")


if __name__ == "__main__":
    main()
