# Story engine

Decoded from high-retention faceless explainer reels (biology / body-horror / "why does this
happen" genre). The formula is not "explain a fact". It is: **make the viewer need the next sentence.**

## Idea engine

A strong idea sits where an everyday experience meets a hidden, slightly scary mechanism.

**Idea formulas**
1. *Relatable glitch* — "Why does X happen to you?" (mosquitoes pick you; you jerk awake; your eye twitches)
2. *Scarier than fiction* — "No horror movie is scarier than ___" (rabies, prions, brain-eating amoeba)
3. *Impossible comparison* — "X kills more than A and B combined" (mosquito vs snakes + sharks)
4. *Imagine this* — a second-person hypothetical with stakes ("An HIV+ person was just bitten... next it bites you")
5. *Myth trap* — "Everyone thinks ___ means ___. It doesn't." (hydrophobia ≠ fear of water)
6. *The body is a machine* — hijacks, puppets, radars, switches (virus drives the body, mosquito has 3 radars)
7. *Experiment story* — "In 2022 scientists put ___ in a box..." (Subject 33)

**Where to mine ideas**: "why do I…" autocomplete, r/askscience / r/explainlikeimfive top posts,
myth-buster lists, recent science news (last 30 days), comments on the user's own past reels
("do one on ___"), and every Part-2 cliffhanger you've already promised.

**Score each idea /25** (5 each): Relatability (has the viewer felt this?) · Stakes (death, pain,
disgust, money, status) · Visual-ability (can it be drawn as objects/diagrams?) · Series potential
(does the answer open another question?) · Fact-checkability (can you source the core claim?).
Ship ideas ≥ 18. Anything < 3 on fact-checkability is out.

**Series design**: plan in arcs of 2–3 parts. Part 1 ends on the arc's biggest question; Part 2
opens with "Remember part 1?" and pays it off, then opens the next. A public promise
("1 question every day for 365 days") turns one-off viewers into followers.

## Beat map (≈ 55 s)

| time | beat | job | example |
|---|---|---|---|
| 0–3 s | **Hook** | stop the scroll with stakes or a contradiction, *before* context | "7 lakh deaths every year — more than snakes and sharks combined." |
| 3–8 s | **Make it personal** | "you", "have you noticed", a scene the viewer has lived | "4 people in a room. The mosquito bites only you." |
| 8–15 s | **Myth / wrong answer** | let them hold the obvious answer, then take it away | "People think hydrophobia = fear of water. The truth is 10x scarier." |
| 15–35 s | **Mechanism, escalating** | 2–4 numbered steps, each a bigger reveal ("Radar 1… Radar 2…") | "Radar 1: your breath. Radar 2: body heat. Radar 3…" |
| 35–45 s | **Strangest part + proof** | the twist nobody expects + one hard number / named study | "Subject 33 attracted up to 100x more. 3 years later — still." |
| 45–52 s | **Bigger question** | turn the answer into a deeper, scarier question | "So why can't the immune system stop it? Why is there no cure?" |
| 52–60 s | **Cliffhanger + series CTA** | promise the answer next part; follow to not miss it | "I'll decode it in part 2. One question every day — follow so you don't miss it." |

Shorter reels (35–45 s) compress steps 3–5; never drop the hook, the twist, or the cliffhanger.

## Curiosity and suspense devices (use 4+ per reel)

- **Open loop** — ask, then delay the answer by 2+ lines. Keep one loop open at all times.
- **Escalators** — "But wait…", "And that's not all.", "Now the strangest part.", "It gets worse."
- **Withheld subject** — show it pixelated or as "???" (stat/bars with `mystery`), name it later.
- **Personification** — the threat has intent: "She *chose* you." "The virus is driving the body." "Puppet."
- **Countdown / log** — "DAY 06", "FIG. 7", lab file cards: makes it feel documented and real.
- **Specificity = credibility** — 10 metres, 100x, 3 years, "Subject 33", a year, a unit.
- **Callback** — "Remember part 1?", or return to the opening image with new meaning.
- **Sensory horror detail** — "fully conscious", "one sip of water", "throat locks".
- **Rhetorical question → silence** — a 0.3 s pause before the reveal (use "..." in VO).
- **Myth strike** — show the wrong answer written, then strike it in red (notepad `strike` + `replace`).

## Script rules

- 120–170 words for 45–60 s (English ≈ 2.7 words/s; Hindi/Urdu ≈ 2.4–2.6).
- Sentences ≤ 12 words. One idea per sentence = one scene.
- Second person, present tense, spoken register. Contractions. Fragments allowed ("Fast.").
- First 7 words must contain the stakes. No greeting, no "in this video".
- Numbers as words in VO if the TTS mangles them ("seventy percent"); keep digits on screen.
- Every 3–5 s something new: a reveal, a number, a turn, or a question.
- The last line before the CTA must be a question the viewer now *needs* answered.
- CTA is one line, tied to the series: "Part 2 tomorrow — follow so you don't miss it."

## On-screen headline rules

- 1–2 lines, 2–5 words total, ALL CAPS. Line 1 = setup (ink), line 2 = **punch word** (red).
- It's a keyword echo of the VO, not a subtitle: VO "your muscles go limp, fast" → `MUSCLES / GO LIMP`.
- Line 2 pops in exactly when the punch word is spoken (`punch_at: "word:limp"` or automatic match).
- Reuse a headline across 2 scenes when a thought continues (keeps visual continuity).

## Scorecard (rewrite until every box is ✅)

- [ ] Stakes or contradiction in the first sentence (≤ 2 s)
- [ ] "You" appears in the first 8 s
- [ ] A wrong/obvious answer is set up and knocked down
- [ ] ≥ 3 escalation beats; ≥ 1 hard number; ≥ 1 named source/study/year
- [ ] An open loop exists at every point until the end
- [ ] Every line maps to one drawable visual
- [ ] Ending question is bigger than the opening question
- [ ] Every claim is in facts.md with a source; estimates are labelled
- [ ] Read aloud in ≤ 60 s

## Example (tested, see examples/hypnic-jerk)

Hook "You're drifting off to sleep. Eyes heavy. And then… you fall." → jolt → "70% of people" →
myth "just a weird dream" struck out → "your brain thinks you're falling" → mechanism (muscles go
limp → brainstem misreads → emergency signal) → theory (ancestors in trees; a slip meant death) →
triggers checklist → twist "for some it's not a jolt — it's a gunshot inside their head" →
"real, harmless, unexplained" → Part 2: The exploding head.
