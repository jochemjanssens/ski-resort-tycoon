// DOM UI, input handling, tool previews, panels, tutorial.

const UI = {
  tool: 'inspect', liftType: 'rope', buildType: 'cafe', brush: 2, sub: null,
  liftStart: null, panel: null, follow: null,
  route: { start: null, maxDiff: 0, key: '', plan: null },
  mouse: { sx: 0, sy: 0, wx: 0, wy: 0, tile: -1, inside: false },
  drag: null, keys: new Set(), ptrs: new Map(), pinch: null, camMoved: false,
  startScenario: 'alpine', startTutorial: true, freeMode: 'mark',
};
const $ = s => document.querySelector(s);
const money = fmt$;
const pct = n => Math.round(n) + '%';
const fmtNum = n => Math.round(n).toLocaleString('en-US');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clockStr = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
const BRUSH_TOOLS = ['piste', 'unpiste', 'clear', 'plant', 'freeride'];

function initUI() {
  const cv = R.canvas;
  cv.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  cv.addEventListener('wheel', e => { e.preventDefault(); UI.camMoved = true; zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerleave', () => { UI.mouse.inside = false; $('#tooltip').classList.add('hidden'); });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', e => UI.keys.delete(e.key.toLowerCase()));

  document.querySelectorAll('#toolbar [data-tool]').forEach(b => b.addEventListener('click', () => selectTool(b.dataset.tool)));
  $('#toolbar [data-toggle=views]').addEventListener('click', () => { UI.sub = UI.sub === 'views' ? null : 'views'; renderSubmenu(); });
  $('#toolbar [data-toggle=undo]').addEventListener('click', () => { undo(); R.overlayDirty = true; });
  document.querySelectorAll('#speed [data-speed]').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
  document.querySelectorAll('#topbar [data-panel]').forEach(b => b.addEventListener('click', () => togglePanel(b.dataset.panel)));
  document.addEventListener('click', onAction);
  document.addEventListener('input', onInput);
  initMinimap();

  Events.listeners.push((type, d) => {
    if (type === 'toast') toast(d.text, d.bad, d.big, d.advisor);
    if (type === 'network' || type === 'changed') R.overlayDirty = true;
    if (type === 'dayend') onDayEnd(d);
    if (type === 'won') showWin();
    if (type === 'newgame') { R.overlayDirty = true; R.dyn = null; buildTerrainCanvas(); }
  });
  selectTool('inspect');
  setInterval(refreshUI, 300);
}

// ---------- tools ----------

function selectTool(t) {
  if (t === 'lifts') UI.tool = 'lift';
  else if (t === 'buildings') UI.tool = 'building';
  else UI.tool = t;
  UI.liftStart = null; UI.route.start = null; UI.sub = null;
  document.querySelectorAll('#toolbar [data-tool]').forEach(b => {
    const k = b.dataset.tool;
    b.classList.toggle('on', k === t || (k === 'lifts' && UI.tool === 'lift') || (k === 'buildings' && UI.tool === 'building'));
  });
  renderSubmenu();
  updateTooltip();
}

function setView(v) {
  R.view = v;
  R.dyn = null;
  $('#toolbar [data-toggle=views]').classList.toggle('on', v !== 'none');
  renderSubmenu();
}

function setSpeed(s) {
  if (s === 0) S.paused = !S.paused;
  else { S.speed = s; S.paused = false; }
  refreshTopbar();
}

function viewLegend() {
  const diffLegend = `<div class="legend">${DIFFS.map(d => `<span><i style="background:${d.color}"></i>${d.name}</span>`).join('')}<span><i style="background:#780078"></i>Too steep</span></div>`;
  const heat = (a, b) => `<div class="legend"><span><i style="background:${heatColor(0, 1)}"></i>${a}</span><span><i style="background:${heatColor(0.5, 1)}"></i>OK</span><span><i style="background:${heatColor(1, 1)}"></i>${b}</span></div>`;
  return {
    none: '', slope: diffLegend,
    condition: heat('Perfect', 'Icy / thin') + '<p class="hint">Snowcats groom the busiest pistes each night. Snow cannons top up thin snow. Settings are in the ❄️ Snow panel.</p>',
    snow: '<div class="legend"><span><i style="background:rgba(150,90,40,.7)"></i>Bare</span><span><i style="background:rgba(200,120,60,.6)"></i>Under 30 cm</span><span><i style="background:rgba(40,110,230,.35)"></i>Good</span><span><i style="background:rgba(40,110,230,.7)"></i>Deep</span></div>',
    traffic: heat('Quiet', 'Busy') + '<p class="hint">Where skiers have been today. Busy pistes wear out faster.</p>',
    queues: heat('Short', 'Long') + '<p class="hint">Each lift shows its current wait and queue length.</p>',
  }[R.view];
}

function renderSubmenu() {
  const el = $('#submenu');
  let h = '';
  if (UI.sub === 'views') {
    h += '<h3>Map views</h3>' + Object.entries(VIEWS).map(([k, v]) =>
      `<button class="card slim ${R.view === k ? 'on' : ''}" data-action="view" data-id="${k}"><span class="ic">${v.icon}</span><span class="nm">${v.name}</span></button>`).join('') + viewLegend();
  } else if (UI.tool === 'lift') {
    h += '<h3>Lifts</h3>';
    for (const [k, L] of Object.entries(LIFT_TYPES)) {
      const locked = !isUnlocked('lift:' + k);
      h += `<button class="card ${UI.liftType === k ? 'on' : ''} ${locked ? 'locked' : ''}" data-action="lifttype" data-id="${k}">
        <span class="ic">${L.icon}</span><span class="nm">${L.name}</span>
        <span class="pr">${locked ? '🔒' : money(L.baseCost) + '+'}</span>
        <span class="ds">${locked ? 'Research required' : `${L.desc} ${Math.round(L.seats / L.interval * 60)}/h · max ${L.maxLen} tiles · ${money(L.perTile)}/tile`}</span></button>`;
    }
    h += '<p class="hint">Click the bottom station, then the top station. The top must be higher. Connect the top station to a piste that leads down!</p>';
  } else if (UI.tool === 'building') {
    h += '<h3>Facilities</h3>';
    for (const [k, B] of Object.entries(BUILDING_TYPES)) {
      if (B.private) continue;
      const locked = !isUnlocked('building:' + k);
      h += `<button class="card ${UI.buildType === k ? 'on' : ''} ${locked ? 'locked' : ''}" data-action="buildtype" data-id="${k}">
        <span class="ic">${B.icon}</span><span class="nm">${B.name}</span>
        <span class="pr">${locked ? '🔒' : money(B.cost)}</span>
        <span class="ds">${locked ? 'Research required' : B.desc + ` Upkeep ${money(B.upkeep)}/day.`}</span></button>`;
    }
  } else if (UI.tool === 'route') {
    h += `<h3>Auto-route piste</h3>
      <div class="hint" style="margin:0 4px 6px">Hardest difficulty to aim for</div>
      <div class="brush">${DIFFS.map((d, k) => `<button class="${UI.route.maxDiff === k ? 'on' : ''}" data-action="routediff" data-id="${k}" style="color:${k === 3 ? '#ddd' : d.color}">${d.name}</button>`).join('')}</div>
      <div class="hint" style="margin:6px 4px">Width</div>
      <div class="brush">${[1, 2, 3].map(n => `<button class="${UI.brush === n ? 'on' : ''}" data-action="brush" data-id="${n}">${n} tile${n > 1 ? 's' : ''}</button>`).join('')}</div>
      <p class="hint">Click a high point, then a lower point (a lift station or the village). The piste follows the gentlest line downhill. Right-click to cancel.</p>`;
  } else if (UI.tool === 'freeride') {
    h += `<h3>Freeride zones · ${money(FREERIDE.cost)}/tile</h3>
      <div class="brush">${[['mark', 'Mark zone'], ['remove', 'Remove']].map(([k, n]) => `<button class="${UI.freeMode === k ? 'on' : ''}" data-action="freemode" data-id="${k}">${n}</button>`).join('')}</div>
      <div class="brush" style="margin-top:6px">${[1, 2, 3].map(n => `<button class="${UI.brush === n ? 'on' : ''}" data-action="brush" data-id="${n}">${n}×${n}</button>`).join('')}</div>
      <p class="hint">Mark open slopes or forest that touch a lift top or a piste, and lead back down to one. Advanced and expert skiers love untracked powder here — but fresh snow brings avalanche danger. Manage it in the ❄️ Snow panel.</p>`;
  } else if (BRUSH_TOOLS.includes(UI.tool)) {
    const names = { piste: `Paint pistes · ${money(PISTE_COST)}/tile (+${money(TREE_CLEAR_COST)} if trees)`, unpiste: 'Remove pistes', clear: `Clear trees · ${money(TREE_CLEAR_COST)}/tile`, plant: 'Plant trees · $15/tile' };
    h += `<h3>${names[UI.tool]}</h3><div class="brush">${[1, 2, 3].map(n => `<button class="${UI.brush === n ? 'on' : ''}" data-action="brush" data-id="${n}">${n}×${n}</button>`).join('')}</div>`;
    if (UI.tool === 'piste') h += `<p class="hint">Drag to paint. Difficulty is set by the slope. Tip: 🛣️ Route paints a whole run for you.</p>`;
  } else if (R.view !== 'none') {
    h += `<h3>${VIEWS[R.view].icon} ${VIEWS[R.view].name}</h3>${viewLegend()}`;
  }
  if (!h) { el.classList.add('hidden'); document.body.classList.remove('has-sub'); return; }
  el.innerHTML = h;
  el.classList.remove('hidden');
  document.body.classList.add('has-sub');
}

function brushTiles(center) {
  const out = [];
  if (center < 0) return out;
  const n = UI.brush, x0 = tx(center) - Math.floor((n - 1) / 2), y0 = ty(center) - Math.floor((n - 1) / 2);
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) if (inMap(x, y)) out.push(idx(x, y));
  return out;
}

function lineTiles(a, b) {
  const out = [];
  let x0 = tx(a), y0 = ty(a);
  const x1 = tx(b), y1 = ty(b);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push(idx(x0, y0));
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

function applyBrush(from, to) {
  const set = new Set();
  for (const c of lineTiles(from, to)) brushTiles(c).forEach(i => set.add(i));
  const tiles = [...set];
  let changed = 0;
  if (UI.tool === 'piste') changed = paintPiste(tiles);
  else if (UI.tool === 'unpiste') changed = removePiste(tiles);
  else if (UI.tool === 'clear') changed = clearTrees(tiles);
  else if (UI.tool === 'plant') changed = plantTrees(tiles);
  else if (UI.tool === 'freeride') changed = UI.freeMode === 'mark' ? paintFree(tiles) : removeFree(tiles);
  if (changed) R.overlayDirty = true;
}

// Route plan for the current hover tile, cached.
function currentRoute() {
  const r = UI.route, m = UI.mouse;
  if (r.start == null || m.tile < 0) return null;
  const key = `${r.start}:${m.tile}:${r.maxDiff}:${UI.brush}:${Net.version}`;
  if (r.key !== key) {
    r.key = key;
    const plan = planRoute(r.start, m.tile, r.maxDiff);
    if (plan.ok) {
      const set = new Set();
      // widen the line, but never with tiles harder than the line itself
      plan.path.forEach(i => {
        const lim = Math.max(r.maxDiff, T.village[i] || T.occ[i] < 0 ? 0 : T.diff[i]);
        brushTiles(i).forEach(t => { if (canPiste(t) && (t === i || T.diff[t] <= lim)) set.add(t); });
      });
      plan.tiles = [...set];
      plan.cost = plan.tiles.reduce((a, t) => a + (T.piste[t] ? 0 : PISTE_COST + (T.tree[t] ? TREE_CLEAR_COST : 0)), 0);
    }
    r.plan = plan;
  }
  return r.plan;
}

function buildingOrigin(type, tile) {
  const s = BUILDING_TYPES[type].size;
  return { x: tx(tile) - Math.floor((s - 1) / 2), y: ty(tile) - Math.floor((s - 1) / 2) };
}

function orderedLift(a, b) {
  return T.height[a] <= T.height[b] ? [a, b] : [b, a];
}

function targetAt(tile, wx, wy) {
  let best = null, bd = 14;
  const m = UI.mouse;
  for (const [g, w] of R.gpos) {
    const p = worldToScreen(w.clone().setY(w.y + 0.2));
    const d = Math.hypot(p.x - m.sx, p.y - m.sy);
    if (!p.behind && d < bd) { bd = d; best = g; }
  }
  if (best) return { kind: 'guest', id: best.id };
  if (tile < 0) return null;
  const o = T.occ[tile];
  if (o < 0) return { kind: 'lift', id: -o };
  if (o > 0) return { kind: 'building', id: o };
  for (const l of S.lifts) {
    const g = liftGeom(l), px = wx / TILE - g.x0, py = wy / TILE - g.y0;
    const along = px * g.ux + py * g.uy, perp = Math.abs(px * g.px + py * g.py);
    if (along > 0 && along < g.len && perp < 0.4) return { kind: 'lift', id: l.id };
  }
  return { kind: 'tile', tile };
}

// ---------- input ----------

function updateMouse(e) {
  const m = UI.mouse;
  m.sx = e.clientX; m.sy = e.clientY;
  const w = screenToWorld(m.sx, m.sy);
  m.wx = w.x; m.wy = w.y;
  const x = Math.floor(w.x / TILE), y = Math.floor(w.y / TILE);
  m.tile = inMap(x, y) ? idx(x, y) : -1;
}

function endDrag() {
  const d = UI.drag;
  UI.drag = null;
  if (d && d.kind === 'paint') { Net.hold = false; endAction(); }
  return d;
}

function onDown(e) {
  if (!S) return;
  UI.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { R.canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
  if (UI.ptrs.size === 2) {
    // two fingers: pinch-zoom and pan, cancel whatever the first finger started
    endDrag();
    const [a, b] = [...UI.ptrs.values()];
    UI.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, a: Math.atan2(b.y - a.y, b.x - a.x) };
    return;
  }
  updateMouse(e);
  UI.mouse.inside = true;
  const m = UI.mouse;
  if (e.button === 1 || e.button === 2) {
    if (e.button === 2 && (UI.liftStart != null || UI.route.start != null)) { UI.liftStart = null; UI.route.start = null; return; }
    // right-drag (or shift + middle) turns and tilts the camera, middle-drag pans
    UI.drag = { kind: e.button === 2 || e.shiftKey ? 'rotate' : 'pan', sx: m.sx, sy: m.sy, lx: m.sx, ly: m.sy, moved: false };
    return;
  }
  if (UI.tool === 'inspect') {
    UI.drag = { kind: e.shiftKey ? 'rotate' : 'pan', sx: m.sx, sy: m.sy, lx: m.sx, ly: m.sy, moved: false, click: true };
  } else if (BRUSH_TOOLS.includes(UI.tool)) {
    if (m.tile < 0) return;
    Net.hold = true;
    beginAction({ piste: 'Paint piste', unpiste: 'Remove piste', clear: 'Clear trees', plant: 'Plant trees', freeride: 'Freeride zone' }[UI.tool]);
    UI.drag = { kind: 'paint', last: m.tile };
    applyBrush(m.tile, m.tile);
  } else if (UI.tool === 'route') {
    if (m.tile < 0) return;
    if (UI.route.start == null) { UI.route.start = m.tile; UI.route.key = ''; return; }
    const plan = currentRoute();
    if (!plan || !plan.ok) { toast(plan ? plan.reason : 'No route', true); return; }
    if (plan.cost > S.money) { toast('Not enough money!', true); return; }
    beginAction('Route piste');
    paintPiste(plan.tiles);
    endAction();
    R.overlayDirty = true;
    UI.route.start = null;
    toast(`🛣️ Piste routed: ${plan.tiles.length} tiles for ${money(plan.cost)}`);
  } else if (UI.tool === 'lift') {
    if (m.tile < 0) return;
    if (!isUnlocked('lift:' + UI.liftType)) { toast('Research this lift first', true); return; }
    if (UI.liftStart == null) UI.liftStart = m.tile;
    else {
      const [a, b] = orderedLift(UI.liftStart, m.tile);
      beginAction('Build lift');
      const l = buildLift(UI.liftType, tx(a), ty(a), tx(b), ty(b));
      endAction();
      if (l) { UI.liftStart = null; select({ kind: 'lift', id: l.id }); }
    }
  } else if (UI.tool === 'building') {
    if (m.tile < 0) return;
    if (!isUnlocked('building:' + UI.buildType)) { toast('Research this building first', true); return; }
    const o = buildingOrigin(UI.buildType, m.tile);
    beginAction('Build ' + BUILDING_TYPES[UI.buildType].name);
    buildBuilding(UI.buildType, o.x, o.y);
    endAction();
  } else if (UI.tool === 'demolish') {
    const t = targetAt(m.tile, m.wx, m.wy);
    if (t && t.kind === 'lift') {
      const l = S.lifts.find(x => x.id === t.id);
      if (confirm(`Demolish ${l.name}? You get 40% of its cost back.`)) demolishLift(l.id);
    } else if (t && t.kind === 'building') {
      const b = S.buildings.find(x => x.id === t.id);
      const B = BUILDING_TYPES[b.type];
      if (confirm(B.private ? `Buy out the owners of this ${B.name} for ${money(B.buyout)} and demolish it?` : `Demolish this ${B.name}? You get 40% of its cost back.`)) demolishBuilding(b.id);
    }
  }
}

function onMove(e) {
  if (!S) return;
  if (UI.ptrs.has(e.pointerId)) UI.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (UI.pinch && UI.ptrs.size >= 2) {
    const [a, b] = [...UI.ptrs.values()];
    const p = UI.pinch, d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ang = Math.atan2(b.y - a.y, b.x - a.x);
    panBy(mx - p.mx, my - p.my);
    zoomAt(mx, my, d / Math.max(10, p.d));
    let da = ang - p.a;
    if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
    R.cam.yaw += da;
    Object.assign(p, { d, mx, my, a: ang });
    UI.camMoved = true; UI.follow = null;
    return;
  }
  updateMouse(e);
  UI.mouse.inside = e.target === R.canvas;
  const d = UI.drag, m = UI.mouse;
  if (d && (d.kind === 'pan' || d.kind === 'rotate')) {
    if (Math.hypot(m.sx - d.sx, m.sy - d.sy) > 4) d.moved = true;
    if (d.moved) {
      if (d.kind === 'pan') { panBy(m.sx - d.lx, m.sy - d.ly); UI.follow = null; } else rotateBy(m.sx - d.lx, m.sy - d.ly);
      UI.camMoved = true;
    }
    d.lx = m.sx; d.ly = m.sy;
  } else if (d && d.kind === 'paint' && m.tile >= 0 && m.tile !== d.last) {
    applyBrush(d.last, m.tile);
    d.last = m.tile;
  }
  updateTooltip();
}

function onUp(e) {
  UI.ptrs.delete(e.pointerId);
  if (UI.pinch) { if (UI.ptrs.size < 2) UI.pinch = null; UI.drag = null; return; }
  const d = endDrag();
  if (d && (d.kind === 'pan' || d.kind === 'rotate') && d.click && !d.moved) select(targetAt(UI.mouse.tile, UI.mouse.wx, UI.mouse.wy));
}

function onKey(e) {
  if (!S || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); R.overlayDirty = true; return; }
  UI.keys.add(k);
  if (k === ' ') { e.preventDefault(); setSpeed(0); }
  else if (k === '1') setSpeed(1);
  else if (k === '2') setSpeed(2);
  else if (k === '3') setSpeed(4);
  else if (k === '4') setSpeed(8);
  else if (k === 'escape') {
    if (UI.liftStart != null || UI.route.start != null) { UI.liftStart = null; UI.route.start = null; }
    else { selectTool('inspect'); select(null); closePanel(); }
  }
  else if (k === 'g') setView(R.view === 'slope' ? 'none' : 'slope');
  else if (k === 'v') { const ks = Object.keys(VIEWS); setView(ks[(ks.indexOf(R.view) + 1) % ks.length]); }
  else if (k === 'q') selectTool('inspect');
  else if (k === 'p') selectTool('piste');
  else if (k === 'r') selectTool('route');
  else if (k === 'l') selectTool('lifts');
  else if (k === 'b') selectTool('buildings');
  else if (k === 'x') selectTool('demolish');
  else if (k === 'f') selectTool('freeride');
  else if (k === 'home') { resetCamera(); UI.camMoved = true; }
  else if (k === '+' || k === '=') zoomAt(innerWidth / 2, innerHeight / 2, 1.2);
  else if (k === '-') zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.2);
}

function keyboardPan(rdt) {
  const v = 700 * rdt;
  const K = UI.keys;
  let dx = 0, dy = 0, rot = 0, tilt = 0;
  if (K.has('a') || K.has('arrowleft')) dx += v;
  if (K.has('d') || K.has('arrowright')) dx -= v;
  if (K.has('w') || K.has('arrowup')) dy += v;
  if (K.has('s') || K.has('arrowdown')) dy -= v;
  if (K.has(',') || K.has('<')) rot -= v;
  if (K.has('.') || K.has('>')) rot += v;
  if (K.has('pageup')) tilt += v;
  if (K.has('pagedown')) tilt -= v;
  if (dx || dy) { panBy(dx, dy); UI.follow = null; UI.camMoved = true; }
  if (rot || tilt) { rotateBy(rot, tilt); UI.camMoved = true; }
}

// ---------- mini-map ----------

function initMinimap() {
  const cv = $('#minimap');
  cv.width = MAP_W * 3; cv.height = MAP_H * 3;
  let dragging = false;
  const jump = e => {
    const r = cv.getBoundingClientRect();
    centerCamOnProj((e.clientX - r.left) / r.width * mapW(), (e.clientY - r.top) / r.height * mapH());
    UI.follow = null; UI.camMoved = true;
  };
  cv.addEventListener('pointerdown', e => { dragging = true; cv.setPointerCapture(e.pointerId); jump(e); });
  cv.addEventListener('pointermove', e => { if (dragging) jump(e); });
  cv.addEventListener('pointerup', () => { dragging = false; });
  $('#minimap-toggle').addEventListener('click', () => $('#minimap-wrap').classList.toggle('collapsed'));
}

// ---------- tooltip & preview ----------

function updateTooltip() {
  const tt = $('#tooltip'), m = UI.mouse;
  if (!m.inside || m.tile < 0 || UI.drag && (UI.drag.kind === 'pan' || UI.drag.kind === 'rotate') || UI.ptrs.size > 1) { tt.classList.add('hidden'); return; }
  const i = m.tile;
  let h = '';
  if (UI.tool === 'lift') {
    if (UI.liftStart == null) h = `${LIFT_TYPES[UI.liftType].name}: click the bottom station`;
    else {
      const [a, b] = orderedLift(UI.liftStart, i);
      const c = checkLift(UI.liftType, tx(a), ty(a), tx(b), ty(b));
      h = `${Math.round(c.len * TILE_M)} m · ↑ ${c.vert} m · <b>${money(c.cost)}</b>`;
      if (!c.ok) h += `<br><span class="bad">${c.reason}</span>`;
    }
  } else if (UI.tool === 'route') {
    if (UI.route.start == null) h = 'Route: click the top of the run';
    else {
      const p = currentRoute();
      if (!p || !p.ok) h = `<span class="bad">${p ? p.reason : ''}</span>`;
      else {
        h = `${p.len} tiles · ${Math.round(T.height[UI.route.start] - T.height[i])} m drop · hardest <b>${DIFFS[p.maxD].name}</b> · <b>${money(p.cost)}</b>`;
        if (p.maxD > UI.route.maxDiff) h += `<br><span class="bad">No ${DIFFS[UI.route.maxDiff].name.toLowerCase()} line here — includes ${DIFFS[p.maxD].name} sections</span>`;
      }
    }
  } else if (UI.tool === 'building') {
    const o = buildingOrigin(UI.buildType, i);
    const c = checkBuilding(UI.buildType, o.x, o.y);
    h = `${BUILDING_TYPES[UI.buildType].name} · <b>${money(c.cost)}</b>`;
    if (!c.ok) h += `<br><span class="bad">${c.reason}</span>`;
  } else if (UI.tool === 'piste') {
    if (T.village[i]) h = 'Village (no piste needed)';
    else if (!canPiste(i)) h = `<span class="bad">${T.rock[i] || T.diff[i] >= 4 ? 'Too steep / rocky' : 'Occupied'}</span>`;
    else h = `<span style="color:${DIFFS[T.diff[i]].color === '#111111' ? '#ccc' : DIFFS[T.diff[i]].color}">●</span> ${DIFFS[T.diff[i]].name} · ${Math.round(T.grade[i] * 100)}% · ${money(PISTE_COST + (T.tree[i] ? TREE_CLEAR_COST : 0))}`;
  } else if (UI.tool === 'freeride') {
    if (UI.freeMode === 'remove') h = T.free[i] ? 'Remove from freeride zone' : '';
    else if (T.free[i]) h = 'Already in a freeride zone';
    else if (!canFree(i)) h = `<span class="bad">${T.village[i] ? 'Not in the village' : T.piste[i] ? 'Already a piste' : T.rock[i] || T.diff[i] >= 4 ? 'Too steep / rocky' : 'Occupied'}</span>`;
    else h = `Off-piste · ${Math.round(T.grade[i] * 100)}%${T.tree[i] ? ' · tree skiing' : ''} · ${money(FREERIDE.cost)}`;
  } else if (UI.tool === 'inspect' || UI.tool === 'demolish') {
    const t = targetAt(i, m.wx, m.wy);
    if (t && t.kind === 'guest') { const g = S.guests.find(x => x.id === t.id); h = `${esc(g.name)} · ${SKILLS[g.skill]} ${GUEST_KINDS[g.kind].toLowerCase()} · 😊 ${pct(g.happy)}`; }
    else if (t && t.kind === 'lift') { const l = S.lifts.find(x => x.id === t.id); h = `${esc(l.name)} · ${l.broken ? '🔧 broken' : `queue ${l.queue.length}`}`; }
    else if (t && t.kind === 'building') { const b = S.buildings.find(x => x.id === t.id); h = BUILDING_TYPES[b.type].name; }
    else if (UI.tool === 'inspect') h = `${Math.round(T.height[i])} m${T.village[i] ? ' · Village' : ` · ${Math.round(T.grade[i] * 100)}% ${T.diff[i] < 4 ? DIFFS[T.diff[i]].name : 'cliff'}`}`;
  }
  if (!h) { tt.classList.add('hidden'); return; }
  tt.innerHTML = h;
  tt.classList.remove('hidden');
  tt.style.left = Math.min(m.sx + 16, innerWidth - tt.offsetWidth - 8) + 'px';
  tt.style.top = (m.sy + 14) + 'px';
}

// Tool previews are drawn flat (world pixels, TILE per tile) on an overlay draped over the terrain.
function drawToolPreview(ctx) {
  const m = UI.mouse;
  if (UI.tool === 'route' && UI.route.start != null) {
    ctx.strokeStyle = '#ffd43b'; ctx.lineWidth = 2.5; ctx.beginPath(); tilePath(ctx, UI.route.start); ctx.stroke();
  }
  if (UI.tool === 'lift' && UI.liftStart != null && (!m.inside || m.tile < 0)) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); tilePath(ctx, UI.liftStart); ctx.stroke();
  }
  if (!m.inside || m.tile < 0) return;
  const i = m.tile;
  if (BRUSH_TOOLS.includes(UI.tool)) {
    for (const t of brushTiles(i)) {
      const ok = UI.tool === 'piste' ? canPiste(t) : UI.tool === 'freeride' && UI.freeMode === 'mark' ? canFree(t) || T.free[t] : true;
      ctx.fillStyle = ok ? (UI.tool === 'piste' ? 'rgba(77,171,247,0.45)' : 'rgba(255,170,60,0.45)') : 'rgba(224,49,49,0.45)';
      ctx.beginPath(); tilePath(ctx, t); ctx.fill();
    }
  } else if (UI.tool === 'route') {
    const p = currentRoute();
    if (p && p.ok) {
      for (const t of p.tiles) {
        const d = Math.min(3, T.diff[t]);
        ctx.fillStyle = DIFFS[d].color; ctx.globalAlpha = d > UI.route.maxDiff ? 0.75 : 0.5;
        ctx.beginPath(); tilePath(ctx, t); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      p.path.forEach((t, k) => { const [x, y] = P(tx(t) + 0.5, ty(t) + 0.5); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); tilePath(ctx, i); ctx.stroke();
  } else if (UI.tool === 'lift') {
    if (UI.liftStart == null) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); tilePath(ctx, i); ctx.stroke();
    } else {
      const [a, b] = orderedLift(UI.liftStart, i);
      const c = checkLift(UI.liftType, tx(a), ty(a), tx(b), ty(b));
      if (a !== b) previewLift(ctx, { type: UI.liftType, bx: tx(a), by: ty(a), tx: tx(b), ty: ty(b) }, c.ok);
      else { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); tilePath(ctx, i); ctx.stroke(); }
    }
  } else if (UI.tool === 'building') {
    const o = buildingOrigin(UI.buildType, i);
    const c = checkBuilding(UI.buildType, o.x, o.y);
    previewBuilding(ctx, { id: 0, type: UI.buildType, x: o.x, y: o.y, size: BUILDING_TYPES[UI.buildType].size }, c.ok);
    if (UI.buildType === 'cannon') {
      ctx.strokeStyle = 'rgba(77,171,247,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      const [cx, cy] = P(o.x + 0.5, o.y + 0.5);
      ctx.beginPath(); ctx.arc(cx, cy, 3.5 * TILE, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
  } else if (UI.tool === 'demolish') {
    const t = targetAt(i, m.wx, m.wy);
    ctx.strokeStyle = '#e03131'; ctx.lineWidth = 3;
    if (t && t.kind === 'building') {
      const b = S.buildings.find(x => x.id === t.id), s2 = b.size * TILE;
      ctx.strokeRect(b.x * TILE, b.y * TILE, s2, s2);
    } else if (t && t.kind === 'lift') {
      const l = S.lifts.find(x => x.id === t.id);
      for (const [x, y] of [[l.bx, l.by], [l.tx, l.ty]]) ctx.strokeRect(x * TILE, y * TILE, TILE, TILE);
      ctx.beginPath(); ctx.moveTo((l.bx + 0.5) * TILE, (l.by + 0.5) * TILE); ctx.lineTo((l.tx + 0.5) * TILE, (l.ty + 0.5) * TILE); ctx.stroke();
    }
  }
}

// ---------- selection info ----------

function select(t) {
  Sel.kind = t ? t.kind : null;
  Sel.id = t ? t.id : null;
  Sel.tile = t && t.tile != null ? t.tile : -1;
  UI.follow = null;
  renderInfo();
}

function bar(v, color) { return `<div class="bar"><div style="width:${clamp(v, 0, 100)}%;background:${color}"></div></div>`; }
function happyColor(h) { return h > 66 ? '#51cf66' : h > 40 ? '#ffd43b' : '#ff6b6b'; }
const liftName = id => esc((S.lifts.find(l => l.id === id) || {}).name || 'a lift');

const STATE_TEXT = {
  walk: g => g.dest === 'V' ? (g.leaving ? 'Heading home' : 'Skiing down to the village') : `Heading to ${liftName(+g.dest.slice(1))}`,
  queue: g => `Queuing for ${liftName(g.lift)} (${Math.round(g.queueTime)} min)`,
  ride: g => `Riding ${liftName(g.lift)}`,
  inside: g => { const b = S.buildings.find(x => x.id === g.bld); return b ? `Inside the ${BUILDING_TYPES[b.type].name}` : 'Inside'; },
  stroll: g => g.then === 'exit' ? 'Walking to the car park' : 'Walking through the village',
  stuck: () => 'Stuck! Hiking down…', wait: () => 'Waiting for the lifts to open', decide: () => 'Thinking…',
  injured: () => 'Injured — waiting for ski patrol',
};

function renderInfo() {
  const el = $('#info');
  document.body.classList.toggle('has-info', !!Sel.kind);
  if (!Sel.kind) { el.classList.add('hidden'); return; }
  let h = '';
  if (Sel.kind === 'guest') {
    const g = S.guests.find(x => x.id === Sel.id);
    if (!g) { Sel.kind = null; el.classList.add('hidden'); return; }
    h = `<h2><span class="dot" style="background:${g.color}"></span>${esc(g.name)}<button class="x" data-action="close-info" aria-label="Close">${CLOSE_SVG}</button></h2>
      <div class="sub">${SKILLS[g.skill]} ${GUEST_KINDS[g.kind].toLowerCase()} · ${(STATE_TEXT[g.state] || (() => g.state))(g)}</div>
      ${guestChips(g)}
      Happiness ${bar(g.happy, happyColor(g.happy))}
      Energy ${bar(g.energy, '#4dabf7')}
      Hunger ${bar(g.hunger, '#ff922b')}
      ${g.skill < (g.kind === 'kid' ? 2 : 3) ? `Progress to ${SKILLS[g.skill + 1]} ${bar((g.xp || 0) / SKILL_XP[g.skill] * 100, '#b197fc')}` : ''}
      <table class="kv"><tr><td>Cash</td><td>${money(g.cash)}</td></tr><tr><td>Spent here</td><td>${money(g.spent)}</td></tr>
      <tr><td>Runs today</td><td>${g.runs}</td></tr></table>
      <div class="hint" style="margin:12px 0 4px;text-transform:uppercase;letter-spacing:.08em;font-size:12px;font-weight:600">Thoughts</div>
      ${g.thoughts.length ? g.thoughts.map(t => `<div class="thought ${THOUGHTS[t.key].good ? 'good' : 'bad'}">${THOUGHTS[t.key].text}</div>`).join('') : '<div class="thought">…</div>'}
      <div style="margin-top:12px"><button class="btn ${UI.follow === g.id ? 'on' : ''}" data-action="follow" data-id="${g.id}">${UI.follow === g.id ? 'Following' : 'Follow with camera'}</button></div>`;
  } else if (Sel.kind === 'lift') {
    const l = S.lifts.find(x => x.id === Sel.id);
    if (!l) { Sel.kind = null; el.classList.add('hidden'); return; }
    const L = LIFT_TYPES[l.type];
    const rel = liftReliability(l);
    const ups = upgradeOptions(l);
    const relCol = rel > 0.7 ? 'var(--good)' : rel > 0.45 ? 'var(--warn)' : 'var(--bad)';
    const runs = l.usable ? [...new Set([l.minRd[3], l.maxRd])].map(d => DIFFS[clamp(d, 0, 3)].name).join(' – ') : '';
    const status = l.broken ? '<span class="chip bad">Broken down</span>' : !l.usable ? '<span class="chip warn">No way down</span>'
      : !l.open ? '<span class="chip">Closed</span>' : '<span class="chip good">Running</span>';
    const best = ups[ups.length - 1];
    h = `<div class="sel-head">
        <div class="sel-ic" style="background:${L.color}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5l18 4"/><path d="M12 7v5"/><rect x="8" y="12" width="8" height="7" rx="1.5"/></svg></div>
        <div class="sel-title"><h2>${esc(l.name)}</h2><span>${L.name} · ${fmtNum(Math.round(l.len * TILE_M))} m · rises ${Math.round(l.vert)} m</span></div>
        <button class="x" data-action="close-info" aria-label="Close">${CLOSE_SVG}</button>
      </div>
      <div class="chips">${status}${runs ? `<span class="chip">Runs from top: ${runs}</span>` : ''}</div>
      ${l.broken ? `<div class="warn">Back in about ${Math.max(1, Math.round(l.repair))} min.${S.staff.mechanic ? '' : ' You have no mechanics!'}</div>` : ''}
      ${!l.usable ? '<div class="warn">No piste leads away from the top station. Paint one from the top station down to a lift or the village.</div>' : ''}
      ${l.usable && !l.toVillage ? '<div class="warn">Pistes from the top don\'t reach the village — guests can only continue to other lifts.</div>' : ''}
      <div class="tiles">
        <div class="tile"><span class="l">Queue</span><span class="v">${l.queue.length}</span><span class="s">${l.broken ? 'lift stopped' : `${liftWait(l).toFixed(1)} min wait`}</span></div>
        <div class="tile"><span class="l">Capacity</span><span class="v">${fmtNum(Math.round(capPerMin(l) * 60))}</span><span class="s">guests per hour</span></div>
        <div class="tile"><span class="l">Rides today</span><span class="v">${fmtNum(l.ridesToday)}</span><span class="s">${l.riders.length} on the lift</span></div>
        <div class="tile"><span class="l">Ride time</span><span class="v">${(l.len / L.speed).toFixed(1)} min</span><span class="s">${L.rest ? 'guests rest on the way' : 'no rest on a drag lift'}</span></div>
      </div>
      <div class="meter-head"><span>Reliability · ${l.age} days old · ${l.breakdowns} breakdown${l.breakdowns === 1 ? '' : 's'}</span><span>${pct(rel * 100)}</span></div>
      <div class="bar"><div style="width:${rel * 100}%;background:${relCol}"></div></div>
      <div class="actions-col">
        ${best ? `<button class="btn primary block" data-action="upgrade" data-id="${l.id}" data-type="${best.type}">Upgrade to ${LIFT_TYPES[best.type].name} · ${money(best.cost)}</button>` : ''}
        ${ups.length > 1 ? ups.slice(0, -1).map(o => `<button class="btn block" data-action="upgrade" data-id="${l.id}" data-type="${o.type}">Upgrade to ${LIFT_TYPES[o.type].name} · ${money(o.cost)}</button>`).join('') : ''}
        <div class="actions-grid">
          <button class="btn" data-action="refurb" data-id="${l.id}" title="Resets age and reliability">Refurbish · ${money(refurbishCost(l))}</button>
          <button class="btn" data-action="toggle-lift" data-id="${l.id}">${l.open ? 'Close lift' : 'Open lift'}</button>
          <button class="btn" data-action="rename-lift" data-id="${l.id}">Rename</button>
          <button class="btn danger" data-action="demolish-lift" data-id="${l.id}">Demolish</button>
        </div>
      </div>
      <div class="hint" style="margin:10px 0 0">Running cost ${money(L.upkeep)} per day · ${fmtNum(l.rides)} rides in total</div>`;
  } else if (Sel.kind === 'building') {
    const b = S.buildings.find(x => x.id === Sel.id);
    if (!b) { Sel.kind = null; el.classList.add('hidden'); return; }
    const B = BUILDING_TYPES[b.type];
    if (B.private) {
      const L = VILLAGE_LEASE[S.village.lease], occ = clamp(0.25 + S.reputation / 130, 0.2, 1);
      const lease = Math.round(B.beds * L.perBed * occ * (B.lux ? 1.6 : 1) + (B.shopLease || 0) * L.perBed);
      el.innerHTML = `<h2>${B.icon} ${B.name}<button class="x" data-action="close-info" aria-label="Close">${CLOSE_SVG}</button></h2>
        <div class="sub">${B.desc}</div>
        <div class="chips"><span class="chip">Privately owned</span>${b.built ? `<span class="chip">Built on day ${((b.built - 1) % DAYS_PER_SEASON) + 1}, year ${Math.floor((b.built - 1) / DAYS_PER_SEASON) + 1}</span>` : ''}</div>
        <table class="kv">${B.beds ? `<tr><td>Beds</td><td>${B.beds}</td></tr>` : ''}<tr><td>Lease paid to you</td><td class="pos">${money(lease)}/night</td></tr></table>
        <div style="margin-top:12px"><button class="btn danger" data-action="demolish-building" data-id="${b.id}">Buy out & demolish · ${money(B.buyout)}</button></div>`;
      el.classList.remove('hidden');
      return;
    }
    let warn = '';
    if ((B.kind === 'food' || B.kind === 'park') && !T.village[idx(b.x, b.y)] && ![...Net.adj.values()].some(arr => arr.includes(b))) warn = '<div class="warn">Not next to a piste — skiers can\'t reach it.</div>';
    if (B.kind === 'school' && !S.staff.instructor) warn = '<div class="warn">No instructors! Hire them in the Staff panel.</div>';
    h = `<h2>${B.icon} ${B.name}<button class="x" data-action="close-info" aria-label="Close">${CLOSE_SVG}</button></h2>
      <div class="sub">${B.desc}</div>${warn}
      <table class="kv">
        ${B.capacity ? `<tr><td>Inside</td><td>${b.occupancy} / ${B.kind === 'school' ? Math.min(B.capacity, schoolCapacity()) : B.capacity}</td></tr>` : ''}
        ${B.priceKey || B.kind === 'park' ? `<tr><td>Visitors</td><td>${b.visits}</td></tr>` : ''}
        ${B.priceKey ? `<tr><td>Revenue</td><td>${money(b.income)}</td></tr>` : ''}
        <tr><td>Upkeep</td><td>${money(B.upkeep)}/day</td></tr>
      </table>
      <div style="margin-top:12px"><button class="btn danger" data-action="demolish-building" data-id="${b.id}">Demolish</button></div>`;
  } else if (Sel.kind === 'tile') {
    const i = Sel.tile;
    h = `<h2>${T.village[i] ? '🏘️ Village' : T.piste[i] ? '⛷️ Piste' : T.free[i] ? '🏔️ Freeride zone' : T.tree[i] ? '🌲 Forest' : T.rock[i] ? '🪨 Rocks' : '🏔️ Mountain'}<button class="x" data-action="close-info" aria-label="Close">${CLOSE_SVG}</button></h2>
      ${T.closed[i] ? '<div class="warn">🏔️ Closed today: avalanche danger.</div>' : ''}
      ${T.bare[i] && (T.piste[i] || T.free[i]) ? '<div class="warn">Not enough snow — closed until it snows or a cannon covers it.</div>' : ''}
      <table class="kv">
        <tr><td>Altitude</td><td>${Math.round(T.height[i])} m</td></tr>
        ${T.village[i] ? '' : `<tr><td>Slope</td><td>${Math.round(T.grade[i] * 100)}% (${T.diff[i] < 4 ? DIFFS[T.diff[i]].name : 'too steep'})</td></tr>`}
        <tr><td>Snow depth</td><td>${Math.round(snowAt(i))} cm${T.cannon[i] ? ' (snow cannon)' : ''}</td></tr>
        ${T.free[i] && !T.piste[i] ? `<tr><td>Untracked powder</td><td>${pct(T.fresh[i] * 100)}</td></tr><tr><td>Rated</td><td>${DIFFS[Math.min(3, tileDiff(i))].name} (off-piste)</td></tr><tr><td>Status</td><td>${freeOpen() ? 'Open' : 'Closed'}</td></tr><tr><td>Connected</td><td>${T.reach && T.reach[i] ? 'Yes' : 'No — must touch a lift top or a piste below one'}</td></tr>` : ''}
        ${T.piste[i] ? `<tr><td>Groomed last night</td><td>${T.groomed[i] ? 'Yes' : T.diff[i] >= 3 && S.grooming.moguls ? 'No — left for moguls' : 'No'}</td></tr><tr><td>Piste condition</td><td>${pct(T.cond[i])}</td></tr><tr><td>Quality</td><td>${pct(pisteQuality(i) * 100)}</td></tr><tr><td>Connected</td><td>${T.reach && T.reach[i] ? 'Yes' : 'No — not reachable from a lift'}</td></tr>` : ''}
      </table>`;
  }
  el.innerHTML = h;
  el.classList.remove('hidden');
}

// ---------- panels ----------

function togglePanel(p) {
  UI.panel = UI.panel === p ? null : p;
  document.body.classList.toggle('has-panel', !!UI.panel);
  document.querySelectorAll('#topbar [data-panel]').forEach(b => b.classList.toggle('on', b.dataset.panel === UI.panel));
  renderPanel(true);
}
function closePanel() { UI.panel = null; document.body.classList.remove('has-panel'); renderPanel(true); document.querySelectorAll('#topbar [data-panel]').forEach(b => b.classList.remove('on')); }

const PANEL_TITLES = { finance: 'Finances', guests: 'Guests & rating', lifts: 'Lifts', staff: 'Staff', marketing: 'Marketing', research: 'Research', prices: 'Prices', goals: 'Goals & advisor', menu: 'Game',
  snow: 'Snow & mountain', events: 'Events', village: 'Village' };
const CLOSE_SVG = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true" style="width:18px;height:18px"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function renderPanel(full) {
  const el = $('#panel');
  if (!UI.panel) { el.classList.add('hidden'); return; }
  if (!full && (UI.panel === 'prices' || UI.panel === 'menu' || UI.panel === 'snow')) { updatePrices(); return; }
  const fn = { finance: panelFinance, guests: panelGuests, lifts: panelLifts, staff: panelStaff, marketing: panelMarketing, research: panelResearch, prices: panelPrices, goals: panelGoals, menu: panelMenu,
    snow: panelSnow, events: panelEvents, village: panelVillage }[UI.panel];
  const scroll = el.scrollTop;
  el.innerHTML = `<h2>${PANEL_TITLES[UI.panel]}<button class="x" data-action="close-panel" aria-label="Close panel">${CLOSE_SVG}</button></h2>` + fn();
  el.classList.remove('hidden');
  el.scrollTop = scroll;
  if (UI.panel === 'finance') drawFinanceChart();
  if (UI.panel === 'prices') updatePrices();
}

const FIN_LABELS = { tickets: 'Lift tickets', passes: 'Season passes', food: 'Food & drink', rental: 'Ski rental', school: 'Ski school', hotel: 'Hotel rooms',
  lease: 'Village leases', events: 'Event sponsors', rewards: 'Goal rewards',
  construction: 'Construction', upkeep: 'Running costs', snow: 'Snow, grooming & avalanche control', staff: 'Staff wages', marketing: 'Marketing & events', research: 'Research', interest: 'Loan interest' };

function finTable(f) {
  let inc = 0, exp = 0, h = '<table class="kv">';
  for (const k of INCOME_KEYS) if (f[k]) { inc += f[k]; h += `<tr><td>${FIN_LABELS[k]}</td><td class="pos">${money(f[k])}</td></tr>`; }
  for (const k of EXPENSE_KEYS) if (f[k]) { exp += f[k]; h += `<tr><td>${FIN_LABELS[k]}</td><td class="neg">${money(-f[k])}</td></tr>`; }
  h += `<tr class="total"><td>Profit</td><td class="${inc - exp >= 0 ? 'pos' : 'neg'}">${money(inc - exp)}</td></tr></table>`;
  return h;
}

function nightlyCosts() {
  return S.lifts.reduce((a, l) => a + LIFT_TYPES[l.type].upkeep, 0) + S.buildings.reduce((a, b) => a + BUILDING_TYPES[b.type].upkeep, 0)
    + (S.night.on ? NIGHT_SKIING.upkeep : 0);
}
function wages() { return Object.entries(S.staff).reduce((a, [k, n]) => a + n * STAFF_TYPES[k].wage, 0); }

function panelFinance() {
  const last = S.fin.history[S.fin.history.length - 1];
  return `<h4>Today so far</h4>${finTable(S.fin.today)}
    ${last ? `<h4>Yesterday</h4>${finTable(last.fin)}` : ''}
    <h4>Daily profit (last 30 days)</h4><canvas class="chart" id="fin-chart"></canvas>
    <h4>Overview</h4><table class="kv">
      <tr><td>Nightly running costs</td><td>${money(nightlyCosts())}</td></tr>
      <tr><td>Staff wages</td><td>${money(wages())}/day</td></tr>
      <tr><td>Research funding</td><td>${money(RESEARCH_FUNDING[S.research.funding])}/day</td></tr>
      <tr><td>Loan</td><td>${money(S.loan)} / ${money(S.maxLoan)}</td></tr>
      <tr><td>Interest</td><td>0.2% per day</td></tr></table>
    <div style="margin-top:8px"><button class="btn" data-action="loan" data-id="5000">Borrow $5,000</button><button class="btn" data-action="repay" data-id="5000">Repay $5,000</button></div>`;
}

function drawFinanceChart() {
  const c = $('#fin-chart');
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = c.clientWidth, H = c.clientHeight;
  const data = S.fin.history.slice(-30).map(d => d.profit);
  if (!data.length) { ctx.fillStyle = '#9fb0c8'; ctx.font = '12px system-ui'; ctx.fillText('No days completed yet', 10, H / 2); return; }
  const max = Math.max(100, ...data.map(Math.abs));
  const mid = H / 2, bw = W / 30;
  ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(0, mid, W, 1);
  data.forEach((v, k) => {
    const h = v / max * (H / 2 - 6);
    ctx.fillStyle = v >= 0 ? '#51cf66' : '#ff6b6b';
    ctx.fillRect(k * bw + 1, v >= 0 ? mid - h : mid, bw - 2, Math.abs(h));
  });
  ctx.fillStyle = '#9fb0c8'; ctx.font = '10px system-ui';
  ctx.fillText(money(max), 4, 11); ctx.fillText(money(-max), 4, H - 3);
}

function thoughtSummary() {
  const counts = {};
  for (const g of S.guests) for (const t of g.thoughts) counts[t.key] = (counts[t.key] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
}

function ratingFactors(thoughts) {
  const e = Object.entries(thoughts || {});
  const good = e.filter(([k]) => THOUGHTS[k].good).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const bad = e.filter(([k]) => !THOUGHTS[k].good).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const row = ([k, c], cls) => `<div class="thought ${cls}"><b>${c}</b> × ${THOUGHTS[k].text}</div>`;
  if (!good.length && !bad.length) return '<div class="hint" style="margin:0">No guests have left yet.</div>';
  return `<div class="factors"><div>${good.map(x => row(x, 'good')).join('') || '<div class="hint">—</div>'}</div><div>${bad.map(x => row(x, 'bad')).join('') || '<div class="hint">—</div>'}</div></div>`;
}

function panelGuests() {
  const n = S.guests.length;
  const avg = n ? S.guests.reduce((a, g) => a + g.happy, 0) / n : 0;
  const skills = [0, 0, 0, 0]; S.guests.forEach(g => skills[g.skill]++);
  const kinds = { adult: 0, kid: 0, board: 0 }; S.guests.forEach(g => kinds[g.kind]++);
  const th = thoughtSummary();
  const list = S.guests.slice().sort((a, b) => a.happy - b.happy).slice(0, 40);
  const last = S.fin.history[S.fin.history.length - 1];
  const delta = S.reputation - S.stats.repStart;
  return `<h4 style="margin-top:0">Resort rating</h4>
    <div class="rating-big">${pct(S.reputation)} <span class="${delta >= 0 ? 'pos' : 'neg'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}</span></div>
    <div class="hint" style="margin:0 0 6px">Each night the rating moves towards how happy the day's guests were when they left (${S.stats.happyN ? pct(S.stats.happySum / S.stats.happyN) : '—'} so far today).</div>
    <div class="hint" style="margin:0">What departing guests said today:</div>
    ${ratingFactors(S.stats.leftThoughts)}
    ${last ? `<div class="hint" style="margin:6px 0 0">Yesterday:</div>${ratingFactors(last.thoughts)}` : ''}
    <h4>Right now</h4><table class="kv">
      <tr><td>On the mountain</td><td>${n} / ${S.cache.capacity}</td></tr>
      <tr><td>Visitors today</td><td>${S.stats.guestsToday}</td></tr>
      <tr><td>Turned away (price / full)</td><td>${S.stats.turnedPrice} / ${S.stats.turnedFull}</td></tr>
      <tr><td>Average happiness</td><td>${n ? pct(avg) : '—'}</td></tr>
      <tr><td>Skiers · kids · boarders</td><td>${kinds.adult} · ${kinds.kid} · ${kinds.board}</td></tr>
      <tr><td>Skill mix</td><td>${skills.map((c, k) => `${c} ${SKILLS[k].slice(0, 3)}`).join(' · ')}</td></tr>
      <tr><td>Injuries · breakdowns today</td><td>${S.stats.injuries} · ${S.stats.breakdowns}</td></tr>
      <tr><td>Best day</td><td>${S.stats.bestDay} guests</td></tr></table>
    <h4>Regulars</h4>${regularsSummary()}
    <h4>What guests are thinking</h4>
    ${th.length ? th.map(([k, c]) => `<div class="thought ${THOUGHTS[k].good ? 'good' : 'bad'}"><b>${c}</b> × ${THOUGHTS[k].text}</div>`).join('') : '<div class="thought">No thoughts yet.</div>'}
    <h4>Guests (least happy first)</h4>
    ${list.map(g => `<div class="list-item" data-action="pick-guest" data-id="${g.id}"><span class="dot" style="background:${g.color}"></span><span class="grow">${esc(g.name)} · ${SKILLS[g.skill]} ${g.kind === 'adult' ? '' : GUEST_KINDS[g.kind].toLowerCase()}</span><span style="color:${happyColor(g.happy)}">${pct(g.happy)}</span></div>`).join('') || '<div class="hint">Nobody here right now.</div>'}`;
}

function panelLifts() {
  if (!S.lifts.length) return '<div class="hint">No lifts yet. Use the 🚡 Lifts tool.</div>';
  return S.lifts.map(l => {
    const L = LIFT_TYPES[l.type];
    const st = l.broken ? '🔧' : !l.usable ? '⚠️' : !l.open ? '⛔' : '🟢';
    return `<div class="list-item" data-action="pick-lift" data-id="${l.id}"><span>${L.icon}</span><span class="grow">${st} ${esc(l.name)}</span>
      <span style="color:var(--muted);font-size:12px">${l.broken ? 'broken' : `${liftWait(l).toFixed(0)} min`} · ${l.ridesToday} rides · ${pct(liftReliability(l) * 100)}</span></div>`;
  }).join('') + '<div class="hint">Wait time · rides today · reliability. Old lifts break down more — refurbish them from the lift\'s info card.</div>';
}

function panelStaff() {
  let h = '<div class="hint" style="margin:0 0 8px">Wages are paid every night. Hiring and firing is free.</div>';
  for (const [k, ST] of Object.entries(STAFF_TYPES)) {
    const n = S.staff[k] || 0, need = staffNeeded(k), cov = staffCoverage(k);
    const status = need === 0 ? '<span class="hint" style="margin:0">Not needed yet</span>'
      : `<span style="color:${cov >= 1 ? '#51cf66' : cov > 0 ? '#ffd43b' : '#ff6b6b'}">${n >= need ? '✓ Fully covered' : `Need ${need} for full cover`}</span>`;
    h += `<div class="staff-row">
      <div class="staff-ic">${ST.icon}</div>
      <div class="grow"><b>${ST.name}</b> · ${money(ST.wage)}/day<div class="hint" style="margin:2px 0">${ST.desc}</div>${status}</div>
      <div class="stepper"><button class="btn" data-action="staff" data-id="${k}" data-d="-1">−</button><b>${n}</b><button class="btn" data-action="staff" data-id="${k}" data-d="1">+</button></div>
    </div>`;
  }
  h += `<table class="kv" style="margin-top:8px"><tr class="total"><td>Total wages</td><td>${money(wages())}/day</td></tr></table>
    <h4>What staff do</h4><div class="hint" style="margin:0;line-height:1.6">
    🔧 Without enough mechanics, lifts break down twice as often and repairs take far longer.<br>
    ⛑️ Ski patrol rescues injured guests quickly and blasts avalanche slopes after big snowfalls — otherwise steep pistes may close.<br>
    🧑‍🏫 The ski school only teaches as many guests as your instructors can handle.</div>`;
  return h;
}

function panelMarketing() {
  let h = '';
  const active = S.campaigns;
  h += '<h4 style="margin-top:0">Running now</h4>' + (active.length ? active.map(c => {
    const C = CAMPAIGNS[c.id];
    return `<div class="list-item"><span>${C.icon}</span><span class="grow">${C.name}</span><span style="font-size:12px;color:var(--muted)">${c.delay ? 'starts tomorrow' : `${c.daysLeft} day${c.daysLeft > 1 ? 's' : ''} left`}</span></div>`;
  }).join('') : '<div class="hint" style="margin:0">No campaigns running.</div>');
  h += `<div class="hint">Visitor demand from marketing: <b>+${pct((S.cache.marketing - 1) * 100)}</b></div><h4>Campaigns</h4>`;
  for (const [k, C] of Object.entries(CAMPAIGNS)) {
    const why = campaignAvailable(k);
    h += `<div class="card static"><span class="ic">${C.icon}</span><span class="nm">${C.name}</span><span class="pr">${money(C.cost)}</span>
      <span class="ds">${C.desc}${why ? `<br><span style="color:var(--bad)">${why}</span>` : ''}</span>
      <span class="act"><button class="btn ${why ? '' : 'primary'}" data-action="campaign" data-id="${k}" ${why ? 'disabled' : ''}>Launch</button></span></div>`;
  }
  h += '<div class="hint">Races, festivals and contests are booked in the 🚩 Events panel.</div><h4>Night skiing</h4>';
  if (!isUnlocked('upgrade:night')) h += '<div class="hint" style="margin:0">Research <b>Night Skiing</b> 🔬 to install floodlights.</div>';
  else if (!S.night.installed) h += `<div class="hint" style="margin:0 0 6px">Floodlights keep every lift open until 20:00 and bring in evening visitors. Costs ${money(NIGHT_SKIING.cost)} plus ${money(NIGHT_SKIING.upkeep)} per night when switched on.</div>
      <button class="btn primary" data-action="night-install">Install floodlights · ${money(NIGHT_SKIING.cost)}</button>`;
  else h += `<div class="row"><label>Night sessions (lifts until 20:00, ${money(NIGHT_SKIING.upkeep)}/night)</label><button class="btn ${S.night.on ? 'on' : ''}" data-action="night-toggle">${S.night.on ? 'On' : 'Off'}</button></div>`;
  return h;
}

function researchAvailable(r) {
  return !r.requires || S.research.unlocked.has(RESEARCH.find(y => y.id === r.requires).unlock);
}

function panelResearch() {
  const f = S.research.funding;
  let h = `<div class="hint" style="margin:0 0 8px">Research funding is paid each night and unlocks new lifts and facilities.</div>
    <h4>Daily funding</h4>
    <div class="row">${RESEARCH_FUNDING.map((v, k) => `<button class="btn ${f === k ? 'on' : ''}" data-action="funding" data-id="${k}">${v ? money(v) : 'Off'}</button>`).join('')}</div>
    <h4>Invest now</h4>
    <div class="row">${[5000, 20000, 50000].map(v => `<button class="btn" data-action="invest" data-id="${v}" ${S.research.current ? '' : 'disabled'}>+${money(v)}</button>`).join('')}</div>
    <div class="hint" style="margin:0">A one-off payment goes straight into the current project. Anything left over carries into the next one.</div>
    <h4>Projects</h4>`;
  for (const r of RESEARCH) {
    const done = S.research.unlocked.has(r.unlock);
    const avail = researchAvailable(r);
    const p = S.research.progress[r.id] || 0;
    const cur = S.research.current === r.id;
    const days = f ? Math.ceil((r.points - p) / RESEARCH_FUNDING[f]) : '∞';
    h += `<div class="list-item" ${!done && avail ? `data-action="research" data-id="${r.id}"` : ''} style="${cur ? 'background:rgba(77,171,247,.15)' : ''};${!avail && !done ? 'opacity:.45' : ''}">
      <span>${done ? '✅' : cur ? '🔬' : avail ? '⬜' : '🔒'}</span><span class="grow">${r.name}</span>
      <span style="font-size:12px;color:var(--muted)">${done ? 'Done' : `${Math.floor(p / r.points * 100)}%${cur ? ` · ${days}d` : ''}`}</span></div>`;
  }
  return h + '<div class="hint">Click a project to research it next.</div>';
}

function panelPrices() {
  const row = (k, label, min, max) => `<div class="row"><label>${label}</label><b id="pv-${k}">${money(S.prices[k])}</b></div>
    <input type="range" min="${min}" max="${max}" step="1" value="${S.prices[k]}" data-price="${k}">`;
  return `${row('ticket', '🎟️ Day lift pass (kids pay 60%)', 0, 200)}
    <div class="hint" id="price-hint"></div>
    ${row('food', '☕ Food (café meal; restaurant ×2.4)', 1, 40)}
    ${row('rental', '🎿 Ski rental', 0, 100)}
    ${row('school', '🧑‍🏫 Ski lesson', 0, 150)}
    ${row('pass', '🎫 Season pass (kids pay 60%)', 50, 1500)}
    <div class="hint" id="pass-hint"></div>
    <div class="hint">Guests compare your lift pass with what the resort is worth to them. More lifts, more vertical, more variety and a better rating let you charge more.</div>`;
}

function updatePrices() {
  for (const k of Object.keys(S.prices)) { const e = $('#pv-' + k); if (e) e.textContent = money(S.prices[k]); }
  const hint = $('#price-hint');
  if (hint) {
    const w = S.cache.wtp;
    const share = clamp((w * 1.4 - S.prices.ticket) / (w * 0.7), 0, 1);
    hint.innerHTML = `Typical guest values your resort at <b>${money(w)}</b>. At this price ~<b>${pct(share * 100)}</b> of visitors will buy a pass.`;
  }
  const ph = $('#pass-hint');
  if (ph) {
    const eq = S.prices.pass / Math.max(1, S.prices.ticket);
    ph.innerHTML = `Loyal regulars buy passes during the first ${PASS.sellUntil} days of each season ${S.day <= PASS.sellUntil ? '<b>(on sale now)</b>' : `(next sale: season ${S.year + 1})`}. The pass costs as much as <b>${eq.toFixed(1)}</b> day tickets. Pass holders come back more often and still spend on food and lessons. Sold this season: <b>${passHolders()}</b>.`;
  }
}

function panelGoals() {
  let found = false;
  const goals = GOALS.map(g => {
    const done = !!S.goals[g.id];
    const cur = !done && !found; if (cur) found = true;
    return `<div class="goal ${done ? 'done' : cur ? 'current' : ''}"><span>${done ? '✅' : cur ? '👉' : '⬜'}</span><span style="flex:1">${g.text}</span><span>${money(g.reward)}</span></div>`;
  }).join('');
  const log = S.adviceLog.length ? S.adviceLog.map(a => `<div class="advice"><span class="hint" style="margin:0">Day ${a.day} · ${clockStr(a.t)}</span><br>${esc(a.text)}</div>`).join('')
    : '<div class="hint" style="margin:0">No advice yet — things are going fine!</div>';
  return `<div class="hint" style="margin:0 0 8px">Complete goals in order to earn cash rewards.</div>${goals}<h4>Advisor</h4>${log}
    ${S.tutorial ? '' : '<button class="btn" data-action="tutorial-start" style="margin-top:8px">Replay tutorial</button>'}`;
}

function panelMenu() {
  return `<button class="btn" data-action="save">💾 Save game</button>
    <button class="btn" data-action="load">📂 Load game</button>
    <button class="btn danger" data-action="new">🆕 New game</button>
    <div class="hint">Scenario: ${scenario().icon} ${scenario().name}</div>
    <h4>Controls</h4>
    <div class="hint" style="margin:0;line-height:1.7">
      Drag (Inspect tool), middle-drag or two fingers: pan · Right-drag or Shift+drag: rotate and tilt · Wheel / pinch: zoom<br>
      WASD: pan · , and .: rotate · Page Up/Down: tilt · Home: reset the camera<br>
      Space: pause · 1–4: speed · Ctrl/⌘+Z: undo · G: slope view · V: cycle views · Esc: cancel<br>
      Q inspect · P piste · R route · F freeride · L lifts · B build · X demolish</div>
    <h4>How it works</h4>
    <div class="hint" style="margin:0;line-height:1.6">Guests arrive at the car park, buy a lift pass, ride lifts and ski <b>downhill</b> along pistes to the next lift or back to the village. Each piste tile's colour comes from the slope. Beginners and kids need green runs, experts want red and black, snowboarders love terrain parks and hate drag lifts. Keep queues short, hire staff, feed hungry guests, and grow your rating to attract more visitors.</div>`;
}

// ---------- snow, events, village ----------

function guestChips(g) {
  const c = [];
  if (g.reg) {
    const r = S.regulars.find(x => x.id === g.reg);
    c.push(`<span class="chip good">Regular${r ? ` · visit ${r.visits + 1}` : ''}</span>`);
    if (r && r.pass) c.push('<span class="chip">🎫 Season pass</span>');
  } else c.push('<span class="chip">First visit</span>');
  if (g.stay) c.push(`<span class="chip">${g.lux ? '🛎️ Lodge guest' : '🏡 Staying in the village'}</span>`);
  return `<div class="chips">${c.join('')}</div>`;
}

function regularsSummary() {
  const r = S.regulars;
  if (!r.length) return '<div class="hint" style="margin:0">Guests who leave happy may come back as regulars. Regulars keep their skill, so they slowly get better over the seasons.</div>';
  const sk = [0, 0, 0, 0]; r.forEach(x => sk[x.skill]++);
  const loyal = r.reduce((a, x) => a + x.loyalty, 0) / r.length;
  return `<table class="kv">
    <tr><td>Regulars on file</td><td>${r.length}</td></tr>
    <tr><td>Season pass holders</td><td>${passHolders()}</td></tr>
    <tr><td>Regulars here today</td><td>${S.stats.regularsToday} (${S.stats.passVisits} on a pass)</td></tr>
    <tr><td>Average loyalty</td><td>${pct(loyal)}</td></tr>
    <tr><td>Skill mix of regulars</td><td>${sk.map((c, k) => `${c} ${SKILLS[k].slice(0, 3)}`).join(' · ')}</td></tr>
    <tr><td>Guests who levelled up today</td><td>${S.stats.levelUps || 0}</td></tr></table>
    <div class="hint" style="margin:4px 0 0">As regulars improve they want harder runs — keep adding reds, blacks and freeride terrain.</div>`;
}

function panelSnow() {
  const rep = snowReport(), st = S.snowStats, w = WEATHER[S.weather.type];
  const cannons = countB('cannon'), garages = countB('groomer'), cap = groomCapacity();
  const sm = S.snowmaking.mode;
  const free = freerideTiles(), lv = S.avy.level;
  let freeTrack = 0;
  let freeCut = 0;
  if (free) {
    let s2 = 0;
    for (let i = 0; i < T.free.length; i++) if (T.free[i]) { s2 += T.fresh[i]; if (freeOpen() && !T.bare[i] && !(T.reach && T.reach[i])) freeCut++; }
    freeTrack = s2 / free;
  }
  const toggle = (on, action, label) => `<div class="row"><label>${label}</label><button class="btn ${on ? 'on' : ''}" data-action="${action}">${on ? 'On' : 'Off'}</button></div>`;
  return `<h4 style="margin-top:0">Snow report</h4>
    <div class="tiles">
      <div class="tile"><span class="l">Piste base</span><span class="v">${Math.round(rep.avg)} cm</span><span class="s">${w.icon} ${w.name}${S.weather.fresh ? ` · +${S.weather.fresh} cm new` : ''}</span></div>
      <div class="tile"><span class="l">Bare · thin</span><span class="v ${rep.bare ? 'neg' : ''}">${rep.bare} · ${rep.thin}</span><span class="s">of ${rep.n} piste tiles</span></div>
    </div>
    <div class="hint" style="margin:6px 0 0">Snow melts faster low down and late in the season, and busy pistes get scraped thin. Pistes under ${SNOW.bareBelow} cm close.</div>

    <h4>Snowmaking</h4>
    ${cannons ? `<div class="brush">${Object.entries(SNOW.modes).map(([k, n]) => `<button class="${sm === k ? 'on' : ''}" data-action="snowmode" data-id="${k}">${n}</button>`).join('')}</div>
      ${sm === 'auto' ? `<div class="row" style="margin-top:8px"><label>Top pistes up to</label><b id="snow-target">${S.snowmaking.target} cm</b></div>
        <input type="range" min="20" max="140" step="5" value="${S.snowmaking.target}" data-snowtarget="1">` : ''}
      <table class="kv"><tr><td>Snow cannons</td><td>${cannons} covering ${coveredPisteTiles()} piste tiles</td></tr>
      <tr><td>Made last night</td><td>${st.tooWarm ? '<span class="neg">Too warm to make snow</span>' : `${fmtNum(st.made)} cm · ${money(st.cost)}`}</td></tr>
      <tr><td>Cost</td><td>${Math.round(SNOW.costPerCm * 100)}¢ per tile per cm</td></tr></table>`
      : `<div class="hint" style="margin:0">${isUnlocked('building:cannon') ? 'Build ❄️ Snow Cannons next to pistes that melt out.' : 'Research <b>Snow Cannons</b> 🔬 to make your own snow.'}</div>`}

    <h4>Grooming</h4>
    ${garages ? `<table class="kv"><tr><td>Snowcats</td><td>${garages} · groom up to ${fmtNum(cap)} tiles a night</td></tr>
      <tr><td>Last night</td><td>${fmtNum(st.groomed)} groomed${st.ungroomed ? ` · <span class="neg">${fmtNum(st.ungroomed)} missed</span>` : ''}</td></tr>
      <tr><td>Fuel</td><td>$${SNOW.groomCost.toFixed(2)} per tile</td></tr></table>
      ${toggle(S.grooming.moguls, 'moguls', 'Leave black runs ungroomed (moguls for experts)')}`
      : `<div class="hint" style="margin:0">${isUnlocked('building:groomer') ? 'Build a 🚜 Groomer Garage. Without snowcats, pistes only recover a little each night.' : 'Research the <b>Groomer Garage</b> 🔬. Until then, pistes only recover a little each night.'}</div>`}

    <h4>Freeride & avalanches</h4>
    ${free ? `<div class="tiles">
        <div class="tile"><span class="l">Freeride zone</span><span class="v">${free}</span><span class="s">tiles · ${pct(freeTrack * 100)} untracked${freeCut ? ` · <span class="neg">${freeCut} unreachable</span>` : ''}</span></div>
        <div class="tile"><span class="l">Avalanche danger</span><span class="v" style="color:${AVY_COLORS[lv]}">${lv} / 5</span><span class="s">${AVY_LEVELS[lv]}${S.freeride.closedToday ? ' · zones closed' : ''}</span></div>
      </div>
      ${toggle(S.freeride.open, 'free-open', 'Freeride zones open')}
      ${toggle(S.freeride.control, 'free-control', `Avalanche control (blasting from danger 3, ${money(FREERIDE.blastCost)}/tile)`)}
      <div class="row"><label>Close zones automatically at danger</label></div>
      <div class="brush">${[[0, 'Never'], [4, '4 High'], [5, '5 Very high']].map(([k, n]) => `<button class="${S.freeride.autoClose === k ? 'on' : ''}" data-action="free-autoclose" data-id="${k}">${n}</button>`).join('')}</div>
      <div class="hint">Danger climbs after big snowfalls, storms and warm spells. Blasting and enough ⛑️ ski patrol (1 per ${FREERIDE.patrolPer} zone tiles, on top of the lifts) make slides rare. A slide injures anyone caught and costs rating.</div>`
      : `<div class="hint" style="margin:0 0 6px">Mark ungroomed off-piste terrain with the Freeride tool. Advanced and expert skiers pay to ride fresh powder, and big zones unlock the Freeride Tour event.</div>
      <button class="btn" data-action="tool" data-id="freeride">Open the Freeride tool</button>`}`;
}

function panelEvents() {
  let h = '';
  const ev = S.event;
  if (ev) {
    const E = EVENTS[ev.id];
    const days = eventDaysAway();
    h += `<div class="card static on"><span class="ic">${E.icon}</span><span class="nm">${E.name}</span>
      <span class="pr">${ev.live ? 'Today!' : `In ${days} day${days === 1 ? '' : 's'}`}</span>
      <span class="ds">${ev.live ? `Day ${E.days - ev.left + 1} of ${E.days}. It succeeds if guests leave at least 62% happy on average.` : 'Keep meeting the requirements or the event is cancelled.'}
      ${eventReqs(ev.id).map(r => `<br><span style="color:${r.ok ? 'var(--good)' : 'var(--bad)'}">${r.ok ? '✓' : '✗'} ${r.text}</span>`).join('')}</span></div>`;
  } else h += '<div class="hint" style="margin:0 0 8px">Book an event a few days ahead. It brings crowds; if they leave happy you gain rating and sponsorship. One event at a time.</div>';
  h += '<h4>Book an event</h4>';
  for (const [k, E] of Object.entries(EVENTS)) {
    const why = eventAvailable(k);
    const reqs = eventReqs(k);
    h += `<div class="card static"><span class="ic">${E.icon}</span><span class="nm">${E.name}</span><span class="pr">${money(E.cost)}</span>
      <span class="ds">${E.desc}<br>${E.days > 1 ? `${E.days} days · ` : ''}+${pct(E.demand * 100)} visitors · ${E.prep} day${E.prep > 1 ? 's' : ''} to prepare${E.sponsor ? ` · sponsor ${money(E.sponsor)}` : ''} · rating +${E.rep[0]} / −${E.rep[1]}
      ${reqs.map(r => `<br><span style="color:${r.ok ? 'var(--good)' : 'var(--muted)'}">${r.ok ? '✓' : '○'} ${r.text}</span>`).join('')}
      ${why && why !== 'Requirements not met' ? `<br><span style="color:var(--bad)">${why}</span>` : ''}${S.eventWins[k] ? `<br>🏅 Held successfully ${S.eventWins[k]}×` : ''}</span>
      <span class="act"><button class="btn ${why ? '' : 'primary'}" data-action="event-book" data-id="${k}" ${why ? 'disabled' : ''}>Book</button></span></div>`;
  }
  if (S.eventLog.length) {
    h += '<h4>Past events</h4>' + S.eventLog.map(e => `<div class="list-item"><span>${EVENTS[e.id].icon}</span><span class="grow">${EVENTS[e.id].name}</span>
      <span style="font-size:12px;color:${e.ok ? 'var(--good)' : 'var(--bad)'}">Y${e.year} D${e.day} · ${e.score}% · ${e.ok ? 'success' : 'flop'}</span></div>`).join('');
  }
  return h;
}

function panelVillage() {
  const pb = privateBuildings();
  const counts = {};
  pb.forEach(b => counts[b.type] = (counts[b.type] || 0) + 1);
  const last = S.fin.history[S.fin.history.length - 1];
  const chance = growthChance(last ? last.guests : 0);
  const types = Object.entries(BUILDING_TYPES).filter(([, B]) => B.private);
  return `<div class="hint" style="margin:0 0 8px">Private developers build chalets, shops and apartments in the village when your resort is busy and well rated. You don't pay for them — they pay you a lease every night, and their guests ski with you.</div>
    <div class="tiles">
      <div class="tile"><span class="l">Beds</span><span class="v">${fmtNum(villageBeds())}</span><span class="s">${pb.length} private building${pb.length === 1 ? '' : 's'}</span></div>
      <div class="tile"><span class="l">Lease income</span><span class="v pos">${money(S.village.lastLease)}</span><span class="s">last night</span></div>
    </div>
    <h4>Lease rate</h4>
    <div class="brush">${Object.entries(VILLAGE_LEASE).map(([k, L]) => `<button class="${S.village.lease === k ? 'on' : ''}" data-action="lease" data-id="${k}">${L.name} · ${money(L.perBed)}/bed</button>`).join('')}</div>
    <div class="hint">A low lease attracts developers faster; a high one earns more per bed but the village grows slowly.</div>
    <table class="kv">
      <tr><td>Chance of a new building tonight</td><td>${pct(chance * 100)}</td></tr>
      ${S.cache.value < 30 ? '<tr><td colspan="2" class="hint">Developers want more lifts, runs and facilities before they invest.</td></tr>' : ''}
      ${S.village.full ? '<tr><td colspan="2" class="neg">No free village space left for developers</td></tr>' : ''}</table>
    <h4>What developers build</h4>
    ${types.map(([k, B]) => `<div class="list-item"><span>${B.icon}</span><span class="grow">${B.name}${B.beds ? ` · ${B.beds} beds` : ''}</span>
      <span style="font-size:12px;color:${S.reputation >= B.minRep ? 'var(--muted)' : 'var(--bad)'}">${counts[k] || 0} built · needs ${B.minRep}% rating${B.minGuests ? `, ${B.minGuests} guests/day` : ''}</span></div>`).join('')}
    <div class="hint">Developers keep lift stations and the entrance road clear. Use Demolish to buy a building out if it is in your way.</div>`;
}

// ---------- actions ----------

function onAction(e) {
  const el = e.target.closest('[data-action]');
  if (!el || !S || el.disabled) return;
  const a = el.dataset.action, id = el.dataset.id;
  switch (a) {
    case 'lifttype': if (isUnlocked('lift:' + id)) { UI.liftType = id; UI.liftStart = null; renderSubmenu(); } break;
    case 'buildtype': if (isUnlocked('building:' + id)) { UI.buildType = id; renderSubmenu(); } break;
    case 'brush': UI.brush = +id; renderSubmenu(); break;
    case 'routediff': UI.route.maxDiff = +id; renderSubmenu(); break;
    case 'view': setView(id); break;
    case 'close-info': select(null); break;
    case 'close-panel': closePanel(); break;
    case 'follow': UI.follow = UI.follow === +id ? null : +id; renderInfo(); break;
    case 'toggle-lift': { const l = S.lifts.find(x => x.id === +id); l.open = !l.open; recalcValue(); renderInfo(); break; }
    case 'rename-lift': { const l = S.lifts.find(x => x.id === +id); const n = prompt('Lift name', l.name); if (n) l.name = n.slice(0, 30); renderInfo(); break; }
    case 'refurb': refurbishLift(+id); renderInfo(); break;
    case 'upgrade': {
      const l = S.lifts.find(x => x.id === +id);
      if (confirm(`Upgrade ${l.name} to a ${LIFT_TYPES[el.dataset.type].name}?`)) upgradeLift(+id, el.dataset.type);
      renderInfo(); break;
    }
    case 'demolish-lift': { const l = S.lifts.find(x => x.id === +id); if (confirm(`Demolish ${l.name}?`)) { demolishLift(l.id); select(null); } break; }
    case 'demolish-building': if (confirm('Demolish this building?')) { demolishBuilding(+id); select(null); } break;
    case 'pick-guest': { const g = S.guests.find(x => x.id === +id); if (g) { select({ kind: 'guest', id: g.id }); centerCamOn(guestPos(g).x * TILE, guestPos(g).y * TILE); } break; }
    case 'pick-lift': { const l = S.lifts.find(x => x.id === +id); select({ kind: 'lift', id: l.id }); centerCamOn((l.bx + l.tx + 1) / 2 * TILE, (l.by + l.ty + 1) / 2 * TILE); break; }
    case 'staff': hireStaff(id, +el.dataset.d); renderPanel(true); break;
    case 'freemode': UI.freeMode = id; renderSubmenu(); break;
    case 'snowmode': S.snowmaking.mode = id; renderPanel(true); break;
    case 'moguls': S.grooming.moguls = !S.grooming.moguls; renderPanel(true); break;
    case 'free-open': setFreerideOpen(!S.freeride.open); renderPanel(true); break;
    case 'free-control': S.freeride.control = !S.freeride.control; renderPanel(true); break;
    case 'free-autoclose': S.freeride.autoClose = +id; renderPanel(true); break;
    case 'event-book': scheduleEvent(id); renderPanel(true); break;
    case 'lease': S.village.lease = id; renderPanel(true); break;
    case 'tool': selectTool(id); break;
    case 'campaign': launchCampaign(id); renderPanel(true); break;
    case 'night-install': installNightSkiing(); renderPanel(true); break;
    case 'night-toggle': toggleNightSkiing(); renderPanel(true); break;
    case 'funding': S.research.funding = +id; renderPanel(true); break;
    case 'research': S.research.current = id; renderPanel(true); break;
    case 'invest': investResearch(+id); renderPanel(true); break;
    case 'loan': takeLoan(+id); renderPanel(true); break;
    case 'repay': repayLoan(+id); renderPanel(true); break;
    case 'save': saveGame(false); break;
    case 'load': if (loadGame()) { toast('📂 Game loaded'); afterLoad(); } else toast('No saved game found', true); break;
    case 'new': closePanel(); S.paused = true; showStart(true); break;
    case 'pick-scenario': UI.startScenario = id; document.querySelectorAll('.scenario').forEach(b => b.classList.toggle('on', b.dataset.id === id)); break;
    case 'start-new':
      newGame(null, UI.startScenario); afterLoad(); hideModal();
      if ($('#tut-check') && $('#tut-check').checked) startTutorial();
      break;
    case 'start-continue': if (loadGame()) afterLoad(); else newGame(); hideModal(); break;
    case 'modal-close': hideModal(); S.paused = false; break;
    case 'tutorial-start': closePanel(); startTutorial(); break;
    case 'tutorial-skip': S.tutorial = null; renderTutorial(); break;
    case 'tutorial-next': advanceTutorial(); break;
    case 'dismiss-advisor': $('#advisor').classList.add('hidden'); break;
    case 'open-goals': if (UI.panel !== 'goals') togglePanel('goals'); break;
  }
}

function onInput(e) {
  const k = e.target.dataset.price;
  if (k && S) { S.prices[k] = +e.target.value; updatePrices(); }
  if (e.target.dataset.snowtarget && S) { S.snowmaking.target = +e.target.value; const v = $('#snow-target'); if (v) v.textContent = S.snowmaking.target + ' cm'; }
}

function afterLoad() {
  select(null);
  UI.follow = null;
  Undo.stack = [];
  const l = S.lifts[0];
  if (l) resetCamera(l.bx + 0.5, l.by - 6); else resetCamera(ENTRANCE.x, MAP_H - 12);
  UI.camMoved = false;
  setView('none');
  renderSubmenu();
  renderPanel(true);
  renderTutorial();
  refreshTopbar();
}

// ---------- tutorial ----------

const TUTORIAL = [
  { text: 'Welcome to your valley! <b>Drag</b> to move around, <b>right-drag</b> to turn and tilt the view, and <b>scroll</b> to zoom. On a touch screen: drag with two fingers, twist to turn, pinch to zoom.', check: () => UI.camMoved },
  { text: 'Open <b>🗺️ Views</b> in the toolbar and pick <b>Slope difficulty</b> (or press <b>G</b>). Green is gentle, black is steep, purple is too steep to ski.', check: () => R.view === 'slope' },
  { text: 'Select <b>🛣️ Route</b>. Click a spot high up the mountain, then click in the village below. A whole piste is painted along the gentlest line.', check: b => pisteCount() >= b.pistes + 8 },
  { text: 'Now a lift: <b>🚡 Lifts → Rope Tow</b>. Click in the village at the bottom of your new run, then click up the slope near the top of it.', check: b => S.lifts.length > b.lifts },
  { text: 'Every lift needs a piste touching its <b>top station</b>, or it shows ⚠️. Paint one with ⛷️ Piste if needed. Made a mistake? Press <b>↩️ Undo</b>.', check: () => S.lifts.length >= 2 && S.lifts.every(l => l.usable) },
  { text: 'Hungry skiers spend money. Open <b>🏠 Build</b> and place a <b>☕ Café</b> right next to a piste.', check: () => S.buildings.some(b => BUILDING_TYPES[b.type].kind === 'food' && [...Net.adj.values()].some(a => a.includes(b))) },
  { text: 'Open <b>👷 Staff</b> in the top bar. Mechanics fix broken lifts, ski patrol rescues injured skiers and controls avalanches.', check: () => UI.panel === 'staff' },
  { text: 'Open <b>🎟️ Prices</b> to set your lift pass. The hint shows how many visitors are willing to pay.', check: () => UI.panel === 'prices' },
  { text: 'You\'re ready! Press <b>⏩</b> to speed up time, follow the <b>🎯 Goals</b>, try <b>📣 Marketing</b>, and listen to the 🧑‍💼 advisor. Have fun!', manual: true },
];

function pisteCount() { let n = 0; for (let i = 0; i < T.piste.length; i++) n += T.piste[i]; return n; }

function startTutorial() {
  S.tutorial = { step: 0, base: { pistes: pisteCount(), lifts: S.lifts.length } };
  UI.camMoved = false;
  renderTutorial();
}

function advanceTutorial() {
  const t = S.tutorial;
  if (!t) return;
  t.step++;
  t.base = { pistes: pisteCount(), lifts: S.lifts.length };
  if (t.step >= TUTORIAL.length) { S.tutorial = null; toast('🎓 Tutorial complete!'); }
  renderTutorial();
}

function checkTutorial() {
  const t = S.tutorial;
  if (!t) return;
  const st = TUTORIAL[t.step];
  if (st && !st.manual && st.check(t.base)) advanceTutorial();
}

function renderTutorial() {
  const el = $('#tutorial');
  const t = S && S.tutorial;
  document.body.classList.toggle('has-tut', !!(t && TUTORIAL[t.step]));
  if (!t || !TUTORIAL[t.step]) { el.classList.add('hidden'); return; }
  const st = TUTORIAL[t.step];
  el.innerHTML = `<div class="tut-head">Tutorial · step ${t.step + 1} of ${TUTORIAL.length}</div><div>${st.text}</div>
    <div class="tut-actions">${st.manual ? '<button class="btn primary" data-action="tutorial-next">Finish</button>' : ''}
    <button class="btn" data-action="tutorial-skip">Skip tutorial</button></div>`;
  el.classList.remove('hidden');
}

// ---------- periodic refresh ----------

function setStat(id, lbl, val) {
  const el = $(id);
  if (lbl != null) el.querySelector('.lbl').textContent = lbl;
  el.querySelector('.val').innerHTML = val;
}

// Progress text for the current goal, shown in the chip under the top bar.
function goalProgress(g) {
  const today = INCOME_KEYS.reduce((a, k) => a + (S.fin.today[k] || 0), 0) - EXPENSE_KEYS.reduce((a, k) => a + (S.fin.today[k] || 0), 0);
  if (/guests visit in one day/.test(g.text)) return `Today ${S.stats.guestsToday}`;
  if (/600 guests/.test(g.text)) return `${S.stats.guestsToday} today · ${pct(S.reputation)}`;
  if (/rating/.test(g.text)) return `Now ${pct(S.reputation)}`;
  if (/profit/.test(g.text)) return `Today ${money(today)}`;
  if (/difficulties/.test(g.text)) return `${S.cache.diffsOpen} of 3`;
  return '';
}

function refreshTopbar() {
  if (!S) return;
  document.documentElement.style.setProperty('--tb', $('#topbar').offsetHeight + 'px');
  setStat('#st-money', null, money(S.money));
  $('#st-money').classList.toggle('neg', S.money < 0);
  const open = liftsOpen() ? (isNightSession() ? ' <small>night</small>' : '') : S.minute < OPEN_TIME ? ' <small>opening</small>' : ' <small>closed</small>';
  setStat('#st-date', `Year ${S.year} · Day ${S.day}/${DAYS_PER_SEASON}`, clockStr(S.minute) + open);
  const w = WEATHER[S.weather.type];
  const sr = snowReport();
  const avy = freerideTiles() && S.avy.level >= 3 ? ` · Avalanche ${S.avy.level}/5` : '';
  setStat('#st-weather', w.name + avy, `${Math.round(sr.n ? sr.avg : S.weather.snow)} cm${S.weather.fresh ? ` <small>+${S.weather.fresh}</small>` : ''}${sr.bare ? ` <small class="neg">${sr.bare} bare</small>` : ''}`);
  setStat('#st-guests', null, `${S.guests.length} · ${S.stats.guestsToday}`);
  const d = S.reputation - S.stats.repStart;
  setStat('#st-rating', null, `${pct(S.reputation)}${Math.abs(d) < 0.05 ? '' : ` <small class="${d >= 0 ? 'pos' : 'neg'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}</small>`}`);
  document.querySelectorAll('#speed [data-speed]').forEach(b => {
    const s = +b.dataset.speed;
    b.classList.toggle('on', s === 0 ? S.paused : !S.paused && S.speed === s);
  });
  $('#toolbar [data-toggle=undo]').classList.toggle('dim', !Undo.stack.length);
  const g = GOALS.find(x => !S.goals[x.id]);
  $('#goalchip').classList.toggle('hidden', !g);
  if (g) {
    $('#goal-text').textContent = g.text;
    const p = goalProgress(g);
    $('#goal-prog').textContent = p;
    $('#goal-prog').classList.toggle('hidden', !p);
  }
}

function refreshUI() {
  if (!S) return;
  refreshTopbar();
  if (Sel.kind) renderInfo();
  if (UI.panel && !UI.drag) renderPanel(false);
  if (!$('#minimap-wrap').classList.contains('collapsed') && R.base) drawMinimap($('#minimap'));
  checkTutorial();
}

// ---------- toasts & modals ----------

let advisorTimer = 0;
function showAdvisor(text) {
  const el = $('#advisor');
  el.innerHTML = `<div class="adv-ic"><svg class="i" viewBox="0 0 24 24" aria-hidden="true" style="width:18px;height:18px"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg></div>
    <div class="adv-body"><b>Advisor</b><span>${esc(text)}</span></div>
    <button class="x" data-action="dismiss-advisor" aria-label="Dismiss tip"><svg class="i" viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  el.classList.remove('hidden');
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(advisorTimer);
  advisorTimer = setTimeout(() => el.classList.add('hidden'), 12000);
}

function toast(text, bad, big, advisor) {
  if (advisor) { showAdvisor(text.replace(/^🧑‍💼\s*/, '')); return; }
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '') + (big ? ' big' : '') + (advisor ? ' advisor' : '');
  el.textContent = text;
  $('#toasts').appendChild(el);
  while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
  setTimeout(() => el.remove(), big || advisor ? 7000 : 3200);
}

function showModal(html) { const m = $('#modal'); m.innerHTML = `<div class="dialog">${html}</div>`; m.classList.remove('hidden'); }
function hideModal() { $('#modal').classList.add('hidden'); }

function onDayEnd({ summary: s, seasonEnd }) {
  const rd = s.repDelta;
  toast(`🌙 Day ${s.day} closed · ${s.guests} guests · ${s.profit >= 0 ? 'profit' : 'loss'} ${money(s.profit)} · rating ${rd >= 0 ? '▲' : '▼'} ${Math.abs(rd).toFixed(1)}`, s.profit < 0);
  const w = WEATHER[S.weather.type];
  if (S.weather.fresh) toast(`${w.icon} ${S.weather.fresh} cm of fresh snow overnight!`);
  if (seasonEnd) {
    const season = S.fin.history.filter(d => d.year === S.year - 1);
    const guests = season.reduce((a, d) => a + d.guests, 0);
    const profit = season.reduce((a, d) => a + d.profit, 0);
    S.paused = true;
    showModal(`<h1>End of season ${S.year - 1}</h1><div class="tag">The snow melts, the lifts rest. Summer flies by…</div>
      <table class="kv"><tr><td>Visitors this season</td><td>${guests.toLocaleString()}</td></tr>
      <tr><td>Season profit (last ${season.length} days)</td><td class="${profit >= 0 ? 'pos' : 'neg'}">${money(profit)}</td></tr>
      <tr><td>Resort rating</td><td>${pct(S.reputation)}</td></tr><tr><td>Cash</td><td>${money(S.money)}</td></tr></table>
      <div class="actions"><button class="btn primary" data-action="modal-close">Start season ${S.year}</button></div>`);
  }
  if (Sel.kind) renderInfo();
}

function showWin() {
  S.paused = true;
  showModal(`<h1>You built a legendary resort!</h1><div class="tag">600 guests in a day and an 80% rating — the Alps are talking about you.</div>
    <p>You can keep playing and expanding as long as you like.</p>
    <div class="actions"><button class="btn primary" data-action="modal-close">Keep playing</button></div>`);
}

function showStart(fromMenu) {
  const cont = hasSave() && !fromMenu;
  const firstTime = !hasSave();
  showModal(`<h1>Ski Resort Tycoon</h1><div class="tag">Build lifts, carve pistes and turn a quiet valley into a world-class ski resort.</div>
    <h4 class="modal-h">Choose a scenario</h4>
    <div class="scenarios">${Object.entries(SCENARIOS).map(([k, sc]) => `<button class="scenario ${UI.startScenario === k ? 'on' : ''}" data-action="pick-scenario" data-id="${k}">
      <span class="sc-ic">${sc.icon}</span><b>${sc.name}</b><span class="sc-money">${money(sc.money)}</span><span class="sc-desc">${sc.desc}</span></button>`).join('')}</div>
    <label class="check"><input type="checkbox" id="tut-check" ${firstTime ? 'checked' : ''}> Show the step-by-step tutorial</label>
    <div class="actions">
      <button class="btn primary" data-action="start-new">Start new resort</button>
      ${cont ? '<button class="btn" data-action="start-continue">Continue saved resort</button>' : ''}
      ${fromMenu ? '<button class="btn" data-action="modal-close">Cancel</button>' : ''}
    </div>`);
}
