// The village: zoning, streets, plot values, private developers and upgrades, and guests who stay for several days.

function privateBuildings() { return S.buildings.filter(b => BUILDING_TYPES[b.type].private); }
function levelOf(b) { return b.level || 1; }
function bedsOf(b) { const B = BUILDING_TYPES[b.type]; return B.beds ? Math.round(B.beds * LEVEL_MULT[levelOf(b)]) : 0; }
function capOf(b) { const B = BUILDING_TYPES[b.type]; return Math.round((B.capacity || 0) * LEVEL_MULT[levelOf(b)]); }
function levelName(b) { const B = BUILDING_TYPES[b.type]; return B.levels ? B.levels[levelOf(b) - 1] : B.name; }
function villageBeds() { return privateBuildings().reduce((a, b) => a + bedsOf(b), 0); }
function garageSpaces() { return S.buildings.reduce((a, b) => a + (b.type === 'garage' ? Math.round(BUILDING_TYPES.garage.spaces * LEVEL_MULT[levelOf(b)]) : 0), 0); }

// ---------- land: village tiles plus zoned gentle land around it ----------

function nearStation(i, r) {
  const x = tx(i), y = ty(i);
  for (const l of S.lifts) {
    if (Math.max(Math.abs(l.bx - x), Math.abs(l.by - y)) <= r || Math.max(Math.abs(l.tx - x), Math.abs(l.ty - y)) <= r) return true;
  }
  return false;
}

// Land the village may spread onto: gentle slopes just above the valley, or a hamlet around a lift station.
function expandable(i) {
  if (T.village[i]) return true;
  if (T.rock[i] || T.piste[i] || T.free[i] || T.diff[i] > 1) return false;
  return ty(i) >= VILLAGE_Y - VILLAGE_SPREAD || nearStation(i, HAMLET_RANGE);
}
function isVillageLand(i) { return T.village[i] === 1 || T.zone[i] > 0; }
function canZone(i) { return T.occ[i] === 0 && !T.piste[i] && expandable(i); }
function canPath(i) { return T.occ[i] === 0 && !T.piste[i] && !T.rock[i] && (T.village[i] || T.diff[i] <= 1) && !(tx(i) === ENTRANCE.x && ty(i) >= MAP_H - 2); }

// mode: 'path', 1–3 (a zone), or 'remove'
function paintVillage(tiles, mode) {
  let todo, cost = 0;
  if (mode === 'remove') {
    let n = 0;
    for (const i of tiles) if (T.zone[i] || T.path[i]) { noteTile(i); T.zone[i] = 0; T.path[i] = 0; n++; }
    if (n) Net.dirty = true;
    return n;
  }
  if (mode === 'path') {
    todo = tiles.filter(i => canPath(i) && !T.path[i]);
    cost = todo.length * PATH_COST + todo.filter(i => T.tree[i]).length * TREE_CLEAR_COST;
  } else {
    todo = tiles.filter(i => canZone(i) && T.zone[i] !== mode);
    cost = todo.filter(i => !T.zone[i]).length * ZONE_COST + todo.filter(i => T.tree[i]).length * TREE_CLEAR_COST;
  }
  if (!todo.length) return 0;
  if (cost > S.money) { Events.emit('toast', { text: 'Not enough money!', bad: true }); return 0; }
  for (const i of todo) {
    noteTile(i);
    T.tree[i] = 0;
    if (mode === 'path') T.path[i] = 1; else T.zone[i] = mode;
  }
  spend('construction', cost); noteCost(cost);
  Net.dirty = true;
  return cost || todo.length;
}

// ---------- plot value ----------

const PV = { version: -1, n: -1, v: null, dl: null, dp: null, ds: null };

// Chebyshev distance from every tile to the nearest source.
function distField(sources) {
  const N = MAP_W * MAP_H, d = new Uint8Array(N).fill(255), q = [];
  for (const s of sources) { d[s] = 0; q.push(s); }
  for (let h = 0; h < q.length; h++) {
    const a = q[h], ax = tx(a), ay = ty(a), nd = d[a] + 1;
    if (nd > 30) continue;
    for (const [dx, dy] of NB8) {
      const x = ax + dx, y = ay + dy;
      if (!inMap(x, y)) continue;
      const b = idx(x, y);
      if (d[b] > nd) { d[b] = nd; q.push(b); }
    }
  }
  return d;
}

function plotGrid() {
  if (PV.version === Net.version && PV.n === S.buildings.length) return PV;
  const N = MAP_W * MAP_H;
  const lifts = [], pistes = [], squares = [], parks = [];
  for (const l of S.lifts) lifts.push(idx(l.bx, l.by), idx(l.tx, l.ty));
  for (let i = 0; i < N; i++) if (T.piste[i] && !T.village[i]) pistes.push(i);
  for (const b of S.buildings) {
    const list = b.type === 'square' ? squares : b.type === 'parking' || b.type === 'garage' ? parks : null;
    if (list) for (const [x, y] of buildingTiles(b.x, b.y, b.size)) list.push(idx(x, y));
  }
  PV.dl = distField(lifts); PV.dp = distField(pistes); PV.ds = distField(squares);
  const dk = distField(parks);
  PV.v = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const dl = PV.dl[i], dp = PV.dp[i], ds = PV.ds[i];
    let v = 1;
    v += dl <= 2 ? 0.55 : dl <= 5 ? 0.3 : dl <= 9 ? 0.1 : 0;          // ski-in, ski-out
    v += dp <= 1 ? 0.25 : dp <= 3 ? 0.1 : 0;
    v += ds <= 7 ? 0.4 * (1 - ds / 8) : 0;                             // near the square
    v += clamp((T.height[i] - BASE_ALT) / 600, 0, 0.35);               // the view from up the slope
    if (dk <= 1) v -= 0.1;                                             // next to a car park
    PV.v[i] = clamp(v, 0.6, 2.4);
  }
  PV.version = Net.version; PV.n = S.buildings.length;
  return PV;
}

function plotValue(i) { return plotGrid().v[i]; }
function frontage(x, y, size) {
  for (let yy = y - 1; yy <= y + size; yy++) for (let xx = x - 1; xx <= x + size; xx++) {
    if (xx >= x && yy >= y && xx < x + size && yy < y + size) continue;
    if (inMap(xx, yy) && T.path[idx(xx, yy)]) return true;
  }
  return false;
}
function buildingValue(b) {
  const g = plotGrid().v;
  let s = 0;
  for (const [x, y] of buildingTiles(b.x, b.y, b.size)) s += g[idx(x, y)];
  return s / (b.size * b.size) + (frontage(b.x, b.y, b.size) ? 0.12 : 0);
}
function buildingSkiIn(b) { return plotGrid().dl[idx(b.x, b.y)] <= 3 || plotGrid().dp[idx(b.x, b.y)] <= 1; }

// ---------- walking through the village along streets ----------

const VF = { version: -1, cache: new Map() };
function townWalk(i) { return (T.village[i] || T.path[i]) && T.occ[i] <= 0; }

// Shortest walk to a target over village tiles, strongly preferring streets.
function villageField(target) {
  if (VF.version !== Net.version) { VF.cache.clear(); VF.version = Net.version; }
  let f = VF.cache.get(target);
  if (f) return f;
  const N = MAP_W * MAP_H, dist = new Float32Array(N).fill(Infinity), next = new Int32Array(N).fill(-1);
  const heap = new Heap();
  dist[target] = 0; heap.push(target, 0);
  while (heap.size) {
    const b = heap.pop(), d = heap.lastV;
    if (d > dist[b]) continue;
    const bx = tx(b), by = ty(b);
    for (const [dx, dy, c] of NB8) {
      const ax = bx + dx, ay = by + dy;
      if (!inMap(ax, ay)) continue;
      const a = idx(ax, ay);
      if (!townWalk(a)) continue;
      const nd = d + c * (T.path[a] && T.path[b] ? 1 : T.path[a] || T.path[b] ? 1.4 : 2);
      if (nd < dist[a]) { dist[a] = nd; next[a] = b; heap.push(a, nd); }
    }
  }
  f = { dist, next };
  if (VF.cache.size > 160) VF.cache.delete(VF.cache.keys().next().value);
  VF.cache.set(target, f);
  return f;
}

function stepStroll(g, dt) {
  const target = idx(clamp(Math.floor(g.wx), 0, MAP_W - 1), clamp(Math.floor(g.wy), 0, MAP_H - 1));
  const f = villageField(target);
  const routed = g.tile !== target && isFinite(f.dist[g.tile]) && f.next[g.tile] >= 0;
  const n = routed ? f.next[g.tile] : target;
  const nx = routed ? tx(n) + 0.5 + g.ox * 0.6 : g.wx, ny = routed ? ty(n) + 0.5 + g.oy * 0.6 : g.wy;
  const v = (T.path[g.tile] ? 2.3 : 1.5) * dt;
  const dx = nx - g.x, dy = ny - g.y, d = Math.hypot(dx, dy);
  if (d > v) { g.x += dx / d * v; g.y += dy / d * v; g.dir = Math.atan2(dy, dx); return; }
  g.x = nx; g.y = ny;
  g.tile = routed ? n : idx(clamp(Math.floor(g.x), 0, MAP_W - 1), clamp(Math.floor(g.y), 0, MAP_H - 1));
  if (routed && g.tile !== target) return;
  g.x = g.wx; g.y = g.wy;
  if (g.then === 'exit') leaveResort(g);
  else if (g.then === 'home') goHome(g);
  else if (g.then === 'enter') {
    const b = S.buildings.find(x => x.id === g.bld);
    if (b) enterBuilding(g, b); else g.state = 'decide';
  } else g.state = 'decide';
}

// ---------- developers ----------

function zoneTiles(z) { let n = 0; for (let i = 0; i < T.zone.length; i++) if (T.zone[i] === z) n++; return n; }

function liftsReachable() {
  const e = idx(ENTRANCE.x, ENTRANCE.y), out = new Set();
  for (const l of S.lifts) { const f = fieldFor('L' + l.id, 3); if (f && isFinite(f.dist[e])) out.add(l.id); }
  return out;
}

// Free spots inside a zone with a street alongside, best plots first. Returns { spots, reason }.
function zoneSpots(z, size, blocked) {
  const g = plotGrid().v, spots = [];
  let sawZone = false, sawRoom = false;
  for (let y = 0; y <= MAP_H - size; y++) for (let x = 0; x <= MAP_W - size; x++) {
    if (blocked.has(idx(x, y))) continue;
    let ok = true, val = 0;
    for (let yy = y; yy < y + size && ok; yy++) for (let xx = x; xx < x + size && ok; xx++) {
      const i = idx(xx, yy);
      if (T.zone[i] !== z) { ok = false; break; }
      sawZone = true;
      if (T.occ[i] !== 0 || T.piste[i] || T.rock[i] || T.path[i]) ok = false;
      val += g[i];
    }
    if (!ok) continue;
    for (let yy = y - 1; yy <= y + size && ok; yy++) for (let xx = x - 1; xx <= x + size && ok; xx++) {
      if (inMap(xx, yy) && T.occ[idx(xx, yy)] < 0) ok = false; // keep lift stations clear
    }
    if (!ok) continue;
    sawRoom = true;
    if (!frontage(x, y, size)) continue;
    spots.push({ x, y, score: val / (size * size) + rand() * 0.25 });
  }
  spots.sort((a, b) => b.score - a.score);
  return { spots, reason: spots.length ? '' : !sawZone ? 'nozone' : !sawRoom ? 'full' : 'nostreet' };
}

function zoneDemand() {
  const appeal = clamp((S.cache.value - 18) / 35, 0, 1);
  const rep = clamp((S.reputation - 22) / 50, 0, 1.2);
  const ratio = S.stats.guestsToday / Math.max(40, S.cache.capacity);
  const beds = villageBeds(), stayers = S.stays.length;
  const occ = beds ? stayers / beds : 1;
  const evening = privateBuildings().filter(b => BUILDING_TYPES[b.type].kind === 'evening').reduce((a, b) => a + capOf(b), 0);
  const shops = privateBuildings().filter(b => b.type === 'shop').length;
  return {
    1: rep * appeal * clamp(ratio * 1.1 + occ * 0.7 + (S.stats.turnedFull > 0 ? 0.3 : 0), 0, 1.5),
    2: rep * clamp(stayers / 40 + S.stats.guestsToday / 500, 0, 1.4) * (evening < stayers * 0.35 || shops < stayers / 60 ? 1 : 0.25),
    3: S.stats.turnedFull > 10 ? clamp(S.stats.turnedFull / 60, 0.25, 1.2) : 0,
  };
}

function pickType(z, guests) {
  const types = ZONES[z].types.filter(k => S.reputation >= BUILDING_TYPES[k].minRep && guests >= (BUILDING_TYPES[k].minGuests || 0));
  if (!types.length) return null;
  const count = k => S.buildings.filter(b => b.type === k).length;
  const w = { chalet: 4, apartments: 2, lodge: 1, shop: 1 + (count('shop') < 2 ? 1 : 0), apres: 1 + (count('apres') < 1 ? 2 : 0), bistro: 1 + (count('bistro') < 1 ? 1 : 0), garage: 1 };
  let tot = 0;
  for (const k of types) tot += w[k];
  let r = rand() * tot;
  for (const k of types) { r -= w[k]; if (r <= 0) return k; }
  return types[0];
}

function develop(z, guests) {
  const type = pickType(z, guests);
  if (!type) return null;
  const B = BUILDING_TYPES[type];
  const before = liftsReachable();
  const blocked = new Set();
  for (let tries = 0; tries < 3; tries++) {
    const { spots, reason } = zoneSpots(z, B.size, blocked);
    S.village.status[z] = reason;
    if (!spots.length) {
      // a big building may not fit; try a small one of the same zone
      if (B.size > 1 && tries === 0) { const small = ZONES[z].types.find(k => BUILDING_TYPES[k].size === 1); if (small) return developType(small, z, before); }
      return null;
    }
    const spot = spots[Math.floor(rand() * Math.min(3, spots.length))];
    const b = placePrivate(type, spot.x, spot.y);
    rebuildNetwork();
    const after = liftsReachable();
    if ([...before].every(id => after.has(id))) { announce(b); return b; }
    unplace(b);
    blocked.add(idx(spot.x, spot.y));
  }
  rebuildNetwork();
  return null;
}

function developType(type, z, before) {
  const { spots, reason } = zoneSpots(z, 1, new Set());
  S.village.status[z] = reason;
  if (!spots.length) return null;
  const b = placePrivate(type, spots[0].x, spots[0].y);
  rebuildNetwork();
  const after = liftsReachable();
  if ([...before].every(id => after.has(id))) { announce(b); return b; }
  unplace(b); rebuildNetwork();
  return null;
}

function placePrivate(type, x, y) {
  const B = BUILDING_TYPES[type];
  const b = { id: S.nextId++, type, x, y, size: B.size, occupancy: 0, visits: 0, income: 0, cost: 0, built: absDay(), level: 1, dayIncome: 0 };
  for (const [cx, cy] of buildingTiles(x, y, B.size)) { const i = idx(cx, cy); T.occ[i] = b.id; T.tree[i] = 0; }
  S.buildings.push(b);
  return b;
}
function unplace(b) {
  for (const [cx, cy] of buildingTiles(b.x, b.y, b.size)) T.occ[idx(cx, cy)] = 0;
  S.buildings = S.buildings.filter(x => x !== b);
}
function announce(b) {
  const B = BUILDING_TYPES[b.type];
  const where = T.village[idx(b.x, b.y)] ? 'in the village' : 'up the mountain';
  Events.emit('toast', { text: `${B.icon} A developer built ${/^[AEIOU]/.test(B.name) ? 'an' : 'a'} ${B.name} ${where}${bedsOf(b) ? ` (+${bedsOf(b)} beds)` : ''}.` });
}

// Busy buildings on valuable plots grow a level.
function upgradeBuildings() {
  const L = VILLAGE_LEASE[S.village.lease];
  const counts = stayCounts();
  for (const b of privateBuildings()) {
    if (levelOf(b) >= 3) continue;
    const B = BUILDING_TYPES[b.type], val = buildingValue(b);
    const busy = B.kind === 'lodging' ? (counts.get(b.id) || 0) >= bedsOf(b) * 0.8
      : B.kind === 'garage' ? S.stats.turnedFull > 5 : (b.dayVisits || 0) >= capOf(b) * 1.2;
    if (!busy || val < 1.05 + 0.25 * levelOf(b) || S.reputation < 40 + 12 * levelOf(b)) continue;
    if (rand() > 0.06 * L.growth) continue;
    b.level = levelOf(b) + 1;
    Events.emit('toast', { text: `${B.icon} ${B.levels[levelOf(b) - 2]} upgraded to a ${levelName(b)}!` });
  }
}

function leaseIncome() {
  const L = VILLAGE_LEASE[S.village.lease], counts = stayCounts();
  let sum = 0;
  for (const b of privateBuildings()) {
    const B = BUILDING_TYPES[b.type], val = buildingValue(b);
    if (B.kind === 'lodging') sum += (counts.get(b.id) || 0) * L.perBed * val * (B.lux ? 1.6 : 1);
    else sum += (B.shopLease || 0) * L.perBed * val * LEVEL_MULT[levelOf(b)];
  }
  return Math.round(sum);
}

function growthChance() {
  const d = zoneDemand(), L = VILLAGE_LEASE[S.village.lease];
  return { 1: clamp(d[1] * 0.22 * L.growth, 0, 0.8), 2: clamp(d[2] * 0.2 * L.growth, 0, 0.8), 3: clamp(d[3] * 0.25 * L.growth, 0, 0.8) };
}

function nightVillage(summary) {
  const ch = growthChance();
  for (const z of [1, 2, 3]) {
    if (!zoneTiles(z)) { S.village.status[z] = 'nozone'; continue; }
    if (rand() < ch[z]) develop(z, summary.guests);
  }
  upgradeBuildings();
  for (const b of S.buildings) { b.dayVisits = 0; b.dayIncome = 0; }
}

function buyOutPrivate(id) {
  const b = S.buildings.find(x => x.id === id);
  if (!b) return false;
  const B = BUILDING_TYPES[b.type], cost = Math.round(B.buyout * LEVEL_MULT[levelOf(b)]);
  if (cost > S.money) { Events.emit('toast', { text: 'Not enough money to buy it out!', bad: true }); return false; }
  spend('construction', cost);
  S.stays = S.stays.filter(s => s.b !== b.id);
  for (const g of S.guests.slice()) if (g.stayB === b.id) g.stayId = 0;
  removeBuilding(b.id, 0, true);
  Events.emit('toast', { text: `${levelName(b)} bought out and demolished for ${fmt$(cost)}` });
  return true;
}

// ---------- guests who stay for several days ----------

function stayCounts() {
  const m = new Map();
  for (const s of S.stays) m.set(s.b, (m.get(s.b) || 0) + 1);
  return m;
}
function findStay(id) { return S.stays.find(s => s.id === id); }

// Nightly: stays tick down, departed guests leave, and lodgings take new bookings for tonight.
function nightStays() {
  for (const s of S.stays) s.nights--;
  const alive = new Set(S.buildings.map(b => b.id));
  S.stays = S.stays.filter(s => s.nights > 0 && alive.has(s.b));
  const occT = clamp(0.12 + S.reputation / 115, 0.08, 0.95) * clamp(0.5 + S.cache.value / 90, 0.5, 1.15) * (0.75 + 0.25 * villageAppeal());
  const counts = stayCounts();
  for (const b of privateBuildings()) {
    const B = BUILDING_TYPES[b.type];
    if (B.kind !== 'lodging') continue;
    const beds = bedsOf(b), here = counts.get(b.id) || 0;
    const want = beds * clamp(occT * (0.75 + buildingValue(b) * 0.25), 0, 1);
    const add = Math.max(0, Math.min(beds - here, Math.round((want - here) * 0.6 + rand() * 1.5)));
    for (let k = 0; k < add; k++) S.stays.push(newStay(b, B));
  }
  S.stayQueue = S.stays.map(s => s.id).sort(() => rand() - 0.5);
  S.stayQueueN = S.stayQueue.length;
}

function newStay(b, B) {
  const kind = rand() < 0.22 ? 'kid' : rand() < 0.22 ? 'board' : 'adult';
  const r = rand();
  const skill = kind === 'kid' ? (r < 0.6 ? 0 : 1) : r < 0.2 ? 0 : r < 0.55 ? 1 : r < 0.85 ? 2 : 3;
  return {
    id: S.nextId++, b: b.id, kind, skill, xp: 0, nights: 2 + Math.floor(rand() * 4), happy: 70 + rand() * 10,
    name: FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)] + ' ' + String.fromCharCode(65 + Math.floor(rand() * 26)) + '.',
    color: JACKET_COLORS[Math.floor(rand() * JACKET_COLORS.length)],
    cash: (90 + Math.floor(rand() * 160)) * (B.lux ? 2 : 1), lux: !!B.lux, day: 0,
  };
}

// Morning: staying guests walk out of their lodging, spread over the first hour.
function stayTick(dt) {
  if (!S.stayQueue || !S.stayQueue.length || S.minute < DAY_START + 10) return;
  S.stayAcc = (S.stayAcc || 0) + Math.max(0.5, S.stayQueueN / 70) * dt;
  while (S.stayAcc >= 1 && S.stayQueue.length) {
    S.stayAcc -= 1;
    const s = findStay(S.stayQueue.shift());
    if (s) spawnStayer(s);
  }
}

function spawnStayer(s) {
  const b = S.buildings.find(x => x.id === s.b);
  if (!b) return;
  const g = makeGuest(s.kind, s.skill);
  Object.assign(g, { name: s.name, color: s.color, xp: s.xp, happy: s.happy, cash: s.cash, lux: s.lux, stayId: s.id, stayB: b.id });
  let door = buildingDoor(b);
  // a lodging that can't reach the lifts sends its guests round by the road
  const reach = fieldFor('V', g.skill);
  if (!T.village[door] && !(reach && isFinite(reach.dist[door]))) door = idx(ENTRANCE.x, ENTRANCE.y);
  setGuestTile(g, door);
  S.guests.push(g);
  S.stats.guestsToday++; S.stats.totalGuests++; S.stats.stayersToday = (S.stats.stayersToday || 0) + 1;
  const price = Math.round(S.prices.ticket * 0.85 * (s.kind === 'kid' ? 0.6 : 1)); // multi-day pass
  earn('tickets', price); g.spent += price;
  if (s.day++ === 0) {
    if (buildingSkiIn(b)) { g.happy += 5; think(g, 'skiin'); }
    else {
      const f = villageField(door), lift = S.lifts.filter(l => T.village[idx(l.bx, l.by)]).map(l => f.dist[idx(l.bx, l.by)]);
      if (lift.length && Math.min(...lift) > 22) { g.happy -= 4; think(g, 'long_walk'); }
    }
    if (villageAppeal() > 0.6 && rand() < 0.5) { g.happy += 3; think(g, 'village_nice'); }
  } else think(g, 'staying');
}

// Overnight guests head out for the evening, then back to their room. Returns true when it took over.
function stayEvening(g) {
  const s = g.stayId && findStay(g.stayId);
  if (!s || s.nights <= 1) return false; // last day: they check out and drive home
  const home = S.buildings.find(b => b.id === s.b);
  if (!home) return false;
  g.leaving = true;
  if (!g.eveningDone && S.minute >= closeTime() - 100) { // après-ski starts mid-afternoon
    g.eveningDone = true;
    const hx = home.x, hy = home.y;
    const venues = S.buildings.filter(b => {
      const B = BUILDING_TYPES[b.type];
      if (B.kind !== 'evening' && B.kind !== 'shop' && !(B.kind === 'food' && isVillageLand(idx(b.x, b.y)))) return false;
      return b.occupancy < (B.private ? capOf(b) : B.capacity);
    });
    if (venues.length) {
      const score = b => Math.hypot(b.x - hx, b.y - hy) - (BUILDING_TYPES[b.type].kind === 'evening' ? 12 : 0) + rand() * 10;
      const b = venues.map(v => [score(v), v]).sort((a, c) => a[0] - c[0])[0][1];
      g.bld = b.id; goVillageWalk(g, buildingDoor(b), 'enter');
      return true;
    }
    g.happy -= 6; think(g, 'no_evening');
  }
  goVillageWalk(g, buildingDoor(home), 'home');
  return true;
}

// The guest goes back to their room: they leave the map but keep their stay.
function goHome(g) {
  const s = g.stayId && findStay(g.stayId);
  if (s) Object.assign(s, { happy: clamp(g.happy * 0.85 + 70 * 0.15, 0, 100), skill: g.skill, xp: g.xp, cash: Math.max(40, g.cash + 60) });
  S.guests = S.guests.filter(x => x !== g);
  if (Sel.kind === 'guest' && Sel.id === g.id) Sel.kind = null;
}

// Evening venues and shops are paid by the guest; the resort takes a cut.
function payVenue(g, b) {
  const B = BUILDING_TYPES[b.type];
  const p = Math.round(B.spend * (g.lux ? 1.8 : 1) * (0.85 + 0.15 * levelOf(b)));
  if (g.cash >= p) {
    g.cash -= p; g.spent += p; b.income += p; b.dayIncome = (b.dayIncome || 0) + p;
    earn('lease', Math.round(p * (B.kind === 'shop' ? 0.15 : 0.3)));
    g.happy += B.kind === 'shop' ? 5 : 8;
    think(g, b.type === 'apres' ? 'apres' : b.type === 'bistro' ? 'dinner' : 'shopping');
  }
  b.visits++; b.dayVisits = (b.dayVisits || 0) + 1;
  g.energy = Math.min(100, g.energy + 6);
}

function villageAppeal() {
  let paths = 0;
  for (let i = 0; i < T.path.length; i++) paths += T.path[i];
  const venues = privateBuildings().filter(b => BUILDING_TYPES[b.type].kind !== 'lodging').length;
  return clamp(countB('square') * 0.35 + paths / 140 + venues * 0.08, 0, 1);
}

function villageAdvice() {
  const d = zoneDemand();
  if (d[1] > 0.4 && S.village.status[1] === 'nozone') advise('zone_lodging', 'Developers want to build holiday homes. Zone some land for Lodging with the 🏘️ Village tool.');
  else if (S.village.status[1] === 'nostreet' || S.village.status[2] === 'nostreet') advise('zone_street', 'Developers only build on zoned plots next to a street. Draw paths alongside your zones with the Village tool.');
  if (S.stays.length > 30 && !privateBuildings().some(b => BUILDING_TYPES[b.type].kind === 'evening')) {
    advise('no_evening', 'Your overnight guests have nothing to do in the evening. Zone some Shops & dining land.');
  }
  if (S.stats.turnedFull > 30 && S.village.status[3] === 'nozone') advise('zone_parking', 'Visitors are turned away for lack of parking. Build car parks, or zone Parking land for a private operator.');
}
