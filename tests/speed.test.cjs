'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, Runner } = require('../web/core.js');
const settings = require('../settings.json');
const course = require('../course.json');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function flat() {
  const g = new Game(settings, { length: 100000, checkpoints: [0], objects: [], practiceObjects: [] }); g.restart(); return g;
}
function run(g, seconds, dt = 1 / 60) {
  while (seconds > 1e-9) { const step = Math.min(dt, seconds); g.step(step); seconds -= step; }
}
test('Right gains gradually at 160, caps at 392 and coasts at 14 using actual integrated distance', () => {
  const g = flat(); g.key('Right', true); run(g, .25);
  close(g.currentSpeed, 320); close(g.worldX, 75); close(g.distance, g.worldX);
  run(g, .75); close(g.currentSpeed, 392); close(g.worldX, 352.8);
  g.key('Right', false); close(g.currentSpeed, 392); run(g, .5); close(g.currentSpeed, 385);
  run(g, 7.5); close(g.currentSpeed, 280); close(g.worldX, 352.8 + 2688); close(g.distance, g.worldX);
});
test('ramp/cap integration is time based across 30/60/120 Hz and a coarse step', () => {
  const results = [1 / 30, 1 / 60, 1 / 120, 2].map(dt => {
    const g = flat(); g.key('Right', true); run(g, 2, dt); g.key('Right', false); run(g, 9, dt);
    return [g.currentSpeed, g.worldX, g.distance];
  });
  for (const r of results) r.forEach((value, i) => close(value, results[0][i]));
});
test('maximum normal coast takes eight seconds and clamps at base even after a long step', () => {
  const g = flat(); g.key('Right', true); run(g, .7); g.key('Right', false);
  close(g.currentSpeed, 392); run(g, 7.9); close(g.currentSpeed, 281.4);
  run(g, .1); close(g.currentSpeed, 280);
  const x = g.worldX; g.step(20); close(g.currentSpeed, 280); close(g.worldX - x, 5600);
});
test('maximum grind coast takes four seconds with deterministic capped integration', () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120, 5]) {
    const g = flat(); g.currentSpeed = 392; g.mode = 'grind';
    // Isolate the integrator from balance/contact, including an over-cap step.
    let remaining = 5;
    while (remaining > 1e-9) { const step = Math.min(dt, remaining); g.moveHorizontal(step); remaining -= step; }
    close(g.currentSpeed, 280); close(g.worldX, 1344 + 280); close(g.distance, g.worldX);
  }
  const g = flat(); g.currentSpeed = 392; g.mode = 'grind'; g.surface = 'rail'; g.jumpZ = 60;
  g.course.objects = [{ id: 'rail', type: 'rail', x: 0, width: 10000, height: 60 }];
  for (let tick = 0; tick < 240; tick++) {
    g.key('Left', g.balance > .04); g.step(1 / 60);
    assert.equal(g.mode, 'grind'); assert.equal(g.bails, 0);
    close(g.currentSpeed, 392 - 28 * (tick + 1) / 60);
  }
  close(g.currentSpeed, 280); close(g.worldX, 1344);
});
test('popping or dropping out of a grind resumes normal coast without a speed jump', () => {
  for (const key of ['Space', 'Down']) {
    const g = flat(); g.currentSpeed = 392; g.mode = 'grind'; g.surface = 'rail'; g.jumpZ = 60;
    g.course.objects = [{ id: 'rail', type: 'rail', x: 0, width: 1000, height: 60 }];
    run(g, .1); close(g.currentSpeed, 389.2);
    g.key(key, true); assert.equal(g.mode, 'air'); close(g.currentSpeed, 389.2);
    run(g, .1); close(g.currentSpeed, 387.8); assert.equal(g.bails, 0);
  }
});
test('partial boost coast duration is proportional to excess speed, not a fixed timer', () => {
  for (const seconds of [.175, .35, .525]) {
    for (const mode of ['rolling', 'grind']) {
      const g = flat(); g.key('Right', true); run(g, seconds); g.key('Right', false);
      const excess = 160 * seconds, rate = mode === 'grind' ? 28 : 14;
      close(g.currentSpeed, 280 + excess); g.mode = mode;
      g.moveHorizontal(excess / rate - .01); close(g.currentSpeed, 280 + rate * .01);
      g.moveHorizontal(.01); close(g.currentSpeed, 280);
      g.moveHorizontal(10); close(g.currentSpeed, 280);
    }
  }
});
test('Space intent immediately suppresses boost and pushing before the 300 ms crouch', () => {
  const g = flat(); g.key('Right', true); run(g, .8); g.key('Space', true); run(g, .2);
  assert.equal(g.boosting, false); assert.equal(g.chargeVisible, false); assert.equal(g.crouching, false);
  close(g.currentSpeed, 389.2); assert.equal(g.pushPhase, 0);
  g.key('Space', false); const launch = g.currentSpeed; run(g, .1);
  assert.equal(g.mode, 'air'); close(g.currentSpeed, launch - 1.4); assert.equal(g.keys.Right, true);
});
test('Right cannot accelerate during Down, Up, manual, flip, grind, raised support or air', () => {
  const states = [
    { keys: { Down: true } }, { keys: { Up: true } }, { keys: { Space: true } },
    { mode: 'manual' }, { mode: 'grind' }, { mode: 'air' }, { mode: 'air', velocityZ: -200 }, { flip: { at: 0 } },
    { surface: 'ledge', jumpZ: 60 }, { jumpZ: 1 }
  ];
  for (const state of states) {
    const g = flat(); g.currentSpeed = 350; Object.assign(g, state); g.keys.Right = true;
    assert.equal(g.boosting, false); g.moveHorizontal(.1); close(g.currentSpeed, state.mode === 'grind' ? 347.2 : 348.6);
  }
  const left = flat(); left.key('Left', true); run(left, .2); close(left.currentSpeed, 280);
});
test('Right in actual manual/flip/grind moves the balance needle, never builds speed', () => {
  for (const mode of ['manual', 'flip', 'grind']) {
    const g = flat();
    if (mode === 'manual') { g.key('Up', true); g.step(1 / 60); }
    if (mode === 'flip') { g.key('Space', true); g.key('Space', false); g.key('Down', true); g.key('Down', false); g.key('Up', true); g.key('Up', false); }
    if (mode === 'grind') {
      g.course.objects = [{ id: 'rail', type: 'rail', x: 0, width: 1000, height: 60 }];
      g.mode = 'grind'; g.surface = 'rail'; g.jumpZ = 60;
    }
    g.key('Right', true); run(g, .1); close(g.currentSpeed, 280); assert.ok(g.balance > .1);
  }
});
test('boost push starts every .8 seconds with one cue; stroke lasts .48 seconds', () => {
  for (const hz of [30, 60, 120]) {
    const g = flat(); g.key('Right', true); run(g, 4.1, 1 / hz);
    const events = g.drainEvents().filter(e => e.type === 'push'); assert.equal(events.length, 5);
    events.forEach((e, i) => close(e.at, (i + 1) * .8));
  }
  const g = flat(); g.key('Right', true); run(g, .8); close(g.pushPhase, .001);
  run(g, .24); close(g.pushPhase, .5); g.key('Right', false);
  run(g, .12); close(g.pushPhase, .75); run(g, .12); close(g.pushPhase, 0);
});
test('cadence changes retain phase and never restart strokes or flood push cues', () => {
  const g = flat(); run(g, 1.2); g.key('Right', true); run(g, .2);
  assert.equal(g.drainEvents().filter(e => e.type === 'push').length, 1);
  close(g.pushPhase, .001);
  for (let n = 0; n < 120; n++) { g.key('Right', n % 2 === 0); g.step(1 / 60); }
  const events = g.drainEvents().filter(e => e.type === 'push');
  assert.ok(events.length <= 2);
  for (let i = 1; i < events.length; i++) assert.ok(events[i].at - events[i - 1].at >= .8 - 1e-8);
});
test('pause freezes momentum; crash, recovery, restart and practice wrap reset base speed', () => {
  const g = flat(); g.key('Right', true); run(g, 1); g.pause(); const saved = [g.currentSpeed, g.worldX, g.time];
  run(g, 10); assert.deepEqual([g.currentSpeed, g.worldX, g.time], saved);
  g.resume(); run(g, .1); close(g.currentSpeed, 390.6);
  g.bail('fixture'); close(g.currentSpeed, 280); g.recover(); close(g.currentSpeed, 280);
  g.key('Right', true); run(g, .8); g.restart(); close(g.currentSpeed, 280);
  g.restart(true, true); g.key('Right', true); while (g.distance < settings.practiceLength) g.step(1 / 60);
  close(g.currentSpeed, 280); assert.equal(g.worldX, 0); assert.equal(g.pushPhase, 0);
});
test('hold mark preserves 900 ms plus reaction at current speed, with coast adding margin', () => {
  const g = flat(), o = { popDistance: 110 }; g.key('Right', true); run(g, .8);
  close(g.holdDistance(o), 110 + 392 * 1.1); const x = g.worldX;
  g.key('Space', true); run(g, .9); assert.equal(g.charge, 1);
  assert.ok(g.worldX - x < g.holdDistance(o) - 110);
});
test('boosted swept collision cannot pass through a narrow solid', () => {
  const g = flat(); g.course.objects = [{ id: 'barrier', type: 'jersey_barrier', x: 50, width: 160, height: 76 }];
  g.key('Right', true); g.step(.5); assert.equal(g.mode, 'crash');
});
test('boost, coast, charge and push events are identical under different render schedules', () => {
  function simulate(schedule) {
    const g = flat(), runner = new Runner(g); let tick = 0, elapsed = 0, frame = 0;
    const actions = new Map([[0, ['Right', true]], [80, ['Space', true]], [140, ['Space', false]], [190, ['Right', false]]]);
    while (elapsed < 12 - 1e-9) {
      const dt = Math.min(schedule[frame++ % schedule.length], 12 - elapsed); elapsed += dt;
      runner.advance(dt, () => { if (actions.has(tick)) g.key(...actions.get(tick)); tick++; });
    }
    return JSON.stringify(g);
  }
  const expected = simulate([1 / 60]);
  for (const schedule of [[1 / 30], [1 / 120], [.011, .027, .009, .046, .017]]) assert.equal(simulate(schedule), expected);
});
test('elevated course retains 29 hazards, three jerseys, four ducks and safe supported approaches', () => {
  const hazards = course.objects.filter(o => o.type !== 'crack');
  assert.equal(hazards.length, 29); assert.equal(course.length, 25200);
  assert.equal(hazards.filter(o => o.type === 'jersey_barrier').length, 3);
  assert.equal(hazards.filter(o => o.type === 'low_bar').length, 4);
  const tiers = hazards.filter(o => o.id.startsWith('climb-') && o.type === 'ledge');
  assert.deepEqual(tiers.map(o => o.height), [60, 120, 180, 240]);
  assert.ok(tiers.every(o => o.x + o.width === 13660));
  assert.ok(tiers.slice(1).every((o, i) => o.x - tiers[i].x === 920));
  assert.ok(hazards.filter(o => o.type === 'ledge' && o.width >= 900 && o.width <= 1600).length >= 2);
  for (const o of hazards) {
    if (o.type === 'low_bar') assert.ok(o.height > settings.crouchHeight && o.height < settings.bodyHeight);
    if (o.type === 'jersey_barrier') assert.ok(o.height >= 70 && o.height <= 80 && o.width >= 145 && o.width <= 175);
  }
  const shelf = hazards.find(o => o.id === 'transfer-ledge'), rail = hazards.find(o => o.id === 'transfer-rail');
  assert.equal(rail.x - shelf.x - shelf.width, 140); assert.equal(rail.height, shelf.height);
  assert.ok(rail.x - rail.popDistance < shelf.x + shelf.width - settings.boardHalfWidth);
});
test('light pops cannot clear jerseys; charged pops clear them without becoming grindable', () => {
  for (let distance = 1; distance <= 260; distance += 5) {
    const g = flat(); g.course.objects = [{ id: 'jersey', type: 'jersey_barrier', x: 600, width: 160, height: 76, charged: true }];
    g.worldX = 600 - distance; g.key('Space', true); g.key('Space', false); run(g, 2);
    assert.ok(g.bails > 0, `Light pop cleared from ${distance}`);
  }
  const g = flat(); g.course.objects = [{ id: 'jersey', type: 'jersey_barrier', x: 600, width: 160, height: 76, charged: true }];
  run(g, (600 - 110) / g.currentSpeed - .9); g.key('Space', true); run(g, .9); g.key('Space', false);
  // Catch attempt without a fresh flip gesture must land, not grind.
  g.key('Up', true); run(g, .7); g.key('Up', false); run(g, .8);
  assert.equal(g.bails, 0); assert.equal(g.drainEvents().filter(e => e.type === 'grind').length, 0);
  assert.ok(g.clearedHazards.some(o => o.id === 'jersey'));
});
