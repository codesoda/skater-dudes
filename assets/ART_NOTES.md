# Skater Dudes artwork and audio

## Scope and provenance

This set supports a **side-on belt scroller**, with a broad ground plane.
It is not an isometric or Paperboy view. The renderer builds the ground belt
from separate tile images. No obstacle collision geometry is baked into art.

The three original PNGs in `assets/source/` remain unchanged. Their pinned
SHA-256 values appear in `assets/manifest.json`, the preparation script, and
the tests. These are the existing, user-approved generated images. This work
makes no image-generation calls and uses no paid API, external media, or
licensed recording. `references/` is research only. No reference image enters
the production manifest. Coin Quest is not modified or used as a media source.

The audio code and score are original for this game. The score is not an
adaptation of a Tony Hawk song or the Coin Quest song. The deliverable contains
procedural instruments only, with no sampled recordings.

## Files and offline commands

Run from `/Users/chrisraethke/projects/shredder`:

```sh
python3 scripts/prepare_assets.py
python3 scripts/compose_audio.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_assets_audio.py -v
```

Python 3.9 or newer works. Audio composition uses only the standard library.
Art preparation and pixel tests need Pillow, declared in
`assets/requirements-build.txt`. Install that file only when preparing art or
running these tests. A normal game build consumes the finished PNGs and WAVs;
it does not need Pillow, synthesis, image generation, or network access.

Both scripts accept `--output-root DIR` for isolated rebuilds. The art script
also accepts `--source-root DIR`. The composer accepts `--score FILE`. Each
script keeps the other script's manifest section. Run them in sequence, not
concurrently against the same output manifest.

- `assets/manifest.json`: 49 image entries (33 original exports, 12 Dave variants and four approved obstacle sprites) and nine audio entries.
- `assets/processed/*.png`: production images, all real RGBA PNGs.
- `assets/crop-map.json`: exact source cells, clean bounds, placement and hashes.
- `assets/qa/contact-sheet.png`: visual QA only; not a runtime manifest entry.
- `assets/audio/score.json`: editable score, seed, tempos, patterns, gains and lengths.
- `assets/audio/events.json`: deterministic rendered music event log.
- `assets/audio/*.wav`: pre-rendered music and effects.

## Crop and alpha process

The original skater and street sheets are **1254 × 1254**, not 1024. Rounded grid boundaries are
`[0, 314, 627, 940, 1254]` on each axis. The city source is 1672 × 941 RGB.

The sheets contain low-opacity colored noise well outside the visible sprites.
The process keeps pixels with alpha at least 200, makes them opaque, and clears
all other pixels to transparent black. This removes faint colored fringes and
stray pixels without cutting into the visible silhouette. Each cleaned cell
has empty margins before cropping. The visible crops do not reach cell edges
or include neighboring art. The crack intentionally has disconnected strokes.

Human and prop crops keep their source pixel scale. They are not stretched to
fill a cell. The two tile bodies use square, opaque interior crops with no
beveled border or transparent padding. These are repeatable surface textures,
not a claim that all opposing source texture pixels match exactly.

The city output is 960 × 540. Its resize and the QA preview use nearest-neighbor
sampling. Set `imageSmoothingEnabled = false` when the game draws pixel art.
No SVG or other vector replacement appears in this set.

## Anchor contract — important for the renderer

**All anchors and contact offsets use actual bitmap pixels.** They are not
normalized fractions or logical draw coordinates. Image entries give actual
`width`/`height` and logical `drawWidth`/`drawHeight` separately.

For an image anchor at world position `(x, y)`:

```js
const sx = drawWidth / image.width;
const sy = drawHeight / image.height;
ctx.drawImage(bitmap, x - image.anchor[0] * sx,
              y - image.anchor[1] * sy, drawWidth, drawHeight);
```

Here `image` means the manifest entry, not the decoded browser bitmap.
The renderer may override draw dimensions for designed prop geometry. Scale
anchors and contact offsets with those same dimensions.

### Human poses

Each dude’s 12 human frames use a **400 × 300** transparent canvas, with an anchor of
**[200, 292]**. Their logical dimensions are **106.666667 × 80**. The wide canvas
protects the extended pushing leg and crash arms; it is not the visible body
width or a collision box. The standing silhouette is 74.4 logical pixels high.

All frames use the same unscaled source body pixels. The crouch lowers the
head by about 19.5 logical pixels; it does not scale the whole body down.
Rolling, both pushing frames, crouch, manual, grind, and leaning poses share
the foot baseline. Horizontal placement centers the supporting shoe(s), not
the arms. The crash shares the canvas but uses a body-centered horizontal
anchor, recorded in the crop map. Do not infer foot support during the crash.

Ollie, flip, and catch keep their feet 30 bitmap pixels, or **8 logical pixels**,
above that baseline. `footLift` records this. Draw the human at the normal deck
anchor; do not subtract the lift again. World jump displacement is separate.

**Every human sprite has no skateboard. Always draw an independent board.**
The renderer controls trick angles, board separation, and draw order.

### Jeff and Dave palettes

`assets/characters.json` is the authoritative name, preview and pose map.
Jeff keeps the original orange helmet and purple hoodie. Dave uses the same
approved body pixels with a teal helmet and coral hoodie. This is a local
palette-derived skin, not a newly generated character image.

`scripts/prepare_assets.py:dave_palette` remaps only high-saturation orange
helmet hues and purple clothing hues. It retains value shading and preserves
skin, pale shoes and gray equipment where those colors do not match the masks.
Alpha and pixel coordinates never change. All 12 variants keep Jeff’s canvas,
anchors, foot lift and baseline exactly. Independent boards are unchanged.
The crop map records `derivedFrom`, palette and output SHA-256. The manifest
records the processor SHA-256. The dynamic ten-row QA contact sheet shows all
49 images without clipping. Pinned baseline hashes in `tests/original-hashes.json`
protect all 33 original exports, approved source PNGs, WAVs, score/events,
course and settings. Historical audio-score authoring text is retained as part
of the immutable original score; it is not a user-facing game title.

### Boards

All four board images draw at **64 logical pixels wide**, preserving their
own aspect ratio. The edge-on source is vertical. The processor rotates it
90 degrees clockwise before sizing it, so its long axis stays 64 pixels wide
and its wheels face down. Runtime flips can rotate it further.

`anchor` sits on the center-column top of the deck for flat, edge, and manual
boards. The underside flip uses its silhouette center. `groundAnchor` records
the lowest wheel-contact baseline for each bitmap. To put flat wheels on the
ground and feet on the deck:

```js
const deckY = groundY - (board.groundAnchor[1] - board.anchor[1]) * boardScaleY;
// Draw board at (boardX, deckY), using its anchor.
// Draw human at (boardX, deckY), using its [200,292] anchor.
```

The manual silhouette already has a raised nose. Its support and lifted front
foot can need a small renderer offset. During tricks the flip center is a
rotation pivot, not a wheel-ground contract. During a grind, position the
board trucks against the rail beam; do not put wheel ground below the beam.

### Props and surface contacts

Props have two transparent padding pixels on each side and a bottom-center
anchor. Their logical size is a useful default, not a physics requirement.
Their front-facing surface bodies stay shallow compared with their width.

The rail is **260 × 84**, anchor **[130,82]**. Its beam occupies bitmap rows
**2 through 20**. `beamTop = contactTop = 2`; `beamBottom = 21` is exclusive.
For a rail bottom-anchor world y and a vertical draw scale:

```js
const beamWorldY = railGroundY + (rail.contactTop - rail.anchor[1]) * scaleY;
```

At the default 148-pixel logical width, its visual beam top is about 45.54
logical pixels above its bottom anchor. If the course needs a lower rail,
change the draw geometry and scale these offsets consistently.

The low bar has `beamTop = 2`, `beamBottom = clearanceY = 22`. The center below
the beam is visually clear. The bench has `contactTop = 62` for its seat,
not the top of its backrest. Ledge and curb use `contactTop = 2`. Stairs and
ramps retain their source silhouettes; the renderer owns their collision
profiles. The crack is a ground decal, not a raised barrier.

`asphalt` and `concrete` use top-left anchors and default 64 × 64 draw sizes.
The city also uses a top-left anchor. It is a backdrop, not a ground/collision
image. Broad lane depth comes from the renderer's tiled belt, not perspective
warping of these characters or props.

## Audio design and runtime contract

All nine WAVs use **22050 Hz, mono, signed 16-bit PCM**. The exact audio keys are:
`music`, `rolling`, `grind`, `crack`, `ollie`, `land`, `crash`, `push`, and `bank`.
No synthesis or note scheduling runs during play.

**Sidewalk Pocket** is an original four-bar hip-hop instrumental at **90 BPM**.
The loop lasts **10.666667 seconds** (235,200 samples). Kick, snare, closed hats
and sparse E2 bass use 22 ms offbeat swing. Its WAV and 56 events are unchanged;
only runtime music gain increases from 0.12 to 0.30.

Rolling remains an unused compatibility asset. Its cyclic 320 Hz high-pass and
4,200 Hz low-pass noise keeps the same bytes, duration and gain. The runtime
never starts it. Grind is a 1.6-second seeded brown-noise loop with 12 Hz leaky
integration, 10 Hz high-pass and 1,800 Hz low-pass. Periodic filter state avoids
zero-state seams; no fade-to-silence occurs. All six one-shot WAVs stay unchanged.
Music release tails wrap across the loop boundary.

The manifest gives `loop`, `gain`, `loopStart`, `loopEnd`, `duration`, and
`sha256`. Loops use the full decoded buffer. One-shots have `loopEnd = 0` because
they do not loop. Predecode each WAV once after the audio context is unlocked.
Use one `AudioBufferSourceNode` per active loop, with these loop boundaries.
Do not restart a loop every frame. Sources are single-use; reuse the decoded
buffer when a state transition needs a new source.

- Music runs as one quiet source. Its manifest gain is 0.30.
- Start grind only on actual grind contact; never start rolling.
- Stop grind while airborne, dropped, landed, crashed, paused, muted or not playing.
- Use short gain ramps on state changes to avoid start/stop clicks.
- Trigger crack only when a **visible crack is crossed on the ground**.
- Trigger ollie on takeoff, land on contact, and push on the push event.
- Scale land gain at runtime for impact strength, capped at the manifest gain.
- Apply user volume/mute controls after these default mix gains.

No asset clips. File peaks stay at or below 0.66 full scale. The runtime limits
four one-shot voices on a 0.25-gain bus under a 0.9 master. The nominal music,
grind and four-cue peak bound is 0.60642; decoded peaks are trimmed to 0.66.
No speaker or headphone audition occurs during this integration.

## Validation and limits

The offline tests cover exact keys, approved paths, source fingerprints,
PNG sizes and alpha, clean cell boundaries, shared body scale and baseline,
board rotation/contact, tile bodies, prop contacts, city pixels, WAV headers,
durations, loop boundaries, seam steps, boundary energy, peaks, signal coverage,
release tails, double-crack contacts, score structure, seed variation, and full
rebuild reproducibility. Rebuilds use a temporary output folder and confirm
that source hashes stay unchanged. Re-running art preparation also preserves
the audio manifest section.

The cleaned sheet, contact sheet, and enlarged board/contact preview received
visual inspection. The alpha cutoff removes the visible fringe noise. All
requested source cells are usable. No asset is blocked.

Audio validation is numeric and structural. **No speaker or headphone audition
was performed.** Timbre and balance still need listening during playtesting.
Tests cannot judge musical taste or the final runtime mix. Separate core and trusted-browser tests cover rendering, physics, audio state, export and UI.

## Final integration additions

`board_flat.truckAnchor = [117, 32]` records the truck contact row in bitmap
pixels. Ground rolling uses `groundAnchor`; grinding aligns `truckAnchor`
with the rail top. The source PNGs and processed pixels remain unchanged.

The runtime trims decoded peaks to 0.66 because browser resampling can raise
WAV peaks (observed crash peak: 0.7425 at 48 kHz before trimming). This is a
uniform level change, not a waveform replacement. Four one-shot voices share
a quarter-gain bus and a 0.9-gain master. The conservative bound, including
music and grind, is
0.9 × 0.66 × (0.30 + 0.30 + 0.68) = 0.76032.
Loop starts and stops use 25 ms gain ramps. Browser tests check independent
buffers, loop identity, seams, pause/mute behavior and decode failure.
No speaker or headphone audition has occurred.

## Approved obstacle sheet integration

`assets/source/obstacles-sheet.png` is a byte-identical copy of the approved
local generated original. Its immutable SHA-256 is
`894b062c2e497936d6c5b396ea06a3959fc4cca3c936a71d25ca16f7d71df960`.
The original stays in `assets/generated/`; no PNG is deleted or overwritten there.
It is a 1254 × 1254 RGBA sheet with real alpha, not a magenta key background.

The layout is not an equal grid. Crop alpha >= 200 bounds inside these regions:

| Key | Region (left, top, right, bottom) | Alpha bounds within region |
| --- | --- | --- |
| jersey_barrier | 0, 0, 860, 630 | 66, 233, 820, 514 |
| gap_left | 860, 0, 1254, 630 | 54, 153, 305, 577 |
| gap_center | 0, 630, 860, 1254 | 54, 127, 836, 486 |
| gap_right | 860, 630, 1254, 1254 | 81, 47, 337, 495 |

Jersey art keeps its gray flared concrete base and yellow/black stripe. Its
center-column top pixel defines `contactTop`; runtime scales that contact to
76 pixels and width to 160. It is not grindable.

Gap parts normalize to 256 pixels of depth with nearest-neighbor sampling.
The center removes its intact asphalt band and recesses the exposed cutaway.
A dark-earth band cropped from the same source fills the opening above it,
so the original street cannot show through across the physical void.
An eight-column blend joins matching center edge columns. The renderer repeats
that center at fixed scale, crops the final tile, and anchors both broken lips
at `o.x` and `o.x + width`. The visible depth is 58 pixels, not a tall wall.
All transparent pixels have cleared RGB; alpha stays binary. No authored
image-generation code, replacement vector art or new dependency is used.

Four low bars use clearance 69.5: below the standing physics height of 70 and
above the crouch height of 40. This also clears the unchanged crouch art and
independent board at their original scale. Beam-only collision leaves the
supports outside the skating line. Down ducks immediately without a jump.
