export const vertex = `
struct Out { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vsMain(@builtin(vertex_index) i: u32) -> Out {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  var o: Out;
  o.pos = vec4(p[i], 0.0, 1.0);
  o.uv = vec2((p[i].x + 1.0) * 0.5, (1.0 - p[i].y) * 0.5);
  return o;
}`;

export const grid = `${vertex}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> size: vec4<f32>;
@fragment fn main(i: Out) -> @location(0) vec4<f32> {
  let c = i.uv * size.xy;
  var rgb = vec3(0.0);
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let p = (c + vec2(f32(x), f32(y)) * 0.33 + 0.5) / size.xy;
    rgb += textureSampleLevel(src, samp, p, 0.0).rgb;
  }}
  rgb /= 9.0;
  let lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  let warmth = clamp(0.5 + (rgb.b + rgb.r * 0.5 - rgb.g) * 0.5, 0.0, 1.0);
  return vec4(lum, warmth, 0.0, 1.0);
}`;

export const smooth = `${vertex}
@group(0) @binding(0) var cur: texture_2d<f32>;
@group(0) @binding(1) var prev: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> params: vec4<f32>;
@group(0) @binding(4) var flow: texture_2d<f32>;
@fragment fn main(i: Out) -> @location(0) vec4<f32> {
  let c = textureSampleLevel(cur, samp, i.uv, 0.0);
  let f = textureSampleLevel(flow, samp, i.uv, 0.0).xy - 0.5;
  let warp = clamp(i.uv + f / params.zw, vec2(0.0), vec2(1.0));
  let p = textureSampleLevel(prev, samp, warp, 0.0);
  let s = mix(c.r, p.r, params.x);
  let motion = max(abs(c.r - p.a), max(p.g * 0.82, length(f) * 0.5));
  return vec4(s, motion, c.g, c.r);
}`;

export const hist = `
@group(0) @binding(0) var state: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(state);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let v = textureLoad(state, vec2<i32>(id.xy), 0).r;
  let b = min(63u, u32(v * 63.999));
  atomicAdd(&bins[b], 1u);
}`;

export const autoLevels = `
@group(0) @binding(0) var<storage, read> bins: array<u32>;
@group(0) @binding(1) var<storage, read_write> levels: array<f32>;
@compute @workgroup_size(1) fn main() {
  var total = 0u;
  for (var n = 0u; n < 64u; n++) { total += bins[n]; }
  let lowMark = max(1u, u32(f32(total) * 0.02));
  let highMark = max(1u, u32(f32(total) * 0.98));
  var low = 0u;
  var high = 63u;
  var acc = 0u;
  for (var n = 0u; n < 64u; n++) {
    acc += bins[n];
    if (acc >= lowMark && low == 0u) { low = n; }
    if (acc >= highMark) { high = n; break; }
  }
  let nextLow = f32(low) / 64.0;
  let nextHigh = f32(high + 1u) / 64.0;
  levels[0] = levels[0] + (nextLow - levels[0]) * 0.1;
  levels[1] = levels[1] + (nextHigh - levels[1]) * 0.1;
}`;

export const flow = `
@group(0) @binding(0) var now: texture_2d<f32>;
@group(0) @binding(1) var old: texture_2d<f32>;
@group(0) @binding(2) var out: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(now);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2<i32>(id.xy);
  var best = 1000.0;
  var vec = vec2<i32>(0);
  for (var y = -3; y <= 3; y++) { for (var x = -3; x <= 3; x++) {
    var score = 0.0;
    for (var sy = -1; sy <= 1; sy++) { for (var sx = -1; sx <= 1; sx++) {
      let a = textureLoad(now, clamp(p + vec2(sx, sy), vec2(0), vec2<i32>(size) - 1), 0).r;
      let b = textureLoad(old, clamp(p + vec2(sx + x, sy + y), vec2(0), vec2<i32>(size) - 1), 0).r;
      score += abs(a - b);
    }}
    if (score < best) { best = score; vec = vec2<i32>(x, y); }
  }}
  textureStore(out, p, vec4<f32>(vec2<f32>(vec) / 6.0 + 0.5, min(best, 1.0), 1.0));
}`;

export const matte = `
@group(0) @binding(0) var now: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> bg: array<vec4<f32>>;
@group(0) @binding(2) var out: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(now);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let i = id.y * size.x + id.x;
  let c = textureLoad(now, vec2<i32>(id.xy), 0);
  let d = length(c.rgb - bg[i].rgb);
  let a = smoothstep(0.035, 0.18, d);
  bg[i] = mix(bg[i], c, select(0.018, 0.0, a > 0.2));
  textureStore(out, vec2<i32>(id.xy), vec4(a, 0.0, 0.0, 1.0));
}`;

export const particles = `
struct Particle { pos: vec2<f32>, vel: vec2<f32>, life: f32, seed: f32, pad: vec2<f32> };
struct Params { grid: vec2<f32>, dt: f32, time: f32, count: f32, pad: vec3<f32> };
@group(0) @binding(0) var flow: texture_2d<f32>;
@group(0) @binding(1) var matte: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<storage, read_write> data: array<Particle>;
@group(0) @binding(4) var<uniform> u: Params;
@group(0) @binding(5) var level: texture_2d<f32>;
fn rand(x: f32) -> f32 { return fract(sin(x * 91.17 + u.time * 1.7) * 43758.5); }
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (f32(id.x) >= u.count) { return; }
  var p = data[id.x];
  if (p.life <= 0.0 || p.pos.x < 0.0 || p.pos.y < 0.0 || p.pos.x >= u.grid.x || p.pos.y >= u.grid.y) {
    p.pos = vec2(rand(f32(id.x) + 1.0) * u.grid.x, rand(f32(id.x) + 3.0) * u.grid.y);
    p.vel = vec2(0.0);
    let uv = (p.pos + 0.5) / u.grid;
    let step = vec2<f32>(1.0, 1.0) / u.grid;
    let c = textureSampleLevel(level, samp, uv, 0.0).r;
    let l = textureSampleLevel(level, samp, uv + vec2<f32>(-step.x, 0.0), 0.0).r;
    let r = textureSampleLevel(level, samp, uv + vec2<f32>(step.x, 0.0), 0.0).r;
    let t = textureSampleLevel(level, samp, uv + vec2<f32>(0.0, -step.y), 0.0).r;
    let b = textureSampleLevel(level, samp, uv + vec2<f32>(0.0, step.y), 0.0).r;
    let edge = length(vec2(r - l, b - t));
    let motion = min(1.0, textureSampleLevel(flow, samp, uv, 0.0).b * 4.0);
    let chance = u.pad.x * 0.22 * motion;
    if ((c > 0.55 || edge > 1.075) && motion > 0.02 && rand(f32(id.x) + 7.0) < chance) {
      p.life = 1.0;
      p.vel = vec2((rand(f32(id.x) + 9.0) - 0.5) * 0.18, -0.12 - rand(f32(id.x) + 11.0) * 0.08);
      p.pad.x = select(0.0, 1.0, rand(f32(id.x) + 13.0) > 0.5);
    } else {
      p.life = -1.0;
    }
  }
  let uv = (p.pos + 0.5) / u.grid;
  let f = textureSampleLevel(flow, samp, uv, 0.0);
  let m = textureSampleLevel(matte, samp, uv, 0.0).r;
  let activity = min(1.0, f.b * 4.0 + m * 0.8 + u.pad.y * 0.4 + u.pad.z * 0.8);
  p.vel = p.vel * 0.96 + (f.xy - 0.5) * (0.18 + activity * 0.25);
  p.vel.y += 0.012;
  p.pos += p.vel;
  p.life -= 0.022 + rand(p.seed + f32(id.x)) * 0.01;
  p.seed = fract(p.seed + 0.003 + activity * 0.01);
  data[id.x] = p;
}`;

export const particleVertex = `
struct Particle { pos: vec2<f32>, vel: vec2<f32>, life: f32, seed: f32, pad: vec2<f32> };
struct Params { grid: vec2<f32>, size: vec2<f32>, count: f32, pad: vec3<f32> };
@group(0) @binding(0) var<storage, read> data: array<Particle>;
@group(0) @binding(1) var<uniform> u: Params;
struct Out { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) life: f32, @location(2) glyph: f32 };
@vertex fn main(@builtin(vertex_index) id: u32) -> Out {
  let n = id / 6u;
  let c = id % 6u;
  let corners = array<vec2<f32>, 6>(vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(-1.0, 1.0), vec2(1.0, -1.0), vec2(1.0, 1.0));
  let p = data[n];
  let q = p.pos + corners[c] * u.size;
  let clip = vec2(q.x / u.grid.x * 2.0 - 1.0, 1.0 - q.y / u.grid.y * 2.0);
  var o: Out;
  o.pos = vec4(clip, 0.0, 1.0);
  o.uv = corners[c] * 0.5 + 0.5;
  o.life = clamp(p.life * 2.0, 0.0, 1.0);
  o.glyph = u.pad.x + select(4.0, 5.0, p.pad.x > 0.5);
  return o;
}`;

export const particleFragment = `
@group(0) @binding(2) var atlas: texture_2d<f32>;
@group(0) @binding(3) var palette: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;
@fragment fn main(@location(0) uv: vec2<f32>, @location(1) life: f32, @location(2) glyph: f32) -> @location(0) vec4<f32> {
  let mask = textureSampleLevel(atlas, samp, vec2((glyph * 24.0 + uv.x * 24.0) / 768.0, (31.0 * 32.0 + uv.y * 32.0) / 1024.0), 0.0).r;
  let color = textureSampleLevel(palette, samp, vec2(0.92, 0.5), 0.0).rgb;
  return vec4(color * mask * life, mask * life);
}`;

export const level = `${vertex}
@group(0) @binding(0) var state: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> bins: array<u32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> params: vec4<f32>;
@group(0) @binding(4) var<storage, read> levels: array<f32>;
@fragment fn main(i: Out) -> @location(0) vec4<f32> {
  let raw = textureSampleLevel(state, samp, i.uv, 0.0);
  let span = max(0.15, levels[1] - levels[0]);
  var v = clamp((raw.r - levels[0]) / span, 0.0, 1.0);
  v = pow(v, 1.0 / params.x);
  if (params.y > 0.5) { v = 1.0 - v; }
  return vec4(v, raw.g, raw.b, raw.a);
}`;

export const output = `${vertex}
struct Params { size: vec2<f32>, grid: vec2<f32>, glyphs: f32, levels: f32, contrast: f32, edge: f32, glow: f32, wire: f32, time: f32, rays: f32, audio: vec4<f32>, debug: f32, ramp: f32, pad: vec2<f32> };
@group(0) @binding(0) var cells: texture_2d<f32>;
@group(0) @binding(1) var atlas: texture_2d<f32>;
@group(0) @binding(2) var palette: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var<uniform> u: Params;
@group(0) @binding(5) var<storage, read> shapes: array<f32>;
@group(0) @binding(6) var<storage, read_write> history: array<u32>;
@group(0) @binding(7) var matte: texture_2d<f32>;
@group(0) @binding(8) var flow: texture_2d<f32>;
fn lum(p: vec2<f32>) -> f32 { return textureSampleLevel(cells, samp, clamp(p, vec2(0.5) / u.grid, vec2(1.0) - vec2(0.5) / u.grid), 0.0).r; }
fn hsv(c: vec3<f32>, a: f32) -> vec3<f32> {
  let k = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
  return c.z * mix(k.xxx, clamp(p - k.xxx, vec3(0.0), vec3(1.0)), c.y) + a;
}
@fragment fn main(i: Out) -> @location(0) vec4<f32> {
  let cellUv = i.uv * u.grid;
  let cell = floor(cellUv);
  let local = fract(cellUv);
  let uv = (cell + 0.5) / u.grid;
  let c = textureSampleLevel(cells, samp, uv, 0.0);
  if (u.debug > 0.5 && u.debug < 1.5) { return vec4(vec3(c.a), 1.0); }
  let matteValue = textureSampleLevel(matte, samp, uv, 0.0).r;
  let flowValue = textureSampleLevel(flow, samp, uv, 0.0);
  let tl = lum((cell + vec2(-1.0, -1.0) + 0.5) / u.grid); let tc = lum((cell + vec2(0.0, -1.0) + 0.5) / u.grid); let tr = lum((cell + vec2(1.0, -1.0) + 0.5) / u.grid);
  let ml = lum((cell + vec2(-1.0, 0.0) + 0.5) / u.grid); let mr = lum((cell + vec2(1.0, 0.0) + 0.5) / u.grid);
  let bl = lum((cell + vec2(-1.0, 1.0) + 0.5) / u.grid); let bc = lum((cell + vec2(0.0, 1.0) + 0.5) / u.grid); let br = lum((cell + vec2(1.0, 1.0) + 0.5) / u.grid);
  let gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  let gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  let edge = length(vec2(gx, gy));
  let edgeOn = edge > 1.9 - u.edge * 1.5;
  let angle = atan2(gy, gx);
  let bayer = array<f32, 16>(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  let bi = u32(cell.x % 4.0) + u32(cell.y % 4.0) * 4u;
  let dither = (bayer[bi] / 16.0 - 0.47) * 0.9;
  let ramp = clamp(c.r * (u.glyphs - 5.0) + dither + 0.5, 0.0, u.glyphs - 5.0);
  var glyph = u32(clamp(c.r * (u.ramp - 1.0) + dither + 0.5, 0.0, u.ramp - 1.0));
  if (edgeOn) {
    let a = (angle + 3.14159265) % 3.14159265;
    var e = 3.0;
    if (a < 0.392699 || a >= 2.748894) { e = 0.0; } else if (a < 1.178097) { e = 2.0; } else if (a < 1.963495) { e = 1.0; }
    glyph = u32(u.ramp + e);
  }
  if (u.wire > 0.5 && !edgeOn) { glyph = 0u; }
  var level = floor(clamp(c.r * (u.levels - 1.0) + 0.5, 0.0, u.levels - 1.0));
  var rainT = -1.0;
  if (u.pad.y > 0.5 && c.r <= 0.04 && !edgeOn) {
    let h1 = fract(sin(cell.x * 12.9898) * 43758.5453);
    let h2 = fract(sin(cell.x * 78.233 + 1.7) * 43758.5453);
    let n = 6.0 + floor(h2 * 12.0);
    let period = u.grid.y + n;
    let head = (u.time * (9.0 + h1 * 21.0) + h1 * period) % period;
    let k = floor(head - cell.y);
    if (k >= 0.0 && k < n) {
      let flick = floor(u.time * 10.0);
      glyph = 1u + u32(fract(sin(dot(cell + flick, vec2(12.9898, 78.233))) * 43758.5453) * (u.ramp - 1.0));
      level = select(max(1.0, floor((u.levels - 1.0) * 0.5 * (1.0 - k / n))), u.levels - 7.0, k < 0.5);
      rainT = select(0.2 + 0.5 * (1.0 - k / n), 0.95, k < 0.5);
    }
  }
  let footprint = vec2(24.0, 32.0) * u.grid / u.size;
  let tile = vec2(f32(glyph) * 24.0, level * 32.0);
  let inner = local * vec2(24.0, 32.0);
  var ink = 0.0;
  for (var sy = 0; sy < 2; sy++) { for (var sx = 0; sx < 2; sx++) {
    let off = (vec2(f32(sx), f32(sy)) - 0.5) * 0.5 * footprint;
    let q = clamp(inner + off, vec2(0.5), vec2(23.5, 31.5));
    ink += textureSampleLevel(atlas, samp, (tile + q) / vec2(768.0, 1024.0), 0.0).r;
  }}
  ink *= 0.25;
  let glyphTone = clamp((f32(glyph) + 0.45) / max(1.0, u.ramp - 1.0), 0.0, 1.0);
  let colorBase = clamp(max(max(0.12, c.r * 0.55 + c.b * 0.22 + min(1.0, c.g * 3.0) * 0.4 + select(0.0, 0.2, edgeOn)), glyphTone * 0.72), 0.0, 1.0);
  let colorT = select(colorBase, rainT, rainT >= 0.0);
  let color = textureSampleLevel(palette, samp, vec2(colorT, 0.5), 0.0).rgb;
  let scan = select(1.0, select(1.0, 0.6, u32(i.pos.y) % 3u == 0u), u.pad.x > 0.5);
  let bloom = 0.0;
  var shaft = 0.0;
  for (var ray = 1; ray <= 12; ray++) {
    let t = f32(ray) / 12.0;
    let sampleCell = mix(cell + 0.5, u.grid * 0.5, t * 0.72);
    shaft += max(0.0, lum(sampleCell / u.grid) - 0.68) * (1.0 - t) / 12.0;
  }
  shaft *= u.rays * 1.8 * (1.0 + u.audio.y * 0.5);
  let matteL = textureSampleLevel(matte, samp, clamp(uv - vec2(1.0, 0.0) / u.grid, vec2(0.0), vec2(1.0)), 0.0).r;
  let matteR = textureSampleLevel(matte, samp, clamp(uv + vec2(1.0, 0.0) / u.grid, vec2(0.0), vec2(1.0)), 0.0).r;
  let matteU = textureSampleLevel(matte, samp, clamp(uv - vec2(0.0, 1.0) / u.grid, vec2(0.0), vec2(1.0)), 0.0).r;
  let matteD = textureSampleLevel(matte, samp, clamp(uv + vec2(0.0, 1.0) / u.grid, vec2(0.0), vec2(1.0)), 0.0).r;
  let rim = smoothstep(0.08, 0.35, abs(matteValue - matteL) + abs(matteValue - matteR) + abs(matteValue - matteU) + abs(matteValue - matteD));
  let rimColor = textureSampleLevel(palette, samp, vec2(1.0, 0.5), 0.0).rgb;
  let motion = min(1.0, flowValue.b * 3.0);
  let glyphColor = select(color, vec3(1.0), u.debug > 1.5);
  return vec4(glyphColor * 1.0 * (ink * scan + bloom + shaft) + rimColor * rim * matteValue * (0.55 + motion * 0.8 + u.audio.w * 0.65), ink + rim * matteValue);
}`;

export const blit = `${vertex}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@fragment fn main(i: Out) -> @location(0) vec4<f32> { return textureSampleLevel(src, samp, i.uv, 0.0); }`;

export const composite = `${vertex}
@group(0) @binding(0) var glyphs: texture_2d<f32>;
@group(0) @binding(1) var bloomA: texture_2d<f32>;
@group(0) @binding(2) var bloomB: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var<uniform> params: vec4<f32>;
@fragment fn main(i: Out) -> @location(0) vec4<f32> {
  var uv = i.uv;
  let g = params.y;
  if (g > 0.0) {
    let band = floor(uv.y * 48.0);
    let tick = floor(params.z * 14.0);
    let r1 = fract(sin(band * 12.9898 + tick * 78.233) * 43758.5453);
    let r2 = fract(sin(band * 39.346 + tick * 11.135) * 24634.6345);
    if (r1 < g * (0.12 + params.w * 0.1)) { uv.x = fract(uv.x + (r2 - 0.5) * 0.08 * g); }
  }
  let base = textureSampleLevel(glyphs, samp, uv, 0.0);
  let glow = textureSampleLevel(bloomA, samp, uv, 0.0) * 0.9 + textureSampleLevel(bloomB, samp, uv, 0.0) * 1.4;
  return vec4(base.rgb + glow.rgb * params.x, 1.0);
}`;

export const fade = `${vertex}
@group(0) @binding(0) var<uniform> params: vec4<f32>;
@fragment fn main(i: Out) -> @location(0) vec4<f32> { return vec4(0.0, 0.0, 0.0, params.x); }`;