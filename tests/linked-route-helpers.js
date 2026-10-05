'use strict';
const { routeTarget } = require('./route-target.js');
const { shouldLoadCharge } = require('./route-charged-jump.js');
const { lightJumpPhase } = require('./route-light-jump.js');
const settings = require('../settings.json');
// Read-only plan. Consumers deliver these edges with Game.key or trusted keyboard input.
function linkedRouteController() {
  let target = '', phase = '';
  return g => {
    const support = g.surface && g.solidParts && g.objects.flatMap(o => g.solidParts(o)).find(o => o.id === g.surface);
    const state = { x: g.worldX, speed: g.currentSpeed, mode: g.mode, surface: g.surface,
      supportEnd: support ? support.x + support.width + settings.boardHalfWidth : g.supportEnd };
    const o = routeTarget(g.objects.filter(o => !o.landingOnly), state, target);
    if (o && o.id !== target) { target = o.id; phase = ''; }
    const d = o ? o.x - g.worldX : Infinity;
    const keys = { Right: !!o?.speedRequired && d > (o.popDistance || 110) + g.currentSpeed * 1.35 &&
      g.mode === 'rolling' && !g.surface, Down: o?.type === 'low_bar' && d < 150,
      Up: g.mode === 'air' && (o?.type === 'rail' || o?.type === 'ledge' && o.intent !== 'ride'),
      Left: g.balanceActive && g.balance > .04 };
    if (o && o.type !== 'low_bar' && g.grounded) {
      if (!phase && shouldLoadCharge(o, state, settings)) phase = 'loading';
      if (phase === 'loading' && d <= (o.popDistance || 110) + 2) phase = 'jumped';
      if (!o.charged) phase = lightJumpPhase(phase, d, g.currentSpeed);
    }
    keys.Space = phase === 'loading' || phase === 'light-ready';
    return { keys, target, phase };
  };
}
if (typeof module !== 'undefined') module.exports = { linkedRouteController };
