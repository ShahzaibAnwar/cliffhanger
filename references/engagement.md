# Engagement: what measurably keeps viewers (and what's folklore)

`render.mjs --stills` scores every video against the checkable rules below ("Engagement check: 8/9").
No rule guarantees a viral video: distribution depends on the topic, timing and the audience's response.
These rules remove the things that reliably lose viewers. Tags: **[S]** strong evidence (peer-reviewed
or large sample) · **[P]** platform guidance · **[C]** common practice, no published evidence.
Research summary dated November 2026.

## The checklist (checked automatically where marked ✓)

**Hook**
1. ✓ Narration starts by 0.5 s, the headline is on screen and something moves by 1 s. No logo, title card
   or silence at the start. People recall feed content after 0.25 s; on mobile they spend ~1.7 s per item. [S] (M1)
2. ✓ The first line states the why/how question or the surprising claim, short (best ~9 words in
   informational niches). Curiosity gaps and urgency beat "how to"/"you need to" phrasing. [S, single preprint] (MI)
3. Instagram's Reels model predicts whether a viewer watches less than 3 s; YouTube shows "stayed to watch
   vs swiped away". No platform publishes a target percentage. [P] (MT, YT1)

**Pacing**
4. ✓ A new visual (cut, illustration or large motion) every 2.5–4 s; nothing held over 5 s (8 s on 16:9
   long-form); average shot not under 2 s. Measured TikToks average one cut per ~2.7 s; in a 242-viewer
   experiment, ~1.9 s per shot cancelled the gain in continued watching, which peaked at 3–5 s. [S] (DH)
5. Connect consecutive shots (same object, a word that bridges): unrelated cuts cost attention and recall. [S] (L)

**Length and signals**
6. ✓ 45–60 s for reels; past 3:00, Reels aren't recommended to non-followers (and 3:00 is the Shorts cap). [P] (IG3, YT2)
   Correlational data: Reels 45–60 s had the best engagement rate; TikToks over 60 s got more reach. [S] (SI, BU)
7. Platforms rank on watch time/completion, likes per reach and **sends per reach** (shares to friends
   matter most for reaching non-followers). Build a payoff worth sending. [P] (TT1, IG1, IG2)

**Sound and text**
8. Narration always on: Instagram shows muted, text-only, bordered, watermarked or reposted Reels less. [P] (IG1)
9. It must still work on mute: the headline carries the core claim. Captions help completion (self-report
   and ad data, moderate evidence). [P/S] (VZ, MC)
10. ✓ Headlines are short keywords, not the narration word for word: identical on-screen text hurts learning.
    Burned-in subtitles: ≤ 20 characters/s, ≤ 2 lines. [S] (RD, NF)
11. ✓ Narration 160–190 words/min (flag under 140 or over 210); trim pauses (`tighten.py`). [S] (GU, RO)

**Endings**
12. ✓ End on the new, related question Part 2 will answer (last ≤ 5 s); Part 2 must answer it. The urge to
    resume an unfinished story replicates; the "Zeigarnik memory boost" doesn't. [S psychology / C for series] (ZG)
13. One short CTA (≤ 3 s), no "comment YES" bait. [P/C] (TT2)

**Originality (monetization)**
14. Original narration and visuals per video; vary the hook template across episodes. YouTube excludes
    repetitive/mass-produced content from monetization (Jul 2025); Instagram reduces reach for reposts. [P] (YT3, IG4)
15. Drawn, step-by-step explanation beats slide-style frames (1.5–2× engagement in lecture video data). [S] (GU)

**Long-form YouTube (16:9)**
16. Deliver the title's promise in the first 30 s (YouTube shows the share still watching at 0:30). [P] (YT4)
17. Chapters: first at 0:00, at least 3, each ≥ 10 s (`chapters.txt` is checked). [P] (YT5)
18. ✓ End screens run 5–20 s in the final 20 s: give the end card `"min": 18`. [P] (YT6)

## Myths to avoid
- "85% watch muted": a 2016 Facebook-publisher figure. TikTok/Reels are sound-on, and muted Reels are shown less.
- "Faster cuts are always better": pacing vs memory is an inverted U; ~1.9 s per shot reduced continued watching.
- "Open loops make viewers remember (Zeigarnik)": the memory effect doesn't replicate (the urge to resume does).
- "7–15 s loops win": large datasets favour 30–60+ s.
- "Swipe-away above X% kills a Short": YouTube publishes no threshold.
- "Shorts views = people who watched": since 31 Mar 2025 every start or replay counts as a view.

## Sources
M1 Meta Foresight, Capturing Attention in Feed — https://www.facebook.com/business/news/insights/capturing-attention-feed-video-creative ·
MT Meta, Instagram Reels ranking system card — https://transparency.meta.com/features/explaining-ranking/ig-reels/ ·
IG1 Instagram Ranking Explained — https://about.instagram.com/blog/announcements/instagram-ranking-explained ·
IG2 Mosseri on top signals (Social Media Today, 2025) — https://www.socialmediatoday.com/news/instagram-shares-algorithm-insights-2025/738034/ ·
IG3 Instagram, Tips for Improving Your Reach — https://creators.instagram.com/blog/tips-for-improving-your-reach ·
IG4 Instagram Original Content Guidelines — https://creators.instagram.com/original-content-guidelines ·
TT1 TikTok, How TikTok recommends videos — https://newsroom.tiktok.com/how-tiktok-recommends-videos-for-you?lang=en ·
TT2 TikTok Creative Codes — https://ads.tiktok.com/business/en-US/blog/creative-best-practices-top-performing-ads ·
YT1 YouTube, change to how Shorts views are counted — https://support.google.com/youtube/thread/333869549 ·
YT2 YouTube, Tall updates coming to Shorts — https://blog.youtube/news-and-events/tall-updates-coming-to-shorts/ ·
YT3 YouTube monetization policies — https://support.google.com/youtube/answer/1311392 ·
YT4 YouTube key moments for audience retention — https://support.google.com/youtube/answer/9314415 ·
YT5 YouTube video chapters — https://support.google.com/youtube/answer/9884579 ·
YT6 YouTube end screens — https://support.google.com/youtube/answer/6388789 ·
DH Dost & Huang (2026), jump cuts and transition frequency — https://archives.marketing-trends-congress.com/2026/PDF/paper_professor_DOST_HUANG.pdf ·
L Lang et al. (1999), production pacing — https://www.tandfonline.com/doi/abs/10.1080/08838159909364504 ·
MI Mishra (2025), The Science of the First Three Seconds — https://doi.org/10.31235/osf.io/rj2mz_v1 ·
BU Buffer, Longer TikToks Get More Views — https://buffer.com/resources/longer-tiktoks-get-more-views-data/ ·
SI Socialinsider, Reels length — https://www.socialinsider.io/blog/instagram-reels-length/ ·
VZ Verizon Media/Publicis survey (Forbes, 2019) — https://www.forbes.com/sites/tjmccue/2019/07/31/verizon-media-says-69-percent-of-consumers-watching-video-with-sound-off/ ·
MC Meta, captioned video ads — https://business.meta.com/news/updated-features-for-video-ads/ ·
RD Two types of redundancy in multimedia learning — https://pmc.ncbi.nlm.nih.gov/articles/PMC10192876/ ·
NF Netflix Timed Text Style Guide — https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide ·
GU Guo, Kim & Rubin (2014), MOOC video engagement — https://up.csail.mit.edu/other-pubs/las2014-pguo-engagement.pdf ·
RO Speech rate and comprehension — https://www.sciencedirect.com/science/article/pii/S0271530925000709 ·
ZG Ghibellini & Meier (2025), Zeigarnik/Ovsiankina meta-analysis — https://www.nature.com/articles/s41599-025-05000-w

## Your own numbers beat general rules
After 5–10 videos, `analytics.mjs report` shows what holds *your* audience (hook types, looks, lengths, scene types).
When it disagrees with the general rules above, follow your own data, and keep testing (hook variants, `variants.mjs`).
