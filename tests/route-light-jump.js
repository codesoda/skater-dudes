'use strict';

// Route-only timing scales with observed speed, including carried momentum.
// At base speed, release at 70 px gives (70 - boardHalfWidth 22) / 280
// = 171 ms before contact. A 30 px cone needs ~82 ms of rise at v=420.
// Scale both marks to preserve the nominal 179 ms hold below 300 ms intent.
// Do not add a second timed/polled wait after reaching the release window.
function lightJumpPhase(phase, distance, speed = 280) {
  const scale = speed / 280;
  if (!phase && distance <= 120 * scale) return 'light-ready';
  if (phase === 'light-ready' && distance <= 70 * scale) return 'jumped';
  return phase;
}

module.exports = { lightJumpPhase };
