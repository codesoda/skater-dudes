'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'artifacts/skater-dudes');
const URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const manifest = require('../assets/manifest.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = key => hash(fs.readFileSync(path.join(ROOT, manifest.images[key].path)));
const imageHash = src => hash(Buffer.from(src.split(',')[1], 'base64'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function shot(page, name) { await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true }); }
async function key(page, name, ms = 35) { await page.keyboard.down(name); await wait(ms); await page.keyboard.up(name); }
async function state(page) {
  return page.evaluate(() => {
    const { game: g, audio: a, input: i } = window.SHREDDER;
    return { id: g.characterId, status: g.status, mode: g.mode, score: g.score, bails: g.bails,
      practice: g.practice, charge: g.space, gauge: g.chargeVisible, queue: i.queue.length, loops: a.loops.size, active: a.active };
  });
}
async function body(page, key) {
  await page.waitForFunction(key => window.dudeQA.draws.some(draw => draw.key === key), key);
  const draw = await page.evaluate(key => window.dudeQA.draws.findLast(draw => draw.key === key), key);
  assert.equal(imageHash(draw.src), fileHash(key));
  return draw;
}
async function clearDraws(page) { await page.evaluate(() => { window.dudeQA.draws = []; }); }

test('Skater Dudes offline chooser, retained identity and real Canvas body images', { timeout: 60000 }, async t => {
  fs.mkdirSync(OUT, { recursive: true });
  const requested = process.env.SHREDDER_BROWSER;
  const channel = requested === 'chromium-headless-shell' ? undefined :
    requested || (fs.existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined);
  const browser = await chromium.launch({ headless: true, channel });
  t.after(async () => browser.close());
  const context = await browser.newContext({ offline: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(), errors = [], network = [], failed = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  page.on('requestfailed', request => failed.push(request.url()));
  await page.goto(URL); await page.getByRole('radio', { name: 'Jeff', exact: true }).waitFor();
  await page.evaluate(() => {
    const r = window.SHREDDER.renderer, original = r.ctx.drawImage.bind(r.ctx);
    window.dudeQA = { draws: [] };
    r.ctx.drawImage = (image, ...args) => {
      const key = Object.keys(r.images).find(key => r.images[key] === image);
      if (key && /^(skater_|dave_|board_)/.test(key)) {
        window.dudeQA.draws.push({ key, src: image.src, args });
        if (window.dudeQA.draws.length > 400) window.dudeQA.draws.splice(0, 200);
      }
      return original(image, ...args);
    };
  });

  await t.test('exact title/dedication, two named sprite previews and one default selection without autoplay', async () => {
    assert.equal(await page.title(), 'Skater Dudes');
    assert.equal(await page.getByRole('heading', { name: 'SKATER DUDES', exact: true }).count(), 1);
    const dedication = page.getByText('Dedicated to Oscar, the raddest skater dude I know', { exact: true });
    assert.equal(await dedication.isVisible(), true);
    assert.equal(await dedication.evaluate(node => getComputedStyle(node).textTransform), 'none');
    assert.equal(await page.getByRole('group', { name: 'Choose your dude' }).count(), 1);
    assert.equal(await page.getByRole('radio').count(), 2);
    assert.equal(await page.getByRole('radio', { name: 'Jeff', exact: true }).isChecked(), true);
    assert.equal(await page.locator('input[name="dude"]:checked').count(), 1);
    for (const id of ['jeff', 'dave']) {
      const preview = page.getByRole('img', { name: manifest.characters[id].name + ' skate sprite' });
      assert.equal(await preview.evaluate(img => img.complete && img.naturalWidth === 400 && img.naturalHeight === 300), true);
      assert.equal(imageHash(await preview.getAttribute('src')), fileHash(manifest.characters[id].previewKey));
    }
    assert.equal(await page.evaluate(() => window.SHREDDER.audio.ctx), null);
    await shot(page, 'title'); await page.locator('.dude-chooser').screenshot({ path: path.join(OUT, 'chooser.png') });
  });

  await t.test('native Arrow/Space radio selection keeps keyboard focus and never starts or queues gameplay', async () => {
    const jeff = page.getByRole('radio', { name: 'Jeff', exact: true }), dave = page.getByRole('radio', { name: 'Dave', exact: true });
    await jeff.focus(); await page.keyboard.press('ArrowRight'); await wait(60);
    assert.equal(await dave.isChecked(), true);
    assert.equal(await dave.evaluate(node => document.activeElement === node), true);
    await page.keyboard.press('Space'); await page.keyboard.press('Enter'); await wait(60);
    const s = await state(page); assert.equal(s.status, 'menu'); assert.equal(s.id, 'dave'); assert.equal(s.queue, 0);
    assert.equal(s.charge, null); assert.equal(s.gauge, false); assert.equal(s.active, false);
    assert.equal(await dave.evaluate(node => document.activeElement === node), true);
    await page.keyboard.press('ArrowLeft'); assert.equal(await jeff.isChecked(), true);
    assert.equal(await jeff.evaluate(node => document.activeElement === node), true);
    const checkbox = page.getByRole('checkbox'); await checkbox.focus(); await page.keyboard.press('Space');
    assert.equal(await checkbox.isChecked(), true); assert.equal((await state(page)).status, 'menu');
    await page.keyboard.press('Space'); assert.equal(await checkbox.isChecked(), false);
  });

  await t.test('click Dave then Route draws the actual Dave image; help, pause and R retain Dave', async () => {
    await page.getByRole('radio', { name: 'Dave', exact: true }).check();
    await clearDraws(page); await page.getByRole('button', { name: 'Ride the street', exact: false }).click();
    assert.equal((await state(page)).id, 'dave'); assert.equal((await state(page)).practice, false);
    const draw = await body(page, 'dave_roll'); assert.notEqual(imageHash(draw.src), fileHash('skater_roll'));
    await shot(page, 'dave-skating');
    await key(page, 'KeyI'); assert.equal((await state(page)).status, 'paused'); assert.equal((await state(page)).id, 'dave');
    await key(page, 'KeyI'); await key(page, 'KeyP'); assert.equal((await state(page)).id, 'dave');
    await key(page, 'KeyP'); await key(page, 'KeyR'); assert.equal((await state(page)).id, 'dave');
    assert.equal(await page.evaluate(() => window.SHREDDER.game.selectCharacter('jeff')), false);
    await key(page, 'KeyP'); await page.getByRole('button', { name: 'Flat practice', exact: true }).click();
    assert.equal((await state(page)).practice, true); assert.equal((await state(page)).id, 'dave');
  });

  await t.test('real Dave crouch, ollie, flip and manual inputs use Dave images and bank normally', async () => {
    await clearDraws(page); await page.keyboard.down('ArrowDown'); await body(page, 'dave_crouch'); await page.keyboard.up('ArrowDown');
    await clearDraws(page); await key(page, 'Space'); await body(page, 'dave_ollie');
    await key(page, 'ArrowDown', 5); await key(page, 'ArrowUp', 5); await body(page, 'dave_flip');
    await page.waitForFunction(() => window.SHREDDER.game.mode === 'rolling');
    await page.waitForFunction(() => window.SHREDDER.game.score >= 180);
    await clearDraws(page); await page.keyboard.down('ArrowUp'); await body(page, 'dave_manual'); await page.keyboard.up('ArrowUp');
    await page.waitForFunction(() => window.SHREDDER.game.score > 180);
  });

  await t.test('Choose dude stops audio/input and preserves score until Jeff starts a new practice run', async () => {
    const banked = (await state(page)).score;
    await page.keyboard.down('Space'); await wait(450); await key(page, 'KeyP'); await page.keyboard.up('Space');
    await page.getByRole('button', { name: 'Choose dude', exact: true }).click();
    await page.waitForFunction(() => window.SHREDDER.audio.nodes.size === 0);
    const s = await state(page); assert.equal(s.id, 'dave'); assert.equal(s.status, 'menu');
    assert.equal(s.score, banked); assert.equal(s.loops, 0); assert.equal(s.active, false);
    assert.equal(s.charge, null); assert.equal(s.gauge, false); assert.equal(s.queue, 0);
    assert.equal(await page.getByRole('radio', { name: 'Dave', exact: true }).evaluate(node => document.activeElement === node), true);
    await page.getByRole('radio', { name: 'Jeff', exact: true }).check();
    assert.equal((await state(page)).score, banked); await clearDraws(page);
    const practice = page.getByRole('button', { name: 'Practice first', exact: true });
    await practice.focus(); await page.keyboard.press('Enter');
    await body(page, 'skater_roll'); assert.equal((await state(page)).id, 'jeff'); assert.equal((await state(page)).score, 0);
    assert.equal((await state(page)).practice, true); await shot(page, 'jeff-skating');
    await page.waitForFunction(() => window.SHREDDER.audio.loops.has('music'));
  });

  await t.test('actual route collision/safe recovery and mode switch retain Dave', async () => {
    await key(page, 'KeyP'); await page.getByRole('button', { name: 'Choose dude', exact: true }).click();
    await page.getByRole('radio', { name: 'Dave', exact: true }).check();
    await page.getByRole('button', { name: 'Ride the street', exact: false }).click();
    await page.waitForFunction(() => window.SHREDDER.game.mode === 'crash', null, { timeout: 9000 });
    assert.equal((await state(page)).id, 'dave'); await body(page, 'dave_crash');
    assert.equal(await page.evaluate(() => window.SHREDDER.game.checkpoint), 1400);
    await page.waitForFunction(() => window.SHREDDER.game.mode === 'rolling');
    assert.equal((await state(page)).id, 'dave'); assert.equal((await state(page)).bails, 1);
    assert.ok(await page.evaluate(() => window.SHREDDER.game.worldX < 50));
    await key(page, 'KeyP');
  });

  await t.test('explicit 24-pose Canvas fixtures verify both sprite hashes, anchors and one independent board', async () => {
    const evidence = await page.evaluate(() => {
      const { renderer: r, game } = window.SHREDDER;
      const fixtures = {
        roll: {}, push1: { pushPhase: .2 }, push2: { pushPhase: .8 }, crouch: { crouching: true },
        ollie: { mode: 'air' }, flip: { mode: 'air', flip: { at: 0 }, time: .1 },
        catch: { mode: 'air', flip: { at: 0 }, time: game.cfg.flipDuration * .85 },
        manual: { mode: 'manual' }, grind: { mode: 'grind' },
        lean_forward: { mode: 'manual', balanceActive: true, balance: .2 },
        lean_back: { mode: 'manual', balanceActive: true, balance: -.2 }, crash: { mode: 'crash' }
      };
      const results = [];
      for (const id of ['jeff', 'dave']) for (const [pose, values] of Object.entries(fixtures)) {
        window.dudeQA.draws = [];
        // Isolated renderer fixture: no physics or actual run state is changed.
        r.skater({ cfg: game.cfg, mode: 'rolling', time: 0, characterId: id, ...values }, 250, 436, 450);
        results.push({ id, pose, draws: window.dudeQA.draws.slice() });
      }
      return results;
    });
    for (const record of evidence) {
      assert.equal(record.draws.length, 2, record.id + ':' + record.pose);
      assert.match(record.draws[0].key, /^board_/);
      assert.equal(imageHash(record.draws[0].src), fileHash(record.draws[0].key));
      const body = record.draws[1], expected = manifest.characters[record.id].poses[record.pose];
      assert.equal(body.key, expected); assert.equal(imageHash(body.src), fileHash(expected));
      assert.deepEqual(body.args, [-200 / 400 * (400 * 80 / 300), -292 / 300 * 80, 400 * 80 / 300, 80]);
      record.draws = record.draws.map(({ key, src, args }) => ({ key, sha256: imageHash(src), args }));
    }
    fs.writeFileSync(path.join(OUT, 'pose-fixtures.json'), JSON.stringify({ kind: 'Explicit isolated Canvas renderer fixtures, not gameplay traversal', evidence }, null, 2));
  });

  await t.test('explicit result fixture offers Choose dude without resetting score or choice', async () => {
    await page.evaluate(() => {
      // Labeled result UI fixture; the existing browser suite completes the real route.
      const { game, ui } = window.SHREDDER; game.status = 'finished'; game.score = 4321; ui.update(game);
    });
    await page.getByRole('button', { name: 'Choose dude', exact: true }).click();
    assert.equal((await state(page)).score, 4321); assert.equal((await state(page)).id, 'dave');
    assert.equal((await state(page)).status, 'menu');
    await page.locator('#game').focus(); await key(page, 'Enter');
    assert.equal((await state(page)).status, 'playing'); assert.equal((await state(page)).id, 'dave');
    assert.equal((await state(page)).score, 0);
  });

  await t.test('mobile/tablet chooser and dedication fit, use readable text and preserve native choice', async () => {
    for (const [width, height] of [[390, 844], [320, 740], [768, 1024]]) {
      await page.setViewportSize({ width, height }); await page.reload();
      await page.getByRole('radio', { name: 'Jeff', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      for (const selector of ['.dedication', '.dude-chooser', '.dude-card']) {
        for (const node of await page.locator(selector).all()) {
          const box = await node.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width, selector);
        }
      }
      assert.ok(await page.locator('.dedication').evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 14));
      const dave = page.getByRole('radio', { name: 'Dave', exact: true }); await dave.check(); assert.equal((await state(page)).id, 'dave');
      await shot(page, 'chooser-' + width);
    }
  });

  await t.test('normal success has no image/request/console/runtime failures and no network use', () => {
    assert.deepEqual(errors, []); assert.deepEqual(network, []); assert.deepEqual(failed, []);
  });

  await t.test('missing Dave flip fixture blocks start and offers retry rather than silently drawing Jeff', async () => {
    const broken = await context.newPage();
    await broken.addInitScript(() => {
      window.breakDave = true;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(HTMLImageElement.prototype, 'src', { ...descriptor, set(value) {
        descriptor.set.call(this, window.breakDave && value === window.SHREDDER_DATA?.images.dave_flip.src ? 'data:image/png;base64,broken' : value);
      } });
    });
    await broken.goto(URL); await broken.getByRole('button', { name: 'Retry artwork', exact: true }).waitFor();
    await key(broken, 'Enter'); assert.equal((await state(broken)).status, 'menu');
    await broken.evaluate(() => { window.breakDave = false; });
    await broken.getByRole('button', { name: 'Retry artwork', exact: true }).click();
    await broken.getByRole('radio', { name: 'Dave', exact: true }).check();
    await broken.getByRole('button', { name: 'Practice first', exact: true }).click();
    assert.equal((await state(broken)).id, 'dave'); assert.equal((await state(broken)).status, 'playing');
    await broken.close();
  });
});
