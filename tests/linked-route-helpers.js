'use strict';
// Read-only plan. Consumers deliver these edges with Game.key or trusted keyboard input.
function linkedRouteController() {
  let target = '', phase = '';
  return g => {
    const previous = g.objects.find(o => o.id === target);
    const o = previous && g.mode === 'air' ? previous : g.objects.find(o =>
      o.type !== 'crack' && o.direction !== 'down' && !o.landingOnly && o.id !== g.surface &&
      o.x + o.width + 25 > g.worldX && (o.x > g.worldX || o.type === 'low_bar'));
    if (o && o.id !== target) { target = o.id; phase = ''; }
    const d = o ? o.x - g.worldX : Infinity;
    const keys = { Right: !!o?.speedRequired && d > (o.popDistance || 110) + g.currentSpeed * 1.35 &&
      g.mode === 'rolling' && !g.surface, Down: o?.type === 'low_bar' && d < 150,
      Up: g.mode === 'air' && o?.type === 'rail', Left: g.balanceActive && g.balance > .04 };
    if (o && o.type !== 'low_bar' && g.grounded) {
      if (o.charged && !phase && d <= (o.popDistance || 110) + g.currentSpeed * 1.35) phase = 'loading';
      if (phase === 'loading' && d <= (o.popDistance || 110) + 2) phase = 'jumped';
    }
    keys.Space = phase === 'loading';
    return { keys, target, phase };
  };
}
if (typeof module !== 'undefined') module.exports = { linkedRouteController };
