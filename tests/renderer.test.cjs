'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { Game } = require('../web/core.js');
const settings = require('../settings.json');
const manifest = require('../assets/manifest.json');
function setup() {
  const calls = [], root = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/renderer.js'), 'utf8'), { window: root });
  const ctx = Object.fromEntries(['drawImage', 'fillRect', 'fillText', 'beginPath', 'ellipse', 'fill', 'save', 'restore', 'translate', 'rotate', 'scale', 'transform'].map(key => [key, (...args) => calls.push([key, ...args])]));
  const renderer = new root.ShredderRenderer.Renderer({ getContext: () => ctx }, manifest);
  renderer.images = Object.fromEntries(Object.keys(manifest.images).map(key => [key, { key }]));
  const game = new Game(settings, { length: 10000, checkpoints: [0], objects: [] }); game.restart();
  return { renderer, game, calls };
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} differs from ${b}`);
test('sprite placement scales bitmap anchors, never treats them as normalized values', () => {
  const { renderer, calls } = setup(); renderer.sprite('skater_roll', 250, 436);
  const [, , x, y, w, h] = calls[0], a = manifest.images.skater_roll;
  close(x, 250 - a.anchor[0] * a.drawWidth / a.width); close(y, 436 - a.anchor[1] * a.drawHeight / a.height);
  close(w, a.drawWidth); close(h, a.drawHeight);
});
test('street wheel plane comes from board groundAnchor, independently of jumpZ', () => {
  const { renderer, game } = setup(), a = manifest.images.board_flat;
  const expected = settings.baselineY + (a.groundAnchor[1] - a.anchor[1]) * a.drawHeight / a.height;
  close(renderer.groundY(game), expected); game.jumpZ = 180; close(renderer.groundY(game), expected);
  close(renderer.groundY(game, 30), expected + 30);
});
test('rail, ledge, curb and bench contact surfaces agree exactly with collision heights', () => {
  const { renderer, game, calls } = setup();
  for (const type of ['rail', 'curb', 'bench', 'low_bar']) {
    calls.length = 0;
    renderer.obstacle({ type, x: 100, laneY: 0, width: 140, height: 60 }, game, 0);
    const [, , , top, , height] = calls.find(call => call[0] === 'drawImage'), a = manifest.images[type];
    close(top + (a.clearanceY ?? a.contactTop) * height / a.height, renderer.groundY(game) - 60);
  }
});
test('grind uses the actual flat-board truck anchor, not the wheel baseline', () => {
  const { renderer, game, calls } = setup(); game.mode = 'grind'; game.jumpZ = 60;
  renderer.skater(game, 250, settings.baselineY - 60, renderer.groundY(game));
  const translation = calls.find(call => call[0] === 'translate'), a = manifest.images.board_flat;
  close(translation[2] + (a.truckAnchor[1] - a.anchor[1]) * a.drawHeight / a.height, renderer.groundY(game) - 60);
});
test('push/crouch never replaces airborne or grind poses; every body draws a separate board', () => {
  const { renderer, game, calls } = setup(); game.pushPhase = .2; game.keys.Down = true;
  for (const [mode, pose] of [['air', 'skater_ollie'], ['grind', 'skater_grind'], ['rolling', 'skater_crouch']]) {
    calls.length = 0; game.mode = mode; renderer.skater(game, 250, 436, 450);
    const keys = calls.filter(c => c[0] === 'drawImage').map(c => c[1].key);
    assert.deepEqual(keys, ['board_flat', pose]);
  }
});

// Explicit pose fixtures exercise rendering, not a claim of playing these tricks.
const poseFixtures = {
  roll: {}, push1: { pushPhase: .2 }, push2: { pushPhase: .8 },
  crouch: { keys: { Down: true } }, ollie: { mode: 'air' },
  flip: { mode: 'air', flip: { at: 0 }, time: .1 },
  catch: { mode: 'air', flip: { at: 0 }, time: settings.flipDuration * .85 },
  manual: { mode: 'manual' }, grind: { mode: 'grind' },
  lean_forward: { mode: 'manual', balance: .2 }, lean_back: { mode: 'manual', balance: -.2 },
  crash: { mode: 'crash' }
};
test('all 12 Jeff and Dave pose fixtures draw the selected body with exactly one shared board', () => {
  for (const id of ['jeff', 'dave']) {
    for (const [pose, fixture] of Object.entries(poseFixtures)) {
      const { renderer, game, calls } = setup(); game.chooseDude(); game.selectCharacter(id); game.restart();
      Object.assign(game, fixture); renderer.skater(game, 250, 436, 450);
      const draws = calls.filter(call => call[0] === 'drawImage');
      assert.equal(draws.length, 2, id + ':' + pose);
      assert.match(draws[0][1].key, /^board_/);
      assert.equal(draws[1][1].key, manifest.characters[id].poses[pose]);
      assert.equal(draws[1][4], manifest.images.skater_roll.drawWidth);
      assert.equal(draws[1][5], 80);
    }
  }
});
test('unexpected identifiers fall back to Jeff, but Dave asset failures never do', () => {
  const { renderer, game, calls } = setup();
  renderer.skater({ ...game, characterId: '__proto__' }, 250, 436, 450);
  assert.equal(calls.filter(call => call[0] === 'drawImage').at(-1)[1].key, 'skater_roll');
  game.chooseDude(); game.selectCharacter('dave'); game.restart(); game.mode = 'air';
  delete renderer.images.dave_ollie; calls.length = 0;
  renderer.skater(game, 250, 436, 450);
  assert.deepEqual(calls.filter(call => call[0] === 'drawImage').map(call => call[1].key), ['board_flat', 'dave_roll']);
  delete renderer.images.dave_roll; calls.length = 0;
  renderer.skater(game, 250, 436, 450);
  assert.deepEqual(calls.filter(call => call[0] === 'drawImage').map(call => call[1].key), ['board_flat']);
});

test('left gauge and crouch delay until 300 ms; charge fills over the next 600 ms', () => {
  const { renderer, game, calls } = setup();
  game.key('Space', true); game.step(.299); renderer.meters(game);
  assert.deepEqual(calls, []);
  game.step(.001); renderer.meters(game);
  assert.ok(calls.some(c => c[0] === 'fillText' && c[1] === 'POP CHARGE'));
  assert.ok(calls.some(c => c[0] === 'fillText' && c[1] === 'RELEASE'));
  const rects = calls.filter(c => c[0] === 'fillRect');
  assert.equal(rects.length, 3); // Panel, vertical track and fill; no expiry bar.
  assert.deepEqual(rects[1], ['fillRect', 34, 235, 22, 124]);
  close(rects[2][1], 34); close(rects[2][2], 359);
  close(rects[2][3], 22); close(rects[2][4], 0);
  calls.length = 0; game.step(.6); renderer.meters(game);
  assert.ok(calls.some(c => c[0] === 'fillText' && c[1] === '100%'));
  calls.length = 0; game.key('Space', false); renderer.meters(game); assert.deepEqual(calls, []);
});
test('charged pavement gives 900 ms plus reaction time before the unchanged release position', () => {
  const { renderer, game, calls } = setup();
  for (const distance of [undefined, 90]) {
    calls.length = 0;
    renderer.obstacle({ type: 'stairs', x: 600, width: 100, height: 60, charged: true, popDistance: distance }, game, 50);
    const texts = calls.filter(c => c[0] === 'fillText');
    assert.ok(texts.some(c => c[1] === 'HOLD' && Math.abs(c[2] - (550 - (distance || 110) - settings.speed * 1.1)) < 1e-8));
    assert.ok(texts.some(c => c[1] === 'RELEASE' && c[2] === 550 - (distance || 110)));
    assert.ok(texts.every(c => c[1] !== 'TAP'));
  }
});
test('practice and charged approach hints teach hold then release, never another tap', () => {
  const { renderer, game, calls } = setup(); game.practice = true;
  renderer.hint(game);
  assert.ok(calls.some(c => c[0] === 'fillText' && c[1].includes('HOLD → RELEASE = BIG POP')));
  game.practice = false; game.course.objects = [{ x: 500, charged: true, type: 'stairs' }];
  calls.length = 0; renderer.hint(game);
  assert.ok(calls.some(c => c[0] === 'fillText' && c[1].includes('LOAD 900 ms · RELEASE AT MARK')));
  game.key('Space', true); game.step(.9); calls.length = 0; renderer.hint(game);
  assert.ok(calls.some(c => c[0] === 'fillText' && c[1].includes('THEN RELEASE')));
});

test('both bodies roll through intent delay, then crouch; push cycle uses both existing poses', () => {
  for (const id of ['jeff', 'dave']) {
    const { renderer, game, calls } = setup(); game.chooseDude(); game.selectCharacter(id); game.restart();
    const pose = () => {
      calls.length = 0; renderer.skater(game, 250, 436, 450);
      return calls.filter(c => c[0] === 'drawImage').at(-1)[1].key;
    };
    game.updatePush(1.72); assert.equal(pose(), manifest.characters[id].poses.push1);
    game.updatePush(.24); assert.equal(pose(), manifest.characters[id].poses.push2);
    game.key('Space', true); game.step(.299); assert.equal(pose(), manifest.characters[id].poses.roll);
    game.step(.001); assert.equal(pose(), manifest.characters[id].poses.crouch);
  }
});

test('generated jersey draws its own concrete bitmap at the physical contact height', () => {
  const { renderer, game, calls } = setup();
  renderer.obstacle({ type: 'jersey_barrier', x: 500, width: 160, height: 76 }, game, 0);
  const draws = calls.filter(c => c[0] === 'drawImage'); assert.equal(draws.length, 1);
  const [, image, , y, , height] = draws[0], a = manifest.images.jersey_barrier;
  assert.equal(image.key, 'jersey_barrier'); close(y + a.contactTop * height / a.height, renderer.groundY(game) - 76);
});
test('gaps 90..240 tile real art with fixed endcaps, cropped final tile and exact collision edges', () => {
  for (const width of [90, 120, 160, 172, 200, 240]) {
    const { renderer, game, calls } = setup(); const x = 500, y = renderer.groundY(game), scale = 58 / 256;
    renderer.obstacle({ type: 'gap', x, width, height: 0 }, game, 0);
    assert.equal(calls.filter(c => c[0] === 'fillRect').length, 0, 'No black-box replacement on load success');
    const draws = calls.filter(c => c[0] === 'drawImage');
    const tiles = draws.filter(c => c[1].key === 'gap_center'); assert.ok(tiles.length > 0);
    let edge = x;
    for (const [, , , , sw, sh, dx, dy, dw, dh] of tiles) {
      close(dx, edge); close(dy, y); close(dw / sw, scale); close(dh / sh, scale); edge += dw;
      close(dh, 58);
    }
    close(edge, x + width);
    for (const [key, edge] of [['gap_left', x], ['gap_right', x + width]]) {
      const cap = draws.find(c => c[1].key === key), meta = manifest.images[key]; assert.ok(cap);
      close(cap[2] + meta.collisionEdgeX * scale, edge); close(cap[3] + meta.groundLipY * scale, y);
      close(cap[4], meta.width * scale); close(cap[5], meta.height * scale);
    }
  }
});
test('boosted hold mark and hint lookahead use current speed', () => {
  const { renderer, game, calls } = setup(); game.currentSpeed = 392;
  game.course.objects = [{ type: 'jersey_barrier', x: 700, width: 160, height: 76, charged: true }];
  renderer.hint(game); assert.ok(calls.some(c => c[0] === 'fillText' && c[1].includes('CHARGED POP')));
  calls.length = 0; renderer.obstacle(game.objects[0], game, 0);
  assert.ok(calls.some(c => c[0] === 'fillText' && c[1] === 'HOLD' && Math.abs(c[2] - (700 - 110 - 392 * 1.1)) < 1e-8));
});

test('long concrete ledges use real fixed-scale bitmap caps, repeated faces and cropped middles', () => {
  for (const width of [920, 1100, 1600, 3680]) {
    const { renderer, game, calls } = setup();
    renderer.obstacle({ type: 'ledge', x: 100, width, height: 120, baseHeight: 60 }, game, 0);
    const draws = calls.filter(c => c[0] === 'drawImage'); assert.ok(draws.length > width / 170);
    for (const [, image, , , sw, sh, , dy, dw, dh] of draws) {
      assert.equal(image.key, 'ledge'); close(dw / sw, .7); close(dh / sh, .7);
      assert.ok(dw <= 236 * .7); assert.ok(dy >= renderer.groundY(game) - 120);
      assert.ok(dy + dh <= renderer.groundY(game) - 60 + 1e-8);
    }
    const lip = draws.filter(c => c[3] === 6).sort((a, b) => a[6] - b[6]);
    let edge = 100;
    for (const d of lip) { close(d[6], edge); close(d[7], renderer.groundY(game) - 120); edge += d[8]; }
    close(edge, 100 + width);
  }
});
test('descending stair bitmap slices share every physical tread and never mirror art', () => {
  const { renderer, game, calls } = setup();
  const stairs = { type: 'stairs', id: 'down', x: 100, width: 1320, height: 220, steps: 11, direction: 'down' };
  renderer.obstacle(stairs, game, 0);
  const tops = calls.filter(c => c[0] === 'fillRect' && c[4] === 1);
  assert.deepEqual(tops.map(c => c.slice(1)), game.solidParts(stairs).map(o => [o.x, renderer.groundY(game) - o.height, o.width, 1]));
  assert.ok(calls.filter(c => c[0] === 'drawImage').every(c => c[1].key === 'ledge'));
  assert.ok(!calls.some(c => c[0] === 'scale'));
});
test('both dudes keep anchored grind body during correction, wheels below truck contact and visible sparks', () => {
  for (const id of ['jeff', 'dave']) for (const balance of [-.24, .24]) {
    const { renderer, game, calls } = setup(); game.chooseDude(); game.selectCharacter(id); game.restart();
    Object.assign(game, { mode: 'grind', balance, jumpZ: 60, grindAt: 0, time: .1 });
    renderer.skater(game, 250, 376, renderer.groundY(game));
    const draws = calls.filter(c => c[0] === 'drawImage');
    assert.equal(draws[1][1].key, manifest.characters[id].poses.grind);
    assert.deepEqual(calls.find(c => c[0] === 'transform'), ['transform', 1, 0, balance * .18, 1, 0, 0]);
    const a = manifest.images.board_flat, y = calls.find(c => c[0] === 'translate')[2];
    const truck = y + (a.truckAnchor[1] - a.anchor[1]) * a.drawHeight / a.height;
    close(truck, renderer.groundY(game) - 60);
    assert.ok(y + (a.groundAnchor[1] - a.anchor[1]) * a.drawHeight / a.height > truck + 6);
    assert.equal(calls.filter(c => c[0] === 'fillRect').length, 13);
    calls.length = 0; renderer.meters(game);
    assert.ok(calls.some(c => c[0] === 'fillText' && c[1] === '50-50 LOCKED'));
    assert.ok(calls.some(c => c[0] === 'fillRect' && c[1] === 330 && c[2] === 80));
  }
});
