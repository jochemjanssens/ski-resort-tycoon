// Canvas rendering: hill-shaded terrain cache, overlays, lifts, buildings, guests.

const R = {
  canvas: null, ctx: null, dpr: 1,
  cam: { x: 0, y: 0, zoom: 1.4 },
  terrain: null, overlay: null, slope: null,
  overlayDirty: true, view: 'none', dyn: null, dynAt: 0, lastOverlay: 0,
};

const VIEWS = {
  none: { name: 'Normal', icon: '🏔️' },
  slope: { name: 'Slope difficulty', icon: '📐' },
  condition: { name: 'Piste condition', icon: '🧊' },
  snow: { name: 'Snow depth', icon: '❄️' },
  traffic: { name: 'Skier traffic', icon: '🔥' },
  queues: { name: 'Lift queues', icon: '⏱️' },
};

function heatColor(t, a) {
  // 0 = green, 0.5 = yellow, 1 = red
  const r = t < 0.5 ? Math.round(80 + 350 * t) : 255, g = t < 0.5 ? 200 : Math.round(200 - 340 * (t - 0.5));
  return `rgba(${r},${Math.max(40, g)},60,${a})`;
}

function buildDynOverlay() {
  const ctx = flatCanvas();
  let maxT = 1;
  if (R.view === 'traffic') for (let i = 0; i < T.traffic.length; i++) maxT = Math.max(maxT, T.traffic[i]);
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const x = tx(i) * TILE, y = ty(i) * TILE;
    if (R.view === 'condition' && T.piste[i] && !T.village[i]) {
      ctx.fillStyle = heatColor(1 - pisteQuality(i), 0.6);
      ctx.fillRect(x, y, TILE, TILE);
    } else if (R.view === 'snow' && !T.village[i]) {
      const d = snowAt(i);
      const t = clamp(d / 160, 0, 1);
      ctx.fillStyle = d < 30 ? `rgba(200,120,60,${0.55 - d / 80})` : `rgba(40,110,230,${0.08 + t * 0.5})`;
      ctx.fillRect(x, y, TILE, TILE);
      if (T.cannon[i]) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + 6, y + 6, 4, 4); }
    } else if (R.view === 'traffic' && T.traffic[i] > 0) {
      ctx.fillStyle = heatColor(Math.sqrt(T.traffic[i] / maxT), 0.65);
      ctx.fillRect(x, y, TILE, TILE);
    }
  }
  R.dyn = warp(R.flat);
  R.dynAt = performance.now();
}

function initRender(canvas) {
  R.canvas = canvas;
  R.ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  R.dpr = window.devicePixelRatio || 1;
  R.canvas.width = Math.floor(window.innerWidth * R.dpr);
  R.canvas.height = Math.floor(window.innerHeight * R.dpr);
  R.canvas.style.width = window.innerWidth + 'px';
  R.canvas.style.height = window.innerHeight + 'px';
  clampCam();
}

// ---------- 2.5D projection ----------
// The map is drawn tilted: depth is foreshortened by KY and every point is lifted by its altitude.
const KY = 0.72;   // north–south foreshortening
const EZ = 0.3;    // screen px per metre of altitude

function mapW() { return R.tp ? R.tp.PW : MAP_W * TILE; }
function mapH() { return R.tp ? R.tp.PH : MAP_H * TILE; }

// Altitude in screen px at a world point (px), bilinear over the vertex heights.
function elevAt(wx, wy) {
  const tp = R.tp;
  if (!tp) return 0;
  const fx = clamp(wx / TILE, 0, MAP_W), fy = clamp(wy / TILE, 0, MAP_H);
  const ix = Math.min(Math.floor(fx), MAP_W - 1), iy = Math.min(Math.floor(fy), MAP_H - 1), rx = fx - ix, ry = fy - iy;
  const a = iy * tp.VW + ix, v = tp.vh;
  const h = (v[a] * (1 - rx) + v[a + 1] * rx) * (1 - ry) + (v[a + tp.VW] * (1 - rx) + v[a + tp.VW + 1] * rx) * ry;
  return (h - BASE_ALT) * EZ;
}
function projY(wx, wy) { return R.tp ? wy * KY - elevAt(wx, wy) + R.tp.off : wy; }
// Project a point given in tile units.
function P(x, y) { return [x * TILE, projY(x * TILE, y * TILE)]; }

// Screen-space (projected) y back to a world y in column wx.
function unprojectY(wx, Y) {
  if (!R.tp) return Y;
  let lo = -TILE * 4, hi = MAP_H * TILE + TILE * 4;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (projY(wx, mid) < Y) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Draw something authored in flat world px around (wx, wy), standing at that spot on the slope.
function withAnchor(ctx, wx, wy, fn) {
  ctx.save();
  ctx.translate(wx, projY(wx, wy));
  ctx.scale(1, KY);
  ctx.translate(-wx, -wy);
  fn();
  ctx.restore();
}

// Outline of tile i on the slope (four projected corners).
function tilePath(ctx, i) {
  const x = tx(i), y = ty(i);
  const a = P(x, y), b = P(x + 1, y), c = P(x + 1, y + 1), d = P(x, y + 1);
  ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath();
}

// Re-draw a flat world-sized canvas onto the tilted, lifted map.
function warp(src) {
  const { w, h, PW, PH, map } = R.tp;
  const sd = new Uint32Array(src.getContext('2d').getImageData(0, 0, w, h).data.buffer);
  const c = document.createElement('canvas');
  c.width = PW; c.height = PH;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(PW, PH);
  const dd = new Uint32Array(img.data.buffer);
  for (let i = 0; i < dd.length; i++) { const m = map[i]; if (m >= 0) dd[i] = sd[m]; }
  ctx.putImageData(img, 0, 0);
  return c;
}

function flatCanvas() {
  if (!R.flat) { R.flat = document.createElement('canvas'); R.flat.width = MAP_W * TILE; R.flat.height = MAP_H * TILE; }
  const ctx = R.flat.getContext('2d');
  ctx.clearRect(0, 0, R.flat.width, R.flat.height);
  return ctx;
}

function clampCam() {
  const vw = window.innerWidth / R.cam.zoom, vh = window.innerHeight / R.cam.zoom;
  const mw = mapW(), mh = mapH(), pad = 200;
  R.cam.x = vw > mw ? (mw - vw) / 2 : clamp(R.cam.x, -pad, mw - vw + pad);
  R.cam.y = vh > mh ? (mh - vh) / 2 : clamp(R.cam.y, -pad, mh - vh + pad);
}

// Centre on a world point (px).
function centerCamOn(wx, wy) { centerCamOnProj(wx, projY(wx, wy)); }
function centerCamOnProj(X, Y) {
  R.cam.x = X - window.innerWidth / R.cam.zoom / 2;
  R.cam.y = Y - window.innerHeight / R.cam.zoom / 2;
  clampCam();
}

function screenToProj(sx, sy) {
  return { x: sx / R.cam.zoom + R.cam.x, y: sy / R.cam.zoom + R.cam.y };
}
function screenToWorld(sx, sy) {
  const p = screenToProj(sx, sy);
  return { x: p.x, y: unprojectY(p.x, p.y) };
}

function zoomAt(sx, sy, factor) {
  const before = screenToProj(sx, sy);
  R.cam.zoom = clamp(R.cam.zoom * factor, 0.5, 4);
  R.cam.x = before.x - sx / R.cam.zoom;
  R.cam.y = before.y - sy / R.cam.zoom;
  clampCam();
}

function hash(i, k) {
  let h = (i * 374761393 + k * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------- sun & terrain cache ----------

// Five pre-lit versions of the terrain across the ski day; render() cross-fades between them.
const SUN_KEYS = [480, 615, 750, 885, 1020];

function sunAt(m) {
  const t = clamp((m - SUN_KEYS[0]) / (SUN_KEYS[SUN_KEYS.length - 1] - SUN_KEYS[0]), 0, 1);
  const th = Math.PI * (0.12 + 0.76 * t);       // east in the morning, west in the evening
  const dx = Math.cos(th), dy = Math.sin(th) * 0.85, dl = Math.hypot(dx, dy);
  const e = 0.22 + 0.42 * Math.sin(Math.PI * t); // low winter sun, highest at noon
  return { dx: dx / dl, dy: dy / dl, e, t, warm: 1 - Math.sin(Math.PI * t) };
}

// Ground offset of the shadow cast by something h px tall.
function shadowVec(h, sun) {
  const len = Math.min(h / Math.tan(sun.e), h * 3.5);
  return { x: -sun.dx * len, y: -sun.dy * len };
}

// Per-terrain data shared by every sun key.
function prepTerrain() {
  const w = MAP_W * TILE, h = MAP_H * TILE;
  const VW = MAP_W + 1, VH = MAP_H + 1;
  const vh = new Float32Array(VW * VH);
  const th = (x, y) => T.height[clamp(y, 0, MAP_H - 1) * MAP_W + clamp(x, 0, MAP_W - 1)];
  for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
    vh[y * VW + x] = (th(x - 1, y - 1) + th(x, y - 1) + th(x - 1, y) + th(x, y)) / 4;
  }
  const vAt = (x, y) => vh[clamp(y, 0, VH - 1) * VW + clamp(x, 0, VW - 1)];
  // Ambient occlusion: hollows are a little darker than ridges.
  const ao = new Float32Array(VW * VH);
  for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
    let sum = 0, n = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { sum += vAt(x + dx, y + dy); n++; }
    ao[y * VW + x] = clamp((sum / n - vAt(x, y)) / 45, -0.5, 1);
  }
  const hp = new Float32Array(w * h);
  for (let py = 0; py < h; py++) {
    const fy = py / TILE, iy = Math.floor(fy), ry = fy - iy;
    for (let px = 0; px < w; px++) {
      const fx = px / TILE, ix = Math.floor(fx), rx = fx - ix;
      const a = iy * VW + ix;
      hp[py * w + px] = (vh[a] * (1 - rx) + vh[a + 1] * rx) * (1 - ry) + (vh[a + VW] * (1 - rx) + vh[a + VW + 1] * rx) * ry;
    }
  }
  // Contour lines every 50 m, heavier every 250 m.
  const contour = new Uint8Array(w * h);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const k = py * w + px, c0 = Math.floor(hp[k] / 50);
    const r = px + 1 < w ? hp[k + 1] : hp[k], d = py + 1 < h ? hp[k + w] : hp[k];
    if (Math.floor(r / 50) !== c0 || Math.floor(d / 50) !== c0) {
      contour[k] = Math.floor(hp[k] / 250) !== Math.floor(r / 250) || Math.floor(hp[k] / 250) !== Math.floor(d / 250) ? 2 : 1;
    }
  }
  // Projection: for every column, walk south and paint each source pixel over the rows it covers
  // (later rows are nearer the viewer, so they win). The result maps each screen pixel to a map pixel.
  let maxE = 0;
  for (let k = 0; k < hp.length; k++) maxE = Math.max(maxE, (hp[k] - BASE_ALT) * EZ);
  const off = Math.ceil(maxE) + 12;
  const PW = w, PH = Math.ceil((h - 1) * KY + off) + 1;
  const map = new Int32Array(PW * PH).fill(-1);
  for (let px = 0; px < w; px++) {
    let prev = -1;
    for (let py = 0; py < h; py++) {
      const k = py * w + px;
      const yd = Math.round(py * KY - (hp[k] - BASE_ALT) * EZ + off);
      const a = prev < 0 ? yd : Math.min(prev, yd), b = prev < 0 ? yd : Math.max(prev, yd);
      for (let r = Math.max(0, a); r <= b && r < PH; r++) map[r * PW + px] = k;
      prev = yd;
    }
  }
  R.tp = { w, h, VW, VH, vh, vAt, ao, hp, contour, off, PW, PH, map };
}

function buildSunKey(m) {
  const { w, h, VW, VH, vAt, ao, hp, contour } = R.tp;
  const sun = sunAt(m);
  const ce = Math.cos(sun.e), se = Math.sin(sun.e), rise = Math.tan(sun.e) * TILE_M / 1.6;
  const lit = new Float32Array(VW * VH);
  const EX = 3.2;
  for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
    const gx = (vAt(x + 1, y) - vAt(x - 1, y)) / (2 * TILE_M) * EX;
    const gy = (vAt(x, y + 1) - vAt(x, y - 1)) / (2 * TILE_M) * EX;
    const nl = Math.hypot(gx, gy, 1);
    const s = (-gx * sun.dx * ce - gy * sun.dy * ce + se) / nl;
    // Cast shadow: march towards the sun and see if the ground rises above the ray.
    const h0 = vAt(x, y);
    let shadow = 0;
    for (let k = 1; k <= 48 && shadow < 1; k++) {
      const st = k * 0.6, sx = x + sun.dx * st, sy = y + sun.dy * st;
      if (sx < 0 || sy < 0 || sx > VW - 1 || sy > VH - 1) break;
      const ix = Math.floor(sx), iy = Math.floor(sy), rx = sx - ix, ry = sy - iy;
      const hs = (vAt(ix, iy) * (1 - rx) + vAt(ix + 1, iy) * rx) * (1 - ry) + (vAt(ix, iy + 1) * (1 - rx) + vAt(ix + 1, iy + 1) * rx) * ry;
      shadow = Math.max(shadow, clamp((hs - (h0 + st * rise)) / 22, 0, 1));
    }
    let v = 0.74 + (s - se) * 2.3;
    v *= 1 - 0.45 * shadow;
    v -= ao[y * VW + x] * 0.16;
    lit[y * VW + x] = clamp(v, 0.05, 1.15);
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const warm = sun.warm;
  for (let py = 0; py < h; py++) {
    const fy = py / TILE, iy = Math.floor(fy), ry = fy - iy, trow = iy * MAP_W;
    for (let px = 0; px < w; px++) {
      const fx = px / TILE, ix = Math.floor(fx), rx = fx - ix;
      const a = iy * VW + ix, k = py * w + px, o = k * 4;
      const L = (lit[a] * (1 - rx) + lit[a + 1] * rx) * (1 - ry) + (lit[a + VW] * (1 - rx) + lit[a + VW + 1] * rx) * ry;
      let r, g, b;
      if (T.village[trow + ix]) {
        const n = hash(px, py) * 6, f = 0.86 + 0.16 * clamp(L, 0, 1);
        r = (224 + n) * f; g = (222 + n) * f; b = (218 + n) * f;
      } else {
        r = 100 + 150 * L; g = 124 + 128 * L; b = 176 + 78 * L;
        // warm low sun on lit slopes, summits a touch brighter
        r += warm * 14 * L; g += warm * 4 * L; b -= warm * 10 * L;
        const alt = clamp((hp[k] - BASE_ALT) / 1100, 0, 1);
        r += alt * 8 - 6; g += alt * 6 - 4;
        const n = (hash(px, py) - 0.5) * 5;
        r += n; g += n; b += n;
        const cl = contour[k];
        if (cl) { r -= cl === 2 ? 38 : 18; g -= cl === 2 ? 30 : 14; b -= cl === 2 ? 16 : 7; }
        // atmospheric haze: the far (upper) mountain fades towards the sky
        const hz = Math.pow(1 - py / h, 1.6) * 0.32;
        r += (200 - r) * hz; g += (214 - g) * hz; b += (232 - b) * hz;
      }
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Village edge + entrance road
  ctx.fillStyle = 'rgba(120,110,100,0.18)';
  ctx.fillRect(0, VILLAGE_Y * TILE, w, 2);
  ctx.fillStyle = '#6b6b70';
  ctx.fillRect(0, (MAP_H - 1) * TILE + 3, w, TILE - 6);
  ctx.fillRect(ENTRANCE.x * TILE + 2, (MAP_H - 2) * TILE, TILE - 4, TILE * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let x = 0; x < w; x += 12) ctx.fillRect(x, (MAP_H - 0.5) * TILE - 0.5, 6, 1);
  ctx.fillStyle = '#e8d34a';
  for (let y = (MAP_H - 2) * TILE + 2; y < MAP_H * TILE; y += 8) ctx.fillRect(ENTRANCE.x * TILE + TILE / 2 - 1, y, 2, 4);
  return warp(c);
}

// Which two sun keys to blend for minute m, and how much of the second.
function sunBlend(m) {
  const K = SUN_KEYS;
  if (m <= K[0]) return [0, 0, 0];
  for (let i = 0; i < K.length - 1; i++) if (m < K[i + 1]) return [i, i + 1, (m - K[i]) / (K[i + 1] - K[i])];
  return [K.length - 1, K.length - 1, 0];
}

function buildTerrainCanvas() {
  prepTerrain();
  const gen = (R.keyGen || 0) + 1;
  R.keyGen = gen;
  R.keys = SUN_KEYS.map(() => null);
  const [a, b] = sunBlend(S ? S.minute : SUN_KEYS[0]);
  R.keys[a] = buildSunKey(SUN_KEYS[a]);
  R.terrain = R.keys[a];
  // Light the rest of the day in the background, one key at a time.
  const pump = () => {
    if (R.keyGen !== gen) return;
    const order = [b, ...SUN_KEYS.keys()];
    const i = order.find(k => !R.keys[k]);
    if (i == null) return;
    R.keys[i] = buildSunKey(SUN_KEYS[i]);
    setTimeout(pump, 40);
  };
  setTimeout(pump, 60);
  R.tracks = null;
  R.overlayDirty = true;
  buildSlopeCanvas();
}

function buildSlopeCanvas() {
  const ctx = flatCanvas();
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (T.village[i]) continue;
    const d = T.diff[i];
    ctx.fillStyle = d >= 4 ? 'rgba(120,0,120,0.55)' : DIFFS[d].color;
    ctx.globalAlpha = d >= 4 ? 1 : (d === 3 ? 0.42 : 0.38);
    ctx.fillRect(tx(i) * TILE, ty(i) * TILE, TILE, TILE);
  }
  ctx.globalAlpha = 1;
  R.slope = warp(R.flat);
}

function pineShadow(ctx, x, y, s, sv) {
  // a cone's shadow: from the trunk base out to where the tip lands
  ctx.moveTo(x - s * 0.45, y + s * 0.1);
  ctx.lineTo(x + sv.x * s, y + s * 0.1 + sv.y * s);
  ctx.lineTo(x + s * 0.45, y + s * 0.1);
  ctx.closePath();
}

function drawPine(ctx, x, y, s, dark) {
  ctx.fillStyle = dark ? '#1f4d2c' : '#2a6337';
  ctx.beginPath(); ctx.moveTo(x, y - s * 1.1); ctx.lineTo(x + s * 0.55, y + s * 0.15); ctx.lineTo(x - s * 0.55, y + s * 0.15); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath(); ctx.moveTo(x, y - s * 1.1); ctx.lineTo(x + s * 0.2, y - s * 0.65); ctx.lineTo(x - s * 0.2, y - s * 0.65); ctx.closePath(); ctx.fill();
}

function buildOverlay() {
  let ctx = flatCanvas();
  // Pistes
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (!T.piste[i]) continue;
    const x = tx(i) * TILE, y = ty(i) * TILE, d = Math.min(3, T.diff[i]);
    const reach = T.reach && T.reach[i];
    ctx.fillStyle = reach ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.45)';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = DIFFS[d].color;
    ctx.globalAlpha = 0.13; ctx.fillRect(x, y, TILE, TILE); ctx.globalAlpha = 1;
    // corduroy
    ctx.fillStyle = 'rgba(150,170,200,0.25)';
    for (let k = 2; k < TILE; k += 4) ctx.fillRect(x, y + k, TILE, 1);
    const wear = 1 - T.cond[i] / 100;
    if (wear > 0.15) { ctx.fillStyle = `rgba(110,150,190,${wear * 0.55})`; ctx.fillRect(x, y, TILE, TILE); }
    // borders
    ctx.fillStyle = DIFFS[d].color;
    const X = tx(i), Y = ty(i);
    const edge = (nx, ny) => !inMap(nx, ny) || !T.piste[idx(nx, ny)];
    if (edge(X - 1, Y)) ctx.fillRect(x, y, 2, TILE);
    if (edge(X + 1, Y)) ctx.fillRect(x + TILE - 2, y, 2, TILE);
    if (edge(X, Y - 1)) ctx.fillRect(x, y, TILE, 2);
    if (edge(X, Y + 1)) ctx.fillRect(x, y + TILE - 2, TILE, 2);
    if (T.closed[i]) {
      ctx.strokeStyle = 'rgba(224,49,49,0.75)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = -TILE; k < TILE; k += 5) { ctx.moveTo(x + k, y + TILE); ctx.lineTo(x + k + TILE, y); }
      ctx.save(); ctx.rect(x, y, TILE, TILE); ctx.clip(); ctx.stroke(); ctx.restore();
    }
  }
  // Rocks
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (!T.rock[i]) continue;
    const x = tx(i) * TILE, y = ty(i) * TILE;
    for (let k = 0; k < 2; k++) {
      const cx = x + 4 + hash(i, k) * 8, cy = y + 4 + hash(i, k + 5) * 8, r = 3 + hash(i, k + 9) * 3;
      ctx.fillStyle = '#5d6470';
      ctx.beginPath(); ctx.moveTo(cx - r, cy + r * 0.6); ctx.lineTo(cx - r * 0.3, cy - r); ctx.lineTo(cx + r * 0.6, cy - r * 0.5); ctx.lineTo(cx + r, cy + r * 0.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8a919c';
      ctx.beginPath(); ctx.moveTo(cx - r * 0.3, cy - r); ctx.lineTo(cx + r * 0.6, cy - r * 0.5); ctx.lineTo(cx + r * 0.1, cy + r * 0.2); ctx.closePath(); ctx.fill();
    }
  }
  R.overlay = warp(R.flat);
  ctx = R.overlay.getContext('2d');
  // Trees stand upright on the slope: all shadows first (towards the current sun), then the trees, back to front
  const sv0 = shadowVec(1.1, sunAt(S.minute)), sv = { x: sv0.x, y: sv0.y * KY };
  const pines = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = idx(x, y);
    if (!T.tree[i]) continue;
    const n = 2 + Math.floor(hash(i, 1) * 2);
    for (let k = 0; k < n; k++) {
      const wx = x * TILE + 3 + hash(i, k * 3) * 10, wy = y * TILE + 6 + hash(i, k * 3 + 1) * 9;
      pines.push([wx, projY(wx, wy), 5 + hash(i, k * 3 + 2) * 3, hash(i, k + 20) > 0.5]);
    }
  }
  pines.sort((a, b) => a[1] - b[1]);
  ctx.fillStyle = 'rgba(38,58,100,0.24)';
  ctx.beginPath();
  for (const [x, y, sz] of pines) pineShadow(ctx, x, y, sz, sv);
  ctx.fill();
  for (const [x, y, sz, dark] of pines) drawPine(ctx, x, y, sz, dark);
  R.overlaySunMinute = S.minute;
  R.overlayDirty = false;
}

// ---------- per-frame ----------

function liftGeom(l) {
  const x0 = l.bx + 0.5, y0 = l.by + 0.5, x1 = l.tx + 0.5, y1 = l.ty + 0.5;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  return { x0, y0, x1, y1, len, ux, uy, px: -uy, py: ux };
}

const CABLE_H = { rope: 2.5, tbar: 4, chair2: 9, chair4: 10, gondola: 12 };
const SHADOW_FILL = 'rgba(30,45,85,0.22)';

// A box standing on the ground: shadow, south wall, then roof raised by h.
function drawBox(ctx, x, y, w, d, h, roof, wall, sun) {
  if (sun) {
    const sv = shadowVec(h, sun);
    ctx.fillStyle = SHADOW_FILL;
    ctx.beginPath();
    ctx.rect(x + sv.x, y + sv.y, w, d);
    ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w + sv.x, y + sv.y); ctx.lineTo(x + sv.x, y + sv.y); ctx.closePath();
    ctx.moveTo(x, y + d); ctx.lineTo(x + w, y + d); ctx.lineTo(x + w + sv.x, y + d + sv.y); ctx.lineTo(x + sv.x, y + d + sv.y); ctx.closePath();
    ctx.moveTo(x, y); ctx.lineTo(x, y + d); ctx.lineTo(x + sv.x, y + d + sv.y); ctx.lineTo(x + sv.x, y + sv.y); ctx.closePath();
    ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + d); ctx.lineTo(x + w + sv.x, y + d + sv.y); ctx.lineTo(x + w + sv.x, y + sv.y); ctx.closePath();
    ctx.fill('nonzero');
  }
  ctx.fillStyle = wall;
  ctx.fillRect(x, y + d - h, w, h);
  ctx.fillStyle = roof;
  ctx.fillRect(x, y - h, w, d);
}

function drawLiftLine(ctx, l, ghost, ok) {
  const L = LIFT_TYPES[l.type];
  const g = liftGeom(l);
  const off = l.type === 'rope' ? 0.12 : 0.2;
  const T_ = TILE, H = CABLE_H[l.type] / KY;
  const sun = sunAt(S.minute), sv = shadowVec(CABLE_H[l.type], sun);
  const ghostCol = ok ? '#2f9e44' : '#e03131';
  // ground point along the line (s tiles from the bottom, side offset o tiles), projected
  const at = (s, o) => P(g.x0 + g.ux * s + g.px * o, g.y0 + g.uy * s + g.py * o);
  const shadowAt = (s, o) => P(g.x0 + g.ux * s + g.px * o + sv.x / T_, g.y0 + g.uy * s + g.py * o + sv.y / T_);
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.75;
  const step = l.type === 'rope' ? 3 : 4;
  const towers = [];
  for (let s = step; s < g.len - 1; s += step) towers.push(s);
  // ground shadows of cable and towers
  ctx.strokeStyle = 'rgba(30,45,85,0.2)'; ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let s = 0; s <= g.len; s += 0.5) { const q = shadowAt(Math.min(s, g.len), 0); if (s === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); }
  for (const s of towers) { const a = at(s, 0), q = shadowAt(s, 0); ctx.moveTo(a[0], a[1]); ctx.lineTo(q[0], q[1]); }
  ctx.stroke();
  // stations (drawn before the cable so it runs over the roofs)
  for (const [x, y] of [[l.bx, l.by], [l.tx, l.ty]]) {
    const col = ghost ? ghostCol : L.color;
    withAnchor(ctx, (x + 0.5) * T_, (y + 0.5) * T_, () => {
      drawBox(ctx, x * T_ + 1, y * T_ + 2, T_ - 2, T_ - 3, 6, col, shade(col, -0.32), ghost ? null : sun);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(x * T_ + 3, y * T_ - 2, T_ - 6, 3);
    });
  }
  // towers
  ctx.strokeStyle = '#3b4252'; ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (const s of towers) { const a = at(s, 0); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0], a[1] - H); }
  ctx.stroke();
  ctx.fillStyle = '#3b4252';
  for (const s of towers) { const a = at(s, 0); ctx.fillRect(a[0] - 1.6 - Math.abs(g.ux) * 2, a[1] - H - 1, 3.2 + Math.abs(g.ux) * 4, 1.6); }
  // cables follow the terrain at height H, sagging slightly between towers
  ctx.strokeStyle = ghost ? ghostCol : '#2d2d33'; ctx.lineWidth = 1;
  for (const sgn of [1, -1]) {
    ctx.beginPath();
    const stops = [0, ...towers, g.len];
    for (let k = 0; k < stops.length - 1; k++) {
      const s0 = stops[k], s1 = stops[k + 1];
      for (let t = 0; t <= 1.0001; t += 0.25) {
        const s = s0 + (s1 - s0) * t, q = at(s, off * sgn);
        const y = q[1] - H + Math.sin(Math.PI * t) * 1.2;
        if (k === 0 && t === 0) ctx.moveTo(q[0], y); else ctx.lineTo(q[0], y);
      }
    }
    ctx.stroke();
  }
  if (!ghost && l.type !== 'rope' && l.type !== 'tbar') {
    // carriers hang under the cable and cast small shadows
    const spacing = l.type === 'gondola' ? 2.2 : 1.4;
    const phase = ((S.minute * L.speed) % spacing + spacing) % spacing;
    const csv = shadowVec(CABLE_H[l.type] - 3, sun);
    for (const sgn of [1, -1]) {
      for (let s = (sgn > 0 ? phase : spacing - phase); s < g.len; s += spacing) {
        const [x, y] = at(s, off * sgn);
        const cw = l.type === 'gondola' ? 5 : l.type === 'chair4' ? 5 : 3;
        ctx.fillStyle = 'rgba(30,45,85,0.18)'; ctx.fillRect(x - cw / 2 + csv.x, y + csv.y * KY - 1, cw, 2);
        ctx.strokeStyle = '#555'; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(x, y - H); ctx.lineTo(x, y - H + 3.5); ctx.stroke();
        if (l.type === 'gondola') { ctx.fillStyle = L.color; ctx.fillRect(x - 2.5, y - H + 3, 5, 5); ctx.fillStyle = '#bfe3ff'; ctx.fillRect(x - 1.7, y - H + 3.8, 3.4, 1.8); }
        else { ctx.fillStyle = '#333'; ctx.fillRect(x - cw / 2, y - H + 3.5, cw, 1.8); }
      }
    }
  }
  ctx.restore();
}

// Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour.
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function drawBuilding(ctx, b, ghost, ok) {
  const s = BUILDING_TYPES[b.type].size * TILE;
  withAnchor(ctx, b.x * TILE + s / 2, b.y * TILE + s / 2, () => drawBuildingFlat(ctx, b, ghost, ok));
}

function drawBuildingFlat(ctx, b, ghost, ok) {
  const B = BUILDING_TYPES[b.type];
  const x = b.x * TILE, y = b.y * TILE, s = B.size * TILE;
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.7;
  if (b.type === 'park' && !ghost) {
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    ctx.strokeStyle = '#e8590c'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
    // halfpipe
    ctx.fillStyle = '#a5c8ee'; ctx.fillRect(x + 4, y + 3, 7, s - 6);
    ctx.fillStyle = '#d6e6f7'; ctx.fillRect(x + 6, y + 3, 3, s - 6);
    // kickers and a rail
    for (const k of [0, 1]) {
      const jx = x + 16 + k * 7, jy = y + 6 + k * 12;
      ctx.fillStyle = 'rgba(40,60,90,0.25)'; ctx.beginPath(); ctx.ellipse(jx + 2, jy + 2, 4.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f1f5fb'; ctx.beginPath(); ctx.ellipse(jx, jy, 4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#9fb6d1'; ctx.lineWidth = 0.6; ctx.stroke();
    }
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 14, y + 26); ctx.lineTo(x + 26, y + 28); ctx.stroke();
    ctx.restore();
    return;
  }
  if (b.type === 'parking') {
    ctx.fillStyle = ghost ? (ok ? '#2f9e44' : '#e03131') : '#7a7d85';
    ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    ctx.fillStyle = '#fff';
    for (let k = 1; k < 4; k++) ctx.fillRect(x + k * s / 4, y + 3, 1, s / 2 - 4);
    if (!ghost) {
      const cars = ['#c53030', '#2b6cb0', '#e2e8f0', '#38a169', '#d69e2e', '#1a202c'];
      for (let k = 0; k < 4; k++) if (hash(b.id, k) < 0.8) {
        const cx = x + k * s / 4 + 2, csv = shadowVec(2, sunAt(S.minute));
        ctx.fillStyle = SHADOW_FILL; ctx.fillRect(cx + csv.x, y + 5 + csv.y, s / 4 - 4, 7);
        ctx.fillStyle = cars[Math.floor(hash(b.id, k + 7) * 6)]; ctx.fillRect(cx, y + 4, s / 4 - 4, 7);
        ctx.fillStyle = 'rgba(200,225,255,0.7)'; ctx.fillRect(cx + 1, y + 6, s / 4 - 6, 2);
      }
    }
  }
  let hgt = 0;
  if (b.type !== 'parking') {
    hgt = (b.type === 'cannon' ? 5 : B.size === 2 ? 11 : 8);
    const col = ghost ? (ok ? '#2f9e44' : '#e03131') : B.color;
    drawBox(ctx, x + 1, y + 1, s - 2, s - 2, hgt, col, shade(col, -0.35), ghost ? null : sunAt(S.minute));
    // snowy roof ridge
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.moveTo(x + 1, y + 1 - hgt); ctx.lineTo(x + s - 1, y + 1 - hgt); ctx.lineTo(x + s / 2, y + s * 0.45 - hgt); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(x + s / 2 - 0.5, y + 1 - hgt, 1, s * 0.44);
    // lit windows on the south wall
    ctx.fillStyle = S.minute > 16 * 60 + 15 ? '#ffd98a' : 'rgba(190,220,255,0.75)';
    for (let wx = x + 4; wx < x + s - 4; wx += 5) ctx.fillRect(wx, y + s - hgt + 1, 2, Math.max(1.5, hgt - 4));
  }
  ctx.font = `${B.size === 2 ? 15 : 10}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.globalAlpha = 1;
  ctx.fillText(B.icon, x + s / 2, y + s * 0.62 - hgt);
  if (b.type === 'cannon' && !ghost) {
    const t = performance.now() / 300;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let k = 0; k < 5; k++) {
      const a = (t + k * 1.3) % 3;
      ctx.beginPath(); ctx.arc(x + s / 2 + a * 6 + Math.sin(k * 7) * 3, y + s / 2 - a * 4 + Math.cos(k * 3) * 2, 1.2, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

function guestPos(g) {
  if (g.state === 'ride') {
    const l = S.lifts.find(x => x.id === g.lift);
    const r = l && l.riders.find(r => r.g === g);
    if (l && r) {
      const gm = liftGeom(l), off = l.type === 'rope' ? 0.12 : 0.2, p = clamp(r.p, 0, 1);
      const z = l.type === 'rope' || l.type === 'tbar' ? 0 : CABLE_H[l.type] - 3.5;
      return { x: gm.x0 + gm.ux * gm.len * p + gm.px * off, y: gm.y0 + gm.uy * gm.len * p + gm.py * off, riding: true, lift: l, z };
    }
  }
  if (g.state === 'queue') {
    const l = S.lifts.find(x => x.id === g.lift);
    if (l) {
      const k = l.queue.indexOf(g);
      const gm = liftGeom(l);
      const row = Math.floor(k / 6), col = k % 6;
      const along = 0.55 + row * 0.22, side = (col - 2.5) * 0.16;
      return { x: gm.x0 - gm.ux * along + gm.px * side, y: gm.y0 - gm.uy * along + gm.py * side };
    }
  }
  return { x: g.x, y: g.y };
}

function render() {
  const ctx = R.ctx, z = R.cam.zoom;
  const now = performance.now(), rdt = Math.min(0.1, (now - (R.lastT || now)) / 1000);
  R.lastT = now;
  if (R.overlaySunMinute == null || Math.abs(S.minute - R.overlaySunMinute) > 30) R.overlayDirty = true;
  // while painting, rebuild the (slow, warped) overlay at most ~5 times a second
  if (R.overlayDirty && (!UI.drag || now - (R.lastOverlay || 0) > 200)) { buildOverlay(); R.lastOverlay = now; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#121c2b';
  ctx.fillRect(0, 0, R.canvas.width, R.canvas.height);
  ctx.setTransform(R.dpr * z, 0, 0, R.dpr * z, -R.cam.x * z * R.dpr, -R.cam.y * z * R.dpr);
  ctx.imageSmoothingEnabled = true;
  drawSkyAndBase(ctx);
  // Terrain lit by the sun: cross-fade between the two nearest pre-lit keys
  const [ka, kb, kf] = sunBlend(S.minute);
  const A = R.keys[ka] || R.keys.find(k => k), B = R.keys[kb];
  ctx.drawImage(A, 0, 0);
  if (B && B !== A && kf > 0.01) { ctx.globalAlpha = kf; ctx.drawImage(B, 0, 0); ctx.globalAlpha = 1; }
  R.terrain = kf > 0.5 && B ? B : A;
  ctx.drawImage(R.overlay, 0, 0);
  drawTracks(ctx, rdt);
  if (R.view === 'slope') ctx.drawImage(R.slope, 0, 0);
  else if (R.view === 'condition' || R.view === 'snow' || R.view === 'traffic') {
    if (!R.dyn || performance.now() - R.dynAt > 800) buildDynOverlay();
    ctx.drawImage(R.dyn, 0, 0);
  }

  for (const b of S.buildings) drawBuilding(ctx, b);
  for (const l of S.lifts) drawLiftLine(ctx, l);

  // Guests: one batch of ground shadows, then the guests themselves
  const showDetail = z >= 1.2;
  const sun = sunAt(S.minute);
  const pos = new Map();
  ctx.fillStyle = 'rgba(25,40,80,0.28)';
  ctx.beginPath();
  for (const g of S.guests) {
    if (g.state === 'inside') continue;
    const p = guestPos(g);
    pos.set(g, p);
    const sv = shadowVec(2.5 + (p.z || 0), sun);
    const sx = p.x * TILE + sv.x * 0.6, sy = projY(p.x * TILE, p.y * TILE) + sv.y * 0.6 * KY;
    ctx.moveTo(sx + 1.8, sy); ctx.ellipse(sx, sy, 1.8, 1.1, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  for (const g of S.guests) {
    if (g.state === 'inside') continue;
    const p = pos.get(g);
    const X = p.x * TILE, Y = projY(X, p.y * TILE) - (p.z || 0) / KY - 1;
    if (p.riding && p.lift.type !== 'rope' && p.lift.type !== 'tbar') {
      ctx.fillStyle = '#333'; ctx.fillRect(X - 2, Y + 0.5, 4, 1.5);
    }
    const kid = g.kind === 'kid', sz = kid ? 0.7 : 1;
    if (g.state === 'injured') {
      ctx.fillStyle = '#fff'; ctx.fillRect(X - 3, Y - 3, 6, 6);
      ctx.fillStyle = '#e03131'; ctx.fillRect(X - 2.5, Y - 0.8, 5, 1.6); ctx.fillRect(X - 0.8, Y - 2.5, 1.6, 5);
      continue;
    }
    if (showDetail && g.state === 'walk' && !T.village[g.tile] && T.piste[g.tile]) {
      const a = g.dir || Math.PI / 2;
      const cx = Math.cos(a), cy = Math.sin(a);
      if (g.kind === 'board') {
        // board sits across the direction of travel
        ctx.strokeStyle = '#3b2f8f'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(X - cy * 2.6, Y + cx * 2.6); ctx.lineTo(X + cy * 2.6, Y - cx * 2.6); ctx.stroke();
        ctx.lineCap = 'butt';
      } else {
        ctx.strokeStyle = '#222'; ctx.lineWidth = 0.8;
        for (const o of [-0.9, 0.9]) {
          ctx.beginPath();
          ctx.moveTo(X - cx * 3 * sz - cy * o * sz, Y - cy * 3 * sz + cx * o * sz);
          ctx.lineTo(X + cx * 3 * sz - cy * o * sz, Y + cy * 3 * sz + cx * o * sz);
          ctx.stroke();
        }
      }
    }
    ctx.fillStyle = g.color;
    ctx.beginPath(); ctx.arc(X, Y, 1.9 * sz, 0, Math.PI * 2); ctx.fill();
    if (showDetail) { ctx.fillStyle = '#f2d0b5'; ctx.beginPath(); ctx.arc(X, Y - 1.6 * sz, 1 * sz, 0, Math.PI * 2); ctx.fill(); }
    if (Sel.kind === 'guest' && Sel.id === g.id) {
      ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(X, Y, 5, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // Lift warnings / labels
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  for (const l of S.lifts) {
    const [X, Y0] = P(l.tx + 0.5, l.ty + 0.5), Y = Y0 - 12;
    const [BX, BY] = P(l.bx + 0.5, l.by + 0.5);
    const blink = Math.floor(performance.now() / 500) % 2;
    if (R.view === 'queues' && l.usable) {
      const w = liftWait(l), t = isFinite(w) ? clamp(w / 12, 0, 1) : 1;
      const gm = liftGeom(l);
      ctx.strokeStyle = heatColor(t, 0.9); ctx.lineWidth = 4;
      ctx.beginPath();
      for (let k = 0; k <= 20; k++) { const q = P(gm.x0 + gm.ux * gm.len * k / 20, gm.y0 + gm.uy * gm.len * k / 20); if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }
      ctx.stroke();
      const label = isFinite(w) ? `${Math.round(w)} min · ${l.queue.length}` : 'BROKEN';
      ctx.font = 'bold 7px system-ui';
      const lw = ctx.measureText(label).width + 6;
      ctx.fillStyle = 'rgba(15,20,30,0.85)'; ctx.fillRect(BX - lw / 2, BY - 22, lw, 10);
      ctx.fillStyle = heatColor(t, 1); ctx.fillText(label, BX, BY - 13);
    }
    if (l.broken) {
      if (blink) { const m = P((l.bx + l.tx + 1) / 2, (l.by + l.ty + 1) / 2); ctx.font = '12px system-ui'; ctx.fillText('🔧', m[0], m[1] - 12); }
    } else if (!l.usable && blink) {
      ctx.font = '12px system-ui'; ctx.fillText('⚠️', X, Y);
    } else if (!l.open) {
      ctx.font = 'bold 7px system-ui'; ctx.fillStyle = '#e03131'; ctx.fillText('CLOSED', BX, BY - 12);
    }
    if (z >= 1.6 || (Sel.kind === 'lift' && Sel.id === l.id)) {
      ctx.font = '600 6px system-ui';
      ctx.fillStyle = 'rgba(20,25,35,0.75)';
      const w = ctx.measureText(l.name).width + 4;
      ctx.fillRect(BX - w / 2, BY + 7, w, 8);
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'top';
      ctx.fillText(l.name, BX, BY + 8);
      ctx.textBaseline = 'bottom';
    }
  }
  if (Sel.kind === 'lift') {
    const l = S.lifts.find(x => x.id === Sel.id);
    if (l) {
      ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2.5]);
      for (const [x, y] of [[l.bx, l.by], [l.tx, l.ty]]) withAnchor(ctx, (x + 0.5) * TILE, (y + 0.5) * TILE, () => ctx.strokeRect(x * TILE - 3, y * TILE - 9, TILE + 6, TILE + 12));
      ctx.setLineDash([]);
    }
  }
  if (Sel.kind === 'building') {
    const b = S.buildings.find(x => x.id === Sel.id);
    if (b) {
      const s = b.size * TILE;
      ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2.5]);
      withAnchor(ctx, b.x * TILE + s / 2, b.y * TILE + s / 2, () => ctx.strokeRect(b.x * TILE - 3, b.y * TILE - 14, s + 6, s + 17));
      ctx.setLineDash([]);
    }
  }

  drawCloudShadows(ctx, rdt);

  // Entrance arch
  ctx.save();
  ctx.translate(0, projY(ENTRANCE.x * TILE, ENTRANCE.y * TILE) - ENTRANCE.y * TILE);
  ctx.fillStyle = '#7b341e';
  ctx.fillRect(ENTRANCE.x * TILE - 4, (MAP_H - 2) * TILE + 2, 3, 12);
  ctx.fillRect((ENTRANCE.x + 1) * TILE + 1, (MAP_H - 2) * TILE + 2, 3, 12);
  ctx.fillRect(ENTRANCE.x * TILE - 6, (MAP_H - 2) * TILE - 2, TILE + 12, 6);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 4px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('SKI RESORT', (ENTRANCE.x + 0.5) * TILE, (MAP_H - 2) * TILE + 1);
  ctx.restore();

  drawToolPreview(ctx);

  // Day/night tint
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const m = S.minute;
  let tint = 0, col = '20,30,80';
  if (m > 15 * 60) {
    tint = clamp((m - 15 * 60) / 150, 0, 1) * 0.38;
    col = m < 16 * 60 + 30 ? '120,60,40' : '20,30,80';
    if (m > 17 * 60 + 30) tint = 0.38 + clamp((m - 17 * 60 - 30) / 60, 0, 1) * 0.3;
  } else if (m < 8 * 60 + 40) tint = clamp((8 * 60 + 40 - m) / 40, 0, 1) * 0.2;
  if (tint > 0) { ctx.fillStyle = `rgba(${col},${tint})`; ctx.fillRect(0, 0, R.canvas.width, R.canvas.height); }
  if (S.night.on && m > 16 * 60 + 15) drawFloodlights(ctx, clamp((m - 16 * 60 - 15) / 45, 0, 1));
  if (S.weather.type === 'snow' || S.weather.type === 'storm') drawSnowfall(ctx, S.weather.type === 'storm' ? 220 : 90);
  drawVignette(ctx);
}

// ---------- ski tracks ----------

// Skiers carve faint lines into the snow; they fade over time and the groomers wipe them each night.
function drawTracks(ctx, rdt) {
  if (!R.tracks) {
    R.tracks = document.createElement('canvas');
    R.tracks.width = mapW(); R.tracks.height = mapH();
    R.tracksDay = S.day;
  }
  const tc = R.tracks.getContext('2d');
  if (R.tracksDay !== S.day) { tc.clearRect(0, 0, R.tracks.width, R.tracks.height); R.tracksDay = S.day; }
  R.trackFade = (R.trackFade || 0) + rdt;
  if (R.trackFade > 2) {
    R.trackFade = 0;
    tc.globalCompositeOperation = 'destination-out';
    tc.fillStyle = 'rgba(0,0,0,0.12)';
    tc.fillRect(0, 0, R.tracks.width, R.tracks.height);
    tc.globalCompositeOperation = 'source-over';
  }
  tc.strokeStyle = 'rgba(105,130,175,0.2)'; tc.lineWidth = 0.8; tc.lineCap = 'round';
  tc.beginPath();
  for (const g of S.guests) {
    const skiing = g.state === 'walk' && T.piste[g.tile] && !T.village[g.tile];
    if (skiing && g._tx != null && Math.hypot(g.x - g._tx, g.y - g._ty) < 1.5) {
      tc.moveTo(g._tx * TILE, projY(g._tx * TILE, g._ty * TILE)); tc.lineTo(g.x * TILE, projY(g.x * TILE, g.y * TILE));
    }
    g._tx = skiing ? g.x : null; g._ty = g.y;
  }
  tc.stroke();
  ctx.drawImage(R.tracks, 0, 0);
}

// ---------- drifting cloud shadows ----------

const CLOUDS_BY_WEATHER = { sunny: 3, cloudy: 10, snow: 12, storm: 16, warm: 5 };

function cloudSprite() {
  if (R.cloudSprite) return R.cloudSprite;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(20,35,75,0.2)');
  grd.addColorStop(0.55, 'rgba(20,35,75,0.12)');
  grd.addColorStop(1, 'rgba(20,35,75,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return (R.cloudSprite = c);
}

function drawCloudShadows(ctx, rdt) {
  const W = mapW(), H = mapH();
  if (!R.clouds) {
    R.clouds = [];
    for (let k = 0; k < 16; k++) {
      const blobs = [];
      for (let j = 0; j < 4; j++) blobs.push([(Math.random() - 0.5) * 160, (Math.random() - 0.5) * 70, 70 + Math.random() * 90]);
      R.clouds.push({ x: Math.random() * (W + 600) - 300, y: Math.random() * H, blobs });
    }
  }
  const n = CLOUDS_BY_WEATHER[S.weather.type] || 6;
  const wind = (S.weather.type === 'storm' ? 70 : 22) * (S.paused ? 0 : Math.sqrt(S.speed));
  const spr = cloudSprite();
  ctx.save();
  for (let k = 0; k < R.clouds.length; k++) {
    const c = R.clouds[k];
    c.x += wind * rdt; c.y += wind * 0.25 * rdt;
    if (c.x > W + 300) { c.x = -300; c.y = Math.random() * H; }
    if (c.y > H + 150) c.y = -150;
    if (k >= n) continue;
    for (const [bx, by, r] of c.blobs) ctx.drawImage(spr, c.x + bx - r, c.y + by - r * 0.6, r * 2, r * 1.2);
  }
  ctx.restore();
}

// ---------- vignette ----------

function drawVignette(ctx) {
  const W = R.canvas.width, H = R.canvas.height;
  if (!R.vig || R.vig.w !== W || R.vig.h !== H) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    g.addColorStop(0, 'rgba(10,16,32,0)');
    g.addColorStop(1, 'rgba(10,16,32,0.32)');
    R.vig = { w: W, h: H, g };
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = R.vig.g;
  ctx.fillRect(0, 0, W, H);
}

function drawFloodlights(ctx, k) {
  const z = R.cam.zoom, d = R.dpr;
  ctx.setTransform(d * z, 0, 0, d * z, -R.cam.x * z * d, -R.cam.y * z * d);
  ctx.globalCompositeOperation = 'lighter';
  const glow = (x, y, r, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,230,160,${a * k})`); g.addColorStop(1, 'rgba(255,230,160,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  };
  for (const l of S.lifts) {
    const gm = liftGeom(l);
    for (let s = 0; s <= gm.len; s += 4) { const q = P(gm.x0 + gm.ux * s, gm.y0 + gm.uy * s); glow(q[0], q[1] - 8, 3 * TILE, 0.16); }
  }
  if (T.reach) for (let i = 0; i < T.reach.length; i += 1) {
    if (T.reach[i] && T.piste[i] && (tx(i) + ty(i)) % 5 === 0) { const q = P(tx(i) + 0.5, ty(i) + 0.5); glow(q[0], q[1], 2 * TILE, 0.1); }
  }
  for (const b of S.buildings) { const q = P(b.x + b.size / 2, b.y + b.size / 2); glow(q[0], q[1], 1.5 * TILE * b.size, 0.22); }
  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------- mini-map ----------

function drawMinimap(cv) {
  const PW = mapW(), PH = mapH();
  const want = Math.round(cv.width * PH / PW);
  if (cv.height !== want) { cv.height = want; cv.style.height = Math.round(cv.clientWidth * PH / PW) + 'px'; }
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, sx = W / PW, sy = H / PH;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1b2940'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(R.terrain, 0, 0, W, H);
  ctx.drawImage(R.overlay, 0, 0, W, H);
  if (R.view === 'slope') ctx.drawImage(R.slope, 0, 0, W, H);
  else if (R.dyn && (R.view === 'condition' || R.view === 'snow' || R.view === 'traffic')) ctx.drawImage(R.dyn, 0, 0, W, H);
  for (const b of S.buildings) { const q = P(b.x, b.y); ctx.fillStyle = BUILDING_TYPES[b.type].color; ctx.fillRect(q[0] * sx, q[1] * sy, b.size * TILE * sx, b.size * TILE * KY * sy); }
  ctx.lineWidth = 1.5;
  for (const l of S.lifts) {
    const a = P(l.bx + 0.5, l.by + 0.5), c = P(l.tx + 0.5, l.ty + 0.5);
    ctx.strokeStyle = l.broken ? '#e03131' : '#222';
    ctx.beginPath(); ctx.moveTo(a[0] * sx, a[1] * sy); ctx.lineTo(c[0] * sx, c[1] * sy); ctx.stroke();
  }
  ctx.fillStyle = '#e8590c';
  for (const g of S.guests) {
    if (g.state === 'inside') continue;
    const p = guestPos(g);
    ctx.fillRect(p.x * TILE * sx - 0.75, projY(p.x * TILE, p.y * TILE) * sy - 0.75, 1.5, 1.5);
  }
  ctx.strokeStyle = '#ffd43b'; ctx.lineWidth = 1.5;
  ctx.strokeRect(R.cam.x * sx, R.cam.y * sy, innerWidth / R.cam.zoom * sx, innerHeight / R.cam.zoom * sy);
}

// ---------- sky and diorama base ----------

function drawSkyAndBase(ctx) {
  const W = mapW(), off = R.tp ? R.tp.off : 0, bottom = mapH();
  if (!R.skyGrad) {
    const g = ctx.createLinearGradient(0, -400, 0, off + 60);
    g.addColorStop(0, '#16243a'); g.addColorStop(0.6, '#3c5778'); g.addColorStop(1, '#a9bfd8');
    R.skyGrad = g;
  }
  ctx.fillStyle = R.skyGrad;
  ctx.fillRect(-400, -400, W + 800, off + 460);
  // the cut face under the front edge of the map, like a model on a table
  const fg = ctx.createLinearGradient(0, bottom, 0, bottom + 40);
  fg.addColorStop(0, '#5b6b84'); fg.addColorStop(1, '#2b3b55');
  ctx.fillStyle = fg;
  ctx.fillRect(0, bottom - 1, W, 40);
}

const flakes = [];
function drawSnowfall(ctx, n) {
  const W = R.canvas.width, H = R.canvas.height, t = performance.now() / 1000;
  while (flakes.length < n) flakes.push({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random(), v: 0.03 + Math.random() * 0.05 });
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  for (let k = 0; k < n; k++) {
    const f = flakes[k];
    const y = ((f.y + t * f.v) % 1) * H, x = ((f.x + Math.sin(t + k) * 0.01 + t * 0.01 * f.s) % 1) * W;
    ctx.beginPath(); ctx.arc(x, y, f.s * 1.4 * R.dpr, 0, Math.PI * 2); ctx.fill();
  }
}
