'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../web/core.js');
const settings = require('../settings.json');
const course = require('../course.json');
const { shouldLoadCharge } = require('./route-charged-jump.js');

function frames(game, count) {
  for (let i = 0; i < count; i++) game.step(1 / settings.fixedHz);
}

test('charged browser planning derives intent and charge time from settings, plus 450 ms transport margin', () => {
  const object = { x: 2000, charged: true, popDistance: 130 };
  for (const cfg of [settings, { ...settings, tapThreshold: .4, fullChargeTime: .8 }]) {
    for (const speed of [280, 392]) {
      const distance = object.popDistance + speed * (cfg.tapThreshold + cfg.fullChargeTime + .45);
      const state = { x: object.x - distance + 1e-9, speed, mode: 'rolling' };
      assert.equal(shouldLoadCharge(object, state, cfg), true);
      assert.equal(shouldLoadCharge(object, { ...state, x: state.x - 1 }, cfg), false);
      for (const mode of ['air', 'grind', 'crash']) {
        assert.equal(shouldLoadCharge(object, { ...state, mode }, cfg), false);
      }
      assert.equal(shouldLoadCharge({ ...object, charged: false }, state, cfg), false);
    }
  }
});

test('early charged planning waits until the descending tread has landed, without changing its target', () => {
  const object = course.objects.find(o => o.id === 'jersey-after-climb');
  const g = new Game(settings, course); g.restart();
  // Isolated last-tread setup, matching the recorded trusted browser failure.
  g.worldX = 14990; g.jumpZ = 20; g.surface = 'climb-down:10';
  let phase = '', starts = 0;
  while (g.worldX < object.x && g.time < 3 && phase !== 'jumped') {
    const support = g.surface && g.objects.flatMap(o => g.solidParts(o)).find(o => o.id === g.surface);
    const s = { x: g.worldX, speed: g.currentSpeed, mode: g.mode, surface: g.surface,
      supportEnd: support ? support.x + support.width + settings.boardHalfWidth : null };
    if (!phase && shouldLoadCharge(object, s, settings)) {
      assert.equal(s.surface, null); assert.equal(g.jumpZ, 0);
      frames(g, 3); // 50 ms combined response/key delay after landing.
      g.key('Space', true); starts++; phase = 'loading';
    } else if (phase === 'loading' && object.x - s.x <= (object.popDistance || 110) + 12) {
      assert.equal(g.charge, 1); g.key('Space', false); phase = 'jumped';
    }
    frames(g, 1); assert.equal(g.bails, 0);
  }
  assert.equal(phase, 'jumped'); assert.equal(starts, 1); assert.equal(g.popCharge, 1);
  const elevated = { x: 12000, speed: 280, mode: 'rolling', surface: 'climb-3', supportEnd: 14000 };
  assert.equal(shouldLoadCharge({ x: 12300, charged: true }, elevated, settings), true);
});

test('charged hold stays full at the unchanged pop mark with 50–150 ms observer and key transport', () => {
  const source = course.objects.find(o => o.type === 'jersey_barrier');
  for (const delayFrames of [3, 6, 9]) for (const speed of [280, 392]) {
    const object = { ...source, x: 1400 };
    const g = new Game(settings, { length: 3000, checkpoints: [0], objects: [object] });
    g.restart(); g.currentSpeed = speed; // Isolated carried-speed fixture only.
    let phase = '', downAt;
    while (g.time < 8 && phase !== 'jumped') {
      const s = { x: g.worldX, speed: g.currentSpeed, mode: g.mode, charge: g.charge };
      if (!phase && shouldLoadCharge(object, s, settings)) {
        frames(g, delayFrames); // State response reaches the controller late.
        frames(g, delayFrames); // Trusted key transport/queue before application.
        assert.equal(g.grounded, true);
        g.key('Space', true); downAt = g.time; phase = 'loading';
      } else if (phase === 'loading' && object.x - s.x <= (object.popDistance || 110) + 12) {
        // Same strict pre-release assertion and position as the browser route.
        assert.equal(s.charge, 1, `delay=${delayFrames / settings.fixedHz}s, speed=${speed}`);
        assert.ok(g.time - downAt >= settings.tapThreshold + settings.fullChargeTime - 1e-8);
        g.key('Space', false); phase = 'jumped';
        assert.equal(g.popCharge, 1); assert.equal(g.velocityZ, settings.fullPopVelocity);
      }
      frames(g, 1);
      assert.equal(g.bails, 0);
    }
    assert.equal(phase, 'jumped');
  }
});
