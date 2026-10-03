'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, Runner } = require('../web/core.js');
const settings = require('../settings.json');
const original = require('../course.json');
const { linkedRouteController } = require('./linked-route-helpers.js');
const courses = [{ id: 'night-shift', course: original }, ...['linked-lines', 'gap-attack'].map(id => ({ id, course: require('../courses/' + id + '.json') }))];
function route(entry, hz, dude) {
  const g = new Game(settings, original, courses); g.selectCourse(entry.id); g.selectCharacter(dude); g.restart();
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
test('native catalog selection never autoplays and survives every run transition with the dude', () => {
  const g = new Game(settings, original, courses); assert.equal(g.selectCourse('missing'), false);
  for (const entry of courses) {
    g.chooseDude(); assert.equal(g.selectCourse(entry.id), true); g.selectCharacter('dave');
    assert.equal(g.status, 'menu'); assert.equal(g.course, entry.course);
    g.restart(); assert.equal(g.selectCourse('night-shift'), false); g.pause(); g.resume(); g.bail('fixture'); g.recover();
    g.restart(true, true, true); assert.deepEqual(g.objects, original.practiceObjects);
    g.restart(true, false); assert.equal(g.courseId, entry.id); assert.equal(g.characterId, 'dave');
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
