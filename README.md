# Neon ASCII

Neon ASCII is a WebGPU video player that turns video into audio-reactive ASCII art with palette-driven glyphs, motion effects, particles, and export tools.

## Quick start

```bash
cd neon
npm install
npm run dev
```

Run `npm run build` for a production build. The project also includes a terminal player, an offline renderer, golden tests, and a deterministic benchmark.

## Repository layout

- `ascii-neon.html`: standalone prototype
- `neon/`: modular WebGPU implementation
- `neon/src/`: browser renderer and UI source
- `neon/terminal.mjs`: terminal player
- `neon/offline.mjs`: offline export pipeline

See [`neon/README.md`](neon/README.md) for installation details, usage, shortcuts, architecture, benchmarks, and troubleshooting.
