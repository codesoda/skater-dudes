'use strict';

// Browser-only planning margin for polling, trusted key transport and the input
// queue. This changes when loading starts, never the pop position or physics.
function shouldLoadCharge(object, state, settings) {
  if (!object.charged || !['rolling', 'manual'].includes(state.mode)) return false;
  // Do not begin a hold on a tread/platform that ends before the pop. Falling
  // and landing clears Space intent even while the physical key remains down.
  const popX = object.x - (object.popDistance || 110);
  if (state.surface && !(state.supportEnd >= popX)) return false;
  const holdSeconds = settings.tapThreshold + settings.fullChargeTime + .45;
  return object.x - state.x <= (object.popDistance || 110) + state.speed * holdSeconds;
}

module.exports = { shouldLoadCharge };
