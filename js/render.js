// WebGL rendering with three.js: lit 3D terrain, trees, lifts, buildings and guests, plus a flat
// overlay layer draped over the terrain for tool previews and map views.
// World units: 1 unit = 1 tile; x runs east, z runs south (the map row), y is up.

THREE.ColorManagement.legacyMode = false;

const R = {
  canvas: null, renderer: null, scene: null, camera: null,
  cam: { x: MAP_W / 2, z: MAP_H - 12, dist: 34, yaw: 0, pitch: 0.82 },
  view: 'none', overlayDirty: true, lastOverlay: 0,
  base: null, baseTex: null, ov: null, ovTex: null, ovKey: '', viewLayer: null, viewAt: 0, slopeLayer: null,
  ghost: null, vh: null,
};

const VIEWS = {
  none: { name: 'Normal', icon: '🏔️' },
  slope: { name: 'Slope difficulty', icon: '📐' },
  condition: { name: 'Piste condition', icon: '🧊' },
  snow: { name: 'Snow depth', icon: '❄️' },
  traffic: { name: 'Skier traffic', icon: '🔥' },
  queues: { name: 'Lift queues', icon: '⏱️' },
};

const XY = 1.4;    // vertical exaggeration
const OBJ = 1.2;   // lifts, buildings and people are drawn a little larger than life to stay readable
const BPX = 20;    // base texture pixels per tile
const OPX = 12;    // overlay pixels per tile
const CABLE = { rope: 0.45, tbar: 0.7, chair2: 1.7, chair4: 1.9, gondola: 2.3 };

function heatColor(t, a) {
  // 0 = green, 0.5 = yellow, 1 = red
  const r = t < 0.5 ? Math.round(80 + 350 * t) : 255, g = t < 0.5 ? 200 : Math.round(200 - 340 * (t - 0.5));
  return `rgba(${r},${Math.max(40, g)},60,${a})`;
}

function hash(i, k) {
  let h = (i * 374761393 + k * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------- heights ----------

// Height at tile corners, averaged from the four tiles around each corner.
function buildHeights() {
  const VW = MAP_W + 1, VH = MAP_H + 1, vh = new Float32Array(VW * VH);
  const th = (x, y) => T.height[clamp(y, 0, MAP_H - 1) * MAP_W + clamp(x, 0, MAP_W - 1)];
  for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
    vh[y * VW + x] = ((th(x - 1, y - 1) + th(x, y - 1) + th(x - 1, y) + th(x, y)) / 4 - BASE_ALT) / TILE_M * XY;
  }
  R.vh = vh;
}

// Ground height in world units at a point given in tiles.
function elev(x, y) {
  if (!R.vh) return 0;
  const VW = MAP_W + 1;
  const fx = clamp(x, 0, MAP_W), fy = clamp(y, 0, MAP_H);
  const ix = Math.min(MAP_W - 1, Math.floor(fx)), iy = Math.min(MAP_H - 1, Math.floor(fy)), rx = fx - ix, ry = fy - iy;
  const v = R.vh, a = v[iy * VW + ix], b = v[iy * VW + ix + 1], c = v[(iy + 1) * VW + ix], d = v[(iy + 1) * VW + ix + 1];
  return (a * (1 - rx) + b * rx) * (1 - ry) + (c * (1 - rx) + d * rx) * ry;
}
function groundAt(x, y) { return x < 0 || y < 0 || x > MAP_W || y > MAP_H ? -2.2 : elev(x, y); }

// ---------- setup ----------

function initRender(canvas) {
  R.canvas = canvas;
  const r = R.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  r.outputEncoding = THREE.sRGBEncoding;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = R.scene = new THREE.Scene();
  R.camera = new THREE.PerspectiveCamera(40, 1, 0.3, 800);

  // Sky gradient and matching fog
  R.sky = document.createElement('canvas'); R.sky.width = 2; R.sky.height = 256;
  R.skyTex = new THREE.CanvasTexture(R.sky); R.skyTex.encoding = THREE.sRGBEncoding;
  scene.background = R.skyTex;
  scene.fog = new THREE.Fog(0xcfe0ef, 80, 230);

  R.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6a7f99, 0.9);
  R.sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  R.sun.castShadow = true;
  const sm = innerWidth < 800 ? 2048 : Math.min(4096, r.capabilities.maxTextureSize);
  R.sun.shadow.mapSize.set(sm, sm);
  Object.assign(R.sun.shadow.camera, { left: -58, right: 58, top: 58, bottom: -58, near: 1, far: 320 });
  R.sun.shadow.camera.updateProjectionMatrix();
  R.sun.shadow.bias = -0.0004; R.sun.shadow.normalBias = 0.05;
  scene.add(R.hemi, R.sun, R.sun.target);

  // Snowfield around the map and distant peaks fading into the haze
  const field = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0xe9eff6, roughness: 1 }));
  field.rotation.x = -Math.PI / 2; field.position.set(MAP_W / 2, -2.2, MAP_H / 2); field.receiveShadow = true;
  scene.add(field);
  const peakMat = new THREE.MeshStandardMaterial({ color: 0xdfe7f1, roughness: 1, flatShading: true });
  for (let k = 0; k < 16; k++) {
    const a = Math.PI * (1.05 + 0.9 * k / 15) + (hash(k, 1) - 0.5) * 0.15, d = 110 + hash(k, 2) * 70;
    const h = 22 + hash(k, 3) * 34, rr = 26 + hash(k, 4) * 22;
    const m = new THREE.Mesh(new THREE.ConeGeometry(rr, h, 6 + Math.floor(hash(k, 5) * 3)), peakMat);
    m.position.set(MAP_W / 2 + Math.cos(a) * d, h / 2 - 2.2, MAP_H / 2 + Math.sin(a) * d * 0.8);
    m.rotation.y = hash(k, 6) * 6;
    scene.add(m);
  }

  R.terrainGroup = new THREE.Group(); R.liftGroup = new THREE.Group(); R.bldGroup = new THREE.Group();
  R.labelGroup = new THREE.Group(); R.ghostGroup = new THREE.Group();
  scene.add(R.terrainGroup, R.liftGroup, R.bldGroup, R.labelGroup, R.ghostGroup);
  initGuests();
  initSnowfall();
  initExtras();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  R.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  R.renderer.setSize(window.innerWidth, window.innerHeight);
  R.camera.aspect = window.innerWidth / window.innerHeight;
  R.camera.updateProjectionMatrix();
}

// Called for every new or loaded game: rebuild the terrain mesh and its textures.
function buildTerrainCanvas() {
  buildHeights();
  const g = R.terrainGroup;
  for (const c of g.children.slice()) g.remove(c);
  if (!R.base) {
    const aniso = R.renderer.capabilities.getMaxAnisotropy();
    R.base = document.createElement('canvas'); R.base.width = MAP_W * BPX; R.base.height = MAP_H * BPX;
    R.baseTex = new THREE.CanvasTexture(R.base); R.baseTex.encoding = THREE.sRGBEncoding; R.baseTex.anisotropy = aniso;
    R.ov = document.createElement('canvas'); R.ov.width = MAP_W * OPX; R.ov.height = MAP_H * OPX;
    R.ovTex = new THREE.CanvasTexture(R.ov); R.ovTex.encoding = THREE.sRGBEncoding; R.ovTex.anisotropy = aniso;
    R.viewLayer = document.createElement('canvas'); R.viewLayer.width = MAP_W * OPX; R.viewLayer.height = MAP_H * OPX;
    R.slopeLayer = document.createElement('canvas'); R.slopeLayer.width = MAP_W * OPX; R.slopeLayer.height = MAP_H * OPX;
  }
  if (R.terrainGeo) R.terrainGeo.dispose();
  const SUB = 3;
  const geo = R.terrainGeo = new THREE.PlaneGeometry(MAP_W, MAP_H, MAP_W * SUB, MAP_H * SUB);
  geo.rotateX(-Math.PI / 2);
  geo.translate(MAP_W / 2, 0, MAP_H / 2);
  const pos = geo.attributes.position;
  for (let k = 0; k < pos.count; k++) pos.setY(k, elev(pos.getX(k), pos.getZ(k)));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: R.baseTex, roughness: 0.92, metalness: 0 }));
  terrain.receiveShadow = true; terrain.castShadow = true;
  const over = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: R.ovTex, transparent: true, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  over.renderOrder = 2;
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(MAP_W, 2.2, MAP_H), new THREE.MeshStandardMaterial({ color: 0x5b6b80, roughness: 1 }));
  skirt.position.set(MAP_W / 2, -1.12, MAP_H / 2);
  g.add(terrain, over, skirt, buildArch());
  paintSlopeLayer();
  R.treeSig = R.liftSig = R.bldSig = null;
  R.ovKey = ''; R.ghostKey = null; R.miniShade = null;
  R.overlayDirty = true;
}

// ---------- base texture: snow, rock, pistes, freeride zones, village ----------

function paintBase() {
  const c = R.base.getContext('2d'), Q = BPX;
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const x = tx(i) * Q, y = ty(i) * Q, n = hash(i, 3);
    if (T.village[i]) c.fillStyle = `rgb(${226 + n * 8},${232 + n * 6},${239 + n * 5})`;
    else if (T.rock[i]) c.fillStyle = `rgb(${120 + n * 25},${126 + n * 25},${136 + n * 22})`;
    else c.fillStyle = `rgb(${240 + n * 8},${244 + n * 7},250)`;
    c.fillRect(x, y, Q, Q);
    if (T.rock[i]) for (let k = 0; k < 3; k++) {
      c.fillStyle = 'rgba(245,248,252,0.85)';
      c.beginPath(); c.ellipse(x + hash(i, k + 5) * Q, y + hash(i, k + 9) * Q, 3 + hash(i, k) * 4, 2 + hash(i, k + 2) * 2.5, 0, 0, 7); c.fill();
    }
  }
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (!T.piste[i] || T.village[i]) continue;
    const x = tx(i) * Q, y = ty(i) * Q, d = Math.min(3, T.diff[i]), X = tx(i), Y = ty(i);
    c.fillStyle = T.reach && T.reach[i] ? '#ffffff' : '#e9edf3'; c.fillRect(x, y, Q, Q);
    c.fillStyle = DIFFS[d].color; c.globalAlpha = 0.1; c.fillRect(x, y, Q, Q); c.globalAlpha = 1;
    if (T.groomed[i]) {
      c.fillStyle = 'rgba(150,172,205,0.35)';
      for (let k = 2; k < Q; k += 4) c.fillRect(x, y + k, Q, 1);
    } else if (d >= 2) {
      // moguls
      for (let k = 0; k < 4; k++) {
        const mx = x + 4 + (k % 2) * 10 + (Math.floor(k / 2) % 2) * 4, my = y + 5 + Math.floor(k / 2) * 10;
        c.fillStyle = 'rgba(120,145,185,0.4)'; c.beginPath(); c.ellipse(mx, my + 1.5, 3.6, 2.2, 0, 0, 7); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.ellipse(mx - 0.6, my, 2.9, 1.7, 0, 0, 7); c.fill();
      }
    }
    const wear = 1 - T.cond[i] / 100;
    if (wear > 0.15) { c.fillStyle = `rgba(110,150,190,${wear * 0.5})`; c.fillRect(x, y, Q, Q); }
    // thin and bare snow: dirt and stones show through
    const sn = T.snow[i];
    if (sn < SNOW.thinBelow) {
      const t = T.bare[i] ? 1 : 1 - (sn - SNOW.bareBelow) / (SNOW.thinBelow - SNOW.bareBelow);
      for (let k = 0; k < 6; k++) {
        if (hash(i, k + 40) > t) continue;
        c.fillStyle = k % 2 ? 'rgba(122,98,72,0.8)' : 'rgba(96,104,92,0.75)';
        c.beginPath(); c.ellipse(x + 2 + hash(i, k + 50) * (Q - 4), y + 2 + hash(i, k + 60) * (Q - 4), 1.5 + hash(i, k + 70) * 3, 1 + hash(i, k + 80) * 2, 0, 0, 7); c.fill();
      }
      if (T.bare[i]) { c.fillStyle = 'rgba(140,110,80,0.4)'; c.fillRect(x, y, Q, Q); }
    }
    c.fillStyle = DIFFS[d].color;
    const edge = (nx, ny) => !inMap(nx, ny) || !T.piste[idx(nx, ny)];
    if (edge(X - 1, Y)) c.fillRect(x, y, 2.5, Q);
    if (edge(X + 1, Y)) c.fillRect(x + Q - 2.5, y, 2.5, Q);
    if (edge(X, Y - 1)) c.fillRect(x, y, Q, 2.5);
    if (edge(X, Y + 1)) c.fillRect(x, y + Q - 2.5, Q, 2.5);
    if (T.closed[i]) {
      c.strokeStyle = 'rgba(224,49,49,0.8)'; c.lineWidth = 2;
      c.save(); c.beginPath(); c.rect(x, y, Q, Q); c.clip(); c.beginPath();
      for (let k = -Q; k < Q; k += 6) { c.moveTo(x + k, y + Q); c.lineTo(x + k + Q, y); }
      c.stroke(); c.restore();
    }
  }
  // Freeride zones: tracks where the powder is used up, inside a dashed orange boundary
  const open = freeOpen();
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (!T.free[i] || T.piste[i]) continue;
    const x = tx(i) * Q, y = ty(i) * Q, X = tx(i), Y = ty(i);
    const on = open && !T.bare[i];
    if (!on) { c.fillStyle = 'rgba(120,120,140,0.2)'; c.fillRect(x, y, Q, Q); }
    if (on && T.fresh[i] < 0.75) {
      c.strokeStyle = 'rgba(120,140,180,0.45)'; c.lineWidth = 1;
      for (let k = 0; k < Math.round((1 - T.fresh[i]) * 4); k++) {
        const sx = x + 2 + hash(i, k + 90) * (Q - 4);
        c.beginPath(); c.moveTo(sx, y); c.bezierCurveTo(sx + 5, y + 6, sx - 5, y + 13, sx + 1, y + Q); c.stroke();
      }
    }
    if (T.closed[i]) { c.fillStyle = 'rgba(224,49,49,0.25)'; c.fillRect(x, y, Q, Q); }
    c.fillStyle = on ? '#ff8a3d' : '#8b93a7';
    const edge = (nx, ny) => !inMap(nx, ny) || !T.free[idx(nx, ny)] || T.piste[idx(nx, ny)];
    for (let k = 0; k < Q; k += 5) {
      if (edge(X - 1, Y)) c.fillRect(x, y + k, 2, 2.5);
      if (edge(X + 1, Y)) c.fillRect(x + Q - 2, y + k, 2, 2.5);
      if (edge(X, Y - 1)) c.fillRect(x + k, y, 2.5, 2);
      if (edge(X, Y + 1)) c.fillRect(x + k, y + Q - 2, 2.5, 2);
    }
  }
  // Village edge, road and entrance drive
  c.fillStyle = 'rgba(120,135,160,0.35)'; c.fillRect(0, VILLAGE_Y * Q, MAP_W * Q, 2);
  c.fillStyle = '#4b515c'; c.fillRect(0, (MAP_H - 1) * Q + 3, MAP_W * Q, Q - 6);
  c.fillStyle = '#f5f5f5'; for (let x = 0; x < MAP_W * Q; x += 16) c.fillRect(x, (MAP_H - 0.5) * Q - 1, 8, 2);
  c.fillStyle = '#4b515c'; c.fillRect(ENTRANCE.x * Q + 3, (MAP_H - 3) * Q, Q - 6, Q * 2.5);
  R.baseTex.needsUpdate = true;
}

function paintSlopeLayer() {
  const c = R.slopeLayer.getContext('2d');
  c.clearRect(0, 0, R.slopeLayer.width, R.slopeLayer.height);
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (T.village[i]) continue;
    const d = T.diff[i];
    c.fillStyle = d >= 4 ? 'rgba(120,0,120,0.7)' : DIFFS[d].color;
    c.globalAlpha = d >= 4 ? 1 : 0.45;
    c.fillRect(tx(i) * OPX, ty(i) * OPX, OPX, OPX);
  }
  c.globalAlpha = 1;
}

function paintViewLayer() {
  const c = R.viewLayer.getContext('2d');
  c.clearRect(0, 0, R.viewLayer.width, R.viewLayer.height);
  let maxT = 1;
  if (R.view === 'traffic') for (let i = 0; i < T.traffic.length; i++) maxT = Math.max(maxT, T.traffic[i]);
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const x = tx(i) * OPX, y = ty(i) * OPX;
    if (R.view === 'condition' && (T.piste[i] || T.free[i]) && !T.village[i]) {
      c.fillStyle = heatColor(1 - pisteQuality(i), 0.65); c.fillRect(x, y, OPX, OPX);
    } else if (R.view === 'snow' && !T.village[i]) {
      const d = snowAt(i), t = clamp(d / 160, 0, 1);
      c.fillStyle = d < SNOW.bareBelow ? 'rgba(150,90,40,0.75)' : d < 30 ? `rgba(200,120,60,${0.6 - d / 80})` : `rgba(40,110,230,${0.1 + t * 0.55})`;
      c.fillRect(x, y, OPX, OPX);
      if (T.cannon[i]) { c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(x + OPX / 2 - 1.5, y + OPX / 2 - 1.5, 3, 3); }
    } else if (R.view === 'traffic' && T.traffic[i] > 0) {
      c.fillStyle = heatColor(Math.sqrt(T.traffic[i] / maxT), 0.7); c.fillRect(x, y, OPX, OPX);
    }
  }
  R.viewAt = performance.now();
  R.viewFor = R.view;
}

// ---------- overlay: previews, views, floodlight glow ----------

// Flat helpers for the tool preview, in world pixels (TILE per tile).
function tilePath(ctx, i) { ctx.rect(tx(i) * TILE, ty(i) * TILE, TILE, TILE); }
function P(x, y) { return [x * TILE, y * TILE]; }

function previewLift(ctx, l, ok) {
  R.ghost = { kind: 'lift', l, ok };
  const col = ok ? 'rgba(47,158,68,0.9)' : 'rgba(224,49,49,0.9)';
  ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo((l.bx + 0.5) * TILE, (l.by + 0.5) * TILE); ctx.lineTo((l.tx + 0.5) * TILE, (l.ty + 0.5) * TILE); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = col;
  for (const [x, y] of [[l.bx, l.by], [l.tx, l.ty]]) ctx.fillRect(x * TILE + 2, y * TILE + 2, TILE - 4, TILE - 4);
}

function previewBuilding(ctx, b, ok) {
  R.ghost = { kind: 'building', b, ok };
  const s = b.size * TILE;
  ctx.fillStyle = ok ? 'rgba(47,158,68,0.45)' : 'rgba(224,49,49,0.5)';
  ctx.fillRect(b.x * TILE, b.y * TILE, s, s);
  ctx.strokeStyle = ok ? '#2f9e44' : '#e03131'; ctx.lineWidth = 2; ctx.strokeRect(b.x * TILE + 1, b.y * TILE + 1, s - 2, s - 2);
}

function floodlit() { return S.night.on && S.minute > 16 * 60 + 15 && S.minute < NIGHT_SKIING.close + 30; }

function overlayKey() {
  const m = UI.mouse;
  return [UI.tool, m.inside ? m.tile : -1, UI.liftStart, UI.route.start, UI.liftType, UI.buildType, UI.brush, UI.freeMode, UI.route.maxDiff,
    R.view, Sel.kind, Sel.id, Sel.tile, floodlit(), Net.version].join('|');
}

function redrawOverlay(now) {
  const c = R.ov.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, R.ov.width, R.ov.height);
  if (floodlit()) {
    c.fillStyle = 'rgba(255,214,140,0.28)';
    for (let i = 0; i < MAP_W * MAP_H; i++) if (T.piste[i] && !T.village[i] && T.reach && T.reach[i]) c.fillRect(tx(i) * OPX, ty(i) * OPX, OPX, OPX);
  }
  if (R.view === 'slope') c.drawImage(R.slopeLayer, 0, 0);
  else if (R.view === 'condition' || R.view === 'snow' || R.view === 'traffic') {
    if (now - R.viewAt > 800 || R.viewFor !== R.view) paintViewLayer();
    c.drawImage(R.viewLayer, 0, 0);
  }
  c.setTransform(OPX / TILE, 0, 0, OPX / TILE, 0, 0);
  R.ghost = null;
  if (Sel.kind === 'tile' && Sel.tile >= 0) { c.strokeStyle = '#ff8a3d'; c.lineWidth = 2; c.beginPath(); tilePath(c, Sel.tile); c.stroke(); }
  drawToolPreview(c);
  R.ovTex.needsUpdate = true;
  syncGhost();
}

// ---------- trees ----------

function syncTrees() {
  let sig = 0, n = 0;
  for (let i = 0; i < T.tree.length; i++) if (T.tree[i]) { sig = (sig * 31 + i) | 0; n++; }
  sig = n + ':' + sig;
  if (sig === R.treeSig) return;
  R.treeSig = sig;
  const trees = [];
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (!T.tree[i]) continue;
    const k = 2 + Math.floor(hash(i, 1) * 2);
    for (let j = 0; j < k; j++) trees.push([tx(i) + 0.15 + hash(i, j * 3) * 0.7, ty(i) + 0.15 + hash(i, j * 3 + 1) * 0.7, 0.75 + hash(i, j * 3 + 2) * 0.6, i * 4 + j]);
  }
  if (!R.trees || R.trees.cap < trees.length) {
    if (R.trees) for (const m of R.trees.meshes) { R.scene.remove(m); m.dispose(); }
    const cap = Math.max(4000, Math.ceil(trees.length * 1.3));
    const coneG = new THREE.ConeGeometry(0.32, 1.25, 7); coneG.translate(0, 0.78, 0);
    const capG = new THREE.ConeGeometry(0.17, 0.42, 7); capG.translate(0, 1.22, 0);
    const trunkG = new THREE.CylinderGeometry(0.06, 0.07, 0.3, 5); trunkG.translate(0, 0.15, 0);
    const mk = (geo, col) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.9 }), cap);
      m.castShadow = true; m.receiveShadow = true; R.scene.add(m); return m;
    };
    const foliage = mk(coneG, 0xffffff), caps = mk(capG, 0xf2f6fb), trunks = mk(trunkG, 0x5b4030);
    R.trees = { cap, meshes: [foliage, caps, trunks], foliage };
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  trees.forEach(([x, y, s, h], k) => {
    p.set(x, elev(x, y) - 0.05, y); sv.set(s, s * (0.9 + hash(h, 4) * 0.3), s);
    q.setFromAxisAngle(up, hash(h, 7) * 6.28);
    m4.compose(p, q, sv);
    for (const m of R.trees.meshes) m.setMatrixAt(k, m4);
    R.trees.foliage.setColorAt(k, col.setHSL(0.38 + hash(h, 2) * 0.06, 0.32, 0.24 + hash(h, 3) * 0.08));
  });
  for (const m of R.trees.meshes) { m.count = trees.length; m.instanceMatrix.needsUpdate = true; }
  if (R.trees.foliage.instanceColor) R.trees.foliage.instanceColor.needsUpdate = true;
}

// ---------- lifts ----------

const steelMat = new THREE.MeshStandardMaterial({ color: 0x8a96a8, metalness: 0.6, roughness: 0.4 });

function liftGeom(l) {
  const x0 = l.bx + 0.5, y0 = l.by + 0.5, x1 = l.tx + 0.5, y1 = l.ty + 0.5;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  return { x0, y0, x1, y1, len, ux, uy, px: -uy, py: ux };
}

// Tower tops along the line; the cable runs straight between them.
function liftPath(l) {
  const gm = liftGeom(l), h = CABLE[l.type] * OBJ;
  const n = Math.max(2, Math.round(gm.len / 3));
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, x = gm.x0 + gm.ux * gm.len * t, y = gm.y0 + gm.uy * gm.len * t;
    pts.push(new THREE.Vector3(x, elev(x, y) + h, y));
  }
  return { gm, h, pts };
}
function cableAt(path, t) {
  const n = path.pts.length - 1, f = clamp(t, 0, 1) * n, k = Math.min(n - 1, Math.floor(f));
  return path.pts[k].clone().lerp(path.pts[k + 1], f - k);
}

function syncLifts() {
  const sig = S.lifts.map(l => `${l.id}:${l.type}:${l.bx},${l.by},${l.tx},${l.ty}`).join('|');
  if (sig === R.liftSig) return;
  R.liftSig = sig;
  for (const c of R.liftGroup.children.slice()) R.liftGroup.remove(c);
  R.liftViz = new Map();
  for (const l of S.lifts) R.liftViz.set(l.id, makeLift(l));
}

// Builds a lift's towers, stations, cables and carriers. With a ghost material it builds a see-through preview instead.
function makeLift(l, ghost) {
  const L = LIFT_TYPES[l.type], path = liftPath(l), { gm, h, pts } = path;
  const grp = new THREE.Group();
  const yaw = -Math.atan2(gm.uy, gm.ux) + Math.PI / 2;
  const metal = ghost || steelMat;
  pts.forEach((q, k) => {
    if (k === 0 || k === pts.length - 1) return;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, h, 6), metal);
    t.position.set(q.x, q.y - h / 2, q.z); t.castShadow = !ghost; grp.add(t);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.05), metal);
    arm.position.copy(q); arm.rotation.y = yaw; grp.add(arm);
  });
  const stMats = [];
  for (const end of [0, 1]) {
    const q = pts[end ? pts.length - 1 : 0];
    const mat = ghost || new THREE.MeshStandardMaterial({ color: L.color, roughness: 0.6, emissive: 0xff8a3d, emissiveIntensity: 0 });
    stMats.push(mat);
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.95, h * 0.85, 0.95), mat);
    st.position.set(q.x, q.y - h + h * 0.42, q.z); st.rotation.y = yaw; st.castShadow = !ghost; grp.add(st);
    if (!ghost) {
      const roof = new THREE.Mesh(gableGeometry(1.15, 1.15, 0.35), new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.7, side: THREE.DoubleSide }));
      roof.position.set(q.x, q.y - h + h * 0.85, q.z); roof.rotation.y = yaw; roof.castShadow = true; grp.add(roof);
    }
  }
  // Two cables: up on one side of the towers, down on the other
  const cableMat = new THREE.LineBasicMaterial({ color: ghost ? ghost.color : 0x2b2f36 });
  for (const s of [1, -1]) {
    grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(q => new THREE.Vector3(q.x + gm.px * 0.28 * s, q.y, q.z + gm.py * 0.28 * s))), cableMat));
  }
  (ghost ? R.ghostGroup : R.liftGroup).add(grp);
  if (ghost) return grp;
  const chairs = [];
  const count = Math.max(4, Math.round(gm.len * (L.drag ? 0.9 : 1.1)));
  const chairMat = new THREE.MeshStandardMaterial({ color: l.type === 'gondola' ? 0xc53030 : 0x30353d, roughness: 0.5 });
  for (let k = 0; k < count; k++) {
    const c = new THREE.Group();
    if (L.drag) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, h * 0.75, 0.03), steelMat); bar.position.y = -h * 0.37; c.add(bar);
      const t = new THREE.Mesh(new THREE.BoxGeometry(l.type === 'tbar' ? 0.3 : 0.12, 0.04, 0.04), steelMat); t.position.y = -h * 0.75; c.add(t);
    } else if (l.type === 'gondola') {
      const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.35, 0.03), steelMat); hanger.position.y = -0.17; c.add(hanger);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.34), chairMat); cab.position.y = -0.55; cab.castShadow = true; c.add(cab);
    } else {
      const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.03), steelMat); hanger.position.y = -0.25; c.add(hanger);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(L.seats * 0.14, 0.07, 0.24), chairMat); seat.position.y = -0.52; seat.castShadow = true; c.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(L.seats * 0.14, 0.2, 0.04), chairMat); back.position.set(0, -0.42, -0.11); c.add(back);
    }
    c.rotation.y = yaw;
    grp.add(c); chairs.push(c);
  }
  return { l, path, grp, chairs, cableMat, stMats, phase: 0 };
}

function updateLifts(dt) {
  if (!R.liftViz) return;
  const running = liftsOpen() && !S.paused;
  for (const v of R.liftViz.values()) {
    const l = v.l, L = LIFT_TYPES[l.type], gm = v.path.gm;
    if (running && l.open && !l.broken) v.phase = (v.phase + dt * S.speed * L.speed / Math.max(1, l.len) * 0.5) % 1;
    const n = v.chairs.length, half = Math.ceil(n / 2);
    v.chairs.forEach((c, k) => {
      const up = k % 2 === 0;
      let t = (Math.floor(k / 2) / half + v.phase) % 1;
      if (!up) t = 1 - t;
      const q = cableAt(v.path, t), s = up ? 1 : -1;
      c.position.set(q.x + gm.px * 0.28 * s, q.y, q.z + gm.py * 0.28 * s);
      c.visible = up || !L.drag;
    });
    const sel = Sel.kind === 'lift' && Sel.id === l.id;
    if (R.view === 'queues' && l.usable) {
      const w = liftWait(l);
      v.cableMat.color.setStyle(heatColor(isFinite(w) ? clamp(w / 12, 0, 1) : 1, 1).replace(/,[^,]*\)$/, ')').replace('rgba', 'rgb'));
    } else v.cableMat.color.setHex(sel ? 0xff8a3d : 0x2b2f36);
    for (const m of v.stMats) m.emissiveIntensity = sel ? 0.45 : 0;
  }
}

// ---------- buildings ----------

// A gabled roof: ridge along x, width w, depth d, height h, sitting on y = 0.
function gableGeometry(w, d, h) {
  const x = w / 2, z = d / 2;
  const v = new Float32Array([
    -x, 0, z, x, 0, z, x, h, 0, -x, 0, z, x, h, 0, -x, h, 0,     // south slope
    x, 0, -z, -x, 0, -z, -x, h, 0, x, 0, -z, -x, h, 0, x, h, 0,  // north slope
    -x, 0, -z, -x, 0, z, -x, h, 0,                              // west gable
    x, 0, z, x, 0, -z, x, h, 0,                                 // east gable
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

const iconTex = new Map();
function emojiTexture(e) {
  if (iconTex.has(e)) return iconTex.get(e);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.font = '48px system-ui, "Apple Color Emoji", "Segoe UI Emoji"'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(e, 32, 36);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
  iconTex.set(e, t);
  return t;
}

function syncBuildings() {
  const sig = S.buildings.map(b => `${b.id}:${b.type}:${b.x},${b.y}`).join('|');
  if (sig === R.bldSig) return;
  R.bldSig = sig;
  for (const c of R.bldGroup.children.slice()) R.bldGroup.remove(c);
  R.bldViz = new Map();
  R.windowMats = [];
  for (const b of S.buildings) {
    const grp = makeBuilding(b);
    R.bldGroup.add(grp);
    R.bldViz.set(b.id, grp);
  }
}

function makeBuilding(b, ghostMat) {
  const B = BUILDING_TYPES[b.type], s = b.size;
  const cx = b.x + s / 2, cy = b.y + s / 2;
  let ground = elev(cx, cy);
  for (const [x, y] of [[b.x, b.y], [b.x + s, b.y], [b.x, b.y + s], [b.x + s, b.y + s]]) ground = Math.min(ground, elev(x, y));
  const g = new THREE.Group();
  g.position.set(cx, ground, cy);
  const std = (color, extra) => ghostMat || new THREE.MeshStandardMaterial({ color, roughness: 0.8, emissive: 0xff8a3d, emissiveIntensity: 0, ...extra });
  const add = (geo, mat, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow && !ghostMat; m.receiveShadow = !ghostMat; g.add(m); return m;
  };
  // A plinth so buildings on a slope don't float
  const plinth = Math.max(0.05, elev(cx, cy) - ground + 0.1);
  if (b.type !== 'parking' && b.type !== 'park') add(new THREE.BoxGeometry(s * 0.86, plinth + 0.1, s * 0.86), std(0x8d7b68), 0, (plinth + 0.1) / 2 - 0.1, 0);
  let top;
  if (b.type === 'parking') {
    add(new THREE.BoxGeometry(s * 0.95, 0.05, s * 0.95), std(0x6f747d), 0, 0.03, 0, false);
    if (!ghostMat) {
      const cols = [0xc53030, 0x2b6cb0, 0xe2e8f0, 0x38a169, 0xd69e2e, 0x1a202c];
      for (let k = 0; k < 8; k++) if (hash(b.id, k) < 0.8) {
        add(new THREE.BoxGeometry(0.22, 0.13, 0.42), std(cols[Math.floor(hash(b.id, k + 7) * 6)], { roughness: 0.35 }), -0.72 + (k % 4) * 0.48, 0.12, k < 4 ? -0.45 : 0.45);
      }
    }
    top = 0.3;
  } else if (b.type === 'park') {
    add(new THREE.BoxGeometry(s * 0.92, 0.06, s * 0.92), std(0xffffff), 0, 0.03, 0, false);
    const pipe = add(new THREE.CylinderGeometry(0.42, 0.42, s * 0.85, 14, 1, true, Math.PI / 2, Math.PI), std(0xd6e6f7, { side: THREE.DoubleSide }), -0.45, 0.42, 0);
    pipe.rotation.x = Math.PI / 2;
    for (const k of [0, 1]) {
      const kick = add(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 10, 1, false, 0, Math.PI / 2), std(0xf1f5fb), 0.35, 0.02, -0.4 + k * 0.8);
      kick.rotation.z = Math.PI / 2; kick.rotation.y = Math.PI / 2;
    }
    add(new THREE.BoxGeometry(0.04, 0.04, 0.7), std(0x444444), 0.75, 0.2, 0);
    top = 0.6;
  } else if (b.type === 'cannon') {
    add(new THREE.CylinderGeometry(0.04, 0.06, 1.1 * OBJ, 6), std(0x9aa5b4), 0, plinth + 0.55 * OBJ, 0);
    const head = add(new THREE.CylinderGeometry(0.16, 0.12, 0.4, 10), std(B.color), 0.1, plinth + 1.1 * OBJ, 0);
    head.rotation.z = -1.1;
    top = plinth + 1.3 * OBJ;
  } else {
    const hgt = (s === 2 ? 0.95 : 0.65) * OBJ;
    add(new THREE.BoxGeometry(s * 0.8, hgt, s * 0.8), std(B.color), 0, plinth + hgt / 2, 0);
    add(gableGeometry(s * 0.92, s * 0.92, hgt * 0.55), std(0xf4f7fb, { roughness: 0.7, side: THREE.DoubleSide }), 0, plinth + hgt, 0);
    if (!ghostMat) {
      const win = new THREE.MeshStandardMaterial({ color: 0x2a3a52, emissive: 0xffc773, emissiveIntensity: 0, roughness: 0.3 });
      win.userData.window = true;
      R.windowMats.push(win);
      const nw = Math.max(2, s * 3);
      for (let k = 0; k < nw; k++) for (const side of [1, -1]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.13), win);
        w.position.set(-s * 0.3 + k * (s * 0.6 / (nw - 1)), plinth + hgt * 0.55, side * (s * 0.4 + 0.003));
        if (side < 0) w.rotation.y = Math.PI;
        g.add(w);
      }
      if (b.type === 'groomer') { const cat = makeSnowcat(); cat.position.set(s * 0.6, 0, 0.1); cat.rotation.y = Math.PI / 2; g.add(cat); }
    }
    top = plinth + hgt * 1.55;
  }
  if (!ghostMat) {
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(B.icon), depthWrite: false }));
    icon.scale.set(0.7, 0.7, 0.7); icon.position.set(0, top + 0.45, 0);
    g.add(icon);
  }
  return g;
}

function makeSnowcat() {
  const g = new THREE.Group();
  const m = (geo, col, x, y, z, em) => {
    const k = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, emissive: em || 0, emissiveIntensity: em ? 1.5 : 0 }));
    if (em) k.material.userData.window = true;
    k.position.set(x, y, z); k.castShadow = true; g.add(k); return k;
  };
  m(new THREE.BoxGeometry(0.62, 0.12, 0.4), 0x2b2f36, 0, 0.07, 0);
  m(new THREE.BoxGeometry(0.42, 0.16, 0.34), 0xe8590c, -0.04, 0.21, 0);
  m(new THREE.BoxGeometry(0.2, 0.15, 0.3), 0xbcd6f0, 0.08, 0.34, 0);
  m(new THREE.BoxGeometry(0.1, 0.06, 0.48), 0xa0aec0, -0.38, 0.06, 0);
  m(new THREE.BoxGeometry(0.03, 0.04, 0.05), 0xfff3c4, 0.32, 0.2, 0.1, 0xffe9a8);
  m(new THREE.BoxGeometry(0.03, 0.04, 0.05), 0xfff3c4, 0.32, 0.2, -0.1, 0xffe9a8);
  return g;
}

// ---------- ghost previews ----------

function syncGhost() {
  const gh = R.ghost;
  const key = !gh ? '' : gh.kind === 'lift' ? `L${gh.l.type}${gh.l.bx},${gh.l.by},${gh.l.tx},${gh.l.ty}${gh.ok}` : `B${gh.b.type}${gh.b.x},${gh.b.y}${gh.ok}`;
  if (key === R.ghostKey) return;
  R.ghostKey = key;
  for (const c of R.ghostGroup.children.slice()) R.ghostGroup.remove(c);
  if (!gh) return;
  const mat = new THREE.MeshStandardMaterial({ color: gh.ok ? 0x2f9e44 : 0xe03131, transparent: true, opacity: 0.55, depthWrite: false });
  if (gh.kind === 'lift') makeLift(gh.l, mat);
  else R.ghostGroup.add(makeBuilding(gh.b, mat));
}

// ---------- guests ----------

function initGuests() {
  const MAXG = 1500;
  const bodyG = new THREE.CapsuleGeometry(0.075, 0.14, 3, 6); bodyG.translate(0, 0.17, 0);
  R.people = new THREE.InstancedMesh(bodyG, new THREE.MeshStandardMaterial({ roughness: 0.6 }), MAXG);
  R.people.castShadow = true; R.people.count = 0;
  const headG = new THREE.SphereGeometry(0.055, 8, 6); headG.translate(0, 0.36, 0);
  R.heads = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ color: 0xf2d0b5 }), MAXG);
  R.heads.count = 0;
  const skiG = new THREE.BoxGeometry(0.11, 0.015, 0.34); skiG.translate(0, 0.01, 0);
  R.skis = new THREE.InstancedMesh(skiG, new THREE.MeshStandardMaterial({ color: 0x222222 }), MAXG);
  R.skis.count = 0;
  R.scene.add(R.people, R.heads, R.skis);
  R.selRing = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.035, 6, 24), new THREE.MeshBasicMaterial({ color: 0xff8a3d, depthTest: false }));
  R.selRing.rotation.x = Math.PI / 2; R.selRing.renderOrder = 5; R.selRing.visible = false;
  R.scene.add(R.selRing);
  R.gpos = new Map();
}

function guestPos(g) {
  if (g.state === 'ride') {
    const l = S.lifts.find(x => x.id === g.lift);
    const r = l && l.riders.find(r => r.g === g);
    if (l && r) {
      const gm = liftGeom(l), p = clamp(r.p, 0, 1);
      return { x: gm.x0 + gm.ux * gm.len * p + gm.px * 0.28, y: gm.y0 + gm.uy * gm.len * p + gm.py * 0.28, riding: true, lift: l, t: p };
    }
  }
  if (g.state === 'queue') {
    const l = S.lifts.find(x => x.id === g.lift);
    if (l) {
      const k = l.queue.indexOf(g), gm = liftGeom(l);
      const row = Math.floor(k / 6), col = k % 6;
      const along = 0.75 + row * 0.24, side = (col - 2.5) * 0.17;
      return { x: gm.x0 - gm.ux * along + gm.px * side, y: gm.y0 - gm.uy * along + gm.py * side };
    }
  }
  return { x: g.x, y: g.y };
}

// 3D position of a guest's feet; chair riders sit below the cable.
function guestWorld(g, p) {
  p = p || guestPos(g);
  let y = elev(p.x, p.y);
  if (p.riding && R.liftViz) {
    const v = R.liftViz.get(p.lift.id);
    if (v && !LIFT_TYPES[p.lift.type].drag) y = cableAt(v.path, p.t).y - (p.lift.type === 'gondola' ? 0.78 : 0.62);
  }
  return new THREE.Vector3(p.x, y, p.y);
}

function updateGuests() {
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  const max = R.people.instanceMatrix.count;
  let n = 0, ns = 0;
  R.gpos.clear();
  for (const g of S.guests) {
    if (g.state === 'inside' || n >= max) continue;
    const p = guestPos(g);
    if (p.riding && p.lift.type === 'gondola') continue; // inside the cabin
    const w = guestWorld(g, p);
    R.gpos.set(g, w);
    const s = (g.kind === 'kid' ? 0.72 : 1) * OBJ;
    sv.set(s, g.state === 'injured' ? s * 0.35 : s, s);
    q.setFromAxisAngle(up, Math.PI / 2 - (g.dir || Math.PI / 2));
    m4.compose(w, q, sv);
    R.people.setMatrixAt(n, m4); R.heads.setMatrixAt(n, m4);
    R.people.setColorAt(n, col.set(g.state === 'injured' ? '#ffffff' : g.color));
    n++;
    if (g.state === 'walk' && !T.village[g.tile] && (T.piste[g.tile] || T.free[g.tile])) {
      if (g.kind === 'board') q.setFromAxisAngle(up, Math.PI - (g.dir || 0));
      m4.compose(w, q, sv);
      R.skis.setMatrixAt(ns++, m4);
    }
  }
  R.people.count = R.heads.count = n; R.skis.count = ns;
  R.people.instanceMatrix.needsUpdate = R.heads.instanceMatrix.needsUpdate = R.skis.instanceMatrix.needsUpdate = true;
  if (R.people.instanceColor) R.people.instanceColor.needsUpdate = true;
  const sel = Sel.kind === 'guest' && S.guests.find(g => g.id === Sel.id);
  R.selRing.visible = !!sel;
  if (sel) { const w = R.gpos.get(sel) || guestWorld(sel); R.selRing.position.set(w.x, w.y + 0.04, w.z); }
}

// ---------- labels ----------

const labelTex = new Map();
function labelTexture(text, color, bg) {
  const key = text + '|' + color + '|' + bg;
  if (labelTex.has(key)) return labelTex.get(key);
  const c = document.createElement('canvas'), x = c.getContext('2d');
  const font = '600 26px Inter, system-ui, sans-serif';
  x.font = font;
  const w = Math.ceil(x.measureText(text).width) + 22;
  c.width = w; c.height = 40;
  x.font = font;
  if (bg) { x.fillStyle = bg; x.beginPath(); if (x.roundRect) x.roundRect(0, 0, w, 40, 9); else x.rect(0, 0, w, 40); x.fill(); }
  x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, 21);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
  t.userData = { aspect: w / 40 };
  if (labelTex.size > 300) labelTex.clear();
  labelTex.set(key, t);
  return t;
}

// Screen-sized sprites (px tall), reused from frame to frame.
function label(text, pos, color, bg, px) {
  const t = labelTexture(text, color || '#fff', bg === undefined ? 'rgba(18,28,43,0.85)' : bg);
  let s = R.labelGroup.children[R.labelN];
  if (!s) {
    s = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, sizeAttenuation: false }));
    s.renderOrder = 10; R.labelGroup.add(s);
  }
  R.labelN++;
  s.visible = true;
  if (s.material.map !== t) { s.material.map = t; s.material.needsUpdate = true; }
  const k = (px || 20) * 2 * Math.tan(R.camera.fov * Math.PI / 360) / window.innerHeight;
  s.scale.set(k * t.userData.aspect, k, 1);
  s.position.copy(pos);
}

function drawLabels() {
  R.labelN = 0;
  const close = R.cam.dist < 30;
  const blink = Math.floor(performance.now() / 500) % 2;
  if (R.liftViz) for (const v of R.liftViz.values()) {
    const l = v.l, bot = v.path.pts[0], top = v.path.pts[v.path.pts.length - 1];
    const sel = Sel.kind === 'lift' && Sel.id === l.id;
    if (R.view === 'queues' && l.usable) {
      const w = liftWait(l), t = isFinite(w) ? clamp(w / 12, 0, 1) : 1;
      label(isFinite(w) ? `${Math.round(w)} min · ${l.queue.length}` : 'BROKEN', bot.clone().setY(bot.y + 0.9), heatColor(t, 1), undefined, 22);
    } else if (close || sel) label(l.name, bot.clone().setY(bot.y + 0.9), '#fff', undefined, 18);
    if (l.broken && blink) { const m = cableAt(v.path, 0.5); label('🔧 Broken', m.setY(m.y + 0.8), '#ff8577', undefined, 20); }
    else if (!l.usable && blink) label('⚠️ No way down', top.clone().setY(top.y + 0.9), '#ffd43b', undefined, 20);
    else if (!l.open) label('CLOSED', bot.clone().setY(bot.y + 1.6), '#ff8577', undefined, 17);
  }
  const E = eventLive();
  if (E) label(`${E.icon} ${E.name.toUpperCase()}`, new THREE.Vector3(ENTRANCE.x + 0.5, 3.2, VILLAGE_Y + 2), '#fff', 'rgba(18,28,43,0.9)', 24);
  for (let k = R.labelN; k < R.labelGroup.children.length; k++) R.labelGroup.children[k].visible = false;
}

// ---------- extras: entrance arch, event bunting, snowcats, snowfall ----------

function buildArch() {
  const g = new THREE.Group(), x = ENTRANCE.x + 0.5, z = MAP_H - 2;
  const wood = new THREE.MeshStandardMaterial({ color: 0x7b341e, roughness: 0.8 });
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.5, 0.14), wood); p.position.set(x + s * 0.75, 0.75, z); p.castShadow = true; g.add(p); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.32, 0.16), wood); beam.position.set(x, 1.5, z); beam.castShadow = true; g.add(beam);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.24), new THREE.MeshBasicMaterial({ map: labelTexture('SKI RESORT', '#ffffff', '#7b341e') }));
  sign.position.set(x, 1.5, z + 0.085); g.add(sign);
  return g;
}

function initExtras() {
  // Event bunting strung across the village
  const g = R.bunting = new THREE.Group(); g.visible = false;
  const x0 = ENTRANCE.x - 9.5, x1 = ENTRANCE.x + 10.5, z = VILLAGE_Y + 2, top = 1.9;
  const wood = new THREE.MeshStandardMaterial({ color: 0x5b3a24 });
  for (const x of [x0, x1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, top, 6), wood); p.position.set(x, top / 2, z); p.castShadow = true; g.add(p); }
  const pts = [];
  for (let k = 0; k <= 30; k++) { const t = k / 30; pts.push(new THREE.Vector3(x0 + (x1 - x0) * t, top - Math.sin(Math.PI * t) * 0.5, z)); }
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x333333 })));
  const flagG = new THREE.BufferGeometry();
  flagG.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.13, 0, 0, 0.13, 0, 0, 0, -0.3, 0]), 3));
  const cols = [0xff8a3d, 0x5ec2ff, 0x7ee08a, 0xffd43b, 0xff5c8a];
  R.flags = [];
  for (let k = 0; k < 28; k++) {
    const t = (k + 0.5) / 28;
    const f = new THREE.Mesh(flagG, new THREE.MeshBasicMaterial({ color: cols[k % 5], side: THREE.DoubleSide }));
    f.position.set(x0 + (x1 - x0) * t, top - Math.sin(Math.PI * t) * 0.5, z);
    g.add(f); R.flags.push(f);
  }
  R.scene.add(g);
  R.cats = [];
}

function initSnowfall() {
  const n = 2400, pos = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) { pos[k * 3] = (Math.random() - 0.5) * 70; pos[k * 3 + 1] = Math.random() * 30; pos[k * 3 + 2] = (Math.random() - 0.5) * 70; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  R.snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false }));
  R.snow.visible = false; R.snow.frustumCulled = false;
  R.scene.add(R.snow);
}

function updateSnowfall(dt) {
  const w = S.weather.type, on = w === 'snow' || w === 'storm';
  R.snow.visible = on;
  if (!on) return;
  const p = R.snow.geometry.attributes.position, a = p.array, wind = w === 'storm' ? 4 : 0.6, fall = w === 'storm' ? 5 : 2.2;
  const cx = R.cam.x, cz = R.cam.z, cy = elev(cx, cz);
  for (let k = 0; k < a.length; k += 3) {
    a[k] += wind * dt; a[k + 1] -= fall * dt * (0.7 + (k % 7) / 10);
    if (a[k + 1] < cy - 3) { a[k + 1] = cy + 26; a[k] = cx + (Math.random() - 0.5) * 70; a[k + 2] = cz + (Math.random() - 0.5) * 70; }
    if (Math.abs(a[k] - cx) > 35) a[k] = cx - Math.sign(a[k] - cx) * 34;
  }
  p.needsUpdate = true;
}

// After closing, each snowcat drives a serpentine over its share of the busiest pistes.
function updateSnowcats() {
  const n = countB('groomer'), t0 = closeTime(), t1 = dayEnd();
  if (!n || S.minute < t0 || S.minute >= t1) { for (const c of R.cats) c.visible = false; R.catRoute = null; return; }
  if (!R.catRoute || R.catRoute.day !== S.day) {
    const tiles = [];
    for (let i = 0; i < T.piste.length; i++) if (T.piste[i] && !T.village[i] && !T.bare[i]) tiles.push(i);
    tiles.sort((a, b) => T.traffic[b] - T.traffic[a]);
    const routes = [];
    for (let c = 0; c < n; c++) {
      const mine = tiles.filter((_, k) => k % n === c).slice(0, SNOW.groomPerGarage).sort((a, b) => ty(a) - ty(b) || (ty(a) % 2 ? tx(b) - tx(a) : tx(a) - tx(b)));
      if (mine.length > 1) routes.push(mine);
    }
    R.catRoute = { day: S.day, routes };
  }
  while (R.cats.length < R.catRoute.routes.length) { const c = makeSnowcat(); c.scale.setScalar(OBJ * 1.4); R.scene.add(c); R.cats.push(c); }
  const p = (S.minute - t0) / (t1 - t0);
  R.cats.forEach((c, k) => {
    const r = R.catRoute.routes[k];
    c.visible = !!r;
    if (!r) return;
    const f = p * (r.length - 1), i = Math.floor(f), a = r[i], b = r[Math.min(r.length - 1, i + 1)], u = f - i;
    const x = tx(a) + (tx(b) - tx(a)) * u + 0.5, y = ty(a) + (ty(b) - ty(a)) * u + 0.5;
    c.position.set(x, elev(x, y), y);
    c.rotation.y = -Math.atan2(ty(b) - ty(a), tx(b) - tx(a));
  });
}

// ---------- sun, sky and time of day ----------

const mixRGB = (a, b, t) => a.map((v, k) => Math.round(v + (b[k] - v) * t));
const cssRGB = c => `rgb(${c[0]},${c[1]},${c[2]})`;

function updateSun() {
  const m = S.minute;
  const t = clamp((m - (7 * 60 + 50)) / (9.5 * 60), 0, 1);       // sunrise ~07:50, sunset ~17:20
  const day = Math.sin(Math.PI * t);
  const night = Math.min(1, clamp((m - 17 * 60) / 60, 0, 1) + clamp((8 * 60 + 10 - m) / 30, 0, 1));
  const az = Math.PI * (0.1 + 0.8 * t), el = Math.max(0.04, day * 0.55), D = 140;
  R.sun.position.set(MAP_W / 2 + Math.cos(az) * D * Math.cos(el), Math.sin(el) * D, MAP_H / 2 + Math.sin(az) * D * Math.cos(el) * 0.9);
  R.sun.target.position.set(MAP_W / 2, 0, MAP_H / 2);
  const warm = 1 - day;
  R.sun.color.setRGB(1, 0.94 - warm * 0.28, 0.86 - warm * 0.5);
  const clear = { sunny: 1, cloudy: 0.45, snow: 0.35, storm: 0.2, warm: 1 }[S.weather.type] || 1;
  R.sun.intensity = (0.4 + 1.6 * day) * clear * (1 - night);
  R.hemi.intensity = (0.3 + 0.4 * day) * (1 - 0.6 * night) + (1 - clear) * 0.3;
  R.hemi.color.setRGB(0.81 - night * 0.3, 0.89 - night * 0.25, 1);
  R.renderer.toneMappingExposure = 0.62 + 0.22 * day;
  const lit = Math.max(clamp((m - 16 * 60) / 70, 0, 1), clamp((8 * 60 + 20 - m) / 30, 0, 1));
  if (R.windowMats) for (const w of R.windowMats) w.emissiveIntensity = lit * 2.2;
  // Sky and fog, quantised so the gradient isn't repainted every frame
  const key = Math.round(m / 5) + S.weather.type;
  if (key === R.skyKey) return;
  R.skyKey = key;
  const grey = 1 - clear;
  let top = mixRGB([47, 111, 179], [140, 154, 172], grey), mid = mixRGB([141, 187, 227], [176, 188, 202], grey), low = mixRGB([220, 233, 244], [206, 214, 224], grey);
  const sunset = clamp(1 - Math.abs(m - 16 * 60 - 50) / 45, 0, 1) * clear;
  mid = mixRGB(mid, [244, 170, 120], sunset * 0.6); low = mixRGB(low, [255, 200, 150], sunset * 0.7);
  top = mixRGB(top, [10, 16, 34], night); mid = mixRGB(mid, [24, 34, 62], night); low = mixRGB(low, [42, 52, 82], night);
  const g = R.sky.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, cssRGB(top)); gr.addColorStop(0.55, cssRGB(mid)); gr.addColorStop(1, cssRGB(low));
  g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  R.skyTex.needsUpdate = true;
  R.scene.fog.color.setRGB(low[0] / 255, low[1] / 255, low[2] / 255).convertSRGBToLinear();
}

// Fog starts beyond the area you are looking at, so it only softens the distance and never hides the map.
function updateFog() {
  const w = S.weather.type, d = R.cam.dist;
  const extra = w === 'storm' ? 25 : w === 'snow' ? 60 : 120;
  R.scene.fog.near = d + extra;
  R.scene.fog.far = d + extra + (w === 'storm' ? 110 : w === 'snow' ? 200 : 320);
}

// ---------- camera ----------

function clampCam() {
  const c = R.cam;
  c.x = clamp(c.x, -4, MAP_W + 4); c.z = clamp(c.z, -4, MAP_H + 4);
  c.dist = clamp(c.dist, 5, 150);
  c.pitch = clamp(c.pitch, 0.22, 1.45);
}

function applyCamera() {
  const c = R.cam, ty0 = elev(c.x, c.z);
  R.camY = R.camY == null ? ty0 : R.camY + (ty0 - R.camY) * 0.2;
  const cp = Math.cos(c.pitch);
  const pos = new THREE.Vector3(c.x + Math.sin(c.yaw) * cp * c.dist, R.camY + Math.sin(c.pitch) * c.dist, c.z + Math.cos(c.yaw) * cp * c.dist);
  pos.y = Math.max(pos.y, groundAt(pos.x, pos.z) + 1.2); // never dip into the mountain
  R.camera.position.copy(pos);
  R.camera.lookAt(c.x, R.camY, c.z);
  R.camera.updateMatrixWorld();
}

function resetCamera(x, y) {
  Object.assign(R.cam, { dist: innerWidth < 700 ? 60 : 46, yaw: -0.35, pitch: 0.62 });
  if (x != null) { R.cam.x = x; R.cam.z = y; }
  R.camY = null;
  clampCam();
}

// The rest of the game talks in world pixels (TILE per tile).
function centerCamOn(wx, wy) { R.cam.x = wx / TILE; R.cam.z = wy / TILE; clampCam(); }
function centerCamOnProj(X, Y) { centerCamOn(X, Y); }
function mapW() { return MAP_W * TILE; }
function mapH() { return MAP_H * TILE; }

// Ray from the camera through a screen point, marched until it meets the ground.
const _ray = new THREE.Raycaster();
function rayGround(sx, sy) {
  _ray.setFromCamera(new THREE.Vector2(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1), R.camera);
  const o = _ray.ray.origin, d = _ray.ray.direction;
  let prev = 0, step = 0.25;
  for (let t = 0.5; t < 600; t += step) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (y <= groundAt(x, z)) {
      let lo = prev, hi = t;
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) / 2;
        if (o.y + d.y * mid <= groundAt(o.x + d.x * mid, o.z + d.z * mid)) hi = mid; else lo = mid;
      }
      return { x: o.x + d.x * hi, y: o.y + d.y * hi, z: o.z + d.z * hi };
    }
    prev = t;
    step = Math.min(1.2, step * 1.04);
    if (y < -5) break;
  }
  return null;
}

function screenToWorld(sx, sy) {
  const h = rayGround(sx, sy);
  return h ? { x: h.x * TILE, y: h.z * TILE } : { x: -1e9, y: -1e9 };
}
function screenToProj(sx, sy) { return screenToWorld(sx, sy); }

function worldToScreen(v) {
  const p = v.clone().project(R.camera);
  return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight, behind: p.z > 1 };
}

// Ground distance covered by one screen pixel at the camera target.
function pixelSize() { return 2 * R.cam.dist * Math.tan(R.camera.fov * Math.PI / 360) / innerHeight; }

function panBy(dx, dy) {
  const c = R.cam, s = pixelSize();
  const k = 1 / Math.max(0.45, Math.sin(c.pitch));
  // screen right and screen "up" projected onto the ground
  const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw), fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
  c.x -= (rx * dx - fx * dy * k) * s;
  c.z -= (rz * dx - fz * dy * k) * s;
  clampCam();
}

function rotateBy(dx, dy) {
  R.cam.yaw -= dx * 0.006;
  R.cam.pitch += dy * 0.004;
  clampCam();
}

function zoomAt(sx, sy, f) {
  const c = R.cam, h = rayGround(sx, sy);
  const nd = clamp(c.dist / f, 5, 150), k = 1 - nd / c.dist;
  if (h && k > 0) { c.x += (h.x - c.x) * k; c.z += (h.z - c.z) * k; }
  c.dist = nd;
  clampCam();
}

// ---------- mini-map ----------

function drawMinimap(cv) {
  const want = Math.round(cv.width * MAP_H / MAP_W);
  if (cv.height !== want) { cv.height = want; cv.style.height = Math.round(cv.clientWidth * MAP_H / MAP_W) + 'px'; }
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, sx = W / MAP_W, sy = H / MAP_H;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(R.base, 0, 0, W, H);
  // hill shading from the heights so the mini-map reads as a mountain
  if (!R.miniShade) {
    const sh = document.createElement('canvas'); sh.width = MAP_W; sh.height = MAP_H;
    const g = sh.getContext('2d'), img = g.createImageData(MAP_W, MAP_H);
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      const dx = elev(x + 1, y + 0.5) - elev(x, y + 0.5), dy = elev(x + 0.5, y + 1) - elev(x + 0.5, y);
      const lit = clamp(0.5 - dx * 0.6 + dy * 0.4, 0, 1), k = (y * MAP_W + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = lit < 0.5 ? 40 : 255; img.data[k + 3] = Math.min(140, Math.abs(lit - 0.5) * 220);
    }
    g.putImageData(img, 0, 0);
    R.miniShade = sh;
  }
  ctx.drawImage(R.miniShade, 0, 0, W, H);
  if (R.view !== 'none' && R.view !== 'queues') ctx.drawImage(R.view === 'slope' ? R.slopeLayer : R.viewLayer, 0, 0, W, H);
  for (const b of S.buildings) { ctx.fillStyle = BUILDING_TYPES[b.type].color; ctx.fillRect(b.x * sx, b.y * sy, b.size * sx, b.size * sy); }
  ctx.lineWidth = 1.5;
  for (const l of S.lifts) {
    ctx.strokeStyle = l.broken ? '#e03131' : '#222';
    ctx.beginPath(); ctx.moveTo((l.bx + 0.5) * sx, (l.by + 0.5) * sy); ctx.lineTo((l.tx + 0.5) * sx, (l.ty + 0.5) * sy); ctx.stroke();
  }
  ctx.fillStyle = '#e8590c';
  for (const g of S.guests) {
    if (g.state === 'inside') continue;
    const p = guestPos(g);
    ctx.fillRect(p.x * sx - 0.75, p.y * sy - 0.75, 1.5, 1.5);
  }
  // what the camera sees
  const top = Math.max(0, innerHeight * 0.1);
  const corners = [[0, top], [innerWidth, top], [innerWidth, innerHeight], [0, innerHeight]].map(([x, y]) => rayGround(x, y));
  ctx.strokeStyle = '#ffd43b'; ctx.lineWidth = 1.5;
  if (corners.every(Boolean)) {
    ctx.beginPath(); corners.forEach((h, k) => k ? ctx.lineTo(h.x * sx, h.z * sy) : ctx.moveTo(h.x * sx, h.z * sy)); ctx.closePath(); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(R.cam.x * sx, R.cam.z * sy, 4, 0, 7); ctx.stroke();
  }
}

// ---------- per frame ----------

function render() {
  const now = performance.now(), dt = Math.min(0.1, (now - (R.lastT || now)) / 1000);
  R.lastT = now;
  if (!R.vh) return;
  // while painting, repaint the (slow) base texture at most ~5 times a second
  if (R.overlayDirty && (!UI.drag || now - R.lastOverlay > 200)) {
    paintBase(); syncTrees(); R.overlayDirty = false; R.lastOverlay = now;
  }
  syncLifts();
  syncBuildings();
  applyCamera();
  const key = overlayKey();
  const viewStale = (R.view === 'condition' || R.view === 'snow' || R.view === 'traffic') && now - R.viewAt > 800;
  if (key !== R.ovKey || viewStale) { R.ovKey = key; redrawOverlay(now); }
  updateLifts(dt);
  updateGuests();
  updateSnowcats();
  updateSnowfall(dt);
  updateSun();
  updateFog();
  R.bunting.visible = !!eventLive();
  if (R.bunting.visible) R.flags.forEach((f, k) => { f.rotation.x = Math.sin(now / 400 + k) * 0.35; });
  // the selected building glows
  if (R.bldViz) for (const [id, g] of R.bldViz) {
    const on = Sel.kind === 'building' && Sel.id === id;
    if (g.userData.sel === on) continue;
    g.userData.sel = on;
    g.traverse(o => { if (o.isMesh && o.material.emissive && !o.material.userData.window) o.material.emissiveIntensity = on ? 0.35 : 0; });
  }
  drawLabels();
  R.renderer.render(R.scene, R.camera);
}
