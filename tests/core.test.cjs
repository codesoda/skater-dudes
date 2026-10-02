'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, Runner } = require('../web/core.js');
const { Input } = require('../web/input.js');
const settings = require('../settings.json');
const course = require('../course.json');
const { routeTarget } = require('./route-target.js');
const { lightJumpPhase } = require('./route-light-jump.js');
// Isolated fixtures below may set initial conditions. The full-route controller at
// the end only sends normal key events; it never changes player/physics state.
const flat = { length: 100000, checkpoints: [0], objects: [], practiceObjects: [] };
function fixture(objects = [], config = {}) {
  const g = new Game({ ...settings, ...config }, { ...flat, objects }); g.restart(); return g;
}
function run(g, seconds, dt = 1 / 60) {
  while (seconds > 1e-9) { const step = Math.min(seconds, dt); g.step(step); seconds -= step; }
}
function tap(g) { g.key('Space', true); run(g, 1 / 60); g.key('Space', false); }
function charge(g, seconds = .9) { g.key('Space', true); run(g, seconds); g.key('Space', false); }
function hazard(type, x = 120, width = 70, height = 60, extra = {}) {
  return { id: 'test-' + type, type, x, width, height, laneY: 0, depth: 40, ...extra };
}
function flip(g) { g.key('Down', true); g.key('Down', false); g.key('Up', true); g.key('Up', false); }
function land(g) { for (let n = 0; n < 180 && g.mode === 'air'; n++) g.step(1 / 60); }

test('299 ms tap stays rolling without crouch or gauge, pops only on release', () => {
  const g = fixture(); g.key('Space', true);
  assert.equal(g.crouching, false); assert.equal(g.mode, 'rolling');
  run(g, .299); assert.equal(g.crouching, false); assert.equal(g.pushPhase, 0); assert.equal(g.chargeVisible, false); assert.equal(g.jumpZ, 0);
  g.key('Space', false); assert.equal(g.velocityZ, 420); assert.equal(g.mode, 'air');
  assert.equal(g.popCharge, 0); assert.equal(g.chargeVisible, false);
  assert.deepEqual(g.drainEvents().map(e => e.type), ['ollie']);
});
test('450 ms shows a quarter charge after intent; 900 ms reaches full', () => {
  const g = fixture(); g.key('Space', true); run(g, .45);
  assert.equal(g.chargeVisible, true); assert.ok(Math.abs(g.charge - .25) < 1e-9);
  run(g, .45); assert.equal(g.charge, 1);
});
test('900 ms release jumps immediately once and clears the gauge and charge', () => {
  const g = fixture(); charge(g);
  assert.equal(g.mode, 'air'); assert.equal(g.velocityZ, 760); assert.equal(g.popCharge, 1);
  assert.equal(g.space, null); assert.equal(g.charge, 0); assert.equal(g.chargeVisible, false);
  assert.deepEqual(g.drainEvents().map(e => e.type), ['ollie']);
  g.key('Space', false); g.releaseSpace(); assert.deepEqual(g.drainEvents(), []);
});
test('small, partial and full releases produce strictly increasing arcs', () => {
  const peaks = [.299, .45, .9].map(duration => {
    const g = fixture(); charge(g, duration); let peak = 0;
    while (g.mode === 'air') { g.step(1 / 600); peak = Math.max(peak, g.jumpZ); }
    assert.equal(g.bails, 0); return peak;
  });
  assert.ok(peaks[0] < peaks[1] && peaks[1] < peaks[2]);
  assert.ok(Math.abs(peaks[2] - 180.5) < .01);
});
test('holding past full charge caps at 100 percent without any automatic jump', () => {
  const g = fixture(); g.key('Space', true); run(g, 2);
  assert.equal(g.mode, 'rolling'); assert.equal(g.jumpZ, 0); assert.equal(g.velocityZ, 0);
  assert.equal(g.charge, 1); assert.equal(g.chargeVisible, true); assert.deepEqual(g.drainEvents(), []);
  g.key('Space', false); assert.equal(g.velocityZ, 760);
  assert.deepEqual(g.drainEvents().map(e => e.type), ['ollie']);
});
test('300 ms boundary enters crouch with an empty gauge and releases a light pop', () => {
  const g = fixture(); g.key('Space', true); run(g, .30);
  assert.equal(g.chargeVisible, true); assert.equal(g.charge, 0); assert.equal(g.crouching, true);
  g.key('Space', false); assert.equal(g.mode, 'air'); assert.ok(Math.abs(g.velocityZ - 420) < 1e-9);
  assert.equal(g.chargeVisible, false); assert.deepEqual(g.drainEvents().map(e => e.type), ['ollie']);
});
test('pause, blur clear, bail, menu and restart cancel a held charge without jumping', () => {
  for (const operation of ['pause', 'clearInput', 'bail', 'chooseDude', 'restart']) {
    const g = fixture(); g.key('Space', true); run(g, .6); g[operation]();
    assert.equal(g.space, null); assert.equal(g.charge, 0); assert.equal(g.chargeVisible, false);
    assert.deepEqual(g.keys, {}); g.resume(); g.key('Space', false);
    assert.equal(g.jumpZ, 0); assert.equal(g.velocityZ, 0);
    assert.equal(g.drainEvents().filter(e => e.type === 'ollie').length, 0);
  }
});
test('held Space while airborne does not crouch or jump after landing', () => {
  const g = fixture(); tap(g); g.key('Space', true); land(g);
  assert.equal(g.mode, 'rolling'); assert.equal(g.crouching, false); assert.equal(g.space, null);
  g.key('Space', true); assert.equal(g.space, null); g.key('Space', false); tap(g); assert.equal(g.mode, 'air');
});
test('airborne Space cannot recharge or pop again', () => {
  const g = fixture(); tap(g); run(g, .1); const v = g.velocityZ;
  g.key('Space', true); assert.equal(g.velocityZ, v); assert.equal(g.space, null);
});
test('fresh Down Up in air starts one flip, never a ground jump', () => {
  const g = fixture(); flip(g); assert.equal(g.mode, 'rolling'); assert.equal(g.flip, null);
  tap(g); flip(g); assert.ok(g.flip); const at = g.flip.at;
  run(g, .1); flip(g); assert.equal(g.flip.at, at);
});
test('gesture can begin before takeoff; intent is consumed', () => {
  const g = fixture(); g.key('Down', true); g.key('Down', false); tap(g); run(g, .15); g.key('Up', true);
  assert.ok(g.flip); assert.equal(g.downAt, -Infinity);
});
test('gesture expires after 400 ms and repeated Down does not refresh it', () => {
  const g = fixture(); g.key('Down', true); run(g, .3); tap(g); run(g, .101);
  g.key('Down', true); g.key('Up', true); assert.equal(g.flip, null);
});
test('balanced completed kickflip lands and banks; no normal-ollie meter', () => {
  const g = fixture(); tap(g); assert.equal(g.balanceActive, false); flip(g); land(g);
  assert.equal(g.mode, 'rolling'); assert.equal(g.trick, 'KICKFLIP'); assert.equal(g.bails, 0);
  run(g, .5); assert.equal(g.score, 180); assert.equal(g.combo, 0);
});
test('unfinished late kickflip bails on landing', () => {
  const g = fixture(); tap(g); run(g, .4); flip(g); land(g);
  assert.equal(g.mode, 'crash'); assert.match(g.message, /start earlier/);
});
test('unsafe kickflip is allowed in air but fails at landing', () => {
  const g = fixture(); charge(g); flip(g); g.key('Right', true); run(g, .4);
  assert.equal(g.mode, 'air'); assert.ok(g.balance > settings.balanceSafe); land(g);
  assert.equal(g.mode, 'crash'); assert.match(g.message, /safe zone/);
});
test('Left moves needle left, Right moves needle right', () => {
  const a = fixture(), b = fixture();
  for (const g of [a, b]) { tap(g); flip(g); }
  a.key('Left', true); b.key('Right', true); run(a, .1); run(b, .1);
  assert.ok(a.balance < 0); assert.ok(b.balance > 0);
});
test('manual requires Up, exits on release, banks clean, and cannot start during loading', () => {
  const g = fixture(); g.key('Up', true); run(g, .1); assert.equal(g.mode, 'manual');
  g.key('Up', false); assert.equal(g.mode, 'rolling'); run(g, .5); assert.ok(g.score >= 60);
  g.key('Space', true); g.key('Up', true); run(g, .3); assert.equal(g.mode, 'rolling');
  assert.equal(g.crouching, true); g.key('Space', false); assert.equal(g.mode, 'air');
});
test('manual has a warning grace period; a correction resets it', () => {
  const g = fixture(); g.key('Up', true); g.step(1 / 60); g.balance = .28;
  run(g, .10); assert.equal(g.mode, 'manual'); assert.ok(g.unsafeTime > 0);
  g.key('Left', true); run(g, .08); assert.equal(g.mode, 'manual');
  assert.equal(g.unsafeTime, 0);
});
test('unbalanced manual fails after sustained ~240 ms, not one frame', () => {
  const g = fixture(); g.key('Up', true); g.step(1 / 60); g.balance = .4;
  run(g, .23); assert.equal(g.mode, 'manual'); run(g, .02); assert.equal(g.mode, 'crash');
});
test('Down deliberately exits a manual', () => {
  const g = fixture(); g.key('Up', true); g.step(1 / 60); g.key('Down', true);
  assert.equal(g.mode, 'rolling'); run(g, .1); assert.equal(g.mode, 'rolling');
});
test('rail catches only a descending top crossing, snaps height, auto exits', () => {
  const rail = hazard('rail', 20, 240, 60), g = fixture([rail]);
  g.mode = 'air'; g.jumpZ = 75; g.velocityZ = -180; g.key('Up', true);
  run(g, .1); assert.equal(g.mode, 'grind'); assert.equal(g.jumpZ, 60);
  g.key('Up', false); run(g, 1); assert.notEqual(g.mode, 'grind'); assert.equal(g.bails, 0);
});
test('Space pops off a rail and Down drops without recatching', () => {
  for (const key of ['Space', 'Down']) {
    const rail = hazard('rail', 0, 250, 60), g = fixture([rail]);
    g.mode = 'grind'; g.jumpZ = 60; g.surface = rail.id; g.worldX = 50;
    g.key(key, true); assert.equal(g.mode, 'air');
    if (key === 'Space') {
      assert.equal(g.velocityZ, 420 + .45 * (760 - 420));
      g.key('Space', false); assert.deepEqual(g.drainEvents().map(e => e.type), ['ollie']);
    }
    else { run(g, .08); assert.equal(g.mode, 'air'); assert.ok(g.jumpZ < 60); }
  }
});
test('rail catch requires matching lane and real top; bench underside is never grindable', () => {
  const g = fixture([hazard('rail', 0, 250, 60, { laneY: 90 })]);
  g.mode = 'air'; g.jumpZ = 75; g.velocityZ = -180; g.key('Up', true); run(g, .1);
  assert.equal(g.mode, 'air');
  const bench = fixture([hazard('bench', 35, 80, 72)]); bench.key('Up', true); run(bench, .2);
  assert.equal(bench.mode, 'crash');
});
test('kickflip intent wins over Up rail catch', () => {
  const rail = hazard('rail', 0, 250, 60), g = fixture([rail]);
  g.mode = 'air'; g.jumpZ = 75; g.velocityZ = -180; flip(g); run(g, .1);
  assert.notEqual(g.mode, 'grind'); assert.equal(g.mode, 'crash');
});
test('solid obstacle blocks wheels; laneY and jumpZ are independent', () => {
  const o = hazard('bench', 60, 80, 72), a = fixture([o]), b = fixture([o]); b.laneY = 90;
  run(a, .3); run(b, .3); assert.equal(a.mode, 'crash'); assert.equal(b.bails, 0);
  tap(b); run(b, .1); assert.equal(b.laneY, 90); assert.ok(b.jumpZ > 0);
});
test('a coarse swept step cannot tunnel through a narrow obstacle', () => {
  const g = fixture([hazard('cone', 50, 12, 30)]); g.step(.4); assert.equal(g.mode, 'crash');
});
test('low bar clears a crouch but hits standing head', () => {
  const o = hazard('low_bar', 40, 80, 48), a = fixture([o]), b = fixture([o]);
  b.key('Down', true); run(a, .2); run(b, .5);
  assert.equal(a.mode, 'crash'); assert.equal(b.bails, 0); assert.equal(b.chargeVisible, false);
});
test('unsupported gap falls and bails rather than skating on empty ground', () => {
  const g = fixture([hazard('gap', 30, 150, 0)]); run(g, .5);
  assert.equal(g.mode, 'crash'); assert.match(g.message, /GAP/);
});
test('push cycle exists only on flat rolling; crouch and airborne cancel it', () => {
  const g = fixture(); run(g, settings.pushInterval + .1); assert.ok(g.pushPhase > 0);
  assert.ok(g.drainEvents().some(e => e.type === 'push'));
  g.key('Space', true); assert.equal(g.pushPhase, 0); run(g, .05); g.key('Space', false);
  run(g, .1); assert.equal(g.pushPhase, 0);
});
test('visible cracks make one cue on wheels; no airborne crack cue', () => {
  const o = hazard('crack', 40, 8, 0), a = fixture([o]), b = fixture([o]);
  tap(b); run(a, .25); run(b, .25);
  assert.equal(a.drainEvents().filter(e => e.type === 'crack').length, 1);
  assert.equal(b.drainEvents().filter(e => e.type === 'crack').length, 0);
});
test('crash keeps banked score, clears combo, and ignores checkpoints without cleared hazards', () => {
  const g = fixture(); g.score = 500; g.combo = 250; g.worldX = 500; g.checkpoint = 280;
  g.bail('test'); assert.equal(g.score, 500); assert.equal(g.combo, 0);
  run(g, 1); assert.equal(g.mode, 'crash'); run(g, .05); assert.equal(g.worldX, 0); assert.equal(g.mode, 'rolling');
});
test('repeated tricks diminish rewards; chaining multiplies and updates best combo', () => {
  const g = fixture(); g.award('MANUAL', 100); g.award('MANUAL', 100); assert.equal(g.combo, 171);
  assert.equal(g.multiplier, 2); g.bank(); assert.equal(g.score, 342); assert.equal(g.bestCombo, 342);
});
test('fixed runner limits catchup to eight steps and freezes in menus/pause', () => {
  const g = fixture(), runner = new Runner(g); runner.advance(100);
  assert.ok(Math.abs(g.worldX - 280 * 8 / 60) < 1e-6);
  g.pause(); runner.advance(100); const x = g.worldX; assert.equal(runner.accumulator, 0);
  g.resume(); runner.advance(1 / 60); assert.ok(Math.abs(g.worldX - x - 280 / 60) < 1e-6);
});
test('30 / 60 / 120 Hz and uneven render schedules produce identical simulation', () => {
  function scheduled(schedule) {
    const g = fixture(), runner = new Runner(g); let tick = 0, elapsed = 0, frame = 0;
    const actions = new Map([[0, ['Space', true]], [36, ['Space', false]], [50, ['Down', true]], [51, ['Down', false]], [52, ['Up', true]], [53, ['Up', false]]]);
    while (elapsed < 3 - 1e-9) {
      const dt = Math.min(schedule[frame++ % schedule.length], 3 - elapsed); elapsed += dt;
      runner.advance(dt, () => { if (actions.has(tick)) g.key(...actions.get(tick)); tick++; });
    }
    return [g.worldX, g.jumpZ, g.score, g.mode, g.bails, g.time, tick];
  }
  const expected = scheduled([1 / 60]);
  for (const schedule of [[1 / 30], [1 / 120], [.011, .027, .009, .046, .017]]) assert.deepEqual(scheduled(schedule), expected);
});
test('each fresh grounded hold starts empty after the previous release and landing', () => {
  const g = fixture(); charge(g); land(g); g.key('Space', true);
  assert.equal(g.charge, 0); assert.equal(g.chargeVisible, false);
  run(g, .45); assert.equal(g.chargeVisible, true); assert.ok(Math.abs(g.charge - .25) < 1e-9);
  g.key('Space', false); assert.ok(Math.abs(g.popCharge - .25) < 1e-9);
});
test('walking off support while holding charge cannot pop on release or landing', () => {
  const ledge = hazard('ledge', 0, 100, 60), g = fixture([ledge]);
  g.surface = ledge.id; g.jumpZ = 60; g.worldX = 90;
  g.key('Space', true); run(g, .2); assert.equal(g.mode, 'air'); assert.equal(g.chargeVisible, false);
  g.key('Space', false); land(g);
  assert.equal(g.mode, 'rolling'); assert.equal(g.space, null);
  assert.equal(g.drainEvents().filter(e => e.type === 'ollie').length, 0);
});
test('pause releases a manual rather than leaving a sticky hold action', () => {
  const g = fixture(); g.key('Up', true); run(g, .1); assert.equal(g.mode, 'manual');
  g.pause(); g.resume(); run(g, .1); assert.equal(g.mode, 'rolling');
});
test('grind uses the same sustained balance grace, not a one-frame bail', () => {
  const rail = hazard('rail', 0, 400, 60), g = fixture([rail]);
  g.mode = 'grind'; g.surface = rail.id; g.jumpZ = 60; g.balance = .4;
  run(g, .23); assert.equal(g.mode, 'grind'); run(g, .02); assert.equal(g.mode, 'crash');
});
test('stairs expose three real treads rather than a full-height invisible first riser', () => {
  const stairs = hazard('stairs', 100, 120, 60), g = fixture([stairs]);
  assert.deepEqual(g.solidParts(stairs).map(o => [o.x, o.width, o.height]), [[100, 40, 20], [140, 40, 40], [180, 40, 60]]);
  g.worldX = 72; g.jumpZ = 28; g.mode = 'air'; g.velocityZ = 100;
  run(g, .03); assert.equal(g.bails, 0);
});
test('large course gaps cannot be cleared by a light ollie, even with a late takeoff', () => {
  for (const distance of [1, 8, 20, 40, 80, 120]) {
    const g = fixture([hazard('gap', 600, 160, 0)]); g.worldX = 600 - distance;
    tap(g); run(g, .85); assert.ok(g.bails > 0, `A light ollie cleared from ${distance}`);
  }
});
test('ascending board clears a cone at its swept entry, not at the start of the frame', () => {
  const g = fixture([hazard('cone', 100, 24, 30)]);
  g.worldX = 74; g.jumpZ = 29.44; g.velocityZ = 286.67; g.mode = 'air';
  g.step(1 / 60); assert.equal(g.bails, 0); assert.ok(g.jumpZ > 30);
});
test('practice loops without a finish timer and can omit every obstacle', () => {
  const g = new Game(settings, course); g.restart(true, true, false);
  assert.equal(g.objects.length, 0); run(g, 19); assert.equal(g.status, 'playing');
  assert.ok(g.worldX < 500); assert.equal(g.bails, 0);
  g.restart(true, true, true); assert.equal(g.objects.length, 2);
});
test('course checkpoints are safe and all object identifiers are unique', () => {
  assert.equal(new Set(course.objects.map(o => o.id)).size, course.objects.length);
  for (const cp of course.checkpoints) assert.ok(!course.objects.some(o => o.type !== 'crack' && cp + 60 > o.x && cp - 60 < o.x + o.width), `Unsafe checkpoint ${cp}`);
});

// Input-driven whole-course playtest. Reads only public state, upcoming hazards,
// and balance. No teleport, invulnerability, custom physics, or artificial support.
function playRoute({ balance = true, tricks = true, character = 'jeff', boost = false } = {}) {
  const game = new Game(settings, course); game.selectCharacter(character); game.restart(); const input = new Input(game);
  let target = null, phase = '', phaseAt = 0, flipDone = false; const crossed = new Set();
  const key = (key, down) => input.feed(key, down);
  for (let tick = 0; tick < 60 * 150 && game.status !== 'finished'; tick++) {
    const o = routeTarget(course.objects, { x: game.worldX, mode: game.mode, surface: game.surface }, target);
    if (o && o.id !== target) { target = o.id; phase = ''; flipDone = false; }
    if (game.mode === 'crash') return { game, crossed, failed: o, tick };
    const distance = o ? o.x - game.worldX : Infinity;
    if (o?.type === 'low_bar') key('ArrowDown', distance < 150);
    else if (o && game.grounded) {
      if (o.charged && !phase && distance <= game.holdDistance(o)) { key('Space', true); phase = 'loading'; phaseAt = game.time; }
      if (phase === 'loading' && distance <= (o.popDistance || 110) + 2) {
        assert.ok(game.charge >= 1, `${o.id} x=${game.worldX} z=${game.jumpZ} charge=${game.charge} mode=${game.mode}`); key('Space', false); phase = 'jumped';
      }
      if (!o.charged) {
        const next = lightJumpPhase(phase, distance, game.currentSpeed);
        if (next !== phase) { key('Space', next === 'light-ready'); phase = next; }
      }
    }
    if (tricks && game.mode === 'air' && phase === 'jumped' && !flipDone && o?.type !== 'rail' && o?.type !== 'ledge') {
      key('ArrowDown', true); key('ArrowDown', false); key('ArrowUp', true); key('ArrowUp', false); flipDone = true;
    }
    if (game.mode === 'air' && (o?.type === 'rail' || o?.type === 'ledge' && o.intent !== 'ride')) key('ArrowUp', true);
    else if (game.grounded && !game.flip) key('ArrowUp', false);
    if (game.balanceActive) {
      key('ArrowLeft', balance && game.balance > .05);
      key('ArrowRight', !balance);
    } else { key('ArrowLeft', false); key('ArrowRight', boost && game.worldX >= 100 && game.worldX < 850); }
    input.flush(); game.step(1 / 60);
    for (const obj of course.objects) if (game.worldX > obj.x + obj.width + 22) crossed.add(obj.id);
    if (o?.type === 'low_bar' && game.worldX > o.x + o.width + 22) key('ArrowDown', false);
  }
  return { game, crossed };
}
test('whole route is clearable with ordinary input, charged pops, flips and rail catches', () => {
  const result = playRoute();
  assert.equal(result.game.bails, 0, `Bail at ${result.game.worldX}: ${result.game.message} (${result.failed?.type})`);
  assert.equal(result.game.status, 'finished'); assert.equal(result.crossed.size, course.objects.length);
  assert.ok(Math.abs(result.game.time - 90) < 1 / 60 + 1e-8);
  assert.ok(result.game.score > 1000); assert.ok(result.game.bestCombo > 100);
  console.log(`Route playtest: ${result.crossed.size} objects crossed, ${result.game.bails} bails, score ${Math.round(result.game.score)}, ${result.game.time.toFixed(2)} s.`);
});
test('whole route stays clearable with an opening boost and eight-second carried momentum', () => {
  const result = playRoute({ boost: true });
  assert.equal(result.game.bails, 0, `Bail at ${result.game.worldX}: ${result.game.message}`);
  assert.equal(result.game.status, 'finished'); assert.equal(result.crossed.size, course.objects.length);
  assert.ok(result.game.score > 1000); assert.ok(result.game.time > 85 && result.game.time < 90);
});
test('Dave clears the whole route with ordinary ollies and no kickflip gesture', () => {
  const result = playRoute({ tricks: false, character: 'dave' }); assert.equal(result.game.status, 'finished'); assert.equal(result.game.bails, 0);
});
test('same route controller without balance correction fails a real trick landing', () => {
  const result = playRoute({ balance: false }); assert.ok(result.game.bails > 0);
  assert.match(result.game.message, /BALANCE|safe zone|balance/);
});

test('charged stairs and gaps cannot be cleared by one light pop at any sampled approach', () => {
  for (const obstacle of course.objects.filter(o => o.charged && ['stairs', 'gap'].includes(o.type))) {
    for (let distance = 1; distance <= 260; distance += 5) {
      const g = fixture([{ ...obstacle, x: 600 }]); g.worldX = 600 - distance;
      tap(g); run(g, 2);
      assert.ok(g.bails > 0, `${obstacle.id} cleared by light pop from ${distance}`);
    }
  }
});

function untilCore(g, predicate, seconds = 12) {
  for (let i = 0; i < seconds * 60 && !predicate(g); i++) g.step(1 / 60);
  assert.ok(predicate(g), `${g.mode} at ${g.worldX}: ${g.message}`);
}
test('Space keeps standing collision height before intent; Down ducks immediately', () => {
  const bar = hazard('low_bar', 60, 40, 48);
  for (const key of ['Space', 'Down']) {
    const g = fixture([bar]); g.key(key, true); run(g, .2);
    assert.equal(g.bails, key === 'Space' ? 1 : 0);
  }
  const g = fixture([hazard('low_bar', 120, 40, 48)]);
  g.key('Space', true); run(g, .7); assert.equal(g.bails, 0); assert.equal(g.crouching, true);
});
test('450 ms release uses exactly one quarter of the charge range', () => {
  const g = fixture(); charge(g, .45);
  assert.ok(Math.abs(g.popCharge - .25) < 1e-9);
  assert.ok(Math.abs(g.velocityZ - 505) < 1e-9);
});
test('push onsets stay 1.6 seconds apart across five cycles at 30/60/120 Hz', () => {
  for (const hz of [30, 60, 120]) {
    const g = fixture(); run(g, 8.1, 1 / hz);
    const events = g.drainEvents().filter(e => e.type === 'push');
    assert.equal(events.length, 5);
    events.forEach((event, i) => assert.ok(Math.abs(event.at - (i + 1) * 1.6) <= 1 / hz + 1e-8));
    for (let i = 1; i < events.length; i++) assert.ok(Math.abs(events[i].at - events[i - 1].at - 1.6) <= 1 / hz + 1e-8);
  }
});
test('push phases keep 480 ms duration; all non-flat-roll states reset the cycle without bursts', () => {
  const g = fixture(); run(g, 1.6); assert.equal(g.pushPhase, .001);
  run(g, .12); assert.ok(Math.abs(g.pushPhase - .25) < 1e-8);
  run(g, .24); assert.ok(Math.abs(g.pushPhase - .75) < 1e-8);
  run(g, .12); assert.equal(g.pushPhase, 0);
  for (const state of [
    { keys: { Space: true } }, { keys: { Down: true } }, { keys: { Up: true } },
    { mode: 'air' }, { mode: 'manual' }, { mode: 'grind' }, { mode: 'crash' },
    { surface: 'raised', jumpZ: 60 }
  ]) {
    const game = fixture(); run(game, 1.7); game.drainEvents(); Object.assign(game, state);
    game.updatePush(.1); assert.equal(game.pushPhase, 0); assert.equal(game.pushClock, 0);
    Object.assign(game, { mode: 'rolling', keys: {}, surface: null, jumpZ: 0 });
    run(game, 1.59); assert.equal(game.drainEvents().filter(e => e.type === 'push').length, 0);
    run(game, .02); assert.equal(game.drainEvents().filter(e => e.type === 'push').length, 1);
  }
});
test('every meaningful hazard records a flat safe retry only after the board clears and lands', () => {
  for (const type of ['curb', 'cone', 'jersey_barrier', 'stairs', 'gap', 'rail', 'ledge', 'bench', 'low_bar']) {
    const o = hazard(type, 700, type === 'gap' ? 160 : 80, type === 'low_bar' ? 48 : type === 'gap' ? 0 : 60);
    const g = fixture([o, hazard('cone', 2000, 24, 30, { id: 'failed' }), hazard('crack', 1100, 8, 0)]);
    if (type === 'low_bar') g.key('Down', true);
    else {
      const distance = type === 'gap' ? 84 : 110;
      run(g, (700 - distance) / 280 - .9); charge(g);
      untilCore(g, g => g.worldX - settings.boardHalfWidth > o.x + o.width || g.mode === 'crash');
      if (!g.grounded || g.surface || g.jumpZ !== 0) assert.equal(g.clearedHazards.length, 0, type + ': airborne or raised contact is not flat success');
    }
    untilCore(g, g => g.clearedHazards.length > 0 || g.mode === 'crash');
    assert.equal(g.bails, 0, type); assert.equal(g.jumpZ, 0); assert.equal(g.surface, null);
    assert.deepEqual(g.clearedHazards, [{ id: o.id, x: o.x + o.width + 30 }]);
    untilCore(g, g => g.mode === 'crash');
    assert.equal(g.clearedHazards.length, 1); const failedX = g.worldX;
    g.recover(); assert.equal(g.worldX, o.x + o.width + 30); assert.ok(g.worldX < failedX);
    assert.ok(g.hazards.every(o => !g.overlapping(o))); assert.equal(g.gapAt(g.worldX), false);
    assert.ok((2000 - settings.boardHalfWidth - g.worldX) / settings.speed >= 1.4);
  }
});
test('failed flip past an exit and failed gap landing never count as cleared', () => {
  const g = fixture([hazard('curb', 700, 28, 18)]);
  run(g, 647 / 280); tap(g); run(g, .4);
  assert.ok(g.worldX - settings.boardHalfWidth > 728); assert.equal(g.clearedHazards.length, 0);
  flip(g); land(g); assert.equal(g.mode, 'crash'); assert.equal(g.clearedHazards.length, 0);
  g.recover(); assert.equal(g.worldX, 0);
  const gap = fixture([hazard('gap', 30, 30, 0)]); run(gap, .3);
  assert.equal(gap.mode, 'crash'); assert.equal(gap.clearedHazards.length, 0);
  gap.recover(); assert.equal(gap.worldX, 0);
});
test('short spacing retries at an earlier cleared point or zero, never past the failed hazard', () => {
  for (const earlier of [false, true]) {
    const objects = [hazard('low_bar', 1200, 80, 48), hazard('cone', 1500, 24, 30)];
    if (earlier) objects.unshift(hazard('low_bar', 500, 80, 48, { id: 'earlier' }));
    const g = fixture(objects); g.key('Down', true); untilCore(g, g => g.mode === 'crash');
    assert.equal(g.clearedHazards.length, earlier ? 2 : 1);
    g.recover(); assert.equal(g.worldX, earlier ? 610 : 0);
    assert.ok(g.hazards.every(o => !g.overlapping(o)));
    assert.ok((g.hazards.find(o => o.x > g.worldX).x - settings.boardHalfWidth - g.worldX) / settings.speed >= 1.4);
    assert.equal(g.clearedHazards.length, earlier ? 1 : 0);
  }
});
test('unsafe exit points overlapping gaps, stairs, rails or low bars are rejected', () => {
  // Clearance-history fixtures isolate target validation, not route traversal.
  for (const type of ['gap', 'stairs', 'rail', 'low_bar', 'jersey_barrier']) {
    const g = fixture([hazard('curb', 500, 80, 20), hazard(type, 600, 100, 48)]);
    g.clearedHazards = [{ id: 'test-curb', x: 610 }]; g.worldX = 620;
    g.bail('unsafe exit fixture'); g.recover(); assert.equal(g.worldX, 0);
  }
});
test('retry preserves each dude, banked score and best combo; clears all held input and current combo', () => {
  for (const id of ['jeff', 'dave']) {
    const g = fixture([hazard('low_bar', 500, 80, 48), hazard('cone', 1400, 24, 30)]);
    g.chooseDude(); g.selectCharacter(id); g.restart(); g.key('Down', true);
    untilCore(g, g => g.worldX > 900); g.key('Space', true);
    untilCore(g, g => g.worldX > 1360); g.score = 500; g.bestCombo = 300; g.combo = 200; g.rollTime = 0;
    untilCore(g, g => g.mode === 'crash');
    g.recover(); assert.equal(g.worldX, 610); assert.equal(g.characterId, id);
    assert.equal(g.score, 500); assert.equal(g.bestCombo, 300); assert.equal(g.combo, 0);
    assert.deepEqual(g.keys, {}); assert.equal(g.space, null); assert.equal(g.pushPhase, 0);
    assert.equal(g.jumpZ, 0); assert.equal(g.velocityZ, 0); assert.equal(g.mode, 'rolling');
  }
});
test('practice wrap and restart discard prior-lap clearance history', () => {
  const objects = [hazard('low_bar', 500, 80, 48)];
  const g = new Game({ ...settings, practiceLength: 1600 }, { ...flat, practiceObjects: objects });
  g.restart(true, true, true); g.key('Down', true); untilCore(g, g => g.worldX > 1000);
  assert.equal(g.clearedHazards.length, 1); untilCore(g, g => g.worldX < 100);
  assert.deepEqual(g.clearedHazards, []); g.key('Down', false);
  untilCore(g, g => g.mode === 'crash'); g.recover(); assert.equal(g.worldX, 0);
  g.key('Down', true); untilCore(g, g => g.worldX > 1000); assert.equal(g.clearedHazards.length, 1);
  g.restart(); assert.deepEqual(g.clearedHazards, []);
});
test('safe retries and push events are identical with 30/60/120 Hz render schedules', () => {
  function simulate(hz) {
    const g = fixture([hazard('low_bar', 500, 80, 48), hazard('cone', 1400, 24, 30)]), runner = new Runner(g);
    let tick = 0;
    for (let frame = 0; frame < 8 * hz; frame++) runner.advance(1 / hz, () => {
      if (tick++ === 90) g.key('Down', true);
    });
    return JSON.stringify(g);
  }
  assert.equal(simulate(30), simulate(60)); assert.equal(simulate(120), simulate(60));
});
