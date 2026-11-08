# Neon ASCII video engine: build brief

Read this file first, then read the three reference files in the same folder:

- `ascii-neon.html`: working single-file web app, the current feature baseline
- `ascii_neon.py`: terminal engine and player (OpenCV + NumPy)
- `render_video.py`: offline renderer that writes mp4 with real glow

The reference code works but it is a prototype. The job is to build the strongest version of this idea you can. Pick any language, framework or stack. Cost of dependencies does not matter, quality and performance do.

## What it does

Takes video (file, webcam, later more) and converts every frame into dense ASCII art that keeps the silhouette, motion and structure of the source. Output is neon violet and deep emerald characters on a pitch black background, with glow, light rays, trails and falling sparks. It runs in real time and can also render offline to video.

## How the prototype works today

Match or beat every stage below.

1. Downscale the frame to a character grid. Cell aspect is 1:2, so rows = cols * height / width * 0.5. Video goes through a 3x intermediate downscale first for cleaner averaging.
2. Luminance with Rec.709 weights.
3. Temporal smoothing per cell with an exponential average, default 0.45.
4. Auto-levels from the 2nd and 98th percentile of the smoothed luminance, eased with a factor of 0.1 per frame, then a gamma of 1 / contrast (default contrast 1.15).
5. 4x4 Bayer offset added before picking the glyph so gradients keep tonal detail.
6. Glyph ramp, dark to bright: ` .,:;-~=+*#%&$@`. Other sets: dense ` .:-=+*#%@`, katakana, blocks.
7. Sobel on the leveled luminance. Where gradient magnitude beats `1.9 - edge * 1.5`, the cell becomes an edge glyph chosen by gradient angle: `|`, `-`, `/`, `\`.
8. Motion energy per cell: absolute difference to the previous frame, decayed by 0.82 per frame.
9. Color index `t = v*0.55 + warmth*0.22 + min(1, motion*3)*0.4 + edge*0.2`, clamped. `warmth` is a blue/red vs green balance of the source pixel.
10. Palette from two user colors, primary P and accent S: stops at 0 = P*0.16, 0.3 = P*0.62, 0.55 = P, 0.75 = S, 1 = S mixed 60% toward white. Sampled into 32 levels and baked into a glyph atlas.
11. Sparks: cells that are bright or on an edge and also moving spawn particles with probability `sparks * 0.22 * min(1, motion*4)`. Gravity 0.012 cells per frame squared, life decays by 0.022 to 0.032 per frame, glyphs are `'` and `*`.
12. Halo: dim `.` cells around bright regions from a blurred copy of the luminance (terminal version only).
13. Post: afterglow trails by fading the previous frame, glow by additive blits of 1/4 and 1/12 scale copies, light rays by 3 scaled additive passes, optional glitch slices, CRT scanlines, hue rotation.
14. Auto quality governor: below 30 fps it lowers render quality, then rays, then column count.

## What is weak in the prototype

- Brightness-only glyph choice. It ignores local shape.
- Motion is plain frame difference, not real motion vectors.
- Silhouette is edge detection only, no subject segmentation.
- Rendering is one Canvas 2D `drawImage` call per cell. That is the fps ceiling.
- Glow is a cheap downscale-upscale trick, not real bloom.
- Particles run on the CPU with a small cap.
- Browser recording is webm only and drops the hue effect.
- No audio from the video drives anything, only the microphone.

## Target

Everything below is wanted. Order by impact, drop nothing without a reason.

**Rendering core**
- Move the whole pipeline to the GPU (WebGL2 or WebGPU for web, wgpu or OpenGL for native). One pass per stage, no per-cell draw calls.
- Glyph rendering from a texture atlas in a fragment shader or instanced quads.
- Target 144 fps at 320x180 cells on a mid-range laptop GPU and a 4K offline export.

**Fidelity**
- Shape-aware glyph matching: split each cell into sampling regions (6 or more), build a shape vector per glyph from the atlas, pick the glyph with the nearest vector, with contrast enhancement. This replaces brightness-only ramps.
- Subject segmentation for exact silhouette tracking. Use a small ONNX model (selfie segmentation, U2Net or similar) with a classical fallback (background subtraction plus morphological cleanup). Draw a rim light along the matte edge.
- Optional monocular depth (Depth Anything small or MiDaS) to drive glyph density, fog and parallax.

**Motion and temporal consistency**
- Real optical flow (Horn-Schunck or a pyramidal Lucas-Kanade on the GPU) at cell resolution.
- Warp the previous frame by the flow before temporal smoothing so smoothing follows moving edges instead of ghosting.
- Glyph hysteresis and temporal dithering so characters do not flicker on static regions.
- Flow vectors choose streak glyphs and drive particles.

**Effects**
- Real bloom: thresholded multi-pass dual Kawase or Gaussian pyramid, additive composite.
- Volumetric light shafts as radial blur from the brightest region or a chosen point.
- GPU particles, 100k or more, spawned from flow magnitude and edges, advected by the flow field plus curl noise, additive glyph sprites, bass-driven bursts.
- Chromatic aberration, film grain, vignette, scanlines, glitch as post shaders. All of it must be included in recordings and exports, hue rotation too.
- Gradient editor with any number of stops, 1D palette texture, plus a mode that extracts the palette from the video itself.

**Audio**
- FFT bands plus onset detection. Source is the video's own audio track, the microphone, or system audio where the platform allows it. Drive bloom, particle bursts, shockwaves and glitch.

**Input and output**
- Input: video file, webcam, screen capture, image sequence, stream URL.
- Native build decodes through ffmpeg with hardware acceleration.
- Output: live preview, mp4, webm, gif, PNG sequence, plain `.ans` text, SVG or HTML vector frames. Offline render is deterministic with a seed, any resolution, audio muxed back in.
- Terminal player with truecolor ANSI, diff-based redraws (only changed cells), optional kitty or sixel graphics for glow, 60 fps.

**Interface** (keep everything the prototype already has)
- Player on the left, controls panel on the right, like YouTube's default view. `T` toggles theatre mode, `F` toggles fullscreen, `?` shows shortcuts, click plays or pauses a loaded video, double-click toggles fullscreen, space plays or pauses, left and right seek 5 seconds. Fullscreen and theatre have no buttons.
- Info icon next to every control. Hover or click shows a short explanation.
- Palette block at the top of the panel. A preset dropdown plus a Custom option. The color picker (square saturation and brightness area, hue bar, hex field, two swatches for primary and accent) only appears when Custom is selected. Changing colors re-themes the whole UI through CSS variables: text, borders, buttons, sliders, checkboxes, selects, tooltips, scrollbars.
- Settings persist, reset button, preset save, load and share as JSON, drag-and-drop for video, timeline scrubber with speed control, speed presets (max fps, balanced, max quality), the auto quality governor.
- Cursor spotlight with sparks, click shockwave for webcam and demo sources, wireframe mode, matrix rain backdrop, mic reactive toggle, record and snapshot.

## Code style rules

The code should read like one careful engineer wrote it by hand. These are hard rules.

- No comments anywhere. No line comments, no block comments, no docstrings, no section banners, no commented-out code, no TODO markers. The code explains itself through names and structure.
- No emoji, ASCII dividers, or decorative console output. Logging is minimal and plain.
- Short, accurate names from the domain (`atlas`, `flow`, `matte`, `bloom`). No `helper`, `utils`, `manager`, `handler` dumping grounds. No names that narrate (`initializeTheRenderer`).
- Small modules with one job each. Conventional layout for the chosen stack.
- No defensive boilerplate. No try/catch around code that cannot fail, no redundant null checks, no type annotations that repeat what inference gives, no config objects for values that never change.
- No wrapper layers or abstractions without a second user.
- Run the standard formatter for the language (rustfmt, prettier, ruff format, gofmt) and keep its output.
- Commit history: small commits, short lowercase messages like `add sobel pass` or `fix atlas rebuild on resize`. No long bodies, no conventional-commit prefixes.
- UI copy is terse and plain. No marketing words.
- README is short: one paragraph on what it is, how to build and run, the shortcut list. Nothing else.

## Deliverables

1. Source repo that builds with one command.
2. A web build and, if the stack allows, a native build with the same pipeline.
3. Terminal player and offline renderer as separate entry points sharing the core.
4. Benchmark script that prints frame time per stage for a fixed clip.
5. A few golden-frame tests that guard the glyph matching and palette output.

## Acceptance

- Silhouettes stay locked to the subject during fast motion, no visible swimming of glyphs on static areas.
- 1080p input runs at the display refresh rate with the default settings.
- Exported video matches the live preview, effects included.
- Switching palette recolors both the ASCII output and the whole interface instantly.
- A reader scanning the repo finds no comments and no telltale boilerplate.
