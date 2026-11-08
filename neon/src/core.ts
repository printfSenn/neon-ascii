import { autoLevels, blit, composite, fade, flow, grid, hist, level, matte, output, particleFragment, particleVertex, particles, smooth, vertex } from './shaders';

export type Options = {
  cols: number;
  rows: number;
  smoothing: number;
  contrast: number;
  edge: number;
  invert: boolean;
  wireframe: boolean;
  hue: number;
  glow: number;
  rays: number;
  sparks: number;
  debug: 'full' | 'raw' | 'atlas' | 'white';
  mirror: boolean;
  scanlines: boolean;
  rain: boolean;
  glitch: number;
  trail: number;
  quality: number;
  bass: number;
  mid: number;
  treble: number;
  onset: number;
  time: number;
};

export type Timing = { copy: number; grid: number; smooth: number; levels: number; glyph: number; total: number };

const stops = (p: number[], s: number[]): [number, number[]][] => [
  [0, p.map(v => v * 0.16)],
  [0.3, p.map(v => v * 0.62)],
  [0.55, p],
  [0.75, s],
  [1, s.map(v => v + (255 - v) * 0.6)]
];

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

export const palette = (primary: string, accent: string, tone = 2) => {
  const p = primary.match(/[0-9a-f]{2}/gi)!.map(v => parseInt(v, 16));
  const s = accent.match(/[0-9a-f]{2}/gi)!.map(v => parseInt(v, 16));
  const data = new Uint8Array(32 * 4);
  const ramp: [number, number[]][] = tone === 1 ? [[0, p.map(v => v * 0.16)], [0.35, p.map(v => v * 0.55)], [0.65, p], [1, p.map(v => v + (255 - v) * 0.6)]] : stops(p, s);
  for (let i = 0; i < 32; i++) {
    const t = i / 31;
    let a = ramp[0];
    let b = ramp[ramp.length - 1];
    for (let j = 1; j < ramp.length; j++) if (t <= ramp[j][0]) { a = ramp[j - 1]; b = ramp[j]; break; }
    const k = (t - a[0]) / (b[0] - a[0]);
    const c = mix(a[1], b[1], k);
    data.set([c[0], c[1], c[2], 255], i * 4);
  }
  return data;
};

const ramps: Record<string, string> = { classic: ' .,:;!i-~+=rxcvzJX*U#M%&$@', dense: ' .:-=+iltjrxnuvczXYUO0*#M@', blocks: ' ·▁▏▂▎░▘▝▖▗▃▍▚▞▒▄▌▀▅▋▆▓▉▇█', kana: ' ･ｦｱｳｴｶｷｺｻｼｽｾﾀﾂﾃﾅﾆﾋﾎﾏﾒﾓﾗﾘﾜ' };
const atlasText = (set: string) => (ramps[set] + '|-/\\\'*').slice(0, 32).padEnd(32, ' ');

export class Renderer {
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly sampler: GPUSampler;
  readonly linearSampler: GPUSampler;
  readonly atlas: GPUTexture;
  readonly paletteTex: GPUTexture;
  readonly gridPipe: GPURenderPipeline;
  readonly smoothPipe: GPURenderPipeline;
  readonly flowPipe: GPUComputePipeline;
  readonly mattePipe: GPUComputePipeline;
  readonly particlePipe: GPUComputePipeline;
  readonly particleRenderPipe: GPURenderPipeline;
  readonly levelPipe: GPURenderPipeline;
  readonly outputPipe: GPURenderPipeline;
  readonly blitPipe: GPURenderPipeline;
  readonly compositePipe: GPURenderPipeline;
  readonly fadePipe: GPURenderPipeline;
  readonly addPipe: GPURenderPipeline;
  readonly trailParams: GPUBuffer;
  readonly histPipe: GPUComputePipeline;
  readonly autoLevelsPipe: GPUComputePipeline;
  readonly gridSize: GPUBuffer;
  readonly smoothParams: GPUBuffer;
  readonly levelParams: GPUBuffer;
  readonly outputParams: GPUBuffer;
  readonly bins: GPUBuffer;
  readonly levels: GPUBuffer;
  readonly shapes: GPUBuffer;
  background: GPUBuffer;
  readonly particleParams: GPUBuffer;
  readonly particleDrawParams: GPUBuffer;
  readonly postParams: GPUBuffer;
  readonly particleData: GPUBuffer;
  readonly sampleCanvas: HTMLCanvasElement;
  readonly sampleCtx: CanvasRenderingContext2D;
  gridUpload?: GPUBuffer;
  gridStride = 0;
  readonly preCanvas = document.createElement('canvas');
  readonly preCtx = this.preCanvas.getContext('2d')!;
  glyphs: GPUBuffer;
  glyphCap = 0;
  rampCount = ramps.classic.length;
  readonly atlasView: GPUTextureView;
  readonly paletteView: GPUTextureView;
  gridTex?: GPUTexture;
  stateA?: GPUTexture;
  stateB?: GPUTexture;
  levelTex?: GPUTexture;
  bloomA?: GPUTexture;
  bloomB?: GPUTexture;
  glyphTex?: GPUTexture;
  trailTex?: GPUTexture;
  flowTex?: GPUTexture;
  matteTex?: GPUTexture;
  cols = 0;
  rows = 0;
  swap = false;
  primary = '10dc8c';
  accent = 'a855ff';
  set = 'classic';
  tone = 2;
  particleCount = 900;
  constructor(device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.linearSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.atlas = device.createTexture({ size: [768, 32 * 32], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.paletteTex = device.createTexture({ size: [32, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.atlasView = this.atlas.createView();
    this.paletteView = this.paletteTex.createView();
    this.gridSize = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.smoothParams = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.levelParams = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.outputParams = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bins = device.createBuffer({ size: 64 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.levels = device.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.levels, 0, new Float32Array([0, 1]));
    this.shapes = device.createBuffer({ size: 32 * 8 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.background = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.particleParams = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.particleDrawParams = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.postParams = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.trailParams = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampleCanvas = document.createElement('canvas');
    this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true })!;
    const seed = new Float32Array(this.particleCount * 8);
    for (let i = 0; i < this.particleCount; i++) seed[i * 8 + 5] = (i * 0.6180339887) % 1;
    this.particleData = device.createBuffer({ size: seed.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.particleData, 0, seed);
    this.glyphs = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const module = (code: string) => device.createShaderModule({ code });
    const layout = (entries: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ entries });
    const render = (code: string, entries: GPUBindGroupLayoutEntry[], formatOut: GPUTextureFormat, blend?: GPUBlendState) => {
      const l = layout(entries);
      return device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [l] }), vertex: { module: module(vertex), entryPoint: 'vsMain' }, fragment: { module: module(code), entryPoint: 'main', targets: [{ format: formatOut, blend }] }, primitive: { topology: 'triangle-list' } });
    };
    this.gridPipe = render(grid, [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }], 'rgba8unorm');
    this.smoothPipe = render(smooth, [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} }], 'rgba8unorm');
    this.levelPipe = render(level, [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }], 'rgba8unorm');
    this.outputPipe = render(output, [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} }, { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, { binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'storage' } }, { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: {} }], format);
    this.blitPipe = render(blit, [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} }], format);
    this.compositePipe = render(composite, [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} }, { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }], format);
    const blitEntries: GPUBindGroupLayoutEntry[] = [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} }];
    this.fadePipe = render(fade, [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }], format, { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' } });
    this.addPipe = render(blit, blitEntries, format, { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } });
    this.histPipe = device.createComputePipeline({ layout: 'auto', compute: { module: module(hist), entryPoint: 'main' } });
    this.autoLevelsPipe = device.createComputePipeline({ layout: 'auto', compute: { module: module(autoLevels), entryPoint: 'main' } });
    this.flowPipe = device.createComputePipeline({ layout: 'auto', compute: { module: module(flow), entryPoint: 'main' } });
    this.mattePipe = device.createComputePipeline({ layout: 'auto', compute: { module: module(matte), entryPoint: 'main' } });
    this.particlePipe = device.createComputePipeline({ layout: 'auto', compute: { module: module(particles), entryPoint: 'main' } });
    const particleLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: {} }] });
    this.particleRenderPipe = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [particleLayout] }), vertex: { module: module(particleVertex), entryPoint: 'main' }, fragment: { module: module(particleFragment), entryPoint: 'main', targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } } }] }, primitive: { topology: 'triangle-list' } });
    this.updateAtlas();
    this.updatePalette();
  }
  static async create(canvas: HTMLCanvasElement) {
    if (!navigator.gpu) throw new Error('webgpu unavailable');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('gpu unavailable');
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('canvas unavailable');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    device.pushErrorScope('validation');
    const renderer = new Renderer(device, context, format);
    const error = await device.popErrorScope();
    if (error) throw new Error(error.message);
    return renderer;
  }
  updatePalette() { const data = new Uint8Array(256); data.set(palette(this.primary, this.accent, this.tone)); this.device.queue.writeTexture({ texture: this.paletteTex }, data, { bytesPerRow: 256 }, [32, 1]); }
  updateAtlas() {
    const glyphs = atlasText(this.set);
    this.rampCount = ramps[this.set].length;
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 28px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const atlas = new Uint8Array(768 * 32 * 32);
    const shapes = new Float32Array(32 * 8);
    for (let g = 0; g < glyphs.length; g++) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, 24, 32);
      ctx.fillStyle = 'white';
      ctx.setTransform(1.4, 0, 0, 1, -4.8, 0);
      ctx.fillText(glyphs[g], 12, 16);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const tile = ctx.getImageData(0, 0, 24, 32).data;
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 3; sx++) {
        let sum = 0;
        for (let y = sy * 16; y < (sy + 1) * 16; y++) for (let x = sx * 8; x < (sx + 1) * 8; x++) sum += tile[(y * 24 + x) * 4] / 255;
        shapes[g * 8 + sy * 3 + sx] = sum / 128;
      }
      for (let level = 0; level < 32; level++) for (let y = 0; y < 32; y++) for (let x = 0; x < 24; x++) atlas[(g * 24 + x) + (level * 32 + y) * 768] = tile[(y * 24 + x) * 4] * (0.2 + level * 0.8 / 31);
    }
    this.device.queue.writeTexture({ texture: this.atlas }, atlas, { bytesPerRow: 768, rowsPerImage: 1024 }, [768, 1024]);
    this.device.queue.writeBuffer(this.shapes, 0, shapes);
  }
  size(source: HTMLVideoElement | HTMLCanvasElement, cols: number, quality = 1.6) {
    const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    if (!w || !h) return false;
    const rows = Math.max(8, Math.round(cols * h / w * 0.5));
    const canvas = this.context.canvas as HTMLCanvasElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wrap = canvas.parentElement?.clientWidth || canvas.clientWidth || 1120;
    const cell = Math.max(5, Math.min(26, Math.round(wrap * dpr * quality / cols)));
    const width = cols * cell, height = rows * cell * 2;
    if (this.cols === cols && this.rows === rows && canvas.width === width && canvas.height === height) return true;
    canvas.width = width; canvas.height = height;
    this.gridTex?.destroy(); this.stateA?.destroy(); this.stateB?.destroy(); this.levelTex?.destroy(); this.glyphTex?.destroy(); this.trailTex?.destroy();
    const make = () => this.device.createTexture({ size: [cols, rows], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    this.gridTex = make(); this.stateA = make(); this.stateB = make(); this.levelTex = make(); this.cols = cols; this.rows = rows; this.swap = false;
    this.sampleCanvas.width = cols; this.sampleCanvas.height = rows;
    this.gridUpload?.destroy();
    this.gridStride = Math.ceil(cols * 4 / 256) * 256;
    this.gridUpload = this.device.createBuffer({ size: this.gridStride * rows, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.flowTex?.destroy(); this.matteTex?.destroy();
    this.flowTex = this.device.createTexture({ size: [cols, rows], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
    this.matteTex = this.device.createTexture({ size: [cols, rows], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
    this.background.destroy();
    this.background = this.device.createBuffer({ size: cols * rows * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.background, 0, new Uint8Array(cols * rows * 16));
    this.glyphs.destroy(); this.glyphCap = cols * rows; this.glyphs = this.device.createBuffer({ size: this.glyphCap * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); this.device.queue.writeBuffer(this.glyphs, 0, new Uint32Array(this.glyphCap).fill(32));
    this.bloomA?.destroy(); this.bloomB?.destroy();
    this.glyphTex = this.device.createTexture({ size: [this.context.canvas.width, this.context.canvas.height], format: this.format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
    this.trailTex = this.device.createTexture({ size: [this.context.canvas.width, this.context.canvas.height], format: this.format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
    this.bloomA = this.device.createTexture({ size: [Math.max(1, this.context.canvas.width >> 1), Math.max(1, this.context.canvas.height >> 1)], format: this.format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
    this.bloomB = this.device.createTexture({ size: [Math.max(1, this.context.canvas.width >> 2), Math.max(1, this.context.canvas.height >> 2)], format: this.format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
    return true;
  }
  reset() {
    this.swap = false;
    const seed = new Float32Array(this.particleCount * 8);
    for (let i = 0; i < this.particleCount; i++) seed[i * 8 + 5] = (i * 0.6180339887) % 1;
    this.device.queue.writeBuffer(this.particleData, 0, seed);
    this.device.queue.writeBuffer(this.glyphs, 0, new Uint32Array(this.glyphCap).fill(32));
    this.device.queue.writeBuffer(this.background, 0, new Uint8Array(this.cols * this.rows * 16));
    this.device.queue.writeBuffer(this.levels, 0, new Float32Array([0, 1]));
    const encoder = this.device.createCommandEncoder();
    for (const texture of [this.gridTex, this.stateA, this.stateB, this.levelTex, this.flowTex, this.matteTex]) {
      if (!texture) continue;
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
      pass.end();
    }
    this.device.queue.submit([encoder.finish()]);
  }
  draw(source: HTMLVideoElement | HTMLCanvasElement, options: Options): Timing {
    const start = performance.now();
    if (!this.size(source, options.cols, options.quality)) return { copy: 0, grid: 0, smooth: 0, levels: 0, glyph: 0, total: 0 };
    this.sampleCtx.clearRect(0, 0, this.cols, this.rows);
    this.sampleCtx.save();
    if (options.mirror) { this.sampleCtx.translate(this.cols, 0); this.sampleCtx.scale(-1, 1); }
    const pw = this.cols * 3, ph = this.rows * 3;
    if (this.preCanvas.width !== pw || this.preCanvas.height !== ph) { this.preCanvas.width = pw; this.preCanvas.height = ph; }
    this.preCtx.imageSmoothingQuality = 'high';
    this.preCtx.drawImage(source, 0, 0, pw, ph);
    this.sampleCtx.imageSmoothingQuality = 'high';
    this.sampleCtx.drawImage(this.preCanvas, 0, 0, this.cols, this.rows);
    this.sampleCtx.restore();
    const pixels = this.sampleCtx.getImageData(0, 0, this.cols, this.rows).data;
    const stride = this.gridStride;
    const gridData = new Uint8Array(stride * this.rows);
    for (let i = 0; i < this.cols * this.rows; i++) {
      const o = i * 4;
      const lum = Math.round(0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2]);
      const warmth = Math.max(0, Math.min(255, Math.round(128 + (pixels[o + 2] + pixels[o] * 0.5 - pixels[o + 1]) * 0.5)));
      const row = (i / this.cols) | 0;
      const dst = row * stride + (i % this.cols) * 4;
      gridData[dst] = lum; gridData[dst + 1] = warmth; gridData[dst + 3] = 255;
    }
    this.device.queue.writeBuffer(this.gridUpload!, 0, gridData);
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToTexture({ buffer: this.gridUpload!, bytesPerRow: stride, rowsPerImage: this.rows }, { texture: this.gridTex! }, [this.cols, this.rows, 1]);
    const copy = performance.now();
    const view = (t: GPUTexture) => t.createView();
    const pass = (pipe: GPURenderPipeline, target: GPUTextureView, entries: GPUBindGroupEntry[]) => { const p = encoder.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] }); p.setPipeline(pipe); p.setBindGroup(0, this.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries })); p.draw(3); p.end(); };
    const gridTime = performance.now();
    const prev = this.swap ? this.stateB! : this.stateA!;
    const next = this.swap ? this.stateA! : this.stateB!;
    const compute = encoder.beginComputePass();
    compute.setPipeline(this.flowPipe);
    compute.setBindGroup(0, this.device.createBindGroup({ layout: this.flowPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: view(this.gridTex!) }, { binding: 1, resource: view(prev) }, { binding: 2, resource: this.flowTex!.createView() }] }));
    compute.dispatchWorkgroups(Math.ceil(this.cols / 8), Math.ceil(this.rows / 8));
    compute.setPipeline(this.mattePipe);
    compute.setBindGroup(0, this.device.createBindGroup({ layout: this.mattePipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: view(this.gridTex!) }, { binding: 1, resource: { buffer: this.background } }, { binding: 2, resource: this.matteTex!.createView() }] }));
    compute.dispatchWorkgroups(Math.ceil(this.cols / 8), Math.ceil(this.rows / 8));
    this.device.queue.writeBuffer(this.particleParams, 0, new Float32Array([this.cols, this.rows, 1 / 60, options.time, this.particleCount, 0, 0, 0, options.sparks, options.bass, options.onset, 0]));
    this.device.queue.writeBuffer(this.particleDrawParams, 0, new Float32Array([this.cols, this.rows, 0.78, 0.92, this.particleCount, 0, 0, 0, this.rampCount, 0, 0, 0]));
    compute.setPipeline(this.particlePipe);
    compute.setBindGroup(0, this.device.createBindGroup({ layout: this.particlePipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.flowTex!.createView() }, { binding: 1, resource: this.matteTex!.createView() }, { binding: 2, resource: this.sampler }, { binding: 3, resource: { buffer: this.particleData } }, { binding: 4, resource: { buffer: this.particleParams } }, { binding: 5, resource: this.levelTex!.createView() }] }));
    compute.dispatchWorkgroups(Math.ceil(this.particleCount / 64));
    compute.end();
    this.device.queue.writeBuffer(this.smoothParams, 0, new Float32Array([options.smoothing, 0, this.cols, this.rows]));
    pass(this.smoothPipe, view(next), [{ binding: 0, resource: view(this.gridTex!) }, { binding: 1, resource: view(prev) }, { binding: 2, resource: this.sampler }, { binding: 3, resource: { buffer: this.smoothParams } }, { binding: 4, resource: this.flowTex!.createView() }]);
    const smoothTime = performance.now();
    this.device.queue.writeBuffer(this.bins, 0, new Uint32Array(64));
    const histPass = encoder.beginComputePass();
    histPass.setPipeline(this.histPipe);
    histPass.setBindGroup(0, this.device.createBindGroup({ layout: this.histPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: view(next) }, { binding: 1, resource: { buffer: this.bins } }] }));
    histPass.dispatchWorkgroups(Math.ceil(this.cols / 8), Math.ceil(this.rows / 8));
    histPass.end();
    const autoPass = encoder.beginComputePass();
    autoPass.setPipeline(this.autoLevelsPipe);
    autoPass.setBindGroup(0, this.device.createBindGroup({ layout: this.autoLevelsPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.bins } }, { binding: 1, resource: { buffer: this.levels } }] }));
    autoPass.dispatchWorkgroups(1);
    autoPass.end();
    const debug = options.debug === 'raw' ? 1 : options.debug === 'atlas' ? 2 : options.debug === 'white' ? 3 : 0;
    this.device.queue.writeBuffer(this.outputParams, 0, new Float32Array([this.context.canvas.width, this.context.canvas.height, this.cols, this.rows, 32, 32, options.contrast / 100, options.edge / 100, options.glow / 100, options.wireframe ? 1 : 0, options.time, options.rays / 100, options.bass, options.mid, options.treble, options.onset, debug, this.rampCount, options.scanlines ? 1 : 0, options.rain ? 1 : 0]));
    const levels = performance.now();
    this.device.queue.writeBuffer(this.levelParams, 0, new Float32Array([options.contrast / 100, options.invert ? 1 : 0, 0, 0]));
    pass(this.levelPipe, view(this.levelTex!), [{ binding: 0, resource: view(next) }, { binding: 1, resource: { buffer: this.bins } }, { binding: 2, resource: this.sampler }, { binding: 3, resource: { buffer: this.levelParams } }, { binding: 4, resource: { buffer: this.levels } }]);
    const screen = this.context.getCurrentTexture().createView();
    const target = options.debug === 'full' ? this.glyphTex!.createView() : screen;
    const out = encoder.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    out.setPipeline(this.outputPipe);
    out.setBindGroup(0, this.device.createBindGroup({ layout: this.outputPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: view(this.levelTex!) }, { binding: 1, resource: this.atlasView }, { binding: 2, resource: this.paletteView }, { binding: 3, resource: this.linearSampler }, { binding: 4, resource: { buffer: this.outputParams } }, { binding: 5, resource: { buffer: this.shapes } }, { binding: 6, resource: { buffer: this.glyphs } }, { binding: 7, resource: this.matteTex!.createView() }, { binding: 8, resource: this.flowTex!.createView() }] }));
    out.draw(3); out.end();
    if (options.debug === 'full') {
      pass(this.blitPipe, this.bloomA!.createView(), [{ binding: 0, resource: this.glyphTex!.createView() }, { binding: 1, resource: this.linearSampler }]);
      pass(this.blitPipe, this.bloomB!.createView(), [{ binding: 0, resource: this.bloomA!.createView() }, { binding: 1, resource: this.linearSampler }]);
      this.device.queue.writeBuffer(this.postParams, 0, new Float32Array([Math.min(1.6, options.glow / 100), options.glitch / 100, options.time % 1000, Math.min(1, options.bass)]));
      this.device.queue.writeBuffer(this.trailParams, 0, new Float32Array([1 - options.trail * 0.85, 0, 0, 0]));
      const trailPass = encoder.beginRenderPass({ colorAttachments: [{ view: this.trailTex!.createView(), loadOp: 'load', storeOp: 'store' }] });
      trailPass.setPipeline(this.fadePipe);
      trailPass.setBindGroup(0, this.device.createBindGroup({ layout: this.fadePipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.trailParams } }] }));
      trailPass.draw(3);
      trailPass.setPipeline(this.addPipe);
      trailPass.setBindGroup(0, this.device.createBindGroup({ layout: this.addPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.glyphTex!.createView() }, { binding: 1, resource: this.linearSampler }] }));
      trailPass.draw(3);
      trailPass.end();
      const compositePass = encoder.beginRenderPass({ colorAttachments: [{ view: screen, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      compositePass.setPipeline(this.compositePipe);
      compositePass.setBindGroup(0, this.device.createBindGroup({ layout: this.compositePipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.trailTex!.createView() }, { binding: 1, resource: this.bloomA!.createView() }, { binding: 2, resource: this.bloomB!.createView() }, { binding: 3, resource: this.linearSampler }, { binding: 4, resource: { buffer: this.postParams } }] }));
      compositePass.draw(3); compositePass.end();
    }
    if (options.debug === 'full' || options.debug === 'white') {
      const spark = encoder.beginRenderPass({ colorAttachments: [{ view: screen, loadOp: 'load', storeOp: 'store' }] });
      spark.setPipeline(this.particleRenderPipe);
      spark.setBindGroup(0, this.device.createBindGroup({ layout: this.particleRenderPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.particleData } }, { binding: 1, resource: { buffer: this.particleDrawParams } }, { binding: 2, resource: this.atlasView }, { binding: 3, resource: this.paletteView }, { binding: 4, resource: this.sampler }] }));
      spark.draw(this.particleCount * 6); spark.end();
    }
    this.device.queue.submit([encoder.finish()]);
    this.swap = !this.swap;
    return { copy: copy - start, grid: gridTime - copy, smooth: smoothTime - gridTime, levels: performance.now() - levels, glyph: performance.now() - levels, total: performance.now() - start };
  }
}