// Drag the orb anywhere; a press without movement opens the panel.
(function () {
  const orb = document.getElementById('orb');
  let down = null, moved = 0;
  orb.addEventListener('pointerdown', (e) => { down = { x: e.screenX, y: e.screenY }; moved = 0; orb.setPointerCapture(e.pointerId); });
  orb.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.screenX - down.x, dy = e.screenY - down.y;
    if (dx || dy) { moved += Math.abs(dx) + Math.abs(dy); window.findable.orbDrag(dx, dy); down = { x: e.screenX, y: e.screenY }; }
  });
  orb.addEventListener('pointerup', () => { if (!down) return; down = null; if (moved < 4) window.findable.orbClick(); else window.findable.orbDragEnd(); });
  orb.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.findable.orbClick(); } });
})();
