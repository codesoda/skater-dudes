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

test('Dave curb preparation tolerates 50–150 ms keydown transport and 50–100 ms release transport, then retries the cone', () => {
  // A release delayed 150 ms from the 70 px mark cannot safely clear an 18 px
  // curb. Test the actual budget, not an impossible arbitrary-latency promise.
  for (const downFrames of [3, 6, 9]) for (const upFrames of [3, 6]) {
    const g = new Game(settings, course); g.selectCharacter('dave'); g.restart();
    const curb = course.objects.find(o => o.id === 'hazard-0');
    let phase = '', downAt, heldSeconds;
    while (g.worldX < 2200 && g.time < 10) {
      const next = lightJumpPhase(phase, curb.x - g.worldX, g.currentSpeed);
      if (next !== phase && g.grounded) {
        // Includes stale read response, key command transport and input queue.
        frames(g, next === 'light-ready' ? downFrames : upFrames);
        assert.equal(g.charge, 0); assert.equal(g.chargeVisible, false);
        g.key('Space', next === 'light-ready');
        if (next === 'light-ready') downAt = g.time;
        else {
          heldSeconds = g.time - downAt;
          assert.equal(g.popCharge, 0); assert.equal(g.velocityZ, settings.lightPopVelocity);
        }
        phase = next;
      }
      frames(g, 1);
      assert.equal(g.bails, 0, `keydown=${downFrames}, keyup=${upFrames}`);
    }
    assert.equal(phase, 'jumped'); assert.ok(g.worldX >= 2200);
    assert.ok(heldSeconds > 0 && heldSeconds < settings.tapThreshold);
    const banked = g.score, best = g.bestCombo; assert.ok(banked > 0);
    while (g.worldX < 2580) frames(g, 1);
    g.key('Up', true);
    while (g.mode !== 'crash' && g.time < 12) frames(g, 1);
    assert.equal(g.mode, 'crash'); assert.equal(g.bails, 1);
    assert.ok(g.worldX > 2600 && g.worldX < 2700, 'real next-cone collision');
    assert.equal(g.score, banked); assert.equal(g.combo, 0);
    g.key('Up', false);
    while (g.mode === 'crash') frames(g, 1);
    assert.equal(g.worldX, 1958); assert.equal(g.jumpZ, 0); assert.equal(g.characterId, 'dave');
    assert.equal(g.bestCombo, best); assert.ok(!g.hazards.some(o => g.overlapping(o)));
    const recoveredAt = g.time;
    while (g.mode !== 'crash' && g.time - recoveredAt < 4) frames(g, 1);
    assert.equal(g.bails, 2); assert.ok(g.time - recoveredAt >= 1.4);
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
