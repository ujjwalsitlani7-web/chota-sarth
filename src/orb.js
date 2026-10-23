// Click the orb to open Chota Sarth. Drag it to move it. Press and hold it to talk.
(function () {
  const orb = document.getElementById('orb');
  let down = null, moved = 0, holdTimer = null, holding = false;
  orb.addEventListener('pointerdown', (e) => {
    down = { x: e.screenX, y: e.screenY }; moved = 0; holding = false; orb.setPointerCapture(e.pointerId);
    holdTimer = setTimeout(() => { if (moved < 4) { holding = true; window.findable.orbHoldStart(); } }, 380);
  });
  orb.addEventListener('pointermove', (e) => {
    if (!down || holding) return;
    const dx = e.screenX - down.x, dy = e.screenY - down.y;
    if (dx || dy) { moved += Math.abs(dx) + Math.abs(dy); if (moved >= 4) clearTimeout(holdTimer); window.findable.orbDrag(dx, dy); down = { x: e.screenX, y: e.screenY }; }
  });
  orb.addEventListener('pointerup', () => {
    if (!down) return; down = null; clearTimeout(holdTimer);
    if (holding) { holding = false; window.findable.orbHoldEnd(); return; }
    if (moved < 4) window.findable.orbClick(); else window.findable.orbDragEnd();
  });
  orb.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.findable.orbClick(); } });
  window.findable.onOrbState((s) => { orb.className = s && s !== 'idle' ? s : ''; orb.setAttribute('aria-label', s === 'listening' ? 'Listening' : 'Open Chota Sarth'); });
})();
