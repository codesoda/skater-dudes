'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../settings.json');
const { RAIL_CATCH_HORIZON, railCrossingSeconds, shouldCatchRail } = require('./route-rail-catch.js');
const rail = { type: 'rail', height: 60 };
function atCrossing(seconds, velocity = -100, height = rail.height, gravity = settings.gravity) {
  return { mode: 'air', velocity, z: height - velocity * seconds + gravity * seconds * seconds / 2 };
}

test('mobile catch planning uses descending crossing time, not the stale 145px height', () => {
  const state = atCrossing(.31);
  assert.ok(state.z > 145);
  assert.ok(Math.abs(railCrossingSeconds(rail, state, settings) - .31) < 1e-10);
  assert.equal(shouldCatchRail(rail, state, settings), true);
  assert.equal(shouldCatchRail(rail, atCrossing(.321), settings), false);
  for (const invalid of [{ mode: 'rolling' }, { velocity: 0 }, { velocity: 100 }, { z: 60 }, { z: 59 }]) {
    assert.equal(shouldCatchRail(rail, { ...state, ...invalid }, settings), false);
  }
  assert.equal(shouldCatchRail({ ...rail, type: 'ledge' }, state, settings), false);
  const cfg = { ...settings, gravity: 1200 }, higherRail = { ...rail, height: 90 };
  assert.ok(Math.abs(railCrossingSeconds(higherRail, atCrossing(.31, -150, 90, cfg.gravity), cfg) - .31) < 1e-10);
});

test('320ms horizon covers 50–150ms total input transport plus three 17ms waits within the 350ms pulse', () => {
  assert.equal(RAIL_CATCH_HORIZON, .32);
  // Model the observer arriving up to two fixed steps after the horizon. The
  // third/final move first exceeds Pan's 12px threshold on the unchanged 40px
  // stroke. Treat ALL transport as pre-activation, which is conservative.
  for (const transport of [.05, .1, .15]) for (const pollLag of [0, 1 / 60, 2 / 60]) {
    const remaining = RAIL_CATCH_HORIZON - pollLag - 1e-9; // Just inside the floating-point boundary.
    const state = atCrossing(remaining);
    assert.equal(shouldCatchRail(rail, state, settings), true);
    const activation = transport + 3 * .017;
    // Semi-implicit fixed integration crosses earlier than the analytic root.
    // Step only local numeric fixture data, never game inputs or game physics.
    let z = state.z, velocity = state.velocity, crossing = 0;
    while (z > rail.height) { velocity -= settings.gravity / 60; z += velocity / 60; crossing += 1 / 60; }
    assert.ok(activation < crossing, `activation=${activation}, crossing=${crossing}`);
    assert.ok(crossing < activation + .35, 'Unchanged bounded catch must still cover the crossing');
    assert.ok(crossing - activation >= .065, 'Keep at least 65ms delivery headroom');
  }
});

test('old late height trigger leaves no delivery headroom at 150ms transport', () => {
  const old = { mode: 'air', z: 144, velocity: -333.333 };
  assert.ok(railCrossingSeconds(rail, old, settings) < .15 + 3 * .017);
});
