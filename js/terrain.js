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

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (y >= VILLAGE_Y) {
        height[i] = BASE_ALT;
        village[i] = 1;
        continue;
      }
      const t = (VILLAGE_Y - y) / mountainRows; // 0 at village edge, 1 at top
      // Peaks vary across the width; a gentle foothill band near the village.
      const ridge = 0.55 + 0.45 * fbm(x * 0.045 + 50, 7.3, 3);
      const bumps = (fbm(x * 0.09, y * 0.09, 4) - 0.5);
      const shape = Math.pow(t, 1.7);
      // Gullies and spurs running down the fall line: ridged noise stretched north–south.
      const rn = fbm(x * 0.05 + 300, y * 0.02 + 300, 2);
      const gully = (1 - Math.abs(rn * 2 - 1)) - 0.55;
      height[i] = BASE_ALT + opts.vert * ridge * shape + bumps * opts.bumps * Math.min(1, t * 2.5)
        + gully * opts.vert * 0.1 * Math.min(1, t * 1.6);
    }
  }
  // Blend the first mountain rows into the flat village.
  for (let y = VILLAGE_Y - 3; y < VILLAGE_Y; y++) {
    const k = (VILLAGE_Y - y) / 4;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      height[i] = BASE_ALT + (height[i] - BASE_ALT) * k;
      if (height[i] < BASE_ALT + 1) height[i] = BASE_ALT + 1 + (VILLAGE_Y - y);
    }
  }

  const grade = new Float32Array(N);
  const diff = new Int8Array(N);
  const tree = new Uint8Array(N);
  const rock = new Uint8Array(N);
  const hAt = (x, y) => height[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (village[i]) { grade[i] = 0; diff[i] = 0; continue; }
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
      if (!rock[i] && h < treeLine && y < VILLAGE_Y - 1) {
        const density = fbm(x * 0.13 + 200, y * 0.13 + 200, 3);
        if (density > 0.5 || (density > 0.44 && rng() < 0.4)) tree[i] = 1;
      }
    }
  }
  return { seed, height, grade, diff, tree, rock, village };
}
