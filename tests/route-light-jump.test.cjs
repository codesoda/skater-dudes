'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../web/core.js');
const settings = require('../settings.json');
const course = require('../course.json');
const { lightJumpPhase } = require('./route-light-jump.js');

const lightObjects = course.objects.filter(o => !o.charged && o.direction !== 'down' && !['crack', 'low_bar'].includes(o.type));
function fixture(object, offset = 0) {
  const obstacle = { ...object, x: 280 + offset };
  const game = new Game(settings, { length: 2000, checkpoints: [0], objects: [obstacle] });
  game.restart();
  return { game, obstacle };
}
function frames(game, count) {
  for (let i = 0; i < count; i++) game.step(1 / settings.fixedHz);
}

test('route light pop prepares early, releases at 70 px and never re-arms on the same target', () => {
  assert.equal(lightJumpPhase('', 121), '');
  assert.equal(lightJumpPhase('', 120), 'light-ready');
  assert.equal(lightJumpPhase('light-ready', 71), 'light-ready');
  assert.equal(lightJumpPhase('light-ready', 70), 'jumped');
  // Landing on a curb or dropping off its far edge must not start a new hold.
  for (const distance of [20, 0, -30, -65]) assert.equal(lightJumpPhase('jumped', distance), 'jumped');
});

test('route light pop marks scale with carried speed without adding a timed wait', () => {
  for (const speed of [320, 392]) {
    const scale = speed / 280;
    assert.equal(lightJumpPhase('', 120 * scale + 1, speed), '');
    assert.equal(lightJumpPhase('', 120 * scale, speed), 'light-ready');
    assert.equal(lightJumpPhase('light-ready', 70 * scale + 1, speed), 'light-ready');
    assert.equal(lightJumpPhase('light-ready', 70 * scale, speed), 'jumped');
  }
});
test('route light pops clear every light obstacle with modest poll and command latency, without charge', () => {
  // Isolated Node timing fixture, not a browser clock override. The real route
  // uses trusted keyboard events and the normal animation clock.
  for (const object of lightObjects) for (const pollFrames of [1, 2]) for (const offset of [0, 2, 4]) for (const speed of [280, 320, 392]) {
    const { game: g, obstacle } = fixture(object, offset);
    g.currentSpeed = speed; // Isolated carry-speed fixture; actual route uses only inputs.
    let phase = '', downAt, heldSeconds, releases = 0;
    while (g.worldX <= obstacle.x + obstacle.width + 50) {
      const distance = obstacle.x - g.worldX, mode = g.mode, observedSpeed = g.currentSpeed;
      frames(g, 1); // State-response transport: the observed position is now stale.
      if (['rolling', 'manual'].includes(mode)) {
        const next = lightJumpPhase(phase, distance, observedSpeed);
        if (next !== phase) {
          frames(g, 1); // Keyboard command transport before the event arrives.
          assert.equal(g.charge, 0); assert.equal(g.chargeVisible, false);
          g.key('Space', next === 'light-ready');
          if (next === 'light-ready') downAt = g.time;
          else {
            heldSeconds = g.time - downAt; releases++;
            assert.equal(g.popCharge, 0); assert.equal(g.velocityZ, settings.lightPopVelocity);
          }
          phase = next;
        }
      }
      frames(g, pollFrames);
      assert.equal(g.bails, 0, `${object.id}, poll=${pollFrames}, offset=${offset}, speed=${speed}`);
      assert.ok(g.time < 5, 'controller must make forward progress');
    }
    assert.equal(releases, 1);
    assert.ok(heldSeconds > 0 && heldSeconds < settings.tapThreshold, `${object.id}: ${heldSeconds}s hold`);
    assert.equal(g.keys.Space, false);
  }
});

test('a genuinely late light release still bails against the unchanged cone', () => {
  const { game: g, obstacle } = fixture(course.objects.find(o => o.id === 'added-29'));
  while (obstacle.x - g.worldX > 120) frames(g, 1);
  g.key('Space', true);
  while (obstacle.x - g.worldX > 40) frames(g, 1);
  g.key('Space', false);
  assert.equal(g.popCharge, 0);
  while (!g.bails && g.time < 2) frames(g, 1);
  assert.equal(g.bails, 1); assert.equal(g.mode, 'crash');
  assert.match(g.message, /tap SPACE a little earlier/);
});
