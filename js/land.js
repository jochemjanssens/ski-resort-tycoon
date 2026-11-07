// Land ownership: the resort starts with a small patch of the mountain and buys neighbouring parcels.

function parcelOf(i) { return Math.min(PARCELS_X - 1, Math.floor(tx(i) / PARCEL)) + Math.min(PARCELS_Y - 1, Math.floor(ty(i) / PARCEL)) * PARCELS_X; }
function parcelXY(p) { return [p % PARCELS_X, Math.floor(p / PARCELS_X)]; }
function ownedParcels() { return S.parcels.reduce((a, v) => a + (v ? 1 : 0), 0); }

function parcelTiles(p) {
  const [px, py] = parcelXY(p), out = [];
  const y1 = py === PARCELS_Y - 1 ? MAP_H : (py + 1) * PARCEL;
  for (let y = py * PARCEL; y < y1; y++) for (let x = px * PARCEL; x < Math.min(MAP_W, (px + 1) * PARCEL); x++) out.push(idx(x, y));
  return out;
}

function parcelCenter(p) {
  const t = parcelTiles(p);
  let x = 0, y = 0;
  for (const i of t) { x += tx(i) + 0.5; y += ty(i) + 0.5; }
  return [x / t.length, y / t.length];
}

function updateOwned() {
  for (let i = 0; i < T.owned.length; i++) T.owned[i] = S.parcels[parcelOf(i)] ? 1 : 0;
}

// Price: bigger and higher parcels cost more, and every parcel you own makes the next one dearer.
function parcelPrice(p) {
  const t = parcelTiles(p);
  let alt = 0;
  for (const i of t) alt += T.height[i] - BASE_ALT;
  alt /= t.length;
  const raw = (LAND.base + t.length * LAND.perTile * (0.5 + alt / LAND.alt)) * (1 + LAND.growth * ownedParcels());
  return Math.round(raw / 250) * 250;
}

function parcelNeighbours(p) {
  const [px, py] = parcelXY(p), out = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = px + dx, y = py + dy;
    if (x >= 0 && y >= 0 && x < PARCELS_X && y < PARCELS_Y) out.push(y * PARCELS_X + x);
  }
  return out;
}

function buyable(p) { return !S.parcels[p] && parcelNeighbours(p).some(n => S.parcels[n]); }

function canBuyParcel(p) {
  if (S.parcels[p]) return 'You already own this land';
  if (!buyable(p)) return 'You can only buy land next to your own';
  if (parcelPrice(p) > S.money) return 'Not enough money';
  return '';
}

function buyParcel(p) {
  const why = canBuyParcel(p);
  if (why) { Events.emit('toast', { text: why, bad: true }); return false; }
  const price = parcelPrice(p);
  spend('land', price);
  S.parcels[p] = 1;
  updateOwned();
  Net.dirty = true;
  Events.emit('changed');
  Events.emit('toast', { text: `🚩 Bought a parcel of land for ${fmt$(price)}` });
  return true;
}

// New game: own the parcels that hold the bunny tow and the end of the access road, and clear a little space there.
function initLand() {
  S.parcels = new Array(PARCELS_X * PARCELS_Y).fill(0);
  const keep = [idx(ENTRANCE.x, ENTRANCE.y)];
  let roadEnd = ENTRANCE.y;
  for (let i = 0; i < T.road.length; i++) if (T.road[i]) roadEnd = Math.min(roadEnd, ty(i));
  keep.push(idx(ENTRANCE.x, roadEnd));
  for (const l of S.lifts) keep.push(idx(l.bx, l.by), idx(l.tx, l.ty));
  let x0 = 99, x1 = -1, y0 = 99, y1 = -1;
  for (const i of keep) { const [px, py] = parcelXY(parcelOf(i)); x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) S.parcels[py * PARCELS_X + px] = 1;
  updateOwned();
  for (let i = 0; i < T.tree.length; i++) {
    if (!T.village[i]) continue;
    const dr = Math.hypot(tx(i) - ENTRANCE.x, (ty(i) - roadEnd) * 1.2);
    const nearLift = S.lifts.some(l => Math.max(Math.abs(tx(i) - l.bx), Math.abs(ty(i) - l.by)) <= 2);
    const jitter = (Math.imul(i, 2654435761) >>> 0) % 997 / 997; // a ragged edge to the clearing
    if (dr < 5.5 + jitter * 2 || nearLift || T.road[i]) T.tree[i] = 0;
  }
}

// Older saves knew nothing about land: they own the whole map.
function fillLandDefaults() {
  if (!S.parcels || S.parcels.length !== PARCELS_X * PARCELS_Y) S.parcels = new Array(PARCELS_X * PARCELS_Y).fill(1);
  updateOwned();
}

const NOT_OWNED = 'Not your land — buy it with the 🚩 Land tool';
