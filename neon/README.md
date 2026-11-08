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
