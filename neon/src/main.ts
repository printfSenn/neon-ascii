import './style.css';
import { Renderer, type Options, type Timing } from './core';
import { zipSync } from 'fflate';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const out = $('out') as HTMLCanvasElement;
const video = document.createElement('video');
video.muted = true;
video.loop = true;
video.playsInline = true;
const cameraVideo = document.createElement('video');
cameraVideo.autoplay = true;
cameraVideo.muted = true;
cameraVideo.playsInline = true;
const demo = document.createElement('canvas');
demo.width = 960;
demo.height = 540;
const dctx = demo.getContext('2d')!;
const presets: Record<string, string[]> = { violet: ['10dc8c', 'a855ff'], toxic: ['00a03c', '50ff78'], ultra: ['5a1ec8', 'aa50ff'], 'mono-green': ['00c878', 'a855ff'], 'mono-violet': ['8a45e8', '10dc8c'] };
const quality = { fast: { columns: 120, glow: 40, rays: 0, quality: '1', trail: 20, sparks: 35 }, balanced: { columns: 180, glow: 65, rays: 15, quality: '1.6', trail: 35, sparks: 55 }, quality: { columns: 260, glow: 80, rays: 30, quality: '2.2', trail: 40, sparks: 60 } };
const ids = ['columns', 'smoothing', 'contrast', 'glow', 'edge', 'trail', 'charset', 'debug', 'preset', 'hue', 'rays', 'sparks', 'scanlines', 'spotlight', 'wireframe', 'auto', 'invert', 'mirror', 'palette', 'speed', 'quality', 'glitch', 'rain', 'cycle'];
const input = (id: string) => $(id) as HTMLInputElement;
const select = (id: string) => $(id) as HTMLSelectElement;
const TIPS: Record<string, string> = { "columns": "Jumlah karakter per baris. Makin banyak makin detail, tapi makin berat dan fps bisa turun.", "smoothing": "Meratakan kecerahan antar frame supaya tidak kedip-kedip. Kalau terlalu tinggi, gerakan jadi berbayang.", "contrast": "Mengatur kontras. Naikkan supaya bagian terang dan gelap lebih tegas.", "glow": "Kekuatan cahaya neon di sekitar karakter yang terang.", "sparks": "Jumlah percikan api yang keluar dari bagian yang bergerak.", "edge": "Kekuatan garis siluet di tepi objek. Geser ke 0 untuk mematikan.", "trail": "Jejak cahaya yang memudar pelan di belakang objek yang bergerak.", "palette": "Pilih preset warna, atau atur sendiri lewat kotak warna. Warna ini juga mengubah tema seluruh halaman.", "charset": "Jenis karakter yang dipakai untuk menggambar: Classic, Dense, Matrix kana, atau Blocks.", "preset": "Preset cepat. Max FPS paling ringan, Max quality paling tajam tapi paling berat.", "quality": "Resolusi gambar hasil render. HD dan Ultra HD lebih tajam tapi lebih berat.", "hue": "Memutar seluruh warna tampilan ASCII. Efek ini tidak ikut terekam di Record atau Snapshot.", "glitch": "Efek layar tersobek acak. Makin tinggi makin sering muncul.", "rays": "Sinar cahaya volumetrik yang memancar dari area terang.", "invert": "Membalik terang dan gelap.", "mirror": "Membalik gambar webcam seperti cermin.", "rain": "Hujan karakter ala Matrix di latar belakang, hanya muncul di area kosong.", "scanlines": "Garis-garis scanline seperti monitor tabung jadul.", "cycle": "Warna berputar otomatis tanpa henti.", "spotlight": "Area di dekat kursor jadi lebih terang dan mengeluarkan percikan.", "wireframe": "Hanya menampilkan garis tepi dan percikan, tanpa isian.", "auto": "Menurunkan kualitas otomatis kalau fps di bawah 30 supaya tetap lancar." };
const css = document.createElement('style');
css.textContent = '.lh{display:flex;align-items:center;gap:6px}.qm{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;margin-left:5px;border:1px solid currentColor;border-radius:50%;font-size:10px;opacity:.6;cursor:help;user-select:none;flex:none}.qm:hover{opacity:1}';
document.head.appendChild(css);
const addTips = () => {
  for (const id in TIPS) {
    const el = document.getElementById(id);
    if (!el || el.dataset.tipped) continue;
    el.dataset.tipped = '1';
    el.removeAttribute('data-tip');
    const q = document.createElement('span');
    q.className = 'qm'; q.textContent = '?'; q.dataset.tip = TIPS[id];
    if (el instanceof HTMLInputElement && el.type === 'checkbox') { el.parentElement!.appendChild(q); continue; }
    const lb = (el.closest('label') ?? el.parentElement) as HTMLElement;
    const lh = document.createElement('div');
    lh.className = 'lh';
    while (lb.firstChild && lb.firstChild !== el) lh.appendChild(lb.firstChild);
    lh.appendChild(q);
    lb.insertBefore(lh, el);
  }
};
let cycleHue = 0;
let renderer: Renderer;
let source: HTMLVideoElement | HTMLCanvasElement = demo;
let mode = 'demo';
let paused = false;
let primary = '10dc8c';
let accent = 'a855ff';
let tone = 2;
let saved = false;
let savedPrimary = primary;
let savedAccent = accent;
let selected = 'primary';
let hue = [0, 0, 0];
let last = performance.now();
let frames = 0;
let fps = 0;
let timing: Timing = { copy: 0, grid: 0, smooth: 0, levels: 0, glyph: 0, total: 0 };
let record: MediaRecorder | undefined;
let chunks: Blob[] = [];
let webcam: MediaStream | undefined;
let audioContext: AudioContext | undefined;
let analyser: AnalyserNode | undefined;
let audioDest: MediaStreamAudioDestinationNode | undefined;
let videoAudio: MediaElementAudioSourceNode | undefined;
let micAudio: MediaStreamAudioSourceNode | undefined;
let freq: Uint8Array<ArrayBuffer> | undefined;
let lastBass = 0;
let audioStream: MediaStream | undefined;
let exportBusy = false;

const rgb = (hex: string) => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
const hex = (v: number[]) => v.map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const h2rgb = (h: number, s: number, v: number) => {
  const f = (n: number) => (v - v * s * Math.max(0, Math.min((n + h / 60) % 6, 4 - (n + h / 60) % 6, 1))) * 255;
  return [f(5), f(3), f(1)];
};
const rgb2hsv = (r: number, g: number, b: number) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h < 0 ? h * 60 + 360 : h * 60, max ? d / max : 0, max];
};
const theme = () => {
  const p = rgb(primary), s = rgb(accent), root = document.documentElement.style;
  const scale = (c: number[]) => { const m = Math.max(...c); return m < 110 && m ? c.map(v => v * 110 / m) : c; };
  const c = (v: number[]) => `rgb(${v.map(Math.round).join(',')})`;
  const ps = scale(p), ss = tone === 1 ? scale(mix(p, [255, 255, 255], .42)) : scale(s);
  root.setProperty('--p', c(ps)); root.setProperty('--s', c(ss)); root.setProperty('--tx', c(mix(ps, [255, 255, 255], .5))); root.setProperty('--dim', c(mix(ps, [0, 0, 0], .3))); root.setProperty('--bd0', c(mix(ps, [0, 0, 0], .85))); root.setProperty('--bd', c(mix(ps, [0, 0, 0], .65))); root.setProperty('--bg', c(mix(ps, [0, 0, 0], .95))); root.setProperty('--bgh', c(mix(ps, [0, 0, 0], .82))); root.setProperty('--hov', c(mix(ss, [255, 255, 255], .55)));
  renderer.primary = primary; renderer.accent = accent; renderer.tone = tone; renderer.updatePalette();
};
const syncColor = () => {
  const value = selected === 'primary' ? primary : accent;
  const c = rgb(value);
  const [h, s, v] = hue = rgb2hsv(c[0], c[1], c[2]);
  input('hex').value = value.toUpperCase();
  $('color-dot').style.left = `${s * 100}%`; $('color-dot').style.top = `${(1 - v) * 100}%`; $('hue-dot').style.left = `${h / 360 * 100}%`;
  $('color-square').style.background = `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${h},100%,50%))`;
  $('primary-swatch').style.background = `#${primary}`; $('accent-swatch').style.background = `#${accent}`;
};
const setColor = (value: string) => { if (selected === 'primary') primary = value; else accent = value; select('palette').value = 'custom'; theme(); syncColor(); save(); };
const paintSaved = () => { $('saved-primary').style.background = `#${savedPrimary}`; $('saved-accent').style.background = `#${savedAccent}`; $('palette').parentElement!.parentElement!.classList.toggle('saved', saved); $('color-square').parentElement!.classList.toggle('single', tone === 1); };
const save = () => {
  const state: Record<string, string | boolean | number> = { primary, accent, tone, saved, savedPrimary, savedAccent };
  for (const id of ids) { const el = $(id); state[id] = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : (el as HTMLInputElement).value; }
  localStorage.setItem('neon-state', JSON.stringify(state));
};
const drawDemo = (t: number) => {
  const c = dctx, w = demo.width, h = demo.height, cx = w / 2, cy = h / 2, k = w / 640;
  const ringWidth = 20;
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = '#000';
  c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'lighter';

  const orb = (x: number, y: number, r: number, spin: number) => {
    const glow = c.createRadialGradient(x, y, 0, x, y, r * 1.8);
    glow.addColorStop(0, 'rgba(210,120,255,.85)');
    glow.addColorStop(.4, 'rgba(100,40,220,.4)');
    glow.addColorStop(1, '#0000');
    c.fillStyle = glow;
    c.beginPath();
    c.arc(x, y, r * 1.8, 0, Math.PI * 2);
    c.fill();
    c.save();
    c.translate(x, y);
    c.rotate(spin);
    c.fillStyle = 'rgba(46,10,120,1)';
    c.beginPath();
    c.arc(0, 0, r * .86, 0, Math.PI * 2);
    c.fill();
    const band = (rr: number, lw: number, color: string, dash: number[]) => {
      c.lineWidth = Math.max(3, lw);
      c.strokeStyle = color;
      c.setLineDash(dash);
      c.beginPath();
      c.arc(0, 0, rr, 0, Math.PI * 2);
      c.stroke();
    };
    band(r, r * .16, 'rgba(250,215,255,1)', []);
    band(r * .78, r * .1, 'rgba(200,120,255,1)', [r * .12, r * .07]);
    band(r * .56, r * .08, 'rgba(255,255,255,.95)', [r * .08, r * .06]);
    c.lineWidth = Math.max(3, r * .07);
    c.strokeStyle = 'rgba(120,240,255,.95)';
    c.setLineDash([r * .1, r * .08]);
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.ellipse(0, 0, r * .9, r * .3, i * Math.PI / 3, 0, Math.PI * 2);
      c.stroke();
    }
    c.setLineDash([]);
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(0, 0, r * .16, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#f5e8ff';
    c.beginPath();
    c.arc(Math.cos(t * 1.8) * r * .38, Math.sin(t * 1.8) * r * .38, r * .1, 0, Math.PI * 2);
    c.fill();
    c.restore();
  };

  const drifters = [
    { s: -1, a: 235, b: 40, f1: .37, f2: .53, f3: 1.1, p1: 0, p2: 1.2, p3: .4, h: 120, r: 26, col: '190,120,255' },
    { s: 1, a: 238, b: 38, f1: .29, f2: .61, f3: .9, p1: 2, p2: .3, p3: 2.2, h: 110, r: 22, col: '130,200,255' },
    { s: -1, a: 250, b: 30, f1: .52, f2: .41, f3: 1.3, p1: 4, p2: 2.6, p3: 1, h: 135, r: 16, col: '255,140,230' },
    { s: 1, a: 245, b: 32, f1: .44, f2: .73, f3: .8, p1: 1, p2: 4.1, p3: 3, h: 125, r: 18, col: '200,150,255' },
    { s: -1, a: 228, b: 42, f1: .63, f2: .34, f3: 1.5, p1: 3, p2: 5, p3: .7, h: 100, r: 13, col: '160,210,255' },
    { s: 1, a: 232, b: 36, f1: .33, f2: .58, f3: 1.2, p1: 5, p2: .9, p3: 3.6, h: 115, r: 14, col: '255,170,240' },
  ];
  for (const d of drifters) {
    const x = cx + d.s * (d.a + d.b * Math.sin(d.f1 * t + d.p1)) * k;
    const y = cy + Math.max(-165, Math.min(165, d.h * Math.sin(d.f2 * t + d.p2) + 40 * Math.sin(d.f3 * t + d.p3))) * k;
    const r = d.r * k * 1.6;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${d.col},.5)`);
    g.addColorStop(.5, `rgba(${d.col},.2)`);
    g.addColorStop(1, `rgba(${d.col},0)`);
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }

  const tilt = -.25 + .1 * Math.sin(t * .4);
  const place = (a: number, r: number, spin: number) => {
    const ox = Math.cos(a) * 235, oy = Math.sin(a) * 100, z = Math.sin(a);
    return {
      x: cx + (ox * Math.cos(tilt) - oy * Math.sin(tilt)) * k,
      y: cy + (ox * Math.sin(tilt) + oy * Math.cos(tilt)) * k,
      r: r * k * (1 + .22 * z),
      z,
      spin,
    };
  };
  const orbs = [place(t * .7, 40, t * .8), place(t * .7 + Math.PI, 50, -t * .65)];

  const rot = t * .5, rx = (130 + 30 * Math.sin(t)) * k, ry = (70 + 20 * Math.cos(t * 1.2)) * k;
  const weavePoint = (th: number, ph: number): [number, number] => {
    const cs = Math.cos(th), sn = Math.sin(th);
    const nl = Math.hypot(cs / rx, sn / ry);
    const off = Math.sin(th * 4 + ph) * 30 * k;
    const lx = cs * rx + cs / rx / nl * off, ly = sn * ry + sn / ry / nl * off;
    return [cx + lx * Math.cos(rot) - ly * Math.sin(rot), cy + lx * Math.sin(rot) + ly * Math.cos(rot)];
  };

  for (const o of orbs) if (o.z < 0) orb(o.x, o.y, o.r, o.spin);

  c.lineWidth = ringWidth * k;
  c.strokeStyle = '#ddd';
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
  c.stroke();

  const tints = ['190,110,255', '255,150,230', '130,220,255'];
  for (let j = 0; j < 3; j++) {
    const head = t * 1.3 + j * Math.PI * 2 / 3, ph = j * 2.1;
    let [px, py] = weavePoint(head, ph);
    const hx = px, hy = py;
    for (let i = 1; i <= 36; i++) {
      const f = 1 - i / 36;
      const [qx, qy] = weavePoint(head - i * .04, ph);
      c.strokeStyle = `rgba(${tints[j]},${f * .22})`;
      c.lineWidth = (6 + 26 * f) * k;
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(qx, qy);
      c.stroke();
      c.strokeStyle = `rgba(255,255,255,${f * f * .9})`;
      c.lineWidth = (2 + 8 * f) * k;
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(qx, qy);
      c.stroke();
      px = qx;
      py = qy;
    }
    const hg = c.createRadialGradient(hx, hy, 0, hx, hy, 20 * k);
    hg.addColorStop(0, '#fff');
    hg.addColorStop(.3, `rgba(${tints[j]},.8)`);
    hg.addColorStop(1, `rgba(${tints[j]},0)`);
    c.fillStyle = hg;
    c.beginPath();
    c.arc(hx, hy, 20 * k, 0, Math.PI * 2);
    c.fill();
  }

  const cr = 20 * k * (1 + .06 * Math.sin(t * 3));
  const cg = c.createRadialGradient(cx, cy, 0, cx, cy, cr * 2);
  cg.addColorStop(0, '#fff');
  cg.addColorStop(.35, 'rgba(235,205,255,1)');
  cg.addColorStop(.6, 'rgba(150,80,255,.45)');
  cg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = cg;
  c.beginPath();
  c.arc(cx, cy, cr * 2, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#fff';
  c.beginPath();
  c.arc(cx, cy, cr * .5, 0, Math.PI * 2);
  c.fill();

  for (const o of orbs) if (o.z >= 0) orb(o.x, o.y, o.r, o.spin);

  c.globalCompositeOperation = 'source-over';
};
const bands = () => {
  if (!analyser || !freq) return { bass: 0, mid: 0, treble: 0, onset: 0 };
  analyser.getByteFrequencyData(freq);
  const avg = (a: number, b: number) => { let sum = 0; for (let i = a; i < b; i++) sum += freq![i]; return sum / Math.max(1, b - a) / 255; };
  const bass = avg(0, Math.min(8, freq.length));
  const mid = avg(8, Math.min(48, freq.length));
  const treble = avg(48, freq.length);
  const onset = Math.max(0, bass - lastBass * 1.12 - .025) * 4;
  lastBass = bass;
  return { bass, mid, treble, onset: Math.min(1, onset) };
};
const options = (time = performance.now() / 1000, audio = true): Options => ({ cols: +input('columns').value, rows: 0, smoothing: +input('smoothing').value / 100, contrast: +input('contrast').value, edge: +input('edge').value / 100, invert: input('invert').checked, wireframe: input('wireframe').checked, mirror: mode === 'webcam' && input('mirror').checked, scanlines: input('scanlines').checked, rain: input('rain').checked, glitch: +input('glitch').value, trail: +input('trail').value / 100, quality: +select('quality').value, hue: +input('hue').value, glow: +input('glow').value, rays: +input('rays').value, sparks: +input('sparks').value / 100, debug: (select('debug').value || 'full') as Options['debug'], ...(audio ? bands() : { bass: 0, mid: 0, treble: 0, onset: 0 }), time });
const autoLower = () => {
  const q = select('preset');
  if (!input('auto').checked || fps >= 30) return;
  const columns = input('columns');
  const qs = select('quality');
  if (+qs.value > 1) qs.selectedIndex = Math.max(0, qs.selectedIndex - 1);
  else if (+columns.value > 80) columns.value = String(+columns.value - 10);
  else if (+input('rays').value > 0) input('rays').value = String(Math.max(0, +input('rays').value - 10));
  q.value = 'custom';
};
const frame = (now: number) => {
  requestAnimationFrame(frame);
  if (paused) return;
  if (input('cycle').checked) { cycleHue = (cycleHue + 0.6) % 360; out.style.filter = `hue-rotate(${cycleHue}deg)`; } else out.style.filter = +input('hue').value ? `hue-rotate(${input('hue').value}deg)` : '';
  if (mode === 'demo') drawDemo(now / 1000);
  const activeVideo = mode === 'webcam' ? cameraVideo : video;
  if ((mode === 'file' || mode === 'webcam') && (activeVideo.readyState < 2 || !activeVideo.videoWidth)) return;
  try { timing = renderer.draw(source, options()); } catch (error) { $('message').textContent = error instanceof Error ? error.message : 'render failed'; paused = true; return; }
  frames++;
  if (now - last > 600) { fps = frames * 1000 / (now - last); $('fps').textContent = `${Math.round(fps)} fps | ${renderer.cols}x${renderer.rows} | ${timing.total.toFixed(2)} ms`; frames = 0; last = now; autoLower(); }
};
const startVideoAudio = async () => {
  audioContext ??= new AudioContext();
  analyser ??= audioContext.createAnalyser();
  analyser.fftSize = 512;
  freq ??= new Uint8Array(analyser.frequencyBinCount);
  audioDest ??= audioContext.createMediaStreamDestination();
  if (!videoAudio) { videoAudio = audioContext.createMediaElementSource(video); videoAudio.connect(analyser); videoAudio.connect(audioContext.destination); analyser.connect(audioDest); }
  video.muted = false;
  await audioContext.resume();
};
const startMic = async () => {
  audioContext ??= new AudioContext();
  analyser ??= audioContext.createAnalyser();
  analyser.fftSize = 512;
  freq ??= new Uint8Array(analyser.frequencyBinCount);
  audioDest ??= audioContext.createMediaStreamDestination();
  if (micAudio) { micAudio.disconnect(); micAudio = undefined; audioStream?.getTracks().forEach(track => track.stop()); audioStream = undefined; $('mic').classList.remove('on'); return; }
  audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  micAudio = audioContext.createMediaStreamSource(audioStream);
  micAudio.connect(analyser); analyser.connect(audioDest); await audioContext.resume(); $('mic').classList.add('on');
};
const waitSeek = (time: number) => new Promise<void>(resolve => { const target = Math.max(0, Math.min(video.duration || time, time)); if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.0001) { resolve(); return; } const done = () => resolve(); video.addEventListener('seeked', done, { once: true }); video.currentTime = target; });
const renderAt = async (time: number) => { await waitSeek(time); renderer.draw(video, options(time, false)); await renderer.device.queue.onSubmittedWorkDone(); };
const fileBlob = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); };
const canExport = () => { if (mode !== 'file' || !video.duration) { $('message').textContent = 'load a video first'; return false; } return true; };
const exportFrames = async (kind: 'gif' | 'png') => {
  if (exportBusy || !canExport()) return;
  exportBusy = true;
  const wasPaused = paused, wasPlaying = !video.paused, position = video.currentTime;
  paused = true; video.pause();
  try {
    renderer.size(video, +input('columns').value, +select('quality').value);
    renderer.reset();
    const fps = 30, count = Math.max(1, Math.ceil(video.duration * fps));
    if (kind === 'gif') {
      const gif = GIFEncoder(), frame = document.createElement('canvas'); frame.width = out.width; frame.height = out.height; const ctx = frame.getContext('2d')!;
      for (let i = 0; i < count; i++) { await renderAt(i / fps); ctx.drawImage(out, 0, 0); const pixels = ctx.getImageData(0, 0, frame.width, frame.height).data; const colors = quantize(pixels, 256); gif.writeFrame(applyPalette(pixels, colors), frame.width, frame.height, { palette: colors, delay: 1000 / fps }); }
      gif.finish(); fileBlob(new Blob([gif.bytes()], { type: 'image/gif' }), 'neon-ascii.gif');
    } else {
      const files: Record<string, Uint8Array> = {};
      for (let i = 0; i < count; i++) { await renderAt(i / fps); const blob = await new Promise<Blob>(resolve => out.toBlob(value => resolve(value!), 'image/png')); files[`frame-${String(i).padStart(6, '0')}.png`] = new Uint8Array(await blob.arrayBuffer()); }
      fileBlob(new Blob([zipSync(files)], { type: 'application/zip' }), 'neon-ascii-frames.zip');
    }
  } finally {
    renderer.reset();
    video.currentTime = position;
    paused = wasPaused;
    if (wasPlaying) video.play().catch(() => undefined);
    exportBusy = false;
  }
};
const exportMp4 = async () => {
  if (exportBusy || !canExport()) return;
  exportBusy = true; paused = false; await startVideoAudio();
  const stream = out.captureStream(30); audioDest?.stream.getAudioTracks().forEach(track => stream.addTrack(track));
  const mime = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find(value => MediaRecorder.isTypeSupported(value)) || 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime }); const data: Blob[] = []; rec.ondataavailable = e => data.push(e.data); const done = new Promise<void>(resolve => { rec.onstop = () => resolve(); });
  rec.start(); video.currentTime = 0; await video.play(); await new Promise(resolve => setTimeout(resolve, video.duration * 1000 + 200)); video.pause(); rec.stop(); await done; fileBlob(new Blob(data, { type: mime }), mime === 'video/mp4' ? 'neon-ascii.mp4' : 'neon-ascii.webm'); exportBusy = false;
};
const stopWebcam = () => { webcam?.getTracks().forEach(track => track.stop()); webcam = undefined; cameraVideo.pause(); if (cameraVideo.srcObject) cameraVideo.srcObject = null; };
const setSourceUI = (active: 'demo' | 'webcam' | 'file') => {
  $('demo').classList.toggle('on', active === 'demo');
  $('camera').classList.toggle('on', active === 'webcam');
  input('file').parentElement?.classList.toggle('on', active === 'file');
};
const load = (file: File) => {
  stopWebcam();
  setSourceUI('file');
  video.pause();
  video.src = URL.createObjectURL(file);
  video.onloadedmetadata = () => {
    mode = 'file'; source = video;
    setSourceUI('file');
    $('message').textContent = file.name;
    startVideoAudio().catch(() => { $('message').textContent = 'video audio unavailable; rendering video only'; }).finally(() => { video.play().catch(() => $('message').textContent = 'video playback was blocked'); });
  };
  video.onerror = () => { mode = 'demo'; source = demo; setSourceUI('demo'); $('message').textContent = 'could not decode that video'; };
};
const toggleFull = () => document.fullscreenElement ? document.exitFullscreen() : out.requestFullscreen();
const bindColor = (el: HTMLElement, fn: (x: number, y: number) => void) => { const move = (e: PointerEvent) => { const r = el.getBoundingClientRect(); fn(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))); }; el.onpointerdown = e => { el.setPointerCapture(e.pointerId); move(e); el.onpointermove = move; }; el.onpointerup = () => { el.onpointermove = null; }; };

const start = async () => {
  renderer = await Renderer.create(out);
  renderer.device.lost.then(info => { $('message').textContent = `gpu lost: ${info.message || info.reason}`; });
  renderer.device.addEventListener('uncapturederror', event => { $('message').textContent = `gpu error: ${event.error.message}`; });
  addTips();
  input('hue').addEventListener('input', () => { input('cycle').checked = false; });
  theme();
  syncColor();
  const stored = localStorage.getItem('neon-state');
  if (stored) { const state = JSON.parse(stored) as Record<string, string | boolean | number>; primary = String(state.primary || primary); accent = String(state.accent || accent); tone = Number(state.tone || 2); saved = Boolean(state.saved); savedPrimary = String(state.savedPrimary || primary); savedAccent = String(state.savedAccent || accent); for (const id of ids) if (id in state) { const el = $(id); if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(state[id]); else (el as HTMLInputElement).value = String(state[id]); } select('tone').value = String(tone); theme(); syncColor(); paintSaved(); $('color-square').parentElement!.classList.remove('open'); }
  for (const id of ids) { $(id).addEventListener('input', save); $(id).addEventListener('change', save); }
  $('palette').onchange = () => { const value = select('palette').value; const p = presets[value]; if (p) { [primary, accent] = p; tone = value.startsWith('mono-') ? 1 : 2; select('tone').value = String(tone); saved = false; } const panel = $('color-square').parentElement!.parentElement!; panel.classList.toggle('open', value === 'custom'); if (p) { theme(); syncColor(); paintSaved(); } save(); };
  select('tone').onchange = () => { tone = +select('tone').value; theme(); paintSaved(); save(); };
  $('save-palette').onclick = () => { savedPrimary = primary; savedAccent = accent; saved = true; select('palette').value = 'custom'; $('color-square').parentElement!.parentElement!.classList.remove('open'); paintSaved(); save(); };
  $('edit-palette').onclick = () => { primary = savedPrimary; accent = savedAccent; select('palette').value = 'custom'; theme(); syncColor(); $('color-square').parentElement!.parentElement!.classList.add('open'); };
  $('export-palette').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ tone, primary: saved ? savedPrimary : primary, accent: saved ? savedAccent : accent, saved }, null, 2)], { type: 'application/json' })); a.download = 'neon-palette.json'; a.click(); };
  input('import-palette').onchange = async () => { const file = input('import-palette').files?.[0]; if (!file) return; const data = JSON.parse(await file.text()) as { tone?: number; primary?: string; accent?: string; saved?: boolean }; if (data.primary && /^[0-9a-f]{6}$/i.test(data.primary)) primary = data.primary.toLowerCase(); if (data.accent && /^[0-9a-f]{6}$/i.test(data.accent)) accent = data.accent.toLowerCase(); tone = data.tone === 1 ? 1 : 2; saved = Boolean(data.saved); savedPrimary = primary; savedAccent = accent; select('tone').value = String(tone); select('palette').value = 'custom'; theme(); syncColor(); paintSaved(); save(); };
  $('primary').onclick = () => { selected = 'primary'; $('primary').classList.add('on'); $('accent').classList.remove('on'); syncColor(); };
  $('accent').onclick = () => { selected = 'accent'; $('accent').classList.add('on'); $('primary').classList.remove('on'); syncColor(); };
  input('hex').oninput = () => { const value = input('hex').value; if (/^[0-9a-f]{6}$/i.test(value)) setColor(value.toLowerCase()); };
  input('hex').onkeydown = e => { if (e.key === 'Enter') { const value = input('hex').value; if (/^[0-9a-f]{6}$/i.test(value)) setColor(value.toLowerCase()); input('hex').blur(); } };
  bindColor($('color-square'), (x, y) => { hue[1] = x; hue[2] = 1 - y; setColor(hex(h2rgb(hue[0], hue[1], hue[2]))); });
  bindColor($('hue-bar'), x => { hue[0] = x * 360; setColor(hex(h2rgb(hue[0], hue[1], hue[2]))); });
  $('charset').onchange = () => { renderer.set = select('charset').value; renderer.updateAtlas(); };
  $('preset').onchange = () => { const p = quality[select('preset').value as keyof typeof quality]; if (p) for (const [id, value] of Object.entries(p)) input(id).value = String(value); save(); };
  $('demo').onclick = () => { stopWebcam(); mode = 'demo'; source = demo; setSourceUI('demo'); video.pause(); $('message').textContent = 'demo feed'; };
  $('camera').onclick = async () => {
    try {
      stopWebcam();
      const request = navigator.mediaDevices?.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
      if (!request) throw new Error('camera api unavailable');
      webcam = await Promise.race([request, new Promise<MediaStream>((_, reject) => setTimeout(() => reject(new Error('camera request timed out')), 8000))]);
      cameraVideo.srcObject = webcam;
      await new Promise<void>((resolve, reject) => {
        const done = () => { cameraVideo.removeEventListener('loadedmetadata', done); resolve(); };
        cameraVideo.addEventListener('loadedmetadata', done, { once: true });
        setTimeout(() => cameraVideo.videoWidth ? resolve() : reject(new Error('camera metadata unavailable')), 4000);
      });
      await cameraVideo.play();
      mode = 'webcam'; source = cameraVideo;
      setSourceUI('webcam'); $('message').textContent = 'webcam';
    } catch {
      stopWebcam(); mode = 'demo'; source = demo; setSourceUI('demo'); $('message').textContent = 'webcam unavailable or permission denied';
    }
  };
  $('file').onchange = () => { const file = ($('file') as HTMLInputElement).files?.[0]; if (file) load(file); };
  $('play').onclick = () => { if (mode === 'file') video.paused ? video.play() : video.pause(); else paused = !paused; $('play').textContent = paused || video.paused ? 'play' : 'pause'; };
  $('speed').onchange = () => { video.playbackRate = +($('speed') as HTMLSelectElement).value; };
  $('seek').oninput = () => { if (video.duration) video.currentTime = +($('seek') as HTMLInputElement).value / 1000 * video.duration; };
  video.ontimeupdate = () => { if (video.duration && !input('seek').matches(':active')) { input('seek').value = String(video.currentTime / video.duration * 1000); $('time').textContent = `${Math.floor(video.currentTime / 60)}:${String(Math.floor(video.currentTime) % 60).padStart(2, '0')} / ${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration) % 60).padStart(2, '0')}`; } };
  $('snapshot').onclick = () => { const a = document.createElement('a'); a.href = out.toDataURL('image/png'); a.download = 'neon-ascii.png'; a.click(); };
  $('mic').onclick = () => { startMic().catch(() => $('message').textContent = 'mic unavailable'); };
  $('record').onclick = async () => { if (record) { record.stop(); return; } await startVideoAudio(); const stream = out.captureStream(60); audioDest?.stream.getAudioTracks().forEach(track => stream.addTrack(track)); chunks = []; const mime = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find(value => MediaRecorder.isTypeSupported(value)) || 'video/webm'; record = new MediaRecorder(stream, { mimeType: mime }); record.ondataavailable = e => chunks.push(e.data); record.onstop = () => { fileBlob(new Blob(chunks, { type: mime }), mime === 'video/mp4' ? 'neon-ascii.mp4' : 'neon-ascii.webm'); record = undefined; $('record').textContent = 'record'; }; record.start(); $('record').textContent = 'stop + save'; };
  $('mp4').onclick = () => { exportMp4().catch(() => { exportBusy = false; $('message').textContent = 'mp4 export failed'; }); };
  $('gif').onclick = () => { exportFrames('gif').catch(() => { exportBusy = false; $('message').textContent = 'gif export failed'; }); };
  $('frames').onclick = () => { exportFrames('png').catch(() => { exportBusy = false; $('message').textContent = 'png export failed'; }); };
  $('reset').onclick = () => { localStorage.removeItem('neon-state'); location.reload(); };
  $('out').onclick = () => { if (mode === 'file') video.paused ? video.play() : video.pause(); };
  $('out').ondblclick = toggleFull;
  addEventListener('dragover', e => e.preventDefault()); addEventListener('drop', e => { e.preventDefault(); const file = (e as DragEvent).dataTransfer?.files[0]; if (file?.type.startsWith('video/')) load(file); });
  addEventListener('keydown', e => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return; if (e.code === 'Space') { $('play').click(); e.preventDefault(); } else if (e.key.toLowerCase() === 't') $('app').classList.toggle('theatre'); else if (e.key.toLowerCase() === 'f') toggleFull(); else if (e.key.toLowerCase() === 'm') $('mic').click(); else if (e.key.toLowerCase() === 'r') $('record').click(); else if (e.key === '?') $('help').classList.toggle('show'); else if (e.key === 'ArrowLeft' && video.duration) video.currentTime -= 5; else if (e.key === 'ArrowRight' && video.duration) video.currentTime += 5; });
  const tip = $('tip'); for (const el of document.querySelectorAll<HTMLElement>('[data-tip]')) { const show = () => { tip.textContent = el.dataset.tip || ''; const r = el.getBoundingClientRect(); tip.style.display = 'block'; tip.style.left = `${r.left}px`; tip.style.top = `${r.bottom + 6}px`; }; el.onmouseenter = show; el.onmouseleave = () => { tip.style.display = 'none'; }; }
  requestAnimationFrame(frame);
};

start().catch(error => { $('message').textContent = error instanceof Error ? error.message : 'webgpu unavailable'; });