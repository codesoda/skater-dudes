'use strict';

// Test-controller timing only. Start the trusted stroke about 300 ms before
// crossing, not at a fixed height. The extra 20 ms covers polling quantization.
const RAIL_CATCH_HORIZON = .32;
function railCrossingSeconds(object, state, settings) {
  if (object.type !== 'rail' || state.mode !== 'air' || state.velocity >= 0 || state.z <= object.height) return null;
  const fallSpeed = -state.velocity;
  return 2 * (state.z - object.height) /
    (Math.sqrt(fallSpeed * fallSpeed + 2 * settings.gravity * (state.z - object.height)) + fallSpeed);
}
function shouldCatchRail(object, state, settings) {
  const crossing = railCrossingSeconds(object, state, settings);
  return crossing !== null && crossing <= RAIL_CATCH_HORIZON;
}
module.exports = { RAIL_CATCH_HORIZON, railCrossingSeconds, shouldCatchRail };
