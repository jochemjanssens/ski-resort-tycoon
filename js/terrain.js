// Procedural mountain terrain: heights, slopes, trees and rocks.

function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const rng = makeRng(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rng(); }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const smooth = t => t * t * (3 - 2 * t);
  const v = (x, y) => vals[perm[(x & 255) + perm[y & 255]]];
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  }
  return function fbm(x, y, oct = 4) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += noise(x * freq, y * freq) * amp;
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  };
}

function generateTerrain(seed, opts) {
  opts = opts || SCENARIOS.alpine.terrain;
  const W = MAP_W, H = MAP_H, N = W * H;
  const fbm = makeNoise(seed);
  const rng = makeRng(seed * 7 + 3);
  const height = new Float32Array(N);
  const village = new Uint8Array(N);
  const mountainRows = VILLAGE_Y;

  // The valley floor: an irregular basin whose upper edge wanders, pinched off by slopes on both sides.
  const EX = ENTRANCE.x;
  const valleyX = W / 2 + (fbm(3.1, 9.7, 2) - 0.5) * 10;
  const vtop = new Int16Array(W);
  for (let x = 0; x < W; x++) {
    let top = VILLAGE_Y + (fbm(x * 0.07 + 11, 4.2, 3) - 0.5) * 9;
    const side = Math.abs(x - valleyX) / (W * 0.5);
    if (side > 0.5) top += (side - 0.5) * 70;
    if (Math.abs(x - EX) <= 3) top = Math.min(top, H - 6);   // keep the valley open where the road comes in
    if (x === EX) top = Math.min(top, H - 8);
    vtop[x] = Math.round(top);
    for (let y = Math.max(0, vtop[x]); y < H; y++) village[y * W + x] = 1;
  }
  // Distance from the valley floor, for blending the slopes into it.
  const vdist = new Uint8Array(N).fill(255), q = [];
  for (let i = 0; i < N; i++) if (village[i]) { vdist[i] = 0; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const a = q[k], ax = a % W, ay = (a / W) | 0, nd = vdist[a] + 1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = ax + dx, y = ay + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const b = y * W + x;
      if (vdist[b] > nd) { vdist[b] = nd; q.push(b); }
    }
  }
  const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const floor = (x, y) => BASE_ALT + (H - 1 - y) * 0.9 + (fbm(x * 0.12 + 70, y * 0.12 + 70, 2) - 0.5) * 4;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (village[i]) { height[i] = floor(x, y); continue; }
      const t = Math.max(0, (VILLAGE_Y - y) / mountainRows); // 0 at the valley, 1 at the top
      // Peaks vary across the width; a gentle foothill band near the village.
      const ridge = 0.55 + 0.45 * fbm(x * 0.045 + 50, 7.3, 3);
      const bumps = (fbm(x * 0.09, y * 0.09, 4) - 0.5);
      const shape = Math.pow(t, 1.7);
      // Gullies and spurs running down the fall line: ridged noise stretched north–south.
      const rn = fbm(x * 0.05 + 300, y * 0.02 + 300, 2);
      const gully = (1 - Math.abs(rn * 2 - 1)) - 0.55;
      const main = opts.vert * ridge * shape + bumps * opts.bumps * Math.min(1, t * 2.5)
        + gully * opts.vert * 0.1 * Math.min(1, t * 1.6);
      // Side slopes rise away from the valley floor wherever the main mountain doesn't.
      const d = vdist[i];
      const flank = Math.min(d, 16) * 9 * (0.7 + 0.6 * fbm(x * 0.1 + 5, y * 0.1 + 5, 2));
      const base = floor(x, y);
      const h = BASE_ALT + Math.max(main, flank);
      height[i] = Math.max(base + d * 2, base + (h - base) * smooth(0, 5, d));
    }
  }
  // The access road: one road climbs up the valley into the village.
  const road = new Uint8Array(N);
  for (let y = H - 1; y >= H - 7; y--) road[y * W + EX] = 1;

  const grade = new Float32Array(N);
  const diff = new Int8Array(N);
  const tree = new Uint8Array(N);
  const rock = new Uint8Array(N);
  const hAt = (x, y) => height[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (village[i]) {
        // the valley floor is forested too, apart from the road; the village is cleared as it is built
        grade[i] = 0; diff[i] = 0;
        const density = fbm(x * 0.13 + 200, y * 0.13 + 200, 3);
        if (Math.abs(x - EX) > 2 && (density > 0.5 || (density > 0.45 && rng() < 0.35))) tree[i] = 1;
        continue;
      }
      const gx = (hAt(x + 1, y) - hAt(x - 1, y)) / 2;
      const gy = (hAt(x, y + 1) - hAt(x, y - 1)) / 2;
      const g = Math.sqrt(gx * gx + gy * gy) / TILE_M;
      grade[i] = g;
      let d = 0;
      while (d < 4 && g >= GRADE_LIMITS[d]) d++;
      diff[i] = d; // 4 = cliff
      const h = height[i];
      if (d >= 4 || (h > BASE_ALT + opts.vert * 0.68 && fbm(x * 0.3 + 9, y * 0.3, 2) > 0.6)) rock[i] = 1;
      const treeLine = 1950 + opts.tree + (fbm(x * 0.1, y * 0.1 + 40, 2) - 0.5) * 300;
      if (!rock[i] && h < treeLine && vdist[i] >= 2) {
        const density = fbm(x * 0.13 + 200, y * 0.13 + 200, 3);
        if (density > 0.5 || (density > 0.44 && rng() < 0.4)) tree[i] = 1;
      }
    }
  }
  return { seed, height, grade, diff, tree, rock, village, vtop, vdist, road, valleyX };
}
