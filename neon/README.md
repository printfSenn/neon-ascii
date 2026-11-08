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
