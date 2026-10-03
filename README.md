# Skater Dudes

An original, side-on **Double Dragon-style belt-scrolling skate prototype**. V1 uses one fixed lane. It is not isometric. Nollies and lane changes are deferred.

## Play now

Play: **https://codesoda.github.io/skater-dudes/**

Source: https://github.com/codesoda/skater-dudes

For offline play, build locally using the steps below, then double-click **`index.html`**.

The root file and `dist/index.html` are identical standalone games. Copy either file anywhere. The player needs only a modern browser with a keyboard or touchscreen: no server, network, npm, Python, imports, CDN, or installation. Art, course, settings, provenance, scripts, styles and nine WAVs are embedded.

The start screen says: **Dedicated to Oscar, the raddest skater dude I know**

Choose **Jeff** or **Dave** before starting. Jeff is selected by default. Jeff wears an orange helmet and purple hoodie. Dave wears a teal helmet and coral hoodie. Both have identical physics, tricks, boards and sound. Click a named sprite card, or Tab to the radio group and use Arrow keys or Space. Native menu controls do not trigger gameplay.

**Choose dude** on the pause, controls or result screen returns to this menu without reloading. It stops audio and clears held keys and charge. The menu keeps your last choice and banked score. Starting Route or Practice begins a new run and resets the score. R, mode switches, help, pauses and safe retries keep your selected dude. Selection changes only in the menu.

Choose **Practice first** to learn on an empty street. The menu checkbox adds a curb and rail. Practice repeats without a timer. **Ride the street** starts a 2.52 km route with 44 objects: 29 meaningful hazards and 15 cracks. It takes 90 seconds at base speed, or less with deliberate speed-building sections. Three concrete jersey barriers need a charged pop. Four overhead bars need Hold Down; their supports sit outside the skating line. Bails retry just past a successfully cleared obstacle. Short spacing uses an earlier cleared obstacle or the start, leaving at least 1.4 seconds before the next obstacle. Failed hazards are never skipped. Banked points stay; the current combo is lost. A clean run ends with results.

Small screens show scrollable menus and a scaled 16:9 game. **Keyboard and one-finger phone gestures both work.** Portrait works; landscape gives a wider street view. There is no virtual direction pad or overlay button grid.

## Controls

| Key | Action |
| --- | --- |
| Quick Space tap | Release before 300 ms for a small ollie. No crouch or charge gauge. |
| Hold Space → release | Hold 300 ms for crouch intent, then charge for 600 ms more. Full pop takes 900 ms. Jump immediately on release. |
| Down, then Up within 400 ms | Kickflip in the air. Start early enough to finish before landing. |
| Hold Up on ground | Manual. Release Up or press Down to end it. |
| Up in air without fresh flip intent | Catch a rail or ledge from above while descending. |
| Hold Right on flat street | Build speed from 280 to 392 px/s. Release to coast to normal over about 8 seconds; grinds take about 4 seconds. |
| Left / Right in tricks | Balance only. Move the needle into the mint center zone. |
| Down | Duck low bars; end a manual or drop a grind. |
| Space during a grind | Pop off the rail. |
| P / Escape | Pause or resume. |
| I | Full controls. |
| M | Mute or unmute. |
| R | Restart the current mode. |
| Enter on title | Start the route. |

### Phone gestures

Use one finger anywhere on the live canvas, including behind the score display. Gestures are not tied to screen zones.

| Gesture | Action |
| --- | --- |
| Stationary tap, then release | Small ollie on release while rolling. |
| Hold still, then release | Same 300 ms intent plus 600 ms charge as Space. The left gauge stays full until release. About 12 CSS pixels of jitter is allowed. |
| Drag down and hold | Duck immediately. Release to stand, **not jump**. This also ends a manual or drops a grind. |
| Drag right and hold on plain street | Build speed with the same 160 px/s² acceleration and 392 px/s cap. Release for the normal eight-second coast. |
| Drag up and hold on ground | Manual. Move sideways with the same finger to balance; release to end. |
| Swipe up in air | A bounded 350 ms rail-catch window, not a latched key. |
| Down → up reversal in air within 400 ms | Kickflip before lifting your finger. Flip intent wins over rail catch. |
| Drag left / right during a flip, manual or grind | Continuous balance only, never boost. Return near the gesture origin for neutral. |

A hold that becomes a drag abandons its pending jump without releasing another input source. Physical keyboard keys and touch controls can overlap. Airborne stationary touches never queue a jump for landing. Pause, help, menu, restart, bail, focus loss, orientation changes, leaving the play area, a canceled touch or a second finger cancels touch input without popping. Start a fresh contact afterward. The toolbar stays native and accessible; scrolling and zoom remain normal outside the live canvas. Touch devices show a first-play gesture guide and contextual helper text. All keyboard mappings below remain available, including Space to pop off a grind.

### Exact Space gesture timeline

```text
Fresh press:      keep rolling; no crouch, push animation or gauge.
Release <300 ms:   small ollie immediately. No crouch or gauge flash.
Hold at 300 ms:    crouch and left charge gauge appear with zero charge.
Charge clock:     starts after 300 ms; 450 ms = 25%, 900 ms = full.
Release <=300 ms:  small ollie immediately; longer holds use their charge fraction.
Hold past 900 ms:  charge stays at 100%; no jump until release.
Cancel:           pause/help, blur/visibility loss, bail, menu or restart clears charge without jumping.
Space held in air: no automatic jump on landing; release before a new gesture.
```

Manuals and grinds show a compact horizontal balance meter **directly above the skater**, following the skater's height. Kickflips keep the larger **top-center** balance meter and rotation progress. Ordinary ollies do not require balance. Manual/grind balance has a 240 ms unsafe-zone grace period. An unfinished or unbalanced flip fails at landing, not in mid-air. Down→Up has priority over rail catching. F does nothing.

Jersey barriers, charged stairs and gaps need the extra pop. Jersey barriers are solid concrete, not cones, and are not grindable. Pavement HOLD/RELEASE marks and the live helper show the approach. Hold Space at HOLD, then release at RELEASE. HOLD uses current speed to allow 900 ms to load plus a 200 ms reaction margin. Space suppresses acceleration immediately, even during the first 300 ms. Airborne momentum coasts gradually; Right only balances during tricks. The full route uses this single hold-release gesture. The automated controller has exact state feedback; that does not prove the timing feels forgiving to a new player.

## Elevated concrete lines

The four-tier line starts at 9,980 px. Each new shelf starts 920 px after the last.
The tops sit at 60, 120, 180 and 240 px. Lower blocks continue under the upper blocks.
Land without Up to **ride** a ledge. Release Space after each landing, then start a fresh 900 ms charge.
Each higher shelf needs another jump. The game never jumps for you.

At 13,660 px, eleven descending treads lead back to the street. Each tread is 120 px wide.
Their tops descend from 220 to 20 px in 20 px steps. Roll off each edge and land naturally.
You can also pop off. The visible concrete slices match the physical treads.

At 17,180 px, ride a 1,100 px ledge. A 700 px rail starts 140 px beyond its end.
Load on the supported flat and release at the mark, 60 px before the ledge ends.
Hold Up during descent to catch the rail. Rails never act as ordinary rolling platforms.
A missed catch shows **HOLD UP**. Keep the balance needle centered with Left and Right.
Space pops off; Down drops through that rail without catching it again.

**RIDE LEDGE**, **UP NEXT STEP**, **UP TO GRIND** and **STAIRS DOWN** identify the line.
Grinds use the selected dude's arms-out stance, hanging wheels, sparks and a brief **50-50 LOCKED** cue.
The compact balance meter follows the skater above elevated rails and ledges. Kickflip balance stays at the top center. A quiet contact clack and steel scrape distinguish grinding from riding.
A failed tier retries before the complex, never inside a concrete block. Banked score and dude choice stay intact.

## Rebuild and test

Development requires Node.js 22+, npm, and Python 3.10+. CI uses Node.js 24, Python 3.12 and Pillow 11.3.0. Normal builds use Python's standard library and the checked-in processed assets. The pinned Pillow version prepares processed art and runs pixel tests. Prepare assets after a fresh checkout to create the ignored QA contact sheet.

```sh
npm ci
python3 -m pip install -r assets/requirements-build.txt
npx --no-install playwright install chromium webkit --with-deps
python3 scripts/prepare_assets.py
SHREDDER_BROWSER=chromium-headless-shell npm test
npm run scan
```

`npm run build` alone creates `index.html` and `dist/index.html` for local play. `npm test` already includes that build; no separate build is needed before testing.

### GitHub Pages

Pushes to `main`, pull requests targeting `main`, and manual runs use `.github/workflows/pages.yml`. Checks install locked npm dependencies and pinned Pillow, prepare offline QA fixtures, run the full test suite with Chromium headless shell and WebKit phone contexts, then require the quality scan and clean dependency audit. Failed scans retain their reports and error logs for 14 days.

Only a successful `main` run outside a pull request uploads the checked `dist/` artifact and deploys it to GitHub Pages. Pull requests never deploy. The repository must use **GitHub Actions** as its Pages source. Deployments use the `github-pages` environment and run one at a time.

Keep original source PNGs, processed PNGs, WAVs and the pinned original under `assets/generated/` in Git. Research references, the local `graft/` index, QA sheets, dependencies and test evidence stay ignored. The Pages site contains only the standalone export, not those source folders.

The browser test uses installed Google Chrome on macOS when available; otherwise it uses Playwright Chromium. Set `SHREDDER_BROWSER=chromium` for installed Playwright Chromium, or `SHREDDER_BROWSER=chromium-headless-shell` for its installed headless shell. The shell avoids desktop Chrome energy-saver frame limits; test thresholds and simulation timing stay unchanged. Tests fail rather than skip when no browser is available.

`npm test` rebuilds the real bundle, checks all Python asset/export tests, and discovers **every `tests/*.test.cjs`**. Test files run serially so independent browser suites do not compete during real-clock input and frame measurements. Browser tests open a `file://` URL with networking offline. The full-route test takes about 89 real seconds with a trusted opening boost and coast; it does not accelerate rAF or mutate player position. `tests/artifacts/` contains screenshots, measured key timings, decoded-audio bounds, normal-clock performance samples and the route log. Generated evidence is ignored by Git.

`npm run scan` uses pinned Aislop **0.16.1** with recognized `.aislop/config.yml`, `ci.failBelow: 95`. It requires scoreable coverage, all five engines, a successful native CI result, and a separate clean npm audit. It does not lower thresholds or disable finding rules. Playwright is pinned to **1.62.1**. Authored JS, Python, scripts and tests remain in scope. Only generated output, media, dependencies, local research, debug artifacts and the narrow `vendor/zingtouch/**` third-party path are excluded. No authored integration or test code is excluded.

To regenerate outputs explicitly:

```sh
python3 scripts/prepare_assets.py
python3 scripts/compose_audio.py
npm run build
```

The builder runs the needed preparation script if processed inputs or character poses are missing. It upgrades old 33- or 45-image manifests automatically and rejects incomplete character definitions. Both preparation scripts preserve the other manifest section. Original PNGs are fingerprinted and remain unchanged. The composer uses only Python's standard library. Its deterministic score lives in `assets/audio/score.json`.

## Offline gesture dependency

`zingtouch` is pinned to **1.0.6**, with no runtime npm dependencies. `vendor/zingtouch/zingtouch.min.js` is the verbatim official npm distribution. Its full MIT license is embedded in both standalone HTML files. `LICENSE`, `NOTICE` and `provenance.json` record upstream attribution, tarball integrity and file hashes. Tests compare the installed locked npm package to the tracked vendor files. Python builds use only the checked-in bundle, not npm, a CDN or a network download. The original bundle's source-map comment stays intact; the optional developer-tools map is not shipped.

The adapter uses ZingTouch's built-in Tap, Pan and Swipe recognizers and a custom Gesture lifecycle for stationary holds. The game still applies all actions through its fixed-step input queue. ZingTouch 1.0.6 prefers TouchEvent on browsers that also expose PointerEvent and does not handle cancel events itself. The adapter adds primary-contact gating, pointer capture where applicable, window cleanup and safe cancellation. It does not patch the vendor bundle.

## Art, sound and provenance

- **Original source art:** `assets/source/skater-sheet.png`, `street-sheet.png`, `city.png`, and the approved `obstacles-sheet.png`.
- **Parent generation prompt summary:** GPT-6 Astra; crisp 16-bit pixel art; a boardless skater 4×4 sheet with separate skateboard cells, a street-prop 4×4 sheet, and a wide city backdrop. No new image generation occurs during this integration.
- **Characters:** `assets/characters.json` defines Jeff and Dave, all 12 body pose keys and preview keys. The builder embeds these definitions. `game.characterId` is the single validated, read-only runtime selection; only the menu selection method changes it.
- **Dave skin:** a deterministic local HSV clothing remap of the approved Jeff PNGs. It changes saturated orange helmet pixels to teal and purple cloth to coral. It preserves alpha, dimensions, padding, anchors, baseline and board separation. No new image generation, paid service or external art is used. The crop map records each derived source and output hash; provenance records the processor hash. All 45 existing runtime PNGs, their anchors, all existing source PNGs, music/events, rolling and the six one-shot WAVs retain their bytes. This elevated-line update changes only the grind WAV and course pins. The score, other eight WAVs, music events, characters and all art remain unchanged.
- **Processing and coordinates:** `scripts/prepare_assets.py`, `assets/crop-map.json`, `assets/ART_NOTES.md`.
- **Production manifest and source hashes:** `assets/manifest.json`. There are 49 PNGs (33 original exports, 12 Dave poses and four approved obstacle sprites) and nine original WAVs. Export changes `path` to embedded `src` while preserving dimensions, bitmap anchors, contact metadata, gains and loop bounds.
- **Original music:** “Sidewalk Pocket,” simple hip-hop, four bars, 90 BPM, 10.666667 seconds. Kick, snare, closed hats and sparse E2 bass repeat with 22 ms offbeat swing. Music uses runtime gain 0.30; its WAV and 56 events remain unchanged. Original score and procedural instruments by the Skater Dudes asset pipeline; no sampled recordings or adapted commercial songs.
- **Audio sources:** `scripts/compose_audio.py`, `assets/audio/score.json`, `assets/audio/events.json`. Wheels, grind, cracks, ollie, landing, crash, push and bank cues have separate buffers. The unused rolling asset remains for nine-key compatibility and DSP tests, but never plays. Grind uses a 1.6-second seeded brown base: 12 Hz leaky integration, 10 Hz high-pass and 1,800 Hz low-pass. A restrained seeded 600–2,500 Hz scrape adds steel texture only during grinding. Its gain stays 0.30. Cyclic filtering avoids a fade-to-silence seam.
- Paperboy images in `references/` are **research only**. The builder accepts only production asset folders. No Paperboy sprites, Coin Quest art, local research, absolute source paths or external media enter the bundle.

Plain rolling starts one 480 ms push animation every 1.6 seconds, measured start to start. Eligible held Right accelerates at 160 px/s² and changes cadence to 0.8 seconds. Release or ineligible inputs coast at 14 px/s²: about 8 seconds from maximum to normal speed. Only grinding coasts faster, at 28 px/s², taking about 4 seconds. Partial boosts coast for proportionally less time. Manuals, charge holds, ducking, raised rolling and air use normal coast. Speed never coasts below 280 px/s. Cadence changes retain cycle phase and each cycle emits one push cue. Held Space, Down or Up, crouch, air, grind, manual and crash suppress pushing.

The engine separates `worldX`, `laneY` and `jumpZ`. V1 keeps `laneY = 0`. The renderer uses independent boards, flat-ground shadows and ground-depth ordering. Wheel and grind-truck contacts use bitmap metadata, not normalized anchors. The city alternates mirrored tiles to avoid hard background joins.

Sound starts only after play and a user gesture. A single music loop persists while playing. Flat rolling plays music only, plus discrete action cues. Only actual rail/ledge grind contact starts the grind loop. Air, drop, landing and crash stop it; rolling hiss never starts. Mute, pause and focus loss stop sources. Decode failure leaves gameplay available. Browser resampling can raise a WAV peak, so decoding uniformly trims peaks to 0.66. Four one-shot voices share a 0.25-gain bus and a 0.9-gain master; the conservative decoded-peak bound for music, grind and four effects stays below 0.77. Loop transitions use short gain ramps.

## Playtest status and open questions

The current coast-tuning evidence is in `tests/artifacts/coast-tuning/validation.json`. Earlier elevated-line evidence is in `tests/artifacts/elevated-lines-grinds/validation.json`. It records exact test counts, scan results, preserved hashes and screenshots. Core controllers clear the full route at base speed in 90 seconds. The normal-clock browser controller uses trusted keys for an opening boost/coast, charged pops, all four duck bars, flips and grinds, then banks and finishes without teleports. All 49 images embed in both identical offline exports.

Gaps use fixed-size broken asphalt endcaps anchored at the collision edges and a repeated cutaway center. The final center tile is cropped, not stretched. The cutaway stays about 58 pixels deep below the street. The generated original remains unchanged; `assets/crop-map.json` records region bounds, normalization and the narrow repeat-seam repair. No new art generation runs.
See `tests/artifacts/skater-dudes/` for title, chooser and Jeff/Dave gameplay screenshots. `tests/artifacts/route.json` holds the real-time browser traversal evidence. Route and obstacle gameplay screenshots use normal runs, not teleports. `pose-fixtures.json` explicitly labels the isolated 24-pose Canvas fixtures. A result-screen fixture tests menu return without claiming another full traversal. Other explicit fixtures cover audio failures, image failures and a burst of sound cues. Some headless browsers need a synthetic blur event; `focus-evidence.json` states whether that fallback was used.

Mobile evidence lives in `tests/artifacts/mobile-gestures/validation.json`. Chromium phone tests use trusted CDP touch start/move/end/cancel with the normal clock. They cover holds, drags, flips, balance, boost/coast and an eleven-hazard street segment with a rail and two duck bars, without teleports. WebKit phone tests use actual trusted `touchscreen.tap`. Its long-hold, drag, swipe and lost-pointer-capture tests are explicitly synthetic lifecycle fixtures, not physical Safari testing. Both engines load the real standalone bundle and assert zero runtime errors and zero HTTP(S) requests. WebKit's offline emulation rejects even `file://` navigation, so its tests deny HTTP(S) through request interception instead. CI installs both pinned Playwright engines and runs these tests without skips. No actual iPhone hardware test or mobile control-feel study has occurred.

All testing here is **automated**, including trusted browser keyboard input. No human control-feel study or speaker/headphone audition has occurred. Numeric waveform tests cannot judge timbre or musical taste.

Tunable values live in **`settings.json`**: speed, tap/charge windows, gesture window, balance safe zone, grace, drift, correction, bank delay and recovery. Music/effect gains live in the editable audio score. Space now jumps directly on release.

Questions for the next human playtest:

1. Is **hold → release** clear? Does the left gauge explain when to release?
2. Are HOLD and RELEASE marks easy to read and time?
3. Do Left/Right balance corrections feel responsive, with enough warning?
4. Are stairs, gaps and rail approaches fair at the current speed and lookahead?
5. Does the music balance well with the new steel scrape, landings and bails? Does its loop feel natural?

Coin Quest remains a separate, unchanged project.
