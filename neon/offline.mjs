import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { unzipSync } from 'fflate';
import ffmpeg from 'ffmpeg-static';

const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const frames = value('--frames');
const input = value('--input');
const output = value('--output');
const fps = Number(value('--fps') || 30);
const ext = output?.toLowerCase().split('.').pop();
if (!frames || !output || !existsSync(frames) || !Number.isFinite(fps) || fps <= 0 || (ext !== 'gif' && (!input || !existsSync(input)))) { console.error('usage: node offline.mjs --frames dir-or-zip --input video --output file [--fps 30]'); process.exit(1); }

let dir = frames;
let temp;
if (!statSync(frames).isDirectory()) {
  const data = readFileSync(frames);
  if (!data.subarray(0, 2).equals(Buffer.from([0x50, 0x4b]))) { console.error('frame source must be a png folder or zip'); process.exit(1); }
  temp = mkdtempSync(join(tmpdir(), 'neon-frames-'));
  dir = temp;
  const files = unzipSync(data);
  const images = Object.entries(files).filter(([name]) => /^frame-\d{6}\.png$/.test(basename(name))).sort(([a], [b]) => a.localeCompare(b));
  if (!images.length) { rmSync(temp, { recursive: true, force: true }); console.error('no png frames found'); process.exit(1); }
  for (let i = 0; i < images.length; i++) writeFileSync(join(dir, `frame-${String(i).padStart(6, '0')}.png`), images[i][1]);
}

const pattern = join(dir, 'frame-%06d.png');
const cmd = ext === 'gif'
  ? ['-framerate', String(fps), '-start_number', '0', '-i', pattern, '-loop', '0', '-threads', '1', '-bitexact', '-y', output]
  : ['-framerate', String(fps), '-start_number', '0', '-i', pattern, '-i', input, '-map', '0:v:0', '-map', '1:a?', '-fps_mode', 'cfr', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-map_metadata', '-1', '-metadata', 'creation_time=1970-01-01T00:00:00Z', '-movflags', '+faststart', '-y', output];
const child = spawn(ffmpeg || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', ...cmd], { stdio: ['ignore', 'inherit', 'inherit'] });
child.on('error', error => { if (temp) rmSync(temp, { recursive: true, force: true }); console.error(error.message); process.exitCode = 1; });
child.on('close', code => { if (temp) rmSync(temp, { recursive: true, force: true }); process.exitCode = code ?? 1; });
