// Game state and simulation: construction, guest AI, lifts, staff, economy, days.

let S = null;   // game state
let T = null;   // terrain (+ mutable layers)
const Net = { dirty: true, fields: new Map(), adj: new Map(), version: 0 };
const NB8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]];
const UPHILL_TOL = 2;
const Events = { listeners: [], emit(type, data) { this.listeners.forEach(f => f(type, data)); } };
let rand = Math.random;

const idx = (x, y) => y * MAP_W + x;
const inMap = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
const tx = i => i % MAP_W;
const ty = i => (i / MAP_W) | 0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt$ = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');

function scenario() { return SCENARIOS[S.scenario] || SCENARIOS.alpine; }

function initLayers() {
  const N = MAP_W * MAP_H;
  T.piste = new Uint8Array(N);
  T.cond = new Float32Array(N).fill(100);
  T.occ = new Int32Array(N); // >0 building id, <0 -lift id
  T.cannon = new Uint8Array(N);
  T.closed = new Uint8Array(N); // avalanche closures (today only)
  T.traffic = new Float32Array(N);
  T.snow = new Float32Array(N);     // snow depth in cm
  T.free = new Uint8Array(N);       // freeride zone
  T.fresh = new Float32Array(N);    // untracked powder in freeride zones (0–1)
  T.groomed = new Uint8Array(N);    // groomed last night
  T.bare = new Uint8Array(N);       // too little snow to ski
}

function newGame(seed, scenarioId) {
  seed = seed || Math.floor(Math.random() * 1e9);
  const sc = SCENARIOS[scenarioId] || SCENARIOS.alpine;
  T = generateTerrain(seed, sc.terrain);
  initLayers();
  S = {
    seed, scenario: scenarioId && SCENARIOS[scenarioId] ? scenarioId : 'alpine',
    money: sc.money, loan: 0, maxLoan: sc.maxLoan,
    year: 1, day: 1, minute: DAY_START, speed: 1, paused: false,
    prices: { ...DEFAULT_PRICES },
    reputation: 40,
    lifts: [], buildings: [], guests: [], nextId: 1,
    research: { unlocked: new Set([...START_UNLOCKED, ...sc.unlock]), current: 'tbar', funding: 1, progress: {} },
    weather: { type: 'snow', snow: sc.snow, fresh: 18 },
    fin: { today: emptyFin(), history: [] },
    stats: freshStats(),
    staff: { ...START_STAFF },
    campaigns: [],
    night: { installed: false, on: false },
    goals: {}, won: false, advice: {}, adviceLog: [],
    tutorial: null,
    spawnAcc: 0,
    cache: emptyCache(),
  };
  S.stats.bestDay = 0; S.stats.totalGuests = 0;
  initResort();
  Undo.stack = [];
  placeStarter();
  Net.dirty = true;
  rebuildNetwork();
  Events.emit('newgame');
}

function freshStats() {
  return { guestsToday: 0, turnedPrice: 0, turnedFull: 0, happySum: 0, happyN: 0, lastDayProfit: 0, bestDay: 0, totalGuests: 0,
    injuries: 0, breakdowns: 0, leftThoughts: {}, repStart: 40, regularsToday: 0, passVisits: 0, levelUps: 0 };
}
function emptyCache() { return { value: 0, demand: 0, capacity: 0, diffsOpen: 0, wtp: 0, diffSet: new Set(), pisteOpen: 0 }; }

function emptyFin() {
  return { tickets: 0, passes: 0, food: 0, rental: 0, school: 0, hotel: 0, lease: 0, events: 0, rewards: 0,
    construction: 0, upkeep: 0, snow: 0, staff: 0, marketing: 0, research: 0, interest: 0 };
}
const INCOME_KEYS = ['tickets', 'passes', 'food', 'rental', 'school', 'hotel', 'lease', 'events', 'rewards'];
const EXPENSE_KEYS = ['construction', 'upkeep', 'snow', 'staff', 'marketing', 'research', 'interest'];

function earn(cat, amt) { S.money += amt; S.fin.today[cat] = (S.fin.today[cat] || 0) + amt; }
function spend(cat, amt) { S.money -= amt; S.fin.today[cat] = (S.fin.today[cat] || 0) + amt; }

// ---------- time helpers ----------

function closeTime() { return S.night.on ? NIGHT_SKIING.close : CLOSE_TIME; }
function dayEnd() { return closeTime() + 60; }
function liftsOpen() { return S.minute >= OPEN_TIME && S.minute < closeTime(); }
function isNightSession() { return S.night.on && S.minute >= CLOSE_TIME; }

// Starter: a rope tow and a green piste near the village.
function placeStarter() {
  const cands = [];
  for (let x0 = 4; x0 < MAP_W - 8; x0++) {
    if (Math.abs(x0 + 2 - ENTRANCE.x) < 4) continue;
    let worst = 0, bad = false;
    for (let y = VILLAGE_Y - 11; y < VILLAGE_Y; y++) {
      for (let x = x0; x < x0 + 4; x++) {
        const i = idx(x, y);
        if (T.rock[i]) bad = true;
        worst = Math.max(worst, T.diff[i]);
      }
    }
    if (!bad) cands.push({ x0, score: worst * 100 + Math.abs(x0 - ENTRANCE.x + 14) });
  }
  cands.sort((a, b) => a.score - b.score);
  if (!cands.length) cands.push({ x0: 10 });
  // Try candidates until the bunny slope actually works (skiable down to the village, enough rise).
  for (let k = 0; k < cands.length; k++) {
    const x0 = cands[k].x0, saved = [];
    for (let y = VILLAGE_Y - 11; y < VILLAGE_Y; y++) {
      for (let x = x0; x < x0 + 4; x++) {
        const i = idx(x, y);
        saved.push([i, T.tree[i], T.piste[i]]);
        T.tree[i] = 0;
        if (x < x0 + 3) T.piste[i] = 1;
      }
    }
    const l = createLift('rope', x0 + 3, VILLAGE_Y, x0 + 3, VILLAGE_Y - 11);
    l.name = 'Bunny Tow';
    rebuildNetwork();
    if ((l.usable && l.vert >= 15) || k === cands.length - 1) return;
    S.lifts.pop(); S.nextId--;
    T.occ[idx(l.bx, l.by)] = 0; T.occ[idx(l.tx, l.ty)] = 0;
    for (const [i, tr, pi] of saved) { T.tree[i] = tr; T.piste[i] = pi; }
  }
}

// ---------- undo ----------

const Undo = { stack: [], cur: null };

function beginAction(label) { Undo.cur = { label, tiles: new Map(), cost: 0, lifts: [], buildings: [] }; }
function noteTile(i) {
  if (Undo.cur && !Undo.cur.tiles.has(i)) Undo.cur.tiles.set(i, { piste: T.piste[i], tree: T.tree[i], cond: T.cond[i], free: T.free[i] });
}
function noteCost(c) { if (Undo.cur) Undo.cur.cost += c; }
function endAction() {
  const a = Undo.cur;
  Undo.cur = null;
  if (!a || (!a.tiles.size && !a.lifts.length && !a.buildings.length)) return;
  Undo.stack.push(a);
  if (Undo.stack.length > 30) Undo.stack.shift();
}

function undo() {
  const a = Undo.stack.pop();
  if (!a) { Events.emit('toast', { text: 'Nothing to undo', bad: true }); return; }
  for (const id of a.buildings) removeBuilding(id, 1, true);
  for (const id of a.lifts) removeLift(id, 1, true);
  for (const [i, v] of a.tiles) { T.piste[i] = v.piste; T.tree[i] = v.tree; T.cond[i] = v.cond; T.free[i] = v.free || 0; }
  if (a.cost) { S.money += a.cost; S.fin.today.construction -= a.cost; }
  Net.dirty = true;
  Events.emit('changed');
  Events.emit('toast', { text: `↩️ Undid: ${a.label}` });
}

// ---------- construction ----------

function canPiste(i) {
  return !T.village[i] && !T.rock[i] && T.diff[i] < 4 && T.occ[i] <= 0;
}

function paintPiste(tiles) {
  let cost = 0;
  const todo = tiles.filter(i => canPiste(i) && !T.piste[i]);
  for (const i of todo) cost += PISTE_COST + (T.tree[i] ? TREE_CLEAR_COST : 0);
  if (!todo.length) return 0;
  if (cost > S.money) { Events.emit('toast', { text: 'Not enough money!', bad: true }); return 0; }
  for (const i of todo) { noteTile(i); T.tree[i] = 0; T.piste[i] = 1; T.cond[i] = 100; T.free[i] = 0; T.groomed[i] = 1; }
  spend('construction', cost); noteCost(cost);
  Net.dirty = true;
  return cost;
}

function removePiste(tiles) {
  let n = 0;
  for (const i of tiles) if (T.piste[i]) { noteTile(i); T.piste[i] = 0; n++; }
  if (n) Net.dirty = true;
  return n;
}

function clearTrees(tiles) {
  const todo = tiles.filter(i => T.tree[i]);
  const cost = todo.length * TREE_CLEAR_COST;
  if (!todo.length) return 0;
  if (cost > S.money) { Events.emit('toast', { text: 'Not enough money!', bad: true }); return 0; }
  todo.forEach(i => { noteTile(i); T.tree[i] = 0; });
  spend('construction', cost); noteCost(cost);
  Net.dirty = true;
  return cost;
}

function plantTrees(tiles) {
  const todo = tiles.filter(i => !T.tree[i] && !T.rock[i] && !T.piste[i] && !T.village[i] && T.occ[i] === 0);
  const cost = todo.length * 15;
  if (!todo.length || cost > S.money) return 0;
  todo.forEach(i => { noteTile(i); T.tree[i] = 1; });
  spend('construction', cost); noteCost(cost);
  Net.dirty = true;
  return cost;
}

// Auto-route: cheapest downhill path from a to b that avoids terrain harder than maxDiff.
function planRoute(a, b, maxDiff) {
  const N = MAP_W * MAP_H, H = T.height;
  const res = { ok: false, path: [], reason: '', maxD: 0, len: 0 };
  if (a < 0 || b < 0 || a === b) { res.reason = 'Pick two different points'; return res; }
  if (H[b] > H[a] + UPHILL_TOL) { res.reason = 'The end must be lower than the start'; return res; }
  const passable = i => i === a || i === b || T.village[i] || T.occ[i] < 0 || canPiste(i) || T.piste[i];
  if (!passable(a) || !passable(b)) { res.reason = 'Start or end is blocked'; return res; }
  const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  const heap = new Heap();
  dist[a] = 0; heap.push(a, 0);
  while (heap.size) {
    const u = heap.pop(), d = heap.lastV;
    if (d > dist[u]) continue;
    if (u === b) break;
    const ux = tx(u), uy = ty(u);
    for (const [dx, dy, c] of NB8) {
      const x = ux + dx, y = uy + dy;
      if (!inMap(x, y)) continue;
      const v = idx(x, y);
      if (!passable(v) || H[v] > H[u] + UPHILL_TOL) continue;
      if (T.village[u] && T.village[v] && v !== b) continue; // don't wander through the village
      let cost = c;
      const df = T.village[v] || T.occ[v] < 0 ? 0 : T.diff[v];
      if (df > maxDiff) cost += 60 * (df - maxDiff);
      if (T.tree[v]) cost += 0.6;
      if (T.piste[v]) cost *= 0.7;
      const nd = d + cost;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(v, nd); }
    }
  }
  if (!isFinite(dist[b])) { res.reason = 'No downhill route between these points'; return res; }
  for (let v = b; v >= 0; v = prev[v]) {
    res.path.push(v);
    if (!T.village[v] && T.occ[v] >= 0) res.maxD = Math.max(res.maxD, T.diff[v]);
    if (v === a) break;
  }
  res.path.reverse();
  res.len = res.path.length;
  res.ok = true;
  return res;
}

function isUnlocked(key) { return S.research.unlocked.has(key); }

function checkLift(type, bx, by, tx2, ty2) {
  const L = LIFT_TYPES[type];
  const res = { ok: false, reason: '', cost: 0, len: 0, vert: 0 };
  if (!inMap(bx, by) || !inMap(tx2, ty2)) { res.reason = 'Out of bounds'; return res; }
  const bi = idx(bx, by), ti = idx(tx2, ty2);
  res.len = Math.hypot(tx2 - bx, ty2 - by);
  res.vert = Math.round(T.height[ti] - T.height[bi]);
  let trees = 0;
  for (const i of [bi, ti]) {
    if (T.rock[i]) { res.reason = 'Station on rocks'; return res; }
    if (T.occ[i] !== 0) { res.reason = 'Station tile occupied'; return res; }
    if (T.tree[i]) trees++;
    if (idx(ENTRANCE.x, ENTRANCE.y) === i) { res.reason = 'Blocks the entrance'; return res; }
  }
  res.cost = Math.round(L.baseCost + L.perTile * res.len + trees * TREE_CLEAR_COST);
  if (res.len < 3) { res.reason = 'Too short'; return res; }
  if (res.len > L.maxLen) { res.reason = `Too long (max ${L.maxLen})`; return res; }
  if (res.vert < 15) { res.reason = 'Top station must be higher'; return res; }
  const steps = Math.ceil(res.len * 2);
  for (let k = 1; k < steps; k++) {
    const x = Math.floor(bx + 0.5 + (tx2 - bx) * k / steps), y = Math.floor(by + 0.5 + (ty2 - by) * k / steps);
    if (T.occ[idx(x, y)] > 0) { res.reason = 'Line crosses a building'; return res; }
  }
  if (res.cost > S.money) { res.reason = 'Not enough money'; return res; }
  res.ok = true;
  return res;
}

function createLift(type, bx, by, tx2, ty2) {
  const id = S.nextId++;
  const count = S.lifts.filter(l => l.type === type).length + 1;
  const l = {
    id, type, name: `${LIFT_TYPES[type].name} ${count}`, bx, by, tx: tx2, ty: ty2,
    len: Math.hypot(tx2 - bx, ty2 - by), vert: T.height[idx(tx2, ty2)] - T.height[idx(bx, by)],
    open: true, queue: [], riders: [], boardTimer: 0, rides: 0, ridesToday: 0, cost: 0,
    usable: false, exits: 0, minRd: [9, 9, 9, 9], maxRd: 0,
    age: 0, broken: false, repair: 0, breakdowns: 0,
  };
  for (const i of [idx(bx, by), idx(tx2, ty2)]) { noteTile(i); T.occ[i] = -id; T.tree[i] = 0; }
  S.lifts.push(l);
  Net.dirty = true;
  return l;
}

function buildLift(type, bx, by, tx2, ty2) {
  const c = checkLift(type, bx, by, tx2, ty2);
  if (!c.ok) { Events.emit('toast', { text: c.reason, bad: true }); return null; }
  spend('construction', c.cost);
  const l = createLift(type, bx, by, tx2, ty2);
  l.cost = c.cost;
  if (Undo.cur) Undo.cur.lifts.push(l.id);
  Events.emit('toast', { text: `${l.name} built for ${fmt$(c.cost)}` });
  return l;
}

function unloadLift(l) {
  for (const g of l.queue) g.state = 'decide';
  for (const r of l.riders) { r.g.state = 'decide'; setGuestTile(r.g, idx(l.bx, l.by)); }
  l.queue = []; l.riders = [];
}

function removeLift(id, refundRatio, silent) {
  const l = S.lifts.find(x => x.id === id);
  if (!l) return;
  const refund = Math.round(l.cost * refundRatio);
  S.money += refund; S.fin.today.construction -= refund;
  unloadLift(l);
  T.occ[idx(l.bx, l.by)] = 0; T.occ[idx(l.tx, l.ty)] = 0;
  S.lifts = S.lifts.filter(x => x !== l);
  Net.dirty = true;
  if (!silent) Events.emit('toast', { text: `${l.name} demolished (refund ${fmt$(refund)})` });
}
function demolishLift(id) { removeLift(id, 0.4); }

function liftReliability(l) { return clamp(1 - l.age / 80, 0.2, 1); }
function refurbishCost(l) { return Math.round(LIFT_TYPES[l.type].baseCost * 0.3); }

function refurbishLift(id) {
  const l = S.lifts.find(x => x.id === id);
  const c = refurbishCost(l);
  if (c > S.money) { Events.emit('toast', { text: 'Not enough money!', bad: true }); return; }
  spend('construction', c);
  l.age = 0; l.broken = false; l.repair = 0;
  Events.emit('toast', { text: `🛠️ ${l.name} refurbished for ${fmt$(c)}` });
}

function upgradeOptions(l) {
  const q = LIFT_TYPES[l.type].quality;
  return Object.entries(LIFT_TYPES)
    .filter(([k, L]) => L.quality > q && isUnlocked('lift:' + k) && l.len <= L.maxLen)
    .map(([k, L]) => ({ type: k, cost: Math.max(0, Math.round(L.baseCost + L.perTile * l.len - l.cost * 0.5)) }));
}

function upgradeLift(id, type) {
  const l = S.lifts.find(x => x.id === id);
  const opt = upgradeOptions(l).find(o => o.type === type);
  if (!opt) return;
  if (opt.cost > S.money) { Events.emit('toast', { text: 'Not enough money!', bad: true }); return; }
  spend('construction', opt.cost);
  unloadLift(l);
  const oldName = LIFT_TYPES[l.type].name;
  if (l.name.startsWith(oldName)) l.name = l.name.replace(oldName, LIFT_TYPES[type].name);
  l.type = type; l.cost += opt.cost; l.age = 0; l.broken = false; l.repair = 0;
  Net.dirty = true;
  Events.emit('toast', { text: `⬆️ ${l.name} upgraded for ${fmt$(opt.cost)}` });
}

function buildingTiles(x, y, size) {
  const out = [];
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) out.push([x + dx, y + dy]);
  return out;
}

function checkBuilding(type, x, y) {
  const B = BUILDING_TYPES[type];
  const res = { ok: false, reason: '', cost: B.cost };
  let trees = 0, vil = 0;
  const tiles = buildingTiles(x, y, B.size);
  for (const [cx, cy] of tiles) {
    if (!inMap(cx, cy)) { res.reason = 'Out of bounds'; return res; }
    const i = idx(cx, cy);
    if (T.rock[i]) { res.reason = 'Cannot build on rocks'; return res; }
    if (T.occ[i] !== 0) { res.reason = 'Tile occupied'; return res; }
    if (T.piste[i]) { res.reason = 'Cannot build on a piste'; return res; }
    if (!T.village[i] && T.diff[i] >= 3) { res.reason = 'Too steep'; return res; }
    if (cx === ENTRANCE.x && cy >= MAP_H - 2) { res.reason = 'Blocks the entrance road'; return res; }
    if (T.tree[i]) trees++;
    if (T.village[i]) vil++;
  }
  if (B.where === 'village' && vil !== tiles.length) { res.reason = 'Must be built in the village'; return res; }
  if (B.where === 'mountain' && vil > 0) { res.reason = 'Must be built on the mountain'; return res; }
  if (vil > 0 && vil !== tiles.length) { res.reason = 'Cannot straddle the village edge'; return res; }
  res.cost += trees * TREE_CLEAR_COST;
  if (res.cost > S.money) { res.reason = 'Not enough money'; return res; }
  res.ok = true;
  return res;
}

function buildBuilding(type, x, y) {
  const c = checkBuilding(type, x, y);
  if (!c.ok) { Events.emit('toast', { text: c.reason, bad: true }); return null; }
  const B = BUILDING_TYPES[type];
  spend('construction', c.cost);
  const b = { id: S.nextId++, type, x, y, size: B.size, occupancy: 0, visits: 0, income: 0, cost: c.cost };
  for (const [cx, cy] of buildingTiles(x, y, B.size)) { const i = idx(cx, cy); noteTile(i); T.occ[i] = b.id; T.tree[i] = 0; }
  S.buildings.push(b);
  if (Undo.cur) Undo.cur.buildings.push(b.id);
  Net.dirty = true;
  Events.emit('toast', { text: `${B.name} built for ${fmt$(c.cost)}` });
  return b;
}

function removeBuilding(id, refundRatio, silent) {
  const b = S.buildings.find(x => x.id === id);
  if (!b) return;
  const refund = Math.round(b.cost * refundRatio);
  S.money += refund; S.fin.today.construction -= refund;
  for (const g of S.guests) if (g.bld === b.id) { g.bld = 0; g.state = 'decide'; }
  for (const [cx, cy] of buildingTiles(b.x, b.y, b.size)) T.occ[idx(cx, cy)] = 0;
  S.buildings = S.buildings.filter(x => x !== b);
  Net.dirty = true;
  if (!silent) Events.emit('toast', { text: `${BUILDING_TYPES[b.type].name} demolished (refund ${fmt$(refund)})` });
}
function demolishBuilding(id) {
  const b = S.buildings.find(x => x.id === id);
  if (b && BUILDING_TYPES[b.type].private) return buyOutPrivate(id);
  removeBuilding(id, 0.4);
}

function buildingDoor(b) {
  const cx = b.x + Math.floor(b.size / 2);
  for (const [x, y] of [[cx, b.y + b.size], [b.x - 1, b.y], [b.x + b.size, b.y], [cx, b.y - 1]]) {
    if (inMap(x, y) && isWalk(idx(x, y))) return idx(x, y);
  }
  return idx(cx, Math.min(MAP_H - 1, b.y + b.size));
}

// ---------- staff, marketing, upgrades ----------

function hireStaff(type, delta) {
  S.staff[type] = clamp((S.staff[type] || 0) + delta, 0, 50);
}

function staffNeeded(type) {
  if (type === 'instructor') {
    const cap = S.buildings.filter(b => b.type === 'school').length * BUILDING_TYPES.school.capacity;
    return Math.ceil(cap / STAFF_TYPES.instructor.per);
  }
  const base = Math.max(S.lifts.length ? 1 : 0, Math.ceil(S.lifts.length / STAFF_TYPES[type].per));
  return type === 'patrol' ? base + Math.ceil(freerideTiles() / FREERIDE.patrolPer) : base;
}

function staffCoverage(type) {
  const need = staffNeeded(type);
  return need ? clamp((S.staff[type] || 0) / need, 0, 1) : 1;
}

function schoolCapacity() {
  const cap = S.buildings.filter(b => b.type === 'school').length * BUILDING_TYPES.school.capacity;
  return Math.min(cap, (S.staff.instructor || 0) * STAFF_TYPES.instructor.per);
}

function campaignAvailable(id) {
  const C = CAMPAIGNS[id];
  if (S.campaigns.some(c => c.id === id)) return 'Already running';
  if (C.requires === 'park' && !countB('park')) return 'Needs a terrain park';
  if (C.requires === 'redblack' && !(S.cache.diffSet.has(2) || S.cache.diffSet.has(3))) return 'Needs an open red or black piste';
  if (C.cost > S.money) return 'Not enough money';
  return '';
}

function launchCampaign(id) {
  const why = campaignAvailable(id);
  if (why) { Events.emit('toast', { text: why, bad: true }); return; }
  const C = CAMPAIGNS[id];
  spend('marketing', C.cost);
  S.campaigns.push({ id, daysLeft: C.days, delay: C.delay || 0 });
  recalcValue();
  Events.emit('toast', { text: `${C.icon} ${C.name} launched!` });
}

function activeCampaigns() { return S.campaigns.filter(c => !c.delay).map(c => CAMPAIGNS[c.id]); }

function installNightSkiing() {
  if (!isUnlocked('upgrade:night') || S.night.installed) return;
  if (NIGHT_SKIING.cost > S.money) { Events.emit('toast', { text: 'Not enough money!', bad: true }); return; }
  spend('construction', NIGHT_SKIING.cost);
  S.night.installed = true; S.night.on = true;
  recalcValue();
  Events.emit('toast', { text: '💡 Floodlights installed — lifts now run until 20:00!' });
}

function toggleNightSkiing() {
  if (!S.night.installed) return;
  if (S.night.on && S.minute >= CLOSE_TIME && S.minute < NIGHT_SKIING.close) { Events.emit('toast', { text: 'Wait until the session ends', bad: true }); return; }
  S.night.on = !S.night.on;
  recalcValue();
}

// ---------- network / pathfinding ----------

function isWalk(i) {
  if (T.occ[i] < 0) return true;
  if (T.occ[i] > 0 || T.closed[i]) return false;
  if (T.village[i] === 1) return true;
  if (T.bare[i]) return false;
  return T.piste[i] === 1 || (T.free[i] === 1 && freeOpen());
}

function tileDiff(i) {
  if (T.occ[i] < 0 || T.village[i]) return 0;
  if (T.free[i] && !T.piste[i]) return Math.max(2, T.diff[i]); // off-piste is never easy
  return T.diff[i];
}

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(k, v) {
    const K = this.k, V = this.v; let n = K.length; K.push(k); V.push(v);
    while (n > 0) { const p = (n - 1) >> 1; if (V[p] <= v) break; K[n] = K[p]; V[n] = V[p]; n = p; }
    K[n] = k; V[n] = v;
  }
  pop() {
    const K = this.k, V = this.v; const top = K[0], tv = V[0];
    const lk = K.pop(), lv = V.pop(); const len = K.length;
    if (len) {
      let n = 0;
      for (;;) {
        let c = 2 * n + 1; if (c >= len) break;
        if (c + 1 < len && V[c + 1] < V[c]) c++;
        if (V[c] >= lv) break;
        K[n] = K[c]; V[n] = V[c]; n = c;
      }
      K[n] = lk; V[n] = lv;
    }
    this.lastV = tv;
    return top;
  }
}

function computeField(sources, skill) {
  const N = MAP_W * MAP_H, H = T.height;
  const dist = new Float64Array(N).fill(Infinity);
  const next = new Int32Array(N).fill(-1);
  const rd = new Int8Array(N).fill(-1);
  const heap = new Heap();
  for (const s of sources) { dist[s] = 0; heap.push(s, 0); }
  while (heap.size) {
    const b = heap.pop(); const d = heap.lastV;
    if (d > dist[b]) continue;
    rd[b] = next[b] >= 0 ? Math.max(tileDiff(b), rd[next[b]]) : tileDiff(b);
    const bx = tx(b), by = ty(b);
    for (const [dx, dy, c] of NB8) {
      const ax = bx + dx, ay = by + dy;
      if (!inMap(ax, ay)) continue;
      const a = idx(ax, ay);
      if (!isWalk(a)) continue;
      const up = H[b] - H[a];
      if (up > UPHILL_TOL) continue;
      let cost = c * (T.village[a] ? 1.3 : 1);
      if (up > 0) cost += 2;
      const df = tileDiff(b);
      if (df > skill) cost += (df - skill) * 14;
      else if (skill >= 2 && T.free[b] && !T.piste[b]) cost *= skill === 3 ? 0.45 : 0.7; // good skiers seek out the powder
      const nd = d + cost;
      if (nd < dist[a]) { dist[a] = nd; next[a] = b; heap.push(a, nd); }
    }
  }
  return { dist, next, rd };
}

function fieldFor(key, skill) {
  const f = Net.fields.get(key);
  return f ? f[skill] : null;
}

function rebuildNetwork() {
  Net.dirty = false;
  Net.version++;
  Net.fields.clear();
  const N = MAP_W * MAP_H;
  const villageSrc = [];
  for (let i = 0; i < N; i++) if (T.village[i] && isWalk(i)) villageSrc.push(i);
  const keys = [['V', villageSrc]];
  for (const l of S.lifts) keys.push(['L' + l.id, [idx(l.bx, l.by)]]);
  for (const [k, src] of keys) Net.fields.set(k, [0, 1, 2, 3].map(s => computeField(src, s)));

  // Lift exits: what can be reached from each top station.
  for (const l of S.lifts) {
    const top = idx(l.tx, l.ty);
    l.exits = 0; l.minRd = [9, 9, 9, 9]; l.maxRd = 0; l.toVillage = false;
    for (const [k] of keys) {
      const fs = Net.fields.get(k);
      if (!isFinite(fs[3].dist[top])) continue;
      l.exits++;
      if (k === 'V') l.toVillage = true;
      for (let s = 0; s < 4; s++) l.minRd[s] = Math.min(l.minRd[s], fs[s].rd[top]);
      l.maxRd = Math.max(l.maxRd, fs[3].rd[top], fs[2].rd[top]);
    }
    l.usable = l.exits > 0;
  }

  // Building adjacency for guests passing by.
  Net.adj.clear();
  for (const b of S.buildings) {
    const B = BUILDING_TYPES[b.type];
    if (B.kind !== 'food' && B.kind !== 'park') continue;
    for (let y = b.y - 1; y <= b.y + b.size; y++) for (let x = b.x - 1; x <= b.x + b.size; x++) {
      if (!inMap(x, y)) continue;
      const i = idx(x, y);
      if (!isWalk(i)) continue;
      if (!Net.adj.has(i)) Net.adj.set(i, []);
      Net.adj.get(i).push(b);
    }
  }

  // Snow cannon coverage.
  T.cannon.fill(0);
  for (const b of S.buildings) if (b.type === 'cannon') {
    for (let y = b.y - 3; y <= b.y + 3; y++) for (let x = b.x - 3; x <= b.x + 3; x++) {
      if (inMap(x, y) && Math.hypot(x - b.x, y - b.y) <= 3.5) T.cannon[idx(x, y)] = 1;
    }
  }

  // Piste tiles reachable from usable lift tops.
  const seen = new Uint8Array(N);
  const stack = [];
  for (const l of S.lifts) if (l.usable) { const t = idx(l.tx, l.ty); seen[t] = 1; stack.push(t); }
  const diffs = new Set();
  let open = 0;
  while (stack.length) {
    const a = stack.pop();
    if (T.piste[a] && !T.village[a]) { diffs.add(T.diff[a]); open++; }
    const ax = tx(a), ay = ty(a);
    for (const [dx, dy] of NB8) {
      const bx = ax + dx, by = ay + dy;
      if (!inMap(bx, by)) continue;
      const b = idx(bx, by);
      if (seen[b] || !isWalk(b) || T.village[b]) continue;
      if (T.height[b] - T.height[a] > UPHILL_TOL) continue;
      seen[b] = 1; stack.push(b);
    }
  }
  T.reach = seen;
  S.cache.diffsOpen = diffs.size;
  S.cache.diffSet = diffs;
  S.cache.pisteOpen = open;

  for (const g of S.guests) g.next = -1;
  recalcValue();
  Events.emit('network');
}

function countB(type) { return S.buildings.filter(b => b.type === type).length; }

function recalcValue() {
  let v = 0;
  for (const l of S.lifts) if (l.usable && l.open) v += LIFT_TYPES[l.type].quality * (4 + Math.min(l.vert, 900) / 25);
  v += S.cache.diffsOpen * 4;
  v += Math.min(10, (countB('cafe') + countB('restaurant') * 2) * 2);
  if (countB('rental')) v += 3;
  if (countB('school')) v += 3;
  v += Math.min(12, countB('park') * 6);
  v += countB('hotel') * 5;
  if (S.night.on) v += 8;
  v += Math.min(10, freerideTiles() / 12);
  v += Math.min(6, countB('shop') * 2);
  S.cache.value = v;
  const beds = villageBeds();
  S.cache.beds = beds;
  S.cache.capacity = 80 + countB('parking') * 100 + countB('hotel') * 60 + beds;
  const w = WEATHER[S.weather.type];
  const fresh = S.weather.fresh >= 15;
  let mk = 1;
  for (const C of activeCampaigns()) mk += C.demand + (C.powder && fresh ? C.powder : 0);
  const E = eventLive();
  if (E) mk += E.demand;
  S.cache.marketing = mk;
  S.cache.demand = (20 + v * 3.5) * (0.35 + S.reputation / 55) * w.mult * (fresh ? 1.25 : 1) * (1 + 0.15 * countB('hotel') + beds / 500) * mk
    + passHolders() * 0.3 * w.mult;
  S.cache.wtp = 16 + v * 0.5 + S.reputation * 0.25;
}

// ---------- guests ----------

function think(g, key) {
  const last = g.thoughts[0];
  if (last && last.key === key) { last.t = S.minute; return; }
  g.thoughts = g.thoughts.filter(t => t.key !== key);
  g.thoughts.unshift({ key, t: S.minute });
  if (g.thoughts.length > 6) g.thoughts.pop();
}

function setGuestTile(g, i) {
  g.tile = i; g.x = tx(i) + 0.5 + g.ox; g.y = ty(i) + 0.5 + g.oy; g.next = -1;
}

function spawnGuest() {
  if (S.guests.length >= S.cache.capacity) { S.stats.turnedFull++; return; }
  const camps = activeCampaigns();
  const E = eventLive() || {};
  const kidShare = 0.18 + camps.reduce((a, c) => a + (c.kids || 0), 0) + (E.kids || 0);
  const boardShare = 0.22 + camps.reduce((a, c) => a + (c.boards || 0), 0) + (E.boards || 0);
  const expertBoost = camps.reduce((a, c) => a + (c.experts || 0), 0) + (E.experts || 0) + Math.min(0.15, freerideTiles() / 400);
  const reg = pickRegular();
  if (reg) reg.last = absDay();
  const kind = reg ? reg.kind : rand() < kidShare ? 'kid' : rand() < boardShare ? 'board' : 'adult';
  const price = reg && reg.pass ? 0 : kind === 'kid' ? Math.round(S.prices.ticket * 0.6) : S.prices.ticket;
  const wtp = S.cache.wtp * (0.7 + rand() * 0.7) * (kind === 'kid' ? 0.6 : 1) * (reg ? 1 + reg.loyalty / 150 : 1);
  if (price > wtp) { S.stats.turnedPrice++; return; }
  let skill;
  if (reg) skill = reg.skill;
  else if (kind === 'kid') skill = rand() < 0.6 ? 0 : 1;
  else {
    const r = rand();
    skill = r < 0.25 ? 0 : r < 0.6 ? 1 : r < 0.85 ? 2 : 3;
    if (rand() < expertBoost) skill = Math.max(skill, rand() < 0.5 ? 3 : 2);
  }
  const g = {
    id: S.nextId++, kind,
    name: FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)] + ' ' + String.fromCharCode(65 + Math.floor(rand() * 26)) + '.',
    color: JACKET_COLORS[Math.floor(rand() * JACKET_COLORS.length)],
    skill, happy: 65 + rand() * 15, energy: 70 + rand() * 30, hunger: rand() * 30,
    cash: 30 + Math.floor(rand() * 120), spent: 0,
    thoughts: [], liftUses: {}, runs: 0, state: 'decide', dest: null, next: -1,
    ox: (rand() - 0.5) * 0.5, oy: (rand() - 0.5) * 0.5, lane: rand() * 2 - 1,
    runStartH: 0, runMaxDiff: 0, runQ: 0, runN: 0, leaving: false, timer: 0, bld: 0, queueTime: 0,
    arrived: S.minute, lesson: false, wx: 0, wy: 0, parkVisits: 0,
    xp: 0, reg: 0, runFree: 0, runFresh: 0, runMog: 0, runThin: 0, runGroomed: 0,
  };
  if (reg) {
    Object.assign(g, { name: reg.name, color: reg.color, xp: reg.xp || 0, reg: reg.id });
    S.stats.regularsToday++;
    if (reg.pass) { S.stats.passVisits++; g.happy += 3; think(g, 'pass'); }
    else if (rand() < 0.5) { g.happy += 3; think(g, 'regular'); }
  }
  const beds = S.cache.beds || 0;
  if (beds && rand() < beds / (S.cache.capacity || 1)) {
    g.stay = true; g.cash += 40;
    if (rand() < luxBeds() / beds) { g.cash *= 2; g.lux = true; }
    if (rand() < 0.35) { g.happy += 3; think(g, 'chalet'); }
  }
  if (isNightSession()) { g.energy = 55 + rand() * 30; g.hunger = 40 + rand() * 30; }
  setGuestTile(g, idx(ENTRANCE.x, ENTRANCE.y));
  S.guests.push(g);
  S.stats.guestsToday++; S.stats.totalGuests++;
  earn('tickets', price);
  g.spent += price;
  if (price < wtp * 0.65) { g.happy += 5; think(g, 'good_value'); }
  else if (price > wtp * 0.9) { g.happy -= 3; think(g, 'pricey_pass'); }
  if (S.weather.fresh >= 15) { g.happy += 6; think(g, 'powder'); }
  if (E.name) { g.happy += 4; think(g, S.event.id === 'race' ? 'race' : 'event'); }
  if (T.closed.some(v => v) && rand() < 0.3) think(g, 'avalanche');
  const rep0 = snowReport();
  if (rep0.n && rep0.bare > rep0.n * 0.3) { g.happy -= 6; think(g, 'bare'); }
  if (rand() < (kind === 'kid' ? 0.5 : 0.3) * (reg && reg.visits > 3 ? 0.4 : 1)) {
    if (countB('rental')) {
      const p = S.prices.rental;
      if (g.cash >= p) { g.cash -= p; g.spent += p; earn('rental', p); const b = S.buildings.find(x => x.type === 'rental'); b.visits++; b.income += p; }
      if (p > FAIR_PRICES.rental * 1.5) { g.happy -= 6; think(g, 'rental_pricey'); }
    } else { g.happy -= 12; think(g, 'no_rental'); }
  }
}

function leaveResort(g) {
  S.guests = S.guests.filter(x => x !== g);
  S.stats.happySum += g.happy; S.stats.happyN++;
  const lt = S.stats.leftThoughts;
  for (const t of g.thoughts) lt[t.key] = (lt[t.key] || 0) + 1;
  rememberGuest(g);
  if (Sel.kind === 'guest' && Sel.id === g.id) Sel.kind = null;
}

function capPerMin(l) { const L = LIFT_TYPES[l.type]; return L.seats / L.interval; }
function liftWait(l) { return l.broken ? Infinity : l.queue.length / capPerMin(l); }

function goVillageWalk(g, target, then) {
  g.state = 'stroll'; g.wx = tx(target) + 0.5; g.wy = ty(target) + 0.5; g.then = then;
}

function decide(g) {
  g.next = -1;
  const t = g.tile;
  const atVillage = T.village[t] === 1;
  const closing = S.minute >= closeTime();
  if (closing || g.energy < 12 || g.happy < 15) {
    if (!g.leaving && g.energy < 12) think(g, 'tired');
    g.leaving = true;
  }
  if (atVillage && !g.leaving && S.minute < OPEN_TIME) { g.state = 'wait'; return; }
  if (atVillage) {
    if (g.leaving) { goVillageWalk(g, idx(ENTRANCE.x, ENTRANCE.y), 'exit'); return; }
    if (g.hunger > 60) {
      const food = S.buildings.filter(b => BUILDING_TYPES[b.type].kind === 'food' && T.village[idx(b.x, b.y)]
        && b.occupancy < BUILDING_TYPES[b.type].capacity);
      if (food.length) { const b = food[Math.floor(rand() * food.length)]; g.bld = b.id; goVillageWalk(g, buildingDoor(b), 'enter'); return; }
    }
    if (g.skill === 0 && !g.lesson && rand() < (g.kind === 'kid' ? 0.85 : 0.6)) {
      const schools = S.buildings.filter(b => b.type === 'school');
      if (schools.length) {
        g.lesson = true;
        const inLessons = schools.reduce((a, b) => a + b.occupancy, 0);
        const sc = schools.find(b => b.occupancy < BUILDING_TYPES.school.capacity);
        if (sc && inLessons < schoolCapacity()) { g.bld = sc.id; goVillageWalk(g, buildingDoor(sc), 'enter'); return; }
        if (!S.staff.instructor) { think(g, 'no_lesson'); g.happy -= 5; }
      }
    }
  }
  let best = null, bestScore = -Infinity;
  if (liftsOpen()) {
    for (const l of S.lifts) {
      if (!l.open || !l.usable || l.broken) continue;
      const f = fieldFor('L' + l.id, g.skill);
      if (!f) continue;
      const d = f.dist[t];
      if (!isFinite(d)) continue;
      const L = LIFT_TYPES[l.type];
      let sc = 6 * L.quality + Math.min(l.vert, 600) / 40 + rand() * 6;
      sc -= liftWait(l) * 0.8;
      const rdTo = f.rd[t];
      if (rdTo > g.skill) sc -= 25 * (rdTo - g.skill);
      const topMin = l.minRd[g.skill];
      if (topMin > g.skill) sc -= 25 * (topMin - g.skill);
      if (g.skill >= 2 && l.maxRd >= g.skill) sc += 4;
      if (g.skill === 3 && l.maxRd <= 1) sc -= 4;
      if (g.kind === 'board' && L.drag) sc -= 4;
      sc -= (g.liftUses[l.id] || 0) * 1.2;
      sc -= d * 0.04;
      if (g.leaving) sc -= 30;
      if (sc > bestScore) { bestScore = sc; best = 'L' + l.id; }
    }
  }
  if (!atVillage) {
    const f = fieldFor('V', g.skill);
    if (f && isFinite(f.dist[t])) {
      let sc = (100 - g.energy) / 12 - 6 + (g.hunger > 60 ? 4 : 0) - Math.max(0, f.rd[t] - g.skill) * 6;
      if (g.leaving) sc += 200;
      if (sc > bestScore) { bestScore = sc; best = 'V'; }
    }
  }
  if (!best) {
    if (atVillage) {
      if (!g.leaving) { think(g, 'nothing'); g.happy -= 10; }
      g.leaving = true;
      goVillageWalk(g, idx(ENTRANCE.x, ENTRANCE.y), 'exit');
    } else {
      think(g, 'stuck'); g.happy -= 25; g.state = 'stuck'; g.timer = 30;
    }
    return;
  }
  g.dest = best;
  g.state = 'walk';
}

function injure(g) {
  S.stats.injuries++;
  think(g, 'injured');
  const cov = staffCoverage('patrol');
  g.state = 'injured';
  g.timer = cov >= 1 ? 12 : cov > 0 ? 30 : 60;
  g.happy -= cov >= 1 ? 12 : 30;
  g.leaving = true;
  if (cov >= 1) think(g, 'rescued');
  else { think(g, 'slow_rescue'); S.reputation -= 0.3; }
}

function resetRun(g) { g.runN = 0; g.runQ = 0; g.runMaxDiff = 0; g.runFree = 0; g.runFresh = 0; g.runMog = 0; g.runThin = 0; g.runGroomed = 0; }

function finishRun(g) {
  if (g.runN < 2) { resetRun(g); return; }
  const drop = g.runStartH - T.height[g.tile];
  const q = g.runQ / g.runN;
  const over = g.runMaxDiff - g.skill;
  g.runs++;
  g.energy -= 2 + Math.max(0, drop) / 60;
  if (over > 0) {
    g.happy -= 9 * over; think(g, 'too_hard');
  } else {
    let fun = Math.max(0, drop) / 30 * (0.4 + 0.6 * q);
    if (g.skill >= 2 && g.runMaxDiff < g.skill - 1) { fun *= 0.4; if (rand() < 0.3) { think(g, 'boring'); g.happy -= 1; } }
    g.happy += Math.min(fun, 12);
    if (drop > 220 && q > 0.6) think(g, 'great_run');
    else if (fun > 3 && rand() < 0.3) think(g, 'nice_run');
    if (isNightSession() && rand() < 0.3) { think(g, 'night'); g.happy += 2; }
    // Off-piste powder and moguls are what experts come for.
    if (g.runFree >= 3) {
      const fr = g.runFresh / g.runFree;
      g.happy += Math.min(10, g.runFree * 0.5 * (0.3 + fr));
      if (fr > 0.5) think(g, 'freeride'); else if (fr < 0.2 && rand() < 0.5) { think(g, 'tracked'); g.happy -= 1; }
    }
    if (g.runMog >= 3 && g.skill === 3) { g.happy += 4; if (rand() < 0.5) think(g, 'moguls'); }
    if (g.runGroomed >= g.runN * 0.7 && S.minute < 10 * 60 + 30 && q > 0.85 && rand() < 0.25) { g.happy += 2; think(g, 'corduroy'); }
    if (drop > 20) addXp(g, g.runMaxDiff >= g.skill ? 1 : 0.4);
  }
  if (g.runThin >= 3 && rand() < 0.5) { g.happy -= 4; think(g, 'thin'); }
  else if (q < 0.35 && rand() < 0.6) { g.happy -= 3; think(g, 'icy'); }
  g.happy = clamp(g.happy, 0, 100);
  const risk = (over > 0 ? 0.035 * over : 0.0008) + (q < 0.35 ? 0.004 : 0) + Math.min(0.01, g.runFree * 0.0004) + (g.runThin >= 3 ? 0.003 : 0);
  resetRun(g);
  if (rand() < risk) injure(g);
}

function arrive(g) {
  const key = g.dest;
  g.next = -1;
  finishRun(g);
  if (g.state === 'injured') return;
  if (key === 'V') { g.state = 'decide'; return; }
  const l = S.lifts.find(x => 'L' + x.id === key);
  if (!l || !l.open || l.broken || !liftsOpen()) { g.state = 'decide'; return; }
  g.state = 'queue'; g.queueTime = 0; g.lift = l.id;
  l.queue.push(g);
}

function enterTile(g, i) {
  g.tile = i;
  if (T.piste[i] && !T.village[i]) {
    T.cond[i] = Math.max(0, T.cond[i] - 0.025);
    T.traffic[i] += 1;
    g.runMaxDiff = Math.max(g.runMaxDiff, T.diff[i]);
    g.runQ += pisteQuality(i); g.runN++;
    if (T.snow[i] < SNOW.thinBelow) g.runThin++;
    if (T.groomed[i]) g.runGroomed++;
    else if (T.diff[i] >= 3) g.runMog++;
  } else if (T.free[i] && !T.village[i]) {
    T.traffic[i] += 1;
    g.runMaxDiff = Math.max(g.runMaxDiff, tileDiff(i));
    g.runQ += pisteQuality(i); g.runN++;
    g.runFree++; g.runFresh += T.fresh[i];
    T.fresh[i] = Math.max(0, T.fresh[i] - 0.06);
  }
  if (g.leaving) return false;
  const bs = Net.adj.get(i);
  if (bs) for (const b of bs) {
    const B = BUILDING_TYPES[b.type];
    if (b.occupancy >= B.capacity) continue;
    if (B.kind === 'food' && g.hunger > 55 && rand() < 0.6) { enterBuilding(g, b); return true; }
    if (B.kind === 'park' && g.parkVisits < 3 && (g.kind === 'board' || g.skill >= 2) && rand() < (g.kind === 'board' ? 0.6 : 0.3)) {
      enterBuilding(g, b); return true;
    }
  }
  return false;
}

function enterBuilding(g, b) {
  const B = BUILDING_TYPES[b.type];
  g.state = 'inside'; g.timer = B.duration * (0.8 + rand() * 0.4); g.bld = b.id;
  b.occupancy++;
}

function exitBuilding(g) {
  const b = S.buildings.find(x => x.id === g.bld);
  g.bld = 0;
  if (!b) { g.state = g.dest ? 'walk' : 'decide'; return; }
  b.occupancy = Math.max(0, b.occupancy - 1);
  const B = BUILDING_TYPES[b.type];
  if (B.kind === 'food') {
    const p = Math.round(S.prices.food * B.priceMult);
    if (g.cash >= p) {
      g.cash -= p; g.spent += p; earn('food', p); b.income += p; b.visits++;
      g.hunger = 0; g.energy = Math.min(100, g.energy + 12);
      const fest = (eventLive() || {}).food ? 1.4 : 1;
      if (S.prices.food > FAIR_PRICES.food * 1.5 * fest * (g.lux ? 1.6 : 1)) { g.happy -= 4; think(g, 'food_pricey'); }
      else { g.happy += 6; think(g, 'food_good'); }
    } else { g.hunger = Math.max(0, g.hunger - 20); }
  } else if (B.kind === 'school') {
    const p = S.prices.school;
    if (g.cash >= p) { g.cash -= p; g.spent += p; earn('school', p); b.income += p; b.visits++; }
    addXp(g, g.skill === 0 ? Math.ceil(SKILL_XP[0] * 0.85) + (rand() < 0.75 ? 4 : 0) : 8);
    g.happy += S.prices.school > FAIR_PRICES.school * 1.5 ? 2 : 10; think(g, 'lesson');
  } else if (B.kind === 'park') {
    b.visits++; g.parkVisits++;
    g.happy += g.kind === 'board' ? 10 : 7; g.energy -= 4; think(g, 'park_fun');
    if (rand() < 0.02) { g.happy = clamp(g.happy, 0, 100); injure(g); return; }
  }
  g.happy = clamp(g.happy, 0, 100);
  if (T.village[g.tile] || !g.dest) g.state = 'decide';
  else { g.state = 'walk'; g.next = -1; }
}

function updateGuest(g, dt) {
  g.hunger = Math.min(100, g.hunger + 0.15 * dt * ((eventLive() || {}).food ? 1.4 : 1));
  g.energy -= 0.03 * dt;
  if (g.hunger > 85) { g.happy -= 0.04 * dt; if (rand() < 0.01) think(g, 'hungry'); }
  switch (g.state) {
    case 'decide': decide(g); break;
    case 'walk': stepWalk(g, dt); break;
    case 'stroll': {
      const dx = g.wx - g.x, dy = g.wy - g.y, d = Math.hypot(dx, dy), v = 1.8 * dt;
      if (d <= v) {
        g.x = g.wx; g.y = g.wy;
        g.tile = idx(clamp(Math.floor(g.x), 0, MAP_W - 1), clamp(Math.floor(g.y), 0, MAP_H - 1));
        if (g.then === 'exit') leaveResort(g);
        else if (g.then === 'enter') {
          const b = S.buildings.find(x => x.id === g.bld);
          if (b) enterBuilding(g, b); else g.state = 'decide';
        }
      } else { g.x += dx / d * v; g.y += dy / d * v; }
      break;
    }
    case 'queue': {
      g.queueTime += dt;
      const l = S.lifts.find(x => x.id === g.lift);
      if (l && l.broken) { g.happy -= 0.4 * dt; think(g, 'broken'); }
      else if (g.queueTime > 6) g.happy -= 0.25 * dt;
      if (g.queueTime > 12) think(g, 'queue');
      if (g.happy < 10 || (l && l.broken && rand() < 0.05 * dt)) { // give up
        if (l) l.queue = l.queue.filter(x => x !== g);
        if (g.happy < 10) g.leaving = true;
        g.state = 'decide';
      }
      break;
    }
    case 'ride': {
      const l = S.lifts.find(x => x.id === g.lift);
      if (l && l.broken) { g.happy -= 0.5 * dt; think(g, 'stuck_lift'); }
      break;
    }
    case 'wait': if (liftsOpen()) g.state = 'decide'; break;
    case 'inside': g.timer -= dt; if (g.timer <= 0) exitBuilding(g); break;
    case 'stuck': g.timer -= dt; if (g.timer <= 0) { g.leaving = true; leaveResort(g); } break;
    case 'injured': g.timer -= dt; if (g.timer <= 0) leaveResort(g); break;
  }
  g.happy = clamp(g.happy, 0, 100);
}

// Spread skiers across the width of a piste instead of all following one line.
function pickNext(g, f) {
  const t = g.tile, best = f.next[t];
  if (best < 0 || T.village[t] || T.occ[t] < 0) return best;
  const d0 = f.dist[t], bd = f.dist[best];
  const bxv = tx(best) - tx(t), byv = ty(best) - ty(t);
  const bestHard = tileDiff(best) > g.skill;
  let pick = best, ps = Infinity;
  for (const [dx, dy] of NB8) {
    const x = tx(t) + dx, y = ty(t) + dy;
    if (!inMap(x, y)) continue;
    const n = idx(x, y);
    if (!isWalk(n) || T.height[n] - T.height[t] > UPHILL_TOL) continue;
    const dn = f.dist[n];
    if (!(dn < d0 - 0.5) || dn > bd + 2.5) continue;
    if (!bestHard && tileDiff(n) > g.skill) continue;
    const s = (dn - bd) + rand() * 2 - g.lane * (dx * -byv + dy * bxv) * 0.9;
    if (s < ps) { ps = s; pick = n; }
  }
  return pick;
}

function stepWalk(g, dt) {
  const f = fieldFor(g.dest, g.skill);
  if (!f) { g.state = 'decide'; return; }
  if (f.dist[g.tile] === 0) { arrive(g); return; }
  if (g.next < 0) {
    g.next = pickNext(g, f);
    if (g.next < 0) { g.state = 'decide'; return; }
  }
  const n = g.next;
  const nx = tx(n) + 0.5 + g.ox, ny = ty(n) + 0.5 + g.oy;
  const walking = T.village[g.tile] || T.occ[g.tile] < 0 || (!T.piste[g.tile] && !T.free[g.tile]);
  let v;
  if (walking) v = 1.8;
  else {
    v = (2.4 + T.grade[g.tile] * 14) * (0.65 + 0.15 * g.skill) * (g.kind === 'kid' ? 0.8 : 1);
    if (tileDiff(g.tile) > g.skill) v *= 0.55;
    if (!T.piste[g.tile] && T.tree[g.tile]) v *= 0.7; // tree skiing
    v = clamp(v, 1.5, 11);
  }
  const step = v * dt;
  const dx = nx - g.x, dy = ny - g.y, d = Math.hypot(dx, dy);
  if (d <= step) {
    g.x = nx; g.y = ny; g.next = -1;
    if (enterTile(g, n)) return;
    if (f.dist[n] === 0) arrive(g);
  } else {
    g.x += dx / d * step; g.y += dy / d * step;
    g.dir = Math.atan2(dy, dx);
  }
}

function updateLift(l, dt) {
  const L = LIFT_TYPES[l.type];
  if (l.broken) {
    l.repair -= dt;
    if (l.repair <= 0) { l.broken = false; Events.emit('toast', { text: `🔧 ${l.name} is running again` }); }
    return;
  }
  // Breakdowns while running
  if (liftsOpen() && l.open && (l.riders.length || l.queue.length)) {
    const cov = staffCoverage('mechanic');
    const p = 0.0006 * L.wear * (1 + l.age / 20) * (1 - 0.5 * cov) * dt;
    if (rand() < p) {
      l.broken = true; l.breakdowns++; S.stats.breakdowns++;
      l.repair = cov >= 1 ? 20 : cov > 0 ? 20 / cov : 240;
      Events.emit('toast', { text: `⚠️ ${l.name} broke down! Repair in ~${Math.round(l.repair)} min`, bad: true });
      return;
    }
  }
  const speed = L.speed / l.len;
  for (let k = l.riders.length - 1; k >= 0; k--) {
    const r = l.riders[k];
    r.p += speed * dt;
    if (r.p >= 1) {
      l.riders.splice(k, 1);
      const g = r.g;
      setGuestTile(g, idx(l.tx, l.ty));
      if (L.rest) { g.energy = Math.min(100, g.energy + L.rest); if (rand() < 0.1) think(g, 'comfy'); }
      g.runStartH = T.height[g.tile]; resetRun(g);
      g.state = 'decide';
    }
  }
  if (!l.open || !liftsOpen()) {
    if (l.queue.length) { for (const g of l.queue) g.state = 'decide'; l.queue = []; }
    return;
  }
  l.boardTimer -= dt;
  let guard = 0;
  while (l.boardTimer <= 0 && guard++ < 6) {
    l.boardTimer += L.interval;
    for (let s = 0; s < L.seats && l.queue.length; s++) {
      const g = l.queue.shift();
      g.state = 'ride'; g.liftUses[l.id] = (g.liftUses[l.id] || 0) + 1;
      if (g.kind === 'board' && L.drag) { g.happy -= 2; if (rand() < 0.4) think(g, 'drag_board'); }
      l.riders.push({ g, p: -0.0001 * s });
      l.rides++; l.ridesToday++;
    }
  }
  if (l.boardTimer < 0) l.boardTimer = 0;
}

// ---------- advisor ----------

function advise(key, text) {
  const stamp = S.year * 1000 + S.day;
  if (S.advice[key] === stamp) return;
  S.advice[key] = stamp;
  S.adviceLog.unshift({ text, year: S.year, day: S.day, t: S.minute });
  if (S.adviceLog.length > 12) S.adviceLog.pop();
  Events.emit('toast', { text: '🧑‍💼 ' + text, advisor: true });
}

function advisorCheck() {
  if (!S.guests.length && S.minute < 11 * 60) return;
  for (const l of S.lifts) {
    if (l.usable && liftWait(l) > 10 && isFinite(liftWait(l))) {
      advise('queue' + l.id, `The queue at ${l.name} is over ${Math.round(liftWait(l))} minutes. Build another lift nearby or upgrade this one.`);
    }
    if (!l.usable) advise('unusable' + l.id, `${l.name} has no piste leading away from its top station, so nobody can use it.`);
  }
  if (S.stats.turnedFull > 10) advise('full', `${S.stats.turnedFull} visitors were turned away because the resort is full. Build more car parks.`);
  if (S.stats.turnedPrice > Math.max(10, S.stats.guestsToday * 0.6)) advise('price', 'Lots of visitors think your lift pass is too expensive. Consider lowering the price.');
  const hungry = S.guests.filter(g => g.hunger > 80).length;
  if (S.guests.length > 15 && hungry > S.guests.length * 0.25) advise('hungry', 'Many skiers are starving. Build cafés or restaurants right next to busy pistes.');
  if (S.day >= 2 && !countB('rental') && S.stats.guestsToday > 20) advise('rental', 'Lots of guests arrive without skis. A Ski Rental shop in the village earns money and keeps them happy.');
  if (countB('school') && !S.staff.instructor) advise('instructor', 'Your ski school has no instructors. Hire some in the 👷 Staff panel.');
  if (S.lifts.some(l => l.broken) && !S.staff.mechanic) advise('mechanic', 'A lift is broken and you have no mechanics! Hire one in the 👷 Staff panel.');
  if (S.lifts.length > (S.staff.mechanic || 0) * 3 + 2) advise('mech_more', 'You have more lifts than your mechanics can look after. Breakdowns will last longer.');
  const beginners = S.guests.filter(g => g.skill === 0);
  if (beginners.length > 8 && beginners.filter(g => g.thoughts.some(t => t.key === 'too_hard' || t.key === 'nothing')).length > beginners.length * 0.4) {
    advise('beginners', 'Beginners are struggling. They need lifts with green runs back down.');
  }
  resortAdvice();
}

// ---------- time ----------

function spawnTick(dt) {
  const m = S.minute;
  let w = 0;
  if (m >= DAY_START + 5 && m <= 13 * 60) w = m < 10 * 60 + 30 ? 1.6 : m < 12 * 60 ? 0.9 : 0.35;
  else if (S.night.on && m >= 15 * 60 && m <= 18 * 60 + 30) w = 0.35;
  if (!w) return;
  S.spawnAcc += S.cache.demand / 240 * w * dt;
  while (S.spawnAcc >= 1) { S.spawnAcc -= 1; spawnGuest(); }
}

function simulate(dt) {
  if (Net.dirty && !Net.hold) rebuildNetwork();
  const prevHour = Math.floor(S.minute / 60);
  S.minute += dt;
  spawnTick(dt);
  if (S.avy.at > 0 && S.minute >= S.avy.at) freerideAvalanche();
  for (const l of S.lifts) updateLift(l, dt);
  const gs = S.guests.slice();
  for (const g of gs) updateGuest(g, dt);
  if (Math.floor(S.minute / 60) !== prevHour) { recalcValue(); checkGoals(); advisorCheck(); }
  if (S.minute >= dayEnd()) endDay();
}

function endDay() {
  for (const g of S.guests.slice()) leaveResort(g);
  for (const l of S.lifts) { l.queue = []; l.riders = []; l.ridesToday = 0; l.age++; l.broken = false; l.repair = 0; }
  for (const b of S.buildings) b.occupancy = 0;
  checkGoals();
  // Nightly costs
  for (const l of S.lifts) spend('upkeep', LIFT_TYPES[l.type].upkeep);
  for (const b of S.buildings) spend('upkeep', BUILDING_TYPES[b.type].upkeep);
  if (S.night.on) spend('upkeep', NIGHT_SKIING.upkeep);
  for (const [k, n] of Object.entries(S.staff)) if (n) spend('staff', n * STAFF_TYPES[k].wage);
  if (S.loan > 0) spend('interest', Math.round(S.loan * 0.002));
  const hotels = countB('hotel');
  if (hotels) earn('hotel', Math.round(hotels * 40 * clamp(S.reputation / 100, 0.1, 1) * 90));
  // Research
  const fund = RESEARCH_FUNDING[S.research.funding];
  const curR = RESEARCH.find(x => x.id === S.research.current);
  if (!curR || S.research.unlocked.has(curR.unlock)) {
    const nextR = nextResearch();
    S.research.current = nextR ? nextR.id : null;
  }
  if (fund) addResearch(fund);
  // Rating drifts towards how happy today's guests were (slowly, weighted by how many came)
  const avgHappy = S.stats.happyN ? S.stats.happySum / S.stats.happyN : 0;
  if (S.stats.happyN) S.reputation += (avgHappy - S.reputation) * 0.15 * Math.min(1, S.stats.happyN / 40);
  S.reputation = clamp(S.reputation, 0, 100);
  eventNight(S.stats.happyN ? avgHappy : 0);
  // Campaigns tick
  for (const c of S.campaigns) { if (c.delay) c.delay--; else c.daysLeft--; }
  S.campaigns = S.campaigns.filter(c => c.daysLeft > 0);
  nightVillage({ guests: S.stats.guestsToday });
  // Weather, snow, grooming, traffic
  T.closed.fill(0);
  rollWeather();
  nightSnow();
  for (let i = 0; i < T.traffic.length; i++) T.traffic[i] *= 0.5;
  avalancheCheck();
  avyForecast();

  const f = S.fin.today;
  const inc = INCOME_KEYS.reduce((a, k) => a + (f[k] || 0), 0);
  const exp = EXPENSE_KEYS.reduce((a, k) => a + (f[k] || 0), 0);
  const summary = {
    year: S.year, day: S.day, income: inc, expenses: exp, profit: inc - exp, guests: S.stats.guestsToday,
    turnedPrice: S.stats.turnedPrice, turnedFull: S.stats.turnedFull, happy: avgHappy, fin: { ...f },
    thoughts: { ...S.stats.leftThoughts }, repDelta: S.reputation - S.stats.repStart, injuries: S.stats.injuries, breakdowns: S.stats.breakdowns,
    regulars: S.stats.regularsToday, passVisits: S.stats.passVisits, levelUps: S.stats.levelUps,
  };
  S.fin.history.push(summary);
  if (S.fin.history.length > 60) S.fin.history.shift();
  S.stats.lastDayProfit = summary.profit;
  S.stats.bestDay = Math.max(S.stats.bestDay, summary.guests);
  checkGoals();

  S.fin.today = emptyFin();
  Object.assign(S.stats, { guestsToday: 0, turnedPrice: 0, turnedFull: 0, happySum: 0, happyN: 0, injuries: 0, breakdowns: 0, leftThoughts: {}, repStart: S.reputation,
    regularsToday: 0, passVisits: 0, levelUps: 0 });
  S.minute = DAY_START; S.spawnAcc = 0;
  S.day++;
  let seasonEnd = false;
  if (S.day > DAYS_PER_SEASON) {
    S.day = 1; S.year++; seasonEnd = true;
    S.weather.snow = Math.round(scenario().snow * 0.7);
    initSnow();
    seasonRollover();
  }
  sellPasses();
  eventMorning();
  Net.dirty = true;
  recalcValue();
  Events.emit('dayend', { summary, seasonEnd });
  saveGame(true);
}

function avalancheCheck() {
  if (S.weather.fresh < 25) return;
  const need = staffNeeded('patrol');
  if ((S.staff.patrol || 0) >= need) {
    if (S.lifts.length) Events.emit('toast', { text: '⛑️ Ski patrol blasted the fresh snow overnight — avalanche danger under control.' });
    return;
  }
  if (rand() > 0.6) return;
  const steep = [];
  for (let i = 0; i < T.piste.length; i++) if (T.piste[i] && T.diff[i] >= 2 && T.height[i] > BASE_ALT + 350) steep.push(i);
  if (!steep.length) return;
  const c = steep[Math.floor(rand() * steep.length)];
  let n = 0;
  for (let y = ty(c) - 3; y <= ty(c) + 3; y++) for (let x = tx(c) - 4; x <= tx(c) + 4; x++) {
    if (inMap(x, y) && T.piste[idx(x, y)]) { T.closed[idx(x, y)] = 1; n++; }
  }
  Events.emit('toast', { text: `🏔️ Avalanche danger! ${n} piste tiles are closed today. Hire more ski patrol to control avalanches.`, bad: true, big: true });
}

function nextResearch() {
  return RESEARCH.find(x => !S.research.unlocked.has(x.unlock) && (!x.requires || S.research.unlocked.has(RESEARCH.find(y => y.id === x.requires).unlock)));
}

function researchRemaining() {
  return RESEARCH.reduce((a, r) => a + (S.research.unlocked.has(r.unlock) ? 0 : r.points - (S.research.progress[r.id] || 0)), 0);
}

// Pays for research and applies it to the current project; leftover points roll into the next one.
function addResearch(amount) {
  if (!S.research.current) { const n = nextResearch(); S.research.current = n ? n.id : null; }
  let left = Math.min(amount, researchRemaining());
  if (left <= 0 || !S.research.current) return 0;
  spend('research', left);
  const paid = left;
  while (left > 0 && S.research.current) {
    const r = RESEARCH.find(x => x.id === S.research.current);
    const need = r.points - (S.research.progress[r.id] || 0);
    const use = Math.min(need, left);
    S.research.progress[r.id] = (S.research.progress[r.id] || 0) + use;
    left -= use;
    if (S.research.progress[r.id] >= r.points) {
      S.research.unlocked.add(r.unlock);
      Events.emit('toast', { text: `🔬 Research complete: ${r.name} is now available!`, big: true });
      const nextR = nextResearch();
      S.research.current = nextR ? nextR.id : null;
    }
  }
  if (left > 0) { S.money += left; S.fin.today.research -= left; }
  return paid - left;
}

function investResearch(amount) {
  if (!S.research.current) { Events.emit('toast', { text: 'Nothing left to research', bad: true }); return; }
  if (amount > S.money) { Events.emit('toast', { text: 'Not enough money!', bad: true }); return; }
  const paid = addResearch(amount);
  if (paid) Events.emit('toast', { text: `🔬 Invested ${fmt$(paid)} in research` });
  checkGoals();
}

function rollWeather() {
  const sc = scenario();
  const r = rand();
  const late = S.day > DAYS_PER_SEASON * 0.75;
  let type = r < 0.3 ? 'sunny' : r < 0.52 ? 'cloudy' : r < 0.78 ? 'snow' : r < 0.86 ? 'storm' : 'warm';
  if (late && type === 'snow' && rand() < 0.5) type = 'warm';
  if (sc.melt > 1 && type === 'snow' && rand() < 0.3) type = 'warm';
  const w = WEATHER[type];
  const fresh = w.snow ? Math.round(w.snow * (0.6 + rand() * 0.8) * sc.snowMult) : 0;
  S.weather.type = type;
  S.weather.fresh = fresh;
  S.weather.snow = clamp(S.weather.snow + fresh - (w.melt + (late ? 3 : 0.5)) * sc.melt, 0, 250);
}

function checkGoals() {
  for (const g of GOALS) {
    if (S.goals[g.id]) continue;
    const idxG = GOALS.indexOf(g);
    if (idxG > 0 && !S.goals[GOALS[idxG - 1].id]) break; // sequential
    if (g.check(S)) {
      S.goals[g.id] = true;
      earn('rewards', g.reward);
      Events.emit('toast', { text: `🎯 Goal complete: ${g.text} (+${fmt$(g.reward)})`, big: true });
      if (g.final) { S.won = true; Events.emit('won'); }
    } else break;
  }
}

function takeLoan(amt) {
  amt = Math.min(amt, S.maxLoan - S.loan);
  if (amt <= 0) return;
  S.loan += amt; S.money += amt;
}
function repayLoan(amt) {
  amt = Math.min(amt, S.loan, Math.max(0, S.money));
  if (amt <= 0) return;
  S.loan -= amt; S.money -= amt;
}

// ---------- save / load ----------

function packBits(arr) {
  let s = '';
  for (let i = 0; i < arr.length; i++) s += arr[i] ? '1' : '0';
  return s;
}

function saveGame(auto) {
  try {
    const data = {
      v: 1, seed: S.seed, tree: packBits(T.tree), piste: packBits(T.piste), free: packBits(T.free),
      snow: Array.from(T.snow, v => Math.round(v)), fresh: Array.from(T.fresh, v => Math.round(v * 100)),
      cond: Array.from(T.cond, v => Math.round(v)), groomed: packBits(T.groomed),
      S: {
        ...S, guests: [],
        lifts: S.lifts.map(l => ({ ...l, queue: [], riders: [] })),
        research: { ...S.research, unlocked: [...S.research.unlocked] },
        cache: {},
      },
    };
    localStorage.setItem('skiTycoonSave', JSON.stringify(data));
    if (!auto) Events.emit('toast', { text: '💾 Game saved' });
    return true;
  } catch (e) {
    if (!auto) Events.emit('toast', { text: 'Could not save: ' + e.message, bad: true });
    return false;
  }
}

function hasSave() {
  try { return !!localStorage.getItem('skiTycoonSave'); } catch (e) { return false; }
}

function loadGame() {
  let data;
  try { data = JSON.parse(localStorage.getItem('skiTycoonSave')); } catch (e) { return false; }
  if (!data || data.v !== 1) return false;
  const sc = SCENARIOS[data.S.scenario] || SCENARIOS.alpine;
  T = generateTerrain(data.seed, sc.terrain);
  initLayers();
  const N = MAP_W * MAP_H;
  // Saves from before the village grew have fewer rows; the extra rows are empty village.
  for (const k of ['tree', 'piste', 'free', 'groomed']) if (typeof data[k] === 'string') data[k] = data[k].padEnd(N, '0');
  for (const [k, v] of [['snow', 0], ['fresh', 100], ['cond', 100]]) if (data[k]) while (data[k].length < N) data[k].push(v);
  for (let i = 0; i < N; i++) { T.tree[i] = data.tree[i] === '1' ? 1 : 0; T.piste[i] = data.piste[i] === '1' ? 1 : 0; }
  S = data.S;
  // Defaults for saves from older versions
  S.scenario = S.scenario || 'alpine';
  S.staff = S.staff || { mechanic: 1, patrol: 1, instructor: 2 };
  S.campaigns = (S.campaigns || []).filter(c => CAMPAIGNS[c.id]);
  fillResortDefaults();
  S.night = S.night || { installed: false, on: false };
  S.advice = S.advice || {}; S.adviceLog = S.adviceLog || [];
  S.stats = { ...freshStats(), ...S.stats, leftThoughts: S.stats.leftThoughts || {} };
  S.guests = [];
  S.paused = false;
  S.research.unlocked = new Set(S.research.unlocked);
  S.cache = emptyCache();
  S.fin.today = { ...emptyFin(), ...S.fin.today };
  if (data.snow) {
    for (let i = 0; i < N; i++) {
      T.snow[i] = data.snow[i]; T.fresh[i] = data.fresh[i] / 100; T.cond[i] = data.cond[i];
      T.free[i] = data.free[i] === '1' ? 1 : 0; T.groomed[i] = data.groomed[i] === '1' ? 1 : 0;
    }
    updateBare();
  } else initSnow();
  for (const l of S.lifts) {
    l.age = l.age || 0; l.broken = false; l.repair = 0; l.breakdowns = l.breakdowns || 0;
    T.occ[idx(l.bx, l.by)] = -l.id; T.occ[idx(l.tx, l.ty)] = -l.id;
  }
  for (const b of S.buildings) { b.occupancy = 0; for (const [x, y] of buildingTiles(b.x, b.y, b.size)) T.occ[idx(x, y)] = b.id; }
  Undo.stack = [];
  Net.dirty = true;
  rebuildNetwork();
  Events.emit('newgame');
  return true;
}

// Selection is shared between UI and sim (cleared when a guest leaves).
const Sel = { kind: null, id: null, tile: -1 };
