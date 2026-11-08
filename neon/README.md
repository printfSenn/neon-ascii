Neon ASCII is a WebGPU video player that decodes a file or webcam stream, reacts to FFT bands and onsets, renders a deterministic palette-driven glyph atlas, and exports MP4, GIF, or numbered PNG frames. Run `npm install`, then `npm run build` or `npm run dev`; `npm run benchmark` prints stage timings, `npm run terminal -- video.mp4` starts the diff redraw player, and `npm run offline -- --frames neon-ascii-frames.zip --input video.mp4 --output out.mp4` muxes the source audio into deterministic PNG frames. Shortcuts: `T` theatre, `F` fullscreen, `Space` play or pause, `Left` and `Right` seek five seconds, `M` mic reactive, `R` record, `?` shortcuts.

## Installation

Install a recent Node.js release, then install the project dependencies from this directory:

```bash
npm install
```

Verify the TypeScript checks and production bundle with:

```bash
npm run build
```

## Usage

Start the development server and open the local URL shown by Vite:

```bash
npm run dev
```

For the terminal player, pass a video path after the script separator:

```bash
npm run terminal -- video.mp4
```

To render deterministic frames offline and mux the source audio into an MP4:

```bash
npm run offline -- --frames neon-ascii-frames.zip --input video.mp4 --output out.mp4
```

## Shortcuts

- `T` toggles theatre mode.
- `F` toggles fullscreen.
- `Space` plays or pauses the video.
- `Left` and `Right` seek five seconds.
- `M` toggles microphone reactivity.
- `R` starts or stops recording.
- `?` opens the shortcut list.

## Architecture

- `src/main.ts` connects the browser UI, media inputs, render loop, recording, and settings.
- `src/core.ts` owns the frame state, glyph selection, palette sampling, temporal smoothing, motion, and particles.
- `src/shaders.ts` contains the WebGPU shader stages used to render the ASCII atlas and effects.
- `src/style.css` defines the player layout, controls, themes, and responsive states.
- `terminal.mjs` provides the diff-based ANSI player, while `offline.mjs` renders deterministic frames for export.
- `golden.mjs` checks stable rendering outputs and `bench.mjs` reports stage timings.

## Benchmark

Run the deterministic benchmark from this directory:

```bash
npm run benchmark
```

It measures a synthetic 1920x1080 frame mapped to a 320x180 cell grid. The report includes decoding, grid sampling, optical flow, temporal smoothing, auto-levels, matte extraction, glyph atlas work, particles, audio analysis, terminal diffing, and total frame time.

## Troubleshooting

- If the preview is blank, use a current Chromium-based browser with WebGPU enabled and open the app through the Vite server rather than a `file://` URL.
- If a video does not load, try a browser-supported file format and confirm that the page has finished loading before selecting the file again.
- If the build fails after changing dependencies, remove the local install and run `npm install` again, then retry `npm run build`.
- If rendering output changes unexpectedly, run `npm test` to check the golden palette, glyph, and smoothing cases.
- If offline export fails, confirm that the input video exists and that `--frames`, `--input`, and `--output` each have a value.
