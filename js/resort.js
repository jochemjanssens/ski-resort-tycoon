// Resort systems layered on the core sim: snow depth, snowmaking and grooming, freeride zones and
// avalanches, regular guests and season passes, hosted events, and the privately growing village.

function absDay() { return (S.year - 1) * DAYS_PER_SEASON + S.day; }

function initResort() {
  S.snowmaking = { mode: 'auto', target: 60 };
  S.grooming = { moguls: false };
  S.freeride = { open: true, control: true, autoClose: 5, closedToday: false };
  S.avy = { level: 1, prev: 0, at: -1, blasted: false };
  S.snowStats = { made: 0, cost: 0, groomed: 0, ungroomed: 0, tooWarm: false };
  S.regulars = [];
  S.passesSold = 0;
  S.event = null; S.eventLast = {}; S.eventWins = {}; S.eventLog = [];
  S.village = { lease: 'normal', full: false, lastLease: 0 };
  initSnow();
}

// Older saves lack these fields.
function fillResortDefaults() {
  const d = { snowmaking: { mode: 'auto', target: 60 }, grooming: { moguls: false },
    freeride: { open: true, control: true, autoClose: 5, closedToday: false },
    avy: { level: 1, prev: 0, at: -1, blasted: false },
    snowStats: { made: 0, cost: 0, groomed: 0, ungroomed: 0, tooWarm: false },
    regulars: [], passesSold: 0, event: null, eventLast: {}, eventWins: {}, eventLog: [],
    village: { lease: 'normal', full: false, lastLease: 0 } };
  for (const [k, v] of Object.entries(d)) if (S[k] == null) S[k] = v;
  if (S.prices.pass == null) S.prices.pass = PASS.defaultPrice;
}

function initSnow() {
  for (let i = 0; i < T.snow.length; i++) T.snow[i] = clamp(S.weather.snow + (T.height[i] - BASE_ALT) / 15, 0, 250);
  for (let i = 0; i < T.fresh.length; i++) T.fresh[i] = 1;
  T.groomed.fill(1);
  updateBare();
}

// ---------- snow, snowmaking and grooming ----------

function snowAt(i) { return T.snow[i]; }

function pisteQuality(i) {
  const free = T.free[i] && !T.piste[i];
  if ((!T.piste[i] && !free) || T.village[i]) return 1;
  const depthQ = clamp((T.snow[i] - SNOW.bareBelow) / (40 - SNOW.bareBelow), 0.15, 1);
  if (free) return clamp(0.45 + 0.55 * T.fresh[i], 0.3, 1) * depthQ;
  return (T.cond[i] / 100) * depthQ;
}

function updateBare() {
  for (let i = 0; i < T.bare.length; i++) T.bare[i] = !T.village[i] && T.snow[i] < SNOW.bareBelow ? 1 : 0;
}

function snowReport() {
  let n = 0, sum = 0, bare = 0, thin = 0;
  for (let i = 0; i < T.piste.length; i++) {
    if (!T.piste[i] || T.village[i]) continue;
    n++; sum += T.snow[i];
    if (T.bare[i]) bare++; else if (T.snow[i] < SNOW.thinBelow) thin++;
  }
  return { n, avg: n ? sum / n : 0, bare, thin };
}

function coveredPisteTiles() {
  let n = 0;
  for (let i = 0; i < T.cannon.length; i++) if (T.cannon[i] && T.piste[i] && !T.village[i]) n++;
  return n;
}

function groomCapacity() { return countB('groomer') * SNOW.groomPerGarage; }

// Runs once a night after tomorrow's weather is rolled.
function nightSnow() {
  const sc = scenario(), w = WEATHER[S.weather.type];
  const late = S.day > DAYS_PER_SEASON * 0.75;
  const melt = (w.melt + (late ? 3 : 0.5)) * sc.melt;
  const fresh = S.weather.fresh;
  const N = T.snow.length;
  for (let i = 0; i < N; i++) {
    if (T.village[i]) continue;
    const alt = clamp((T.height[i] - BASE_ALT) / 800, 0, 1.6);
    let d = T.snow[i] + fresh * (0.8 + alt * 0.4) - melt * (1.2 - 0.5 * alt);
    if (T.piste[i]) d -= Math.min(2, T.traffic[i] * 0.008); // skiers scrape it off
    T.snow[i] = clamp(d, 0, 300);
  }

  // Snowmaking: only when it's cold enough.
  const st = S.snowStats;
  st.made = 0; st.cost = 0; st.tooWarm = false;
  const mode = S.snowmaking.mode;
  if (mode !== 'off' && countB('cannon')) {
    if (w.melt >= 5) st.tooWarm = true;
    else {
      const target = mode === 'max' ? 150 : S.snowmaking.target;
      let made = 0;
      for (let i = 0; i < N; i++) {
        if (!T.cannon[i] || !T.piste[i] || T.village[i]) continue;
        const need = target - T.snow[i];
        if (need <= 0) continue;
        const eff = clamp(0.55 + (T.height[i] - BASE_ALT) / 1300, 0.55, 1);
        const add = Math.min(need, SNOW.cannonRate * eff);
        T.snow[i] += add; made += add;
      }
      st.made = Math.round(made);
      st.cost = Math.round(made * SNOW.costPerCm);
      if (st.cost) spend('snow', st.cost);
    }
  }

  // Grooming: snowcats work through the busiest pistes first.
  const cap = groomCapacity();
  const todo = [];
  for (let i = 0; i < N; i++) {
    if (!T.piste[i] || T.village[i]) continue;
    T.groomed[i] = 0;
    if (T.snow[i] < SNOW.bareBelow) continue;
    if (S.grooming.moguls && T.diff[i] >= 3) continue;
    todo.push(i);
  }
  todo.sort((a, b) => (T.traffic[b] - T.traffic[a]) || (T.cond[a] - T.cond[b]));
  const done = Math.min(cap, todo.length);
  for (let k = 0; k < done; k++) { const i = todo[k]; T.cond[i] = 100; T.groomed[i] = 1; }
  for (let i = 0; i < N; i++) {
    if (T.piste[i] && !T.groomed[i]) T.cond[i] = Math.min(100, T.cond[i] + 12 + fresh * 2);
  }
  st.groomed = done; st.ungroomed = todo.length - done;
  if (done) spend('snow', Math.round(done * SNOW.groomCost));

  // Fresh snow refills the powder in freeride zones.
  for (let i = 0; i < N; i++) if (T.free[i]) T.fresh[i] = Math.min(1, T.fresh[i] + (fresh >= 6 ? fresh / 22 : 0.04));
  updateBare();
}

// ---------- freeride zones and avalanches ----------

function canFree(i) { return !T.village[i] && !T.rock[i] && T.diff[i] < 4 && T.occ[i] === 0 && !T.piste[i]; }
function freeOpen() { return S.freeride.open && !S.freeride.closedToday; }
function freerideTiles() { let n = 0; for (let i = 0; i < T.free.length; i++) n += T.free[i]; return n; }

function paintFree(tiles) {
  const todo = tiles.filter(i => canFree(i) && !T.free[i]);
  if (!todo.length) return 0;
  const cost = todo.length * FREERIDE.cost;
  if (cost > S.money) { Events.emit('toast', { text: 'Not enough money!', bad: true }); return 0; }
  for (const i of todo) { noteTile(i); T.free[i] = 1; T.fresh[i] = 1; }
  spend('construction', cost); noteCost(cost);
  Net.dirty = true;
  return cost;
}

function removeFree(tiles) {
  let n = 0;
  for (const i of tiles) if (T.free[i]) { noteTile(i); T.free[i] = 0; n++; }
  if (n) Net.dirty = true;
  return n;
}

function setFreerideOpen(on) { S.freeride.open = on; Net.dirty = true; }

// Nightly: work out tomorrow's avalanche danger and whether a slide will happen.
function avyForecast() {
  const f = S.weather.fresh, prev = S.avy.prev || 0;
  let lv = 1;
  if (f >= 10) lv++;
  if (f >= 25) lv++;
  if (f + prev >= 45) lv++;
  if (S.weather.type === 'warm' && prev >= 15) lv++;
  if (S.weather.type === 'storm') lv++;
  lv = clamp(lv, 1, 5);
  S.avy.prev = f; S.avy.level = lv; S.avy.at = -1; S.avy.blasted = false;
  S.freeride.closedToday = false;
  const n = freerideTiles();
  if (!n || lv < 3) return;
  if (S.freeride.autoClose && lv >= S.freeride.autoClose) {
    S.freeride.closedToday = true;
    Events.emit('toast', { text: `🏔️ Avalanche danger ${lv} (${AVY_LEVELS[lv]}): freeride zones stay closed today.`, bad: true });
    return;
  }
  if (S.freeride.control) {
    const cost = n * FREERIDE.blastCost;
    spend('snow', cost);
    S.avy.blasted = true;
  }
  const cov = staffCoverage('patrol');
  let p = [0, 0, 0, 0.12, 0.3, 0.55][lv];
  p *= S.avy.blasted ? 1 - 0.85 * cov : 1 - 0.3 * cov;
  if (rand() < p) S.avy.at = OPEN_TIME + 60 + rand() * 360;
  if (lv >= 4) Events.emit('toast', { text: `🏔️ Avalanche danger ${lv} (${AVY_LEVELS[lv]}) in the freeride zones${S.avy.blasted ? ' — ski patrol is blasting slopes' : ''}.`, bad: !S.avy.blasted });
}

function freerideAvalanche() {
  S.avy.at = -1;
  if (!freeOpen()) return;
  const cand = [];
  for (let i = 0; i < T.free.length; i++) if (T.free[i] && T.diff[i] >= 2) cand.push(i);
  if (!cand.length) return;
  const c = cand[Math.floor(rand() * cand.length)];
  const hit = new Set();
  for (let y = ty(c) - 3; y <= ty(c) + 4; y++) for (let x = tx(c) - 3; x <= tx(c) + 3; x++) {
    if (!inMap(x, y)) continue;
    const i = idx(x, y);
    if (Math.hypot(x - tx(c), (y - ty(c)) * 0.8) > 3.6) continue;
    hit.add(i);
    if (T.free[i] || T.piste[i]) T.closed[i] = 1;
  }
  let caught = 0;
  for (const g of S.guests.slice()) {
    if (g.state !== 'walk' || !hit.has(g.tile)) continue;
    caught++; think(g, 'avy_caught'); injure(g);
  }
  S.reputation = clamp(S.reputation - 1 - Math.min(8, caught * 2), 0, 100);
  Net.dirty = true;
  Events.emit('changed');
  Events.emit('toast', {
    text: caught ? `🏔️ Avalanche in the freeride zone! ${caught} skier${caught > 1 ? 's were' : ' was'} caught. Rating −${(1 + Math.min(8, caught * 2)).toFixed(0)}`
      : '🏔️ An avalanche came down in the freeride zone. Luckily nobody was caught.', bad: true, big: true });
}

// ---------- regulars, progression and season passes ----------

function addXp(g, n) {
  g.xp = (g.xp || 0) + n;
  const maxSkill = g.kind === 'kid' ? 2 : 3;
  while (g.skill < maxSkill && g.xp >= SKILL_XP[g.skill]) {
    g.xp -= SKILL_XP[g.skill];
    g.skill++;
    g.happy = Math.min(100, g.happy + 8);
    think(g, 'level_up');
    S.stats.levelUps = (S.stats.levelUps || 0) + 1;
    g.next = -1;
  }
}

function passHolders() { return S.regulars.reduce((a, r) => a + (r.pass ? 1 : 0), 0); }

function pickRegular() {
  const today = absDay();
  const cands = S.regulars.filter(r => r.last !== today);
  if (!cands.length) return null;
  const share = clamp(cands.length / Math.max(30, S.cache.demand * 3), 0, 0.55);
  if (rand() > share) return null;
  let tot = 0;
  for (const r of cands) tot += (r.pass ? 5 : 1) * (10 + r.loyalty);
  let x = rand() * tot;
  for (const r of cands) { x -= (r.pass ? 5 : 1) * (10 + r.loyalty); if (x <= 0) return r; }
  return cands[cands.length - 1];
}

function rememberGuest(g) {
  if (g.reg) {
    const r = S.regulars.find(x => x.id === g.reg);
    if (!r) return;
    r.skill = g.skill; r.xp = g.xp || 0; r.visits++;
    r.loyalty = clamp(r.loyalty + (g.happy - 55) / 4, 0, 100);
    if (r.loyalty <= 0 && !r.pass) S.regulars = S.regulars.filter(x => x !== r);
    return;
  }
  if (g.happy < 62 || g.state === 'stuck') return;
  S.regulars.push({ id: S.nextId++, name: g.name, kind: g.kind, color: g.color, skill: g.skill, xp: g.xp || 0,
    loyalty: (g.happy - 50) * 0.8, visits: 1, pass: false, last: absDay() });
  if (S.regulars.length > REGULARS_MAX) {
    let worst = null;
    for (const r of S.regulars) if (!r.pass && (!worst || r.loyalty < worst.loyalty)) worst = r;
    if (worst) S.regulars = S.regulars.filter(x => x !== worst);
  }
}

// Each night in the selling window some loyal regulars weigh up a season pass.
function sellPasses() {
  if (S.day > PASS.sellUntil) return;
  const left = (DAYS_PER_SEASON - S.day + 1) / DAYS_PER_SEASON;
  let n = 0, sum = 0;
  for (const r of S.regulars) {
    if (r.pass || r.loyalty < 35 || rand() > 0.2) continue;
    const kid = r.kind === 'kid' ? 0.6 : 1;
    const visits = (3 + r.loyalty / 9) * left;
    const worth = visits * S.prices.ticket * kid * 1.1 + 40;
    const price = Math.round(S.prices.pass * kid);
    if (price > worth * (0.75 + rand() * 0.5)) continue;
    r.pass = true; n++; sum += price;
    earn('passes', price);
  }
  S.passesSold += n;
  if (n) Events.emit('toast', { text: `🎫 ${n} season pass${n > 1 ? 'es' : ''} sold overnight (+${fmt$(sum)})` });
}

function seasonRollover() {
  for (const r of S.regulars) { r.pass = false; r.loyalty *= 0.9; }
}

// ---------- events ----------

function eventReqs(id) { return EVENTS[id].req.map(k => ({ text: EVENT_REQS[k].text, ok: !!EVENT_REQS[k].check() })); }

function eventAvailable(id) {
  const E = EVENTS[id];
  if (S.event) return S.event.id === id ? 'Already planned' : 'Another event is already planned';
  const since = absDay() - (S.eventLast[id] || -999);
  if (since < E.cooldown) return `Can be held again in ${E.cooldown - since} day${E.cooldown - since > 1 ? 's' : ''}`;
  if (S.day + E.prep + E.days - 1 > DAYS_PER_SEASON) return 'Not enough days left this season';
  if (eventReqs(id).some(r => !r.ok)) return 'Requirements not met';
  if (E.cost > S.money) return 'Not enough money';
  return '';
}

function scheduleEvent(id) {
  const why = eventAvailable(id);
  if (why) { Events.emit('toast', { text: why, bad: true }); return; }
  const E = EVENTS[id];
  spend('marketing', E.cost);
  S.event = { id, start: absDay() + E.prep, left: E.days, live: false, happy: [] };
  Events.emit('toast', { text: `${E.icon} ${E.name} booked — it starts in ${E.prep} day${E.prep > 1 ? 's' : ''}.` });
}

function eventLive() { return S.event && S.event.live ? EVENTS[S.event.id] : null; }

function eventDaysAway() { return S.event && !S.event.live ? S.event.start - absDay() : 0; }

// Morning: an event due today goes live if the resort still meets its requirements.
function eventMorning() {
  const ev = S.event;
  if (!ev || ev.live || absDay() < ev.start) return;
  const E = EVENTS[ev.id];
  if (eventReqs(ev.id).some(r => !r.ok)) {
    S.reputation = clamp(S.reputation - 3, 0, 100);
    S.eventLast[ev.id] = absDay();
    S.event = null;
    Events.emit('toast', { text: `${E.icon} ${E.name} cancelled — the resort no longer meets the requirements. Rating −3`, bad: true, big: true });
    return;
  }
  ev.live = true;
  Events.emit('toast', { text: `${E.icon} Today: ${E.name}!`, big: true });
}

// Night: score the day and wrap the event up when its last day is over.
function eventNight(avgHappy) {
  const ev = S.event;
  if (!ev || !ev.live) return;
  ev.happy.push(avgHappy || 0);
  ev.left--;
  if (ev.left > 0) return;
  const E = EVENTS[ev.id];
  const score = ev.happy.reduce((a, b) => a + b, 0) / ev.happy.length;
  const ok = score >= 62;
  if (ok) {
    S.reputation = clamp(S.reputation + E.rep[0], 0, 100);
    if (E.sponsor) earn('events', E.sponsor);
    S.eventWins[ev.id] = (S.eventWins[ev.id] || 0) + 1;
    Events.emit('toast', { text: `${E.icon} ${E.name} was a success! Rating +${E.rep[0]}${E.sponsor ? `, sponsors paid ${fmt$(E.sponsor)}` : ''}`, big: true });
  } else {
    S.reputation = clamp(S.reputation - E.rep[1], 0, 100);
    if (E.sponsor) earn('events', Math.round(E.sponsor * 0.4));
    Events.emit('toast', { text: `${E.icon} ${E.name} was a let-down (guests ${Math.round(score)}% happy). Rating −${E.rep[1]}`, bad: true, big: true });
  }
  S.eventLog.unshift({ id: ev.id, year: S.year, day: S.day, score: Math.round(score), ok });
  if (S.eventLog.length > 10) S.eventLog.pop();
  S.eventLast[ev.id] = absDay();
  S.event = null;
}

// ---------- the private village ----------

function privateBuildings() { return S.buildings.filter(b => BUILDING_TYPES[b.type].private); }
function villageBeds() { return privateBuildings().reduce((a, b) => a + BUILDING_TYPES[b.type].beds, 0); }
function luxBeds() { return privateBuildings().reduce((a, b) => a + (BUILDING_TYPES[b.type].lux ? BUILDING_TYPES[b.type].beds : 0), 0); }

function leaseIncome() {
  const L = VILLAGE_LEASE[S.village.lease];
  const occ = clamp(0.25 + S.reputation / 130, 0.2, 1);
  let sum = 0;
  for (const b of privateBuildings()) {
    const B = BUILDING_TYPES[b.type];
    sum += B.beds * L.perBed * occ * (B.lux ? 1.6 : 1) + (B.shopLease || 0) * L.perBed;
  }
  return Math.round(sum);
}

function growthChance(guests) {
  const L = VILLAGE_LEASE[S.village.lease];
  const ratio = guests / Math.max(40, S.cache.capacity);
  // Developers only invest in a resort that is busy, well liked and has real terrain and facilities.
  const appeal = clamp((S.cache.value - 18) / 35, 0, 1);
  const pressure = clamp((S.reputation - 28) / 50, 0, 1.2) * clamp(ratio * 1.4 + (S.stats.turnedFull > 0 ? 0.3 : 0), 0, 1.5) * appeal;
  return clamp(pressure * 0.3 * L.growth, 0, 0.9);
}

function nightVillage(summary) {
  const lease = leaseIncome();
  S.village.lastLease = lease;
  if (lease) earn('lease', lease);
  if (rand() < growthChance(summary.guests)) developPrivate(summary.guests);
}

function liftsReachable() {
  const e = idx(ENTRANCE.x, ENTRANCE.y), out = new Set();
  for (const l of S.lifts) { const f = fieldFor('L' + l.id, 3); if (f && isFinite(f.dist[e])) out.add(l.id); }
  return out;
}

function findVillageSpot(size, blocked) {
  const lifts = S.lifts.map(l => [l.bx, l.by]);
  const spots = [];
  for (let y = VILLAGE_Y; y <= MAP_H - 2 - size; y++) {
    for (let x = 1; x < MAP_W - size; x++) {
      if (blocked.has(idx(x, y))) continue;
      if (x + size > ENTRANCE.x - 2 && x < ENTRANCE.x + 3) continue;
      let ok = true;
      for (let yy = y - 1; yy <= y + size && ok; yy++) for (let xx = x - 1; xx <= x + size && ok; xx++) {
        if (!inMap(xx, yy)) continue;
        const i = idx(xx, yy), inside = xx >= x && yy >= y && xx < x + size && yy < y + size;
        if (T.occ[i] < 0) ok = false; // keep lift stations clear
        else if (inside && (T.occ[i] !== 0 || T.piste[i] || T.rock[i] || !T.village[i])) ok = false;
      }
      if (!ok) continue;
      let near = 99;
      for (const [lx, ly] of lifts) near = Math.min(near, Math.hypot(lx - x, ly - y));
      let neigh = 0;
      for (const b of S.buildings) if (Math.abs(b.x - x) <= 3 && Math.abs(b.y - y) <= 3) neigh++;
      spots.push({ x, y, score: Math.min(near, 30) - neigh * 1.5 + rand() * 6 });
    }
  }
  spots.sort((a, b) => a.score - b.score);
  return spots.slice(0, 3);
}

function developPrivate(guests) {
  const types = Object.entries(BUILDING_TYPES).filter(([, B]) => B.private && S.reputation >= B.minRep && guests >= (B.minGuests || 0));
  if (!types.length) return null;
  const weights = { chalet: 4, shop: countB('shop') < countB('chalet') / 3 + 1 ? 2 : 0.3, apartments: 2, lodge: 1 };
  let tot = 0;
  for (const [k] of types) tot += weights[k];
  let r = rand() * tot, type = types[0][0];
  for (const [k] of types) { r -= weights[k]; if (r <= 0) { type = k; break; } }
  const B = BUILDING_TYPES[type];
  const before = liftsReachable();
  const blocked = new Set();
  for (let tries = 0; tries < 3; tries++) {
    const spot = findVillageSpot(B.size, blocked)[0];
    if (!spot) break;
    const b = { id: S.nextId++, type, x: spot.x, y: spot.y, size: B.size, occupancy: 0, visits: 0, income: 0, cost: 0, built: absDay() };
    for (const [cx, cy] of buildingTiles(b.x, b.y, b.size)) { const i = idx(cx, cy); T.occ[i] = b.id; T.tree[i] = 0; }
    S.buildings.push(b);
    rebuildNetwork();
    const after = liftsReachable();
    if ([...before].every(id => after.has(id))) {
      S.village.full = false;
      Events.emit('toast', { text: `${B.icon} A developer built ${/^[AEIOU]/.test(B.name) ? 'an' : 'a'} ${B.name} in the village${B.beds ? ` (+${B.beds} beds)` : ''}.` });
      return b;
    }
    for (const [cx, cy] of buildingTiles(b.x, b.y, b.size)) T.occ[idx(cx, cy)] = 0;
    S.buildings = S.buildings.filter(x => x !== b);
    blocked.add(idx(spot.x, spot.y));
  }
  rebuildNetwork();
  S.village.full = true;
  return null;
}

function buyOutPrivate(id) {
  const b = S.buildings.find(x => x.id === id);
  if (!b) return false;
  const B = BUILDING_TYPES[b.type];
  if (B.buyout > S.money) { Events.emit('toast', { text: 'Not enough money to buy it out!', bad: true }); return false; }
  spend('construction', B.buyout);
  removeBuilding(b.id, 0, true);
  Events.emit('toast', { text: `${B.name} bought out and demolished for ${fmt$(B.buyout)}` });
  return true;
}

function resortAdvice() {
  const rep = snowReport();
  if (rep.n && rep.bare > rep.n * 0.15) {
    advise('bare', countB('cannon') ? `${rep.bare} piste tiles have melted out. Build more snow cannons on low pistes or set snowmaking to full power.`
      : `${rep.bare} piste tiles have melted out and are closed. Snow cannons keep low pistes open.`);
  } else if (rep.n && rep.thin > rep.n * 0.3) advise('thin', 'The snow is getting thin on many pistes. Snow cannons can top them up overnight.');
  const cap = groomCapacity();
  if (rep.n > 40 && cap && S.snowStats.ungroomed > rep.n * 0.3) advise('groom', `Your snowcats could not groom ${S.snowStats.ungroomed} piste tiles last night. Build another Groomer Garage.`);
  if (S.avy.level >= 4 && freerideTiles() && !S.freeride.control && !S.freeride.closedToday) {
    advise('avy', 'Avalanche danger is high and nobody is blasting the freeride slopes. Turn on avalanche control or close the zones in the Snow panel.');
  }
  if (freerideTiles() && staffCoverage('patrol') < 1) advise('patrol_free', 'Your freeride zones need more ski patrol. Hire patrollers in the Staff panel.');
  if (S.village.full && S.stats.turnedFull > 20) advise('village_full', 'Developers want to build in the village, but there is no room left. Keep village space free of your own buildings.');
  const ev = S.event;
  if (ev && !ev.live && ev.start - absDay() === 1 && S.minute > 12 * 60) {
    const missing = eventReqs(ev.id).filter(r => !r.ok);
    advise('event_soon', missing.length ? `${EVENTS[ev.id].name} starts tomorrow, but you no longer meet: ${missing.map(r => r.text.toLowerCase()).join(', ')}.`
      : `${EVENTS[ev.id].name} starts tomorrow. Keep queues short and guests happy!`);
  }
}
