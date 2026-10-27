// Boot and main loop.

(function () {
  initRender(document.getElementById('game'));
  newGame();
  initUI();
  buildTerrainCanvas();
  afterLoad();
  S.paused = true;
  showStart();

  let last = performance.now();
  let lastHour = -1;
  function frame(now) {
    const rdt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!S.paused && $('#modal').classList.contains('hidden')) {
      let gdt = rdt * 2 * S.speed; // game minutes
      while (gdt > 0) { const st = Math.min(0.5, gdt); simulate(st); gdt -= st; }
    } else if (Net.dirty && !Net.hold) rebuildNetwork();
    const hour = Math.floor(S.minute / 60);
    if (hour !== lastHour) { lastHour = hour; R.overlayDirty = true; }
    keyboardPan(rdt);
    if (UI.follow) {
      const g = S.guests.find(x => x.id === UI.follow);
      if (g) { const p = guestPos(g); centerCamOn(p.x * TILE, p.y * TILE); } else UI.follow = null;
    }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
