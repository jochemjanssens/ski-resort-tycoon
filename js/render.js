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
  if (!R.dyn) { R.dyn = document.createElement('canvas'); R.dyn.width = MAP_W * TILE; R.dyn.height = MAP_H * TILE; }
  const ctx = R.dyn.getContext('2d');
  ctx.clearRect(0, 0, R.dyn.width, R.dyn.height);
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

function clampCam() {
  const vw = window.innerWidth / R.cam.zoom, vh = window.innerHeight / R.cam.zoom;
  const mw = MAP_W * TILE, mh = MAP_H * TILE, pad = 200;
  R.cam.x = vw > mw ? (mw - vw) / 2 : clamp(R.cam.x, -pad, mw - vw + pad);
  R.cam.y = vh > mh ? (mh - vh) / 2 : clamp(R.cam.y, -pad, mh - vh + pad);
}

function centerCamOn(wx, wy) {
  R.cam.x = wx - window.innerWidth / R.cam.zoom / 2;
  R.cam.y = wy - window.innerHeight / R.cam.zoom / 2;
  clampCam();
}

function screenToWorld(sx, sy) {
  return { x: sx / R.cam.zoom + R.cam.x, y: sy / R.cam.zoom + R.cam.y };
}

function zoomAt(sx, sy, factor) {
  const before = screenToWorld(sx, sy);
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

// ---------- terrain cache ----------

function buildTerrainCanvas() {
  const w = MAP_W * TILE, h = MAP_H * TILE;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const VW = MAP_W + 1, VH = MAP_H + 1;
  const vh = new Float32Array(VW * VH);
  const th = (x, y) => T.height[clamp(y, 0, MAP_H - 1) * MAP_W + clamp(x, 0, MAP_W - 1)];
  for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
    vh[y * VW + x] = (th(x - 1, y - 1) + th(x, y - 1) + th(x - 1, y) + th(x, y)) / 4;
  }
  const vAt = (x, y) => vh[clamp(y, 0, VH - 1) * VW + clamp(x, 0, VW - 1)];
  // Per-vertex shading.
  const L = [-0.75, 0.35, 0.65]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
  const shade = new Float32Array(VW * VH);
  const EX = 3.2;
  for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
    const gx = (vAt(x + 1, y) - vAt(x - 1, y)) / (2 * TILE_M) * EX;
    const gy = (vAt(x, y + 1) - vAt(x, y - 1)) / (2 * TILE_M) * EX;
    const n = [-gx, -gy, 1]; const nl = Math.hypot(...n);
    shade[y * VW + x] = (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl;
  }
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const hp = new Float32Array(w * h);
  const sp = new Float32Array(w * h);
  for (let py = 0; py < h; py++) {
    const fy = py / TILE, iy = Math.floor(fy), ry = fy - iy;
    for (let px = 0; px < w; px++) {
      const fx = px / TILE, ix = Math.floor(fx), rx = fx - ix;
      const a = iy * VW + ix;
      const h00 = vh[a], h10 = vh[a + 1], h01 = vh[a + VW], h11 = vh[a + VW + 1];
      const s00 = shade[a], s10 = shade[a + 1], s01 = shade[a + VW], s11 = shade[a + VW + 1];
      hp[py * w + px] = (h00 * (1 - rx) + h10 * rx) * (1 - ry) + (h01 * (1 - rx) + h11 * rx) * ry;
      sp[py * w + px] = (s00 * (1 - rx) + s10 * rx) * (1 - ry) + (s01 * (1 - rx) + s11 * rx) * ry;
    }
  }
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const k = py * w + px, o = k * 4;
      const ti = Math.floor(py / TILE) * MAP_W + Math.floor(px / TILE);
      let s = sp[k];
      const alt = (hp[k] - BASE_ALT) / 1100;
      let r, g, b;
      if (T.village[ti]) {
        const n = hash(px, py) * 6;
        r = 226 + n; g = 224 + n; b = 220 + n;
      } else {
        const lit = clamp((s - 0.35) / 0.6, 0, 1.1);
        r = 118 + 132 * lit; g = 140 + 112 * lit; b = 182 + 72 * lit;
        // lower slopes are a touch duller, summits brighter
        const a = clamp(alt, 0, 1);
        r += a * 10 - 8; g += a * 8 - 6; b += a * 4 - 2;
        const n = (hash(px, py) - 0.5) * 5;
        r += n; g += n; b += n;
        // contour lines every 50 m
        const c0 = Math.floor(hp[k] / 50);
        if ((px + 1 < w && Math.floor(hp[k + 1] / 50) !== c0) || (py + 1 < h && Math.floor(hp[k + w] / 50) !== c0)) {
          const major = Math.floor(hp[k] / 250) !== Math.floor((px + 1 < w ? hp[k + 1] : hp[k + w]) / 250) || Math.floor(hp[k] / 250) !== Math.floor((py + 1 < h ? hp[k + w] : hp[k]) / 250);
          r -= major ? 40 : 20; g -= major ? 32 : 16; b -= major ? 18 : 8;
        }
      }
      d[o] = clamp(r, 0, 255); d[o + 1] = clamp(g, 0, 255); d[o + 2] = clamp(b, 0, 255); d[o + 3] = 255;
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
  R.terrain = c;
  R.overlayDirty = true;
  buildSlopeCanvas();
}

function buildSlopeCanvas() {
  const c = document.createElement('canvas');
  c.width = MAP_W * TILE; c.height = MAP_H * TILE;
  const ctx = c.getContext('2d');
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (T.village[i]) continue;
    const d = T.diff[i];
    ctx.fillStyle = d >= 4 ? 'rgba(120,0,120,0.55)' : DIFFS[d].color;
    ctx.globalAlpha = d >= 4 ? 1 : (d === 3 ? 0.42 : 0.38);
    ctx.fillRect(tx(i) * TILE, ty(i) * TILE, TILE, TILE);
  }
  ctx.globalAlpha = 1;
  R.slope = c;
}

function drawPine(ctx, x, y, s, dark) {
  ctx.fillStyle = 'rgba(40,60,90,0.22)';
  ctx.beginPath(); ctx.ellipse(x + s * 0.35, y + s * 0.15, s * 0.5, s * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = dark ? '#1f4d2c' : '#2a6337';
  ctx.beginPath(); ctx.moveTo(x, y - s * 1.1); ctx.lineTo(x + s * 0.55, y + s * 0.15); ctx.lineTo(x - s * 0.55, y + s * 0.15); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath(); ctx.moveTo(x, y - s * 1.1); ctx.lineTo(x + s * 0.2, y - s * 0.65); ctx.lineTo(x - s * 0.2, y - s * 0.65); ctx.closePath(); ctx.fill();
}

function buildOverlay() {
  if (!R.overlay) { R.overlay = document.createElement('canvas'); R.overlay.width = MAP_W * TILE; R.overlay.height = MAP_H * TILE; }
  const ctx = R.overlay.getContext('2d');
  ctx.clearRect(0, 0, R.overlay.width, R.overlay.height);
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
  // Trees (sorted by row for overlap)
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = idx(x, y);
    if (!T.tree[i]) continue;
    const n = 2 + Math.floor(hash(i, 1) * 2);
    for (let k = 0; k < n; k++) {
      drawPine(ctx, x * TILE + 3 + hash(i, k * 3) * 10, y * TILE + 6 + hash(i, k * 3 + 1) * 9, 4.5 + hash(i, k * 3 + 2) * 2.5, hash(i, k + 20) > 0.5);
    }
  }
  R.overlayDirty = false;
}

// ---------- per-frame ----------

function liftGeom(l) {
  const x0 = l.bx + 0.5, y0 = l.by + 0.5, x1 = l.tx + 0.5, y1 = l.ty + 0.5;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  return { x0, y0, x1, y1, len, ux, uy, px: -uy, py: ux };
}

function drawLiftLine(ctx, l, ghost, ok) {
  const L = LIFT_TYPES[l.type];
  const g = liftGeom(l);
  const off = l.type === 'rope' ? 0.12 : 0.2;
  const T_ = TILE;
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.75;
  // shadow
  ctx.strokeStyle = 'rgba(30,40,70,0.18)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo((g.x0 + 0.4) * T_, (g.y0 + 0.4) * T_); ctx.lineTo((g.x1 + 0.4) * T_, (g.y1 + 0.4) * T_); ctx.stroke();
  // towers
  ctx.fillStyle = '#4a5160';
  const step = l.type === 'rope' ? 3 : 4;
  for (let s = step; s < g.len - 1; s += step) {
    const x = (g.x0 + g.ux * s) * T_, y = (g.y0 + g.uy * s) * T_;
    ctx.fillRect(x - 2, y - 2, 4, 4);
    ctx.fillRect(x - (g.px * off * T_) - 1, y - (g.py * off * T_) - 1, 2, 2);
  }
  // cables
  ctx.strokeStyle = ghost ? (ok ? '#2f9e44' : '#e03131') : '#2d2d33'; ctx.lineWidth = 1;
  for (const sgn of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo((g.x0 + g.px * off * sgn) * T_, (g.y0 + g.py * off * sgn) * T_);
    ctx.lineTo((g.x1 + g.px * off * sgn) * T_, (g.y1 + g.py * off * sgn) * T_);
    ctx.stroke();
  }
  if (!ghost && l.type !== 'rope' && l.type !== 'tbar') {
    // decorative carriers on both sides
    const spacing = l.type === 'gondola' ? 2.2 : 1.4;
    const phase = ((S.minute * L.speed) % spacing + spacing) % spacing;
    for (const sgn of [1, -1]) {
      for (let s = (sgn > 0 ? phase : spacing - phase); s < g.len; s += spacing) {
        const x = (g.x0 + g.ux * s + g.px * off * sgn) * T_, y = (g.y0 + g.uy * s + g.py * off * sgn) * T_;
        if (l.type === 'gondola') { ctx.fillStyle = L.color; ctx.fillRect(x - 2.5, y - 2, 5, 4); ctx.fillStyle = '#bfe3ff'; ctx.fillRect(x - 1.5, y - 1.2, 3, 1.5); }
        else { ctx.fillStyle = '#333'; ctx.fillRect(x - (l.type === 'chair4' ? 2.5 : 1.5), y - 1, l.type === 'chair4' ? 5 : 3, 2); }
      }
    }
  }
  // stations
  for (const [x, y, top] of [[l.bx, l.by, false], [l.tx, l.ty, true]]) {
    const X = x * T_, Y = y * T_;
    ctx.fillStyle = 'rgba(30,40,70,0.25)'; ctx.fillRect(X + 3, Y + 3, T_, T_);
    ctx.fillStyle = ghost ? (ok ? '#2f9e44' : '#e03131') : L.color;
    ctx.fillRect(X + 1, Y + 1, T_ - 2, T_ - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(X + 3, Y + (top ? 3 : T_ - 6), T_ - 6, 3);
  }
  ctx.restore();
}

function drawBuilding(ctx, b, ghost, ok) {
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
      for (let k = 0; k < 4; k++) if (hash(b.id, k) < 0.8) { ctx.fillStyle = cars[Math.floor(hash(b.id, k + 7) * 6)]; ctx.fillRect(x + k * s / 4 + 2, y + 5, s / 4 - 4, 7); }
    }
  } else {
    ctx.fillStyle = 'rgba(30,40,70,0.28)'; ctx.fillRect(x + 4, y + 4, s - 2, s - 2);
    ctx.fillStyle = ghost ? (ok ? '#2f9e44' : '#e03131') : B.color;
    ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    // snowy roof
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath(); ctx.moveTo(x + 1, y + 1); ctx.lineTo(x + s - 1, y + 1); ctx.lineTo(x + s / 2, y + s * 0.45); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(x + s / 2 - 0.5, y + 1, 1, s * 0.44);
  }
  ctx.font = `${B.size === 2 ? 15 : 10}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.globalAlpha = 1;
  ctx.fillText(B.icon, x + s / 2, y + s * 0.62);
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
      return { x: gm.x0 + gm.ux * gm.len * p + gm.px * off, y: gm.y0 + gm.uy * gm.len * p + gm.py * off, riding: true, lift: l };
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
  if (R.overlayDirty) buildOverlay();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#121c2b';
  ctx.fillRect(0, 0, R.canvas.width, R.canvas.height);
  ctx.setTransform(R.dpr * z, 0, 0, R.dpr * z, -R.cam.x * z * R.dpr, -R.cam.y * z * R.dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(R.terrain, 0, 0);
  ctx.drawImage(R.overlay, 0, 0);
  if (R.view === 'slope') ctx.drawImage(R.slope, 0, 0);
  else if (R.view === 'condition' || R.view === 'snow' || R.view === 'traffic') {
    if (!R.dyn || performance.now() - R.dynAt > 800) buildDynOverlay();
    ctx.drawImage(R.dyn, 0, 0);
  }

  for (const b of S.buildings) drawBuilding(ctx, b);
  for (const l of S.lifts) drawLiftLine(ctx, l);

  // Guests
  const showDetail = z >= 1.2;
  for (const g of S.guests) {
    if (g.state === 'inside') continue;
    const p = guestPos(g);
    const X = p.x * TILE, Y = p.y * TILE;
    if (p.riding && p.lift.type !== 'rope' && p.lift.type !== 'tbar') {
      ctx.fillStyle = '#333'; ctx.fillRect(X - 2, Y, 4, 1.5);
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
    const X = (l.tx + 0.5) * TILE, Y = l.ty * TILE - 1;
    const blink = Math.floor(performance.now() / 500) % 2;
    if (R.view === 'queues' && l.usable) {
      const w = liftWait(l), t = isFinite(w) ? clamp(w / 12, 0, 1) : 1;
      const gm = liftGeom(l);
      ctx.strokeStyle = heatColor(t, 0.9); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(gm.x0 * TILE, gm.y0 * TILE); ctx.lineTo(gm.x1 * TILE, gm.y1 * TILE); ctx.stroke();
      const label = isFinite(w) ? `${Math.round(w)} min · ${l.queue.length}` : 'BROKEN';
      ctx.font = 'bold 7px system-ui';
      const lw = ctx.measureText(label).width + 6;
      ctx.fillStyle = 'rgba(15,20,30,0.85)'; ctx.fillRect((l.bx + 0.5) * TILE - lw / 2, l.by * TILE - 11, lw, 10);
      ctx.fillStyle = heatColor(t, 1); ctx.fillText(label, (l.bx + 0.5) * TILE, l.by * TILE - 2);
    }
    if (l.broken) {
      if (blink) { ctx.font = '12px system-ui'; ctx.fillText('🔧', (l.bx + l.tx + 1) / 2 * TILE, (l.by + l.ty) / 2 * TILE); }
    } else if (!l.usable && blink) {
      ctx.font = '12px system-ui'; ctx.fillText('⚠️', X, Y);
    } else if (!l.open) {
      ctx.font = 'bold 7px system-ui'; ctx.fillStyle = '#e03131'; ctx.fillText('CLOSED', (l.bx + 0.5) * TILE, l.by * TILE - 1);
    }
    if (z >= 1.6 || (Sel.kind === 'lift' && Sel.id === l.id)) {
      ctx.font = '600 6px system-ui';
      ctx.fillStyle = 'rgba(20,25,35,0.75)';
      const w = ctx.measureText(l.name).width + 4;
      ctx.fillRect((l.bx + 0.5) * TILE - w / 2, (l.by + 1) * TILE + 1, w, 8);
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'top';
      ctx.fillText(l.name, (l.bx + 0.5) * TILE, (l.by + 1) * TILE + 2);
      ctx.textBaseline = 'bottom';
    }
  }
  if (Sel.kind === 'lift') {
    const l = S.lifts.find(x => x.id === Sel.id);
    if (l) {
      ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2.5]);
      for (const [x, y] of [[l.bx, l.by], [l.tx, l.ty]]) ctx.strokeRect(x * TILE - 3, y * TILE - 3, TILE + 6, TILE + 6);
      ctx.setLineDash([]);
    }
  }
  if (Sel.kind === 'building') {
    const b = S.buildings.find(x => x.id === Sel.id);
    if (b) { ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2.5]); ctx.strokeRect(b.x * TILE - 3, b.y * TILE - 3, b.size * TILE + 6, b.size * TILE + 6); ctx.setLineDash([]); }
  }

  // Entrance arch
  ctx.fillStyle = '#7b341e';
  ctx.fillRect(ENTRANCE.x * TILE - 4, (MAP_H - 2) * TILE + 2, 3, 12);
  ctx.fillRect((ENTRANCE.x + 1) * TILE + 1, (MAP_H - 2) * TILE + 2, 3, 12);
  ctx.fillRect(ENTRANCE.x * TILE - 6, (MAP_H - 2) * TILE - 2, TILE + 12, 6);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 4px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('SKI RESORT', (ENTRANCE.x + 0.5) * TILE, (MAP_H - 2) * TILE + 1);

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
    for (let s = 0; s <= gm.len; s += 4) glow((gm.x0 + gm.ux * s) * TILE, (gm.y0 + gm.uy * s) * TILE, 3 * TILE, 0.16);
  }
  if (T.reach) for (let i = 0; i < T.reach.length; i += 1) {
    if (T.reach[i] && T.piste[i] && (tx(i) + ty(i)) % 5 === 0) glow((tx(i) + 0.5) * TILE, (ty(i) + 0.5) * TILE, 2 * TILE, 0.1);
  }
  for (const b of S.buildings) glow((b.x + b.size / 2) * TILE, (b.y + b.size / 2) * TILE, 1.5 * TILE * b.size, 0.22);
  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------- mini-map ----------

function drawMinimap(cv) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, sx = W / (MAP_W * TILE), sy = H / (MAP_H * TILE);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(R.terrain, 0, 0, W, H);
  ctx.drawImage(R.overlay, 0, 0, W, H);
  if (R.view === 'slope') ctx.drawImage(R.slope, 0, 0, W, H);
  else if (R.dyn && (R.view === 'condition' || R.view === 'snow' || R.view === 'traffic')) ctx.drawImage(R.dyn, 0, 0, W, H);
  for (const b of S.buildings) { ctx.fillStyle = BUILDING_TYPES[b.type].color; ctx.fillRect(b.x * TILE * sx, b.y * TILE * sy, b.size * TILE * sx, b.size * TILE * sy); }
  ctx.lineWidth = 1.5;
  for (const l of S.lifts) {
    ctx.strokeStyle = l.broken ? '#e03131' : '#222';
    ctx.beginPath(); ctx.moveTo((l.bx + 0.5) * TILE * sx, (l.by + 0.5) * TILE * sy); ctx.lineTo((l.tx + 0.5) * TILE * sx, (l.ty + 0.5) * TILE * sy); ctx.stroke();
  }
  ctx.fillStyle = '#e8590c';
  for (const g of S.guests) {
    if (g.state === 'inside') continue;
    const p = guestPos(g);
    ctx.fillRect(p.x * TILE * sx - 0.75, p.y * TILE * sy - 0.75, 1.5, 1.5);
  }
  ctx.strokeStyle = '#ffd43b'; ctx.lineWidth = 1.5;
  ctx.strokeRect(R.cam.x * sx, R.cam.y * sy, innerWidth / R.cam.zoom * sx, innerHeight / R.cam.zoom * sy);
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
