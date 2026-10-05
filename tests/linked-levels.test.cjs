'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, Runner } = require('../web/core.js');
const settings = require('../settings.json');
const original = require('../course.json');
const { linkedRouteController } = require('./linked-route-helpers.js');
const courses = [{ id: 'night-shift', course: original }, ...['linked-lines', 'gap-attack'].map(id => ({ id, course: require('../courses/' + id + '.json') }))];
function route(entry, hz, dude) {
  const g = new Game(settings, entry.course, [entry]); g.selectCharacter(dude); g.restart();
  const runner = new Runner(g), control = linkedRouteController();
  const evidence = { supports: [], grinds: [], pops: [], events: [] }, supports = new Set();
  for (let frame = 0; frame < hz * 90 && g.status === 'playing'; frame++) {
    runner.advance(1 / hz, () => {
      const plan = control(g);
      for (const [key, pressed] of Object.entries(plan.keys)) g.key(key, !!pressed);
      for (const event of g.drainEvents()) {
        evidence.events.push([event.type, event.at]);
        if (event.type === 'ollie') evidence.pops.push([plan.target, g.jumpZ, g.currentSpeed, g.popCharge]);
        if (event.type === 'grind') evidence.grinds.push(g.surface);
      }
      if (g.surface && g.grounded) supports.add(g.surface);
      assert.equal(g.bails, 0, `${entry.id} ${g.worldX}: ${g.message}`);
    });
  }
  assert.equal(g.status, 'finished'); evidence.supports = [...supports]; return evidence;
}
for (const entry of courses.slice(1)) test(`${entry.id}: input-only entire route, both dudes, identical 30/60/120 schedules`, () => {
  const expected = route(entry, 60, 'jeff');
  for (const dude of ['jeff', 'dave']) for (const hz of [30, 60, 120]) assert.deepEqual(route(entry, hz, dude), expected);
  for (const height of [60, 120, 180, 240]) assert.ok(expected.supports.some(id => entry.course.objects.some(o => o.id === id && o.height === height)), 'tier ' + height);
  for (const o of entry.course.objects.filter(o => o.type === 'rail')) assert.ok(expected.grinds.includes(o.id), o.id);
  for (const o of entry.course.objects.filter(o => o.type === 'gap')) assert.ok(expected.pops.some(p => p[0] === o.id && p[3] === 1), o.id);
  for (const o of entry.course.objects.filter(o => o.speedRequired)) assert.ok(expected.pops.some(p => p[0] === o.id && p[2] >= 370), o.id);
});
// Explicit short courses exercise natural step/finish transitions, not production traversal.
function campaignFixture() {
  const entries = courses.map(entry => ({ id: entry.id, course: { ...entry.course, length: 560, objects: [] } }));
  return new Game({ ...settings, practiceLength: 560 }, entries[0].course, entries);
}
function finish(g) {
  for (let i = 0; i < 600 && g.status === 'playing'; i++) g.step(1 / 60);
  assert.equal(g.status, 'finished');
  assert.equal(g.drainEvents().filter(e => e.type === 'finish').length, 1);
}
function resetRun(g) {
  assert.equal(g.status, 'playing'); assert.equal(g.mode, 'rolling');
  for (const key of ['score', 'combo', 'bestCombo', 'bails', 'time', 'worldX', 'distance', 'balance', 'checkpoint']) assert.equal(g[key], 0, key);
  assert.equal(g.currentSpeed, settings.speed); assert.equal(g.space, null); assert.deepEqual(g.keys, {});
  assert.deepEqual(g.events, []); assert.equal(g.flip, null); assert.equal(g.surface, null);
}
test('campaign starts at Level 1 without arbitrary selection or early advance', () => {
  const g = campaignFixture();
  assert.equal(g.courseId, 'night-shift'); assert.equal(g.levelNumber, 1);
  assert.equal(typeof g.selectCourse, 'undefined'); assert.equal(g.advanceCourse(), false);
  g.restart(); assert.equal(g.advanceCourse(), false);
  g.pause(); assert.equal(g.advanceCourse(), false); g.resume();
  g.bail('fixture'); assert.equal(g.advanceCourse(), false); g.recover();
  g.chooseDude(); assert.equal(g.advanceCourse(), false); assert.equal(g.levelNumber, 1);
});
test('natural finishes earn exactly one next level and preserve either dude; final replay never advances', () => {
  for (const dude of ['jeff', 'dave']) {
    const g = campaignFixture(); g.selectCharacter(dude); g.restart();
    for (let level = 1; level <= 3; level++) {
      assert.equal(g.levelNumber, level); assert.equal(g.characterId, dude);
      g.key('Up', true); g.step(1 / 60); g.key('Up', false); finish(g);
      const completedX = g.worldX; g.step(1); assert.equal(g.worldX, completedX);
      assert.equal(g.canAdvance, level < 3);
      g.restart(); resetRun(g); assert.equal(g.levelNumber, level); assert.equal(g.advanceCourse(), false);
      finish(g);
      assert.equal(g.advanceCourse(), level < 3);
      if (level < 3) { resetRun(g); assert.equal(g.advanceCourse(), false); assert.equal(g.levelNumber, level + 1); }
    }
    assert.equal(g.levelNumber, 3); assert.equal(g.canAdvance, false);
    g.restart(); resetRun(g); assert.equal(g.levelNumber, 3);
  }
  assert.equal(campaignFixture().levelNumber, 1, 'fresh session has no saved unlock');
});
test('practice wrapping, restart, pause and dude menu keep the current earned course without unlocking', () => {
  const g = campaignFixture(); g.selectCharacter('dave'); g.restart();
  for (let level = 1; level <= 3; level++) {
    g.key('Space', true); g.step(1 / 60); g.pause(); assert.equal(g.space, null);
    assert.equal(g.advanceCourse(), false); g.resume(); g.bail('fixture'); g.recover();
    g.chooseDude(); assert.equal(g.status, 'menu'); assert.equal(g.advanceCourse(), false);
    g.restart(true, true, true); assert.deepEqual(g.objects, original.practiceObjects);
    g.restart(true, true, false);
    for (let i = 0; i < 300; i++) g.step(1 / 60);
    assert.equal(g.status, 'playing'); assert.ok(g.distance > g.cfg.practiceLength);
    assert.equal(g.canAdvance, false); assert.equal(g.advanceCourse(), false);
    g.restart(true, false); resetRun(g); assert.equal(g.levelNumber, level); assert.equal(g.characterId, 'dave');
    g.key('Space', true); finish(g); assert.equal(g.space, null); assert.deepEqual(g.keys, {});
    if (level < 3) assert.equal(g.advanceCourse(), true);
  }
});
test('each speed gap cannot be cleared at base speed across a full-charge takeoff sweep, but boost clears', () => {
  for (const gap of courses[2].course.objects.filter(o => o.speedRequired)) {
    let attempts = 0;
    // Full charge is the maximal range: every earlier or partial pop travels less.
    // Include the last grounded integration step at the near edge, not just the marked release.
    for (let release = gap.x - 350; release <= gap.x + 4; release += 2) {
      const g = new Game(settings, { length: gap.x + 2000, checkpoints: [0], objects: [gap] }); g.restart();
      let popped = false;
      for (let n = 0; n < 4000 && g.mode !== 'crash' && g.worldX < gap.x + gap.width + 60; n++) {
        if (!popped && g.worldX >= release - 400) g.key('Space', true);
        if (!popped && g.worldX >= release) { g.key('Space', false); popped = true; }
        g.step(1 / 60);
      }
      assert.equal(g.mode, 'crash', gap.id + ' base release ' + release); attempts++;
      g.recover(); assert.ok(g.worldX <= gap.x - gap.minPrep, 'safe boost retry');
    }
    assert.ok(attempts > 170);
    const g = new Game(settings, { length: gap.x + 1200, checkpoints: [0], objects: [gap] }); g.restart();
    const control = linkedRouteController();
    while (g.status === 'playing' && g.bails === 0) { for (const [key, down] of Object.entries(control(g).keys)) g.key(key, !!down); g.step(1 / 60); }
    assert.equal(g.bails, 0); assert.equal(g.status, 'finished');
  }
});
test('raised gaps contain no lower hidden support and descent treads start at the far platform edge', () => {
  for (const { course } of courses.slice(1)) {
    assert.equal(new Set(course.objects.map(o => o.id)).size, course.objects.length);
    for (const gap of course.objects.filter(o => o.type === 'gap')) {
      assert.ok(!course.objects.some(o => o.type === 'ledge' && o.x < gap.x + gap.width && o.x + o.width > gap.x));
    }
    for (const rail of course.objects.filter(o => o.baseHeight && o.type === 'rail')) {
      assert.ok(course.objects.some(o => o.type === 'ledge' && o.height === rail.baseHeight && o.x <= rail.x && o.x + o.width >= rail.x + rail.width));
    }
    for (const stair of course.objects.filter(o => o.direction === 'down')) {
      assert.ok(course.objects.some(o => o.type === 'ledge' && o.x + o.width === stair.x && o.height > stair.height));
    }
  }
});
