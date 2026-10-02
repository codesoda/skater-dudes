'use strict';
// Read-only route planning: retain an airborne target, then look past the
// current support to the next blocking entry, not the outer block's far exit.
function routeTarget(objects, state, current) {
  const previous = objects.find(o => o.id === current);
  if (previous && state.mode === 'air') return previous;
  return objects.find(o => o.type !== 'crack' && o.direction !== 'down' &&
    o.id !== state.surface && o.x + o.width + 25 > state.x &&
    (o.x > state.x || o.type === 'low_bar'));
}
module.exports = { routeTarget };
