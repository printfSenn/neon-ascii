import { spawn } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const args = process.argv.slice(2);
const input = args.find(value => !value.startsWith('--'));
const get = name => { const value = args.find(item => item.startsWith(`${name}=`)); return value ? value.slice(name.length + 1) : undefined; };
const width = Number(get('--width') || 640);
const height = Number(get('--height') || 360);
const cols = Number(get('--cols') || Math.min(140, process.stdout.columns || 120));
const rows = Math.max(8, Math.round(cols * height / width * .5));
const fps = Number(get('--fps') || 60);
const ramp = ' .,:;-~=+*#%&$@';
if (!input) { console.error('usage: node terminal.mjs video --cols=120 --width=640 --height=360'); process.exit(1); }
const decoder = spawn(ffmpeg || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', input, '-vf', `scale=${cols}:${rows * 2}:flags=bilinear`, '-r', String(fps), '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
const bytes = cols * rows * 3;
let pending = Buffer.alloc(0);
let previous = [];
let first = true;
const draw = frame => {
  const next = new Array(cols * rows);
  let output = first ? '\x1b[2J\x1b[H\x1b[?25l' : '';
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = (y * cols + x) * 3;
    const r = frame[i], g = frame[i + 1], b = frame[i + 2];
    const lum = (r * .2126 + g * .7152 + b * .0722) / 255;
    const glyph = ramp[Math.min(ramp.length - 1, lum * ramp.length | 0)];
    const cell = `${glyph}:${r}:${g}:${b}`;
    next[y * cols + x] = cell;
    if (first || cell !== previous[y * cols + x]) output += `\x1b[${y + 1};${x + 1}H\x1b[38;2;${r};${g};${b}m${glyph}`;
  }
  process.stdout.write(output); previous = next; first = false;
};
decoder.stdout.on('data', chunk => { pending = Buffer.concat([pending, chunk]); while (pending.length >= bytes) { draw(pending.subarray(0, bytes)); pending = pending.subarray(bytes); } });
decoder.on('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
const clean = () => process.stdout.write('\x1b[0m\x1b[?25h\n');
process.on('SIGINT', () => { clean(); decoder.kill('SIGINT'); });
decoder.on('close', clean);
