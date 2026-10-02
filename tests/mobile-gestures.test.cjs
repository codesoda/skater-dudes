'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium, webkit } = require('playwright');
const { lightJumpPhase } = require('./route-light-jump.js');
const { shouldLoadCharge } = require('./route-charged-jump.js');
const { routeTarget } = require('./route-target.js');
const settings = require('../settings.json');
const OUT = path.join(__dirname, 'artifacts/mobile-gestures');
const URL = pathToFileURL(path.join(__dirname, '../index.html')).href;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function state(page) {
  return page.evaluate(() => {
    const g = window.SHREDDER.game;
    const support = g.surface && g.objects.flatMap(o => g.solidParts(o)).find(o => o.id === g.surface);
    return { status: g.status, mode: g.mode, x: g.worldX, z: g.jumpZ, velocity: g.velocityZ, time: g.time,
      speed: g.currentSpeed, charge: g.charge, gauge: g.chargeVisible, crouch: g.crouching, flip: !!g.flip,
      balance: g.balance, bails: g.bails, keys: g.keys, space: !!g.space, surface: g.surface,
      supportEnd: support ? support.x + support.width + g.cfg.boardHalfWidth : null,
      ollies: window.mobileQA.events.filter(e => e.type === 'ollie').length };
  });
}
async function until(page, predicate, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await state(page); if (predicate(value)) return value; await wait(15); }
  assert.fail('Mobile state timeout: ' + JSON.stringify(await state(page)));
}
async function observe(page) {
  await page.evaluate(() => {
    const qa = window.mobileQA = { native: [], recognizers: { tap: 0, pan: 0, swipe: 0, start: 0, end: 0 }, events: [] };
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointercancel']) {
      window.addEventListener(type, e => qa.native.push({ type, trusted: e.isTrusted, pointerId: e.pointerId, at: performance.now() }), true);
    }
    const { gestures, game } = window.SHREDDER;
    for (const name of Object.keys(qa.recognizers)) {
      const original = gestures[name].bind(gestures);
      gestures[name] = (...args) => { qa.recognizers[name]++; return original(...args); };
    }
    const emit = game.emit.bind(game);
    game.emit = (type, detail) => { qa.events.push({ type, x: game.worldX, z: game.jumpZ, at: game.time }); return emit(type, detail); };
  });
}
async function point(page, fx = .5, fy = .5) {
  const b = await page.locator('#game').boundingBox(); return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}
async function restart(page) { await page.keyboard.press('KeyR'); await wait(50); }
async function screenshot(page, name) { await page.screenshot({ path: path.join(OUT, name + '.png') }); }
async function cdpTouch(context, page) {
  const cdp = await context.newCDPSession(page); let current;
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ ...p, id: 1, radiusX: 3, radiusY: 3, force: 1 })) });
  return {
    async start(p) { current = p; await send('touchStart', [p]); },
    async move(p) { current = p; await send('touchMove', [p]); },
    async end() { await send('touchEnd', []); },
    async cancel() { await send('touchCancel', []); },
    async second() { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...current, id: 1 }, { x: current.x + 30, y: current.y, id: 2 }] }); },
    async swipe(p, dx, dy) {
      await this.start(p);
      // ZingTouch needs >2 native moves and measures the final pair's velocity.
      // Leave most of the displacement for that pair, not a latency-sensitive 10px.
      for (const fraction of [.1, .25, 1]) { await wait(17); await this.move({ x: p.x + dx * fraction, y: p.y + dy * fraction }); }
      await this.end();
    }
  };
}
async function fixtureTouch(page, type, p, id = 1) {
  // Explicit synthetic WebKit lifecycle fixture. Playwright only exposes trusted
  // touchscreen.tap for this engine; this is NOT physical Safari drag evidence.
  await page.evaluate(({ type, p, id }) => {
    const canvas = document.getElementById('game');
    const touch = { identifier: id, target: canvas, clientX: p.x, clientY: p.y, pageX: p.x, pageY: p.y };
    const active = !['touchend', 'touchcancel'].includes(type);
    // WebKit exposes Touch but rejects its constructor. Keep this synthetic
    // fixture explicit: a TouchEvent with read-only contact-list test data.
    const event = new TouchEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      touches: { value: active ? [touch] : [] }, targetTouches: { value: active ? [touch] : [] },
      changedTouches: { value: [touch] }
    });
    canvas.dispatchEvent(event);
  }, { type, p, id });
}

test('Chromium phone: trusted normal-clock gestures and real street hazards, no virtual pad', { timeout: 110000 }, async t => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, offline: true });
  const page = await context.newPage(), errors = [], network = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
  await page.goto(URL); await page.getByRole('button', { name: 'Practice first', exact: true }).waitFor(); await observe(page);
  const touch = await cdpTouch(context, page);
  await t.test('portrait menu scrolls normally, first-play guide replaces keyboard-only footer, no autoplay', async () => {
    assert.equal(await page.evaluate(() => window.SHREDDER.audio.ctx), null);
    assert.match(await page.locator('.guide').innerText(), /One finger anywhere/);
    assert.match(await page.locator('.keyline').innerText(), /One finger/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#game').evaluate(el => getComputedStyle(el).touchAction), 'auto');
    await screenshot(page, 'chromium-portrait-menu');
    await page.getByRole('button', { name: 'Practice first', exact: true }).tap();
    assert.equal(await page.locator('#game').evaluate(el => getComputedStyle(el).touchAction), 'none');
    assert.equal(await page.locator('#stage button:visible').count(), 0);
  });
  await t.test('trusted taps in different canvas and HUD spots produce identical small release ollies', async () => {
    for (const [x, y] of [[.2, .3], [.75, .75], [.15, .05]]) {
      await restart(page); const before = (await state(page)).ollies;
      const p = await point(page, x, y); await touch.start(p); await wait(80);
      assert.equal((await state(page)).mode, 'rolling'); assert.equal((await state(page)).gauge, false);
      await touch.end(); await until(page, s => s.mode === 'air');
      assert.equal((await state(page)).ollies, before + 1);
      assert.equal(await page.evaluate(() => window.SHREDDER.game.popCharge), 0);
    }
    assert.ok(await page.evaluate(() => window.mobileQA.recognizers.tap >= 3));
    await screenshot(page, 'chromium-portrait-tap');
  });
  await t.test('stationary 900 ms charge survives jitter and keeps waiting for release', async () => {
    await restart(page); const p = await point(page); await touch.start(p); await wait(180);
    assert.equal((await state(page)).gauge, false);
    await touch.move({ x: p.x + 5, y: p.y + 4 }); await wait(250);
    assert.equal((await state(page)).gauge, true); assert.ok((await state(page)).charge > .05);
    await wait(650); assert.equal((await state(page)).charge, 1); assert.equal((await state(page)).mode, 'rolling');
    await screenshot(page, 'chromium-full-charge'); await touch.end();
    await until(page, s => s.mode === 'air'); assert.equal(await page.evaluate(() => window.SHREDDER.game.popCharge), 1);
  });
  await t.test('trusted Chromium Swipe emits real velocity and carries a bounded catch pulse across release', async () => {
    await restart(page);
    const p = await point(page, .5, .85), box = await page.locator('#game').boundingBox();
    await touch.start(p); await wait(1050); await touch.end(); await until(page, s => s.mode === 'air');
    await page.evaluate(() => {
      const { gestures, game } = window.SHREDDER, canvas = document.getElementById('game');
      const qa = window.swipeQA = { native: [], emitted: [], callbacks: [], frames: [] };
      const snapshot = () => ({ at: performance.now(), time: game.time, mode: game.mode,
        up: game.keys.Up, contact: !!gestures.contact, catchUntil: gestures.catchUntil,
        owners: [...(gestures.input.owners.get('ArrowUp') || [])] });
      const native = e => qa.native.push({ type: e.type, trusted: e.isTrusted,
        at: performance.now(), date: Date.now(), x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY });
      for (const type of ['touchstart', 'touchmove', 'touchend']) window.addEventListener(type, native, true);
      // Observe the library's actual CustomEvent before its handlers consume it.
      // Native trust belongs to the input events, not the emitted CustomEvent.
      const dispatch = canvas.dispatchEvent;
      canvas.dispatchEvent = function (event) {
        if (event.detail?.data?.[0]?.velocity !== undefined) {
          qa.emitted.push({ type: event.type, data: event.detail.data, ...snapshot() });
        }
        return dispatch.call(this, event);
      };
      const originals = { swipe: gestures.swipe, end: gestures.end };
      for (const name of Object.keys(originals)) gestures[name] = function (...args) {
        const before = snapshot(), result = originals[name].apply(this, args);
        qa.callbacks.push({ name, before, after: snapshot() }); return result;
      };
      let frame;
      const sample = () => { if (qa.frames.length < 180) qa.frames.push(snapshot()); frame = requestAnimationFrame(sample); };
      frame = requestAnimationFrame(sample);
      window.stopSwipeQA = () => {
        cancelAnimationFrame(frame); canvas.dispatchEvent = dispatch;
        Object.assign(gestures, originals);
        for (const type of ['touchstart', 'touchmove', 'touchend']) window.removeEventListener(type, native, true);
      };
    });
    let failure;
    try {
      // The 70%-height stroke stays inside the portrait canvas. Its final 75%
      // segment is ~100 CSS px, leaving headroom for real CDP/frame latency.
      await touch.swipe(p, 0, -box.height * .7);
      // Wait for browser-side history, not a transport-delayed Up snapshot.
      await page.waitForFunction(() => {
        const qa = window.swipeQA, end = qa.callbacks.find(e => e.name === 'end');
        return end && qa.frames.some(f => f.time >= end.after.catchUntil && !f.up && f.catchUntil === null);
      }, null, { timeout: 2000 });
      const qa = await page.evaluate(() => window.swipeQA);
      const moves = qa.native.filter(e => e.type === 'touchmove');
      assert.ok(qa.native.every(e => e.trusted)); assert.equal(moves.length, 3);
      assert.ok(moves[1].y - moves[2].y > 70);
      for (const e of qa.native) assert.ok(e.x >= box.x && e.x <= box.x + box.width && e.y >= box.y && e.y <= box.y + box.height);
      assert.equal(qa.emitted.length, 1);
      const emitted = qa.emitted[0], data = emitted.data[0];
      assert.ok(data.velocity >= .2); assert.ok(data.duration > 0);
      assert.ok(Math.abs(data.velocity - data.distance / data.duration) < .000001);
      assert.ok(data.currentDirection > 45 && data.currentDirection < 135);
      assert.equal(emitted.mode, 'air'); assert.equal(emitted.contact, true);
      const swipe = qa.callbacks.find(e => e.name === 'swipe'), end = qa.callbacks.find(e => e.name === 'end');
      assert.ok(swipe.after.owners.includes('touch-catch'));
      assert.equal(end.before.contact, true); assert.equal(end.after.contact, false);
      assert.deepEqual(end.after.owners, ['touch-catch']);
      assert.ok(Math.abs(end.after.catchUntil - swipe.after.time - .35) < .000001);
      const held = qa.frames.filter(f => !f.contact && f.up && f.time >= end.after.time);
      assert.ok(held.length > 0, 'Catch must remain active after native release');
      const expired = qa.frames.find(f => f.time >= end.after.catchUntil && !f.up && f.catchUntil === null);
      assert.ok(expired, 'Catch must expire on the real simulation clock');
      assert.equal(expired.mode, 'air');
      // rAF may observe eight fixed catch-up steps plus the expiry boundary.
      assert.ok(expired.time - end.after.catchUntil <= 9 / 60);
      assert.equal((await state(page)).bails, 0);
    } catch (error) { failure = error; throw error; }
    finally {
      const evidence = await page.evaluate(() => { window.stopSwipeQA(); return window.swipeQA; });
      fs.writeFileSync(path.join(OUT, 'trusted-swipe.json'), JSON.stringify({ engine: browser.version(), error: failure?.stack, ...evidence }, null, 2));
      if (failure) {
        const directory = path.join(__dirname, 'artifacts/ci-browser'); fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'trusted-swipe.json'), JSON.stringify({ error: failure.stack, ...evidence }, null, 2));
      }
    }
  });
  await t.test('drag down cancels pending charge, crouches immediately, and never jumps on release', async () => {
    await restart(page); const p = await point(page), before = (await state(page)).ollies;
    await touch.start(p); await wait(450); await touch.move({ x: p.x, y: p.y + 35 }); await wait(80);
    assert.equal((await state(page)).crouch, true); assert.equal((await state(page)).space, false);
    await touch.end(); await wait(60); assert.equal((await state(page)).crouch, false);
    assert.equal((await state(page)).ollies, before);
  });
  await t.test('right hold boosts through real physics; release has bounded eight-second coast', async () => {
    await restart(page); const p = await point(page); await touch.start(p); await touch.move({ x: p.x + 45, y: p.y });
    await wait(820); assert.equal((await state(page)).speed, 392); await touch.end(); await wait(50);
    const released = await state(page); assert.equal(released.keys.Right, false);
    await wait(4000); const midway = await state(page); assert.ok(midway.speed > 328 && midway.speed < 340);
    await until(page, s => s.speed === 280, 4500);
    const end = await state(page); assert.ok(end.time - released.time >= 7.8 && end.time - released.time < 8.3);
  });
  await t.test('manual and early down-up air reversal use continuous pan balance, not screen zones', async () => {
    await restart(page); const p = await point(page);
    await touch.start(p); await touch.move({ x: p.x, y: p.y - 30 }); await wait(70);
    assert.equal((await state(page)).mode, 'manual');
    await touch.move({ x: p.x - 60, y: p.y - 30 }); await wait(80); const left = await state(page);
    assert.equal(left.keys.Left, true); assert.equal(left.keys.Up, true);
    await touch.move({ x: p.x + 60, y: p.y - 30 }); await wait(70);
    assert.ok((await state(page)).balance > left.balance); assert.equal((await state(page)).speed, 280);
    await touch.end(); await until(page, s => s.mode === 'rolling');
    await restart(page); await touch.start(p); await wait(1050); await touch.end(); await until(page, s => s.mode === 'air');
    await touch.start(p); await touch.move({ x: p.x, y: p.y + 40 }); await wait(40);
    await touch.move({ x: p.x, y: p.y + 20 }); await until(page, s => s.flip);
    await touch.move({ x: p.x - 50, y: p.y + 15 }); await wait(65);
    assert.equal((await state(page)).keys.Left, true); await screenshot(page, 'chromium-air-flip-balance'); await touch.end();
    await until(page, s => s.mode === 'rolling'); assert.equal((await state(page)).bails, 0);
  });
  await t.test('trusted cancel and multiple contacts abandon the hold, fresh starts still work', async () => {
    for (const action of ['cancel', 'second']) {
      await restart(page); const p = await point(page), before = (await state(page)).ollies;
      await touch.start(p); await wait(450); await touch[action]();
      if (action === 'second') await touch.end();
      await wait(50); assert.equal((await state(page)).space, false); assert.equal((await state(page)).ollies, before);
      await touch.start(p); await wait(60); await touch.end(); await until(page, s => s.mode === 'air');
    }
  });
  await t.test('pause/help/restart/blur/orientation/visibility lifecycle fixtures cannot rearm an old contact', async () => {
    for (const action of ['KeyP', 'KeyI', 'KeyR', 'blur', 'orientationchange', 'visibilitychange']) {
      await restart(page); const p = await point(page), before = (await state(page)).ollies;
      await touch.start(p); await wait(350);
      if (action.startsWith('Key')) await page.keyboard.press(action);
      else await page.evaluate(type => {
        if (type === 'visibilitychange') {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event(type)); delete document.hidden;
        } else window.dispatchEvent(new Event(type));
      }, action);
      await touch.move({ x: p.x + 25, y: p.y }); await touch.end(); await wait(40);
      assert.equal((await state(page)).space, false); assert.equal((await state(page)).ollies, before);
      if ((await state(page)).status === 'paused') await page.keyboard.press(action === 'KeyI' ? 'KeyI' : 'KeyP');
    }
  });
  await t.test('trusted pointer-only compatibility stream captures and cancels when dragged outside the canvas', async () => {
    const pointerPage = await context.newPage();
    await pointerPage.addInitScript(() => { window.TouchEvent = undefined; });
    pointerPage.on('pageerror', e => errors.push(e.message));
    pointerPage.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
    await pointerPage.goto(URL); await pointerPage.getByRole('button', { name: 'Practice first', exact: true }).tap();
    await observe(pointerPage); const driver = await cdpTouch(context, pointerPage), p = await point(pointerPage);
    await driver.start(p); await wait(350); assert.equal((await state(pointerPage)).gauge, true);
    assert.equal(await pointerPage.locator('#game').evaluate(el => {
      const event = window.mobileQA.native.find(e => e.type === 'pointerdown');
      return !!event?.trusted && el.hasPointerCapture(event.pointerId) && window.SHREDDER.gestures.contact !== null && el.matches(':focus');
    }), true);
    await driver.move({ x: p.x, y: 2 }); await driver.end(); await wait(40);
    assert.equal((await state(pointerPage)).space, false); assert.equal((await state(pointerPage)).ollies, 0);
    await driver.start(p); await wait(350); await driver.cancel(); await wait(40);
    assert.equal((await state(pointerPage)).space, false); assert.equal((await state(pointerPage)).ollies, 0);
    await pointerPage.close();
  });
  await t.test('landscape real route clears eleven hazards including charged obstacles, rail and two duck bars', async () => {
    await page.bringToFront();
    if ((await state(page)).status === 'playing') await page.keyboard.press('KeyP');
    await page.getByRole('button', { name: 'Choose dude', exact: true }).tap();
    await page.setViewportSize({ width: 844, height: 390 });
    await page.getByRole('button', { name: 'Ride the street', exact: false }).tap();
    await page.locator('#game').scrollIntoViewIfNeeded();
    const p = await point(page), box = await page.locator('#game').boundingBox();
    assert.ok(Math.abs(box.width / box.height - 16 / 9) < .02);
    const toolbar = await page.locator('.toolbar').boundingBox(); assert.ok(toolbar.y >= 0 && toolbar.y + toolbar.height < 390);
    const objects = await page.evaluate(() => window.SHREDDER.game.objects.filter(o => o.type !== 'crack'));
    let target = null, phase = '', finger = false, catching = false, duck = false;
    const started = Date.now(), routeStart = await page.evaluate(() => window.mobileQA.events.length);
    while ((await state(page)).x < 9410 && Date.now() - started < 42000) {
      const s = await state(page); assert.equal(s.bails, 0, JSON.stringify(s));
      const object = routeTarget(objects, s, target);
      if (!object) break;
      if (object.id !== target) { target = object.id; phase = ''; catching = false; }
      const distance = object.x - s.x;
      if (finger && !duck && !['loading', 'light-ready'].includes(phase) && s.mode !== 'grind') { await touch.end(); finger = false; }
      if (duck && s.x > object.x + object.width + 25) { await touch.end(); finger = false; duck = false; }
      if (object.type === 'low_bar') {
        if (!finger && distance < 160) { await touch.start(p); await touch.move({ x: p.x, y: p.y + 35 }); finger = true; duck = true; }
        if (distance < 0 && distance > -80) assert.equal(s.crouch, true);
      } else if (s.mode === 'rolling' && !phase) {
        if (object.charged && shouldLoadCharge(object, s, settings) || !object.charged && lightJumpPhase('', distance) === 'light-ready') {
          await touch.start(p); finger = true; phase = object.charged ? 'loading' : 'light-ready';
        }
      } else if (finger && (phase === 'loading' && distance <= (object.popDistance || 110) || phase === 'light-ready' && lightJumpPhase(phase, distance) === 'jumped')) {
        await touch.end(); finger = false; phase = 'jumped';
      }
      if (object.type === 'rail' && phase === 'jumped' && s.mode === 'air' && s.velocity < 0 && s.z < 145 && !catching) {
        await touch.swipe(p, 0, -40); catching = true;
      }
      if (s.mode === 'grind' && !finger) { await touch.start(p); await touch.move({ x: p.x - 35, y: p.y }); finger = true; }
      if (finger && s.mode === 'grind' && s.balance < -.06) { await touch.move(p); }
      if (finger && !duck && phase === 'jumped' && s.mode !== 'grind' && object.type === 'rail') { await touch.end(); finger = false; }
      await wait(15);
      if (duck && (await state(page)).x > object.x + object.width + 25) { await touch.end(); finger = false; duck = false; }
    }
    if (finger) await touch.end();
    const final = await state(page), events = await page.evaluate(i => window.mobileQA.events.slice(i), routeStart);
    assert.ok(final.x >= 9410); assert.equal(final.bails, 0); assert.ok(events.some(e => e.type === 'grind'));
    assert.ok(events.filter(e => e.type === 'ollie').length >= 8);
    await screenshot(page, 'chromium-landscape-real-route');
    fs.writeFileSync(path.join(OUT, 'trusted-touch-route.json'), JSON.stringify({ final, events, wallSeconds: (Date.now() - started) / 1000,
      controller: 'Chromium CDP trusted touch start/move/end; normal clock; read-only state feedback; no teleports, key calls or physics writes' }, null, 2));
  });
  await t.test('both library recognition and offline runtime are clean', async () => {
    const evidence = await page.evaluate(() => window.mobileQA);
    assert.ok(evidence.recognizers.pan > 10); assert.ok(evidence.recognizers.swipe > 0);
    assert.ok(evidence.native.filter(e => e.type.startsWith('touch')).every(e => e.trusted));
    assert.deepEqual(errors, []); assert.deepEqual(network, []);
    fs.writeFileSync(path.join(OUT, 'chromium-evidence.json'), JSON.stringify({ engine: browser.version(), errors, network, ...evidence }, null, 2));
  });
});

test('WebKit phone: trusted taps plus explicitly synthetic long-gesture/cancel fixtures', { timeout: 30000 }, async t => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await webkit.launch({ headless: true }); t.after(() => browser.close());
  // WebKit's offline emulation rejects file:// navigation itself. Deny HTTP(S)
  // instead, and assert zero attempted network requests below.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.route(/^https?:/, route => route.abort());
  const page = await context.newPage(), errors = [], network = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
  await page.goto(URL); await page.getByRole('button', { name: 'Practice first', exact: true }).waitFor(); await observe(page);
  await screenshot(page, 'webkit-portrait-menu'); await page.getByRole('button', { name: 'Practice first', exact: true }).tap();
  await t.test('actual trusted touchscreen.tap works at different positions', async () => {
    for (const xy of [[.2, .25], [.75, .7]]) {
      await restart(page); const p = await point(page, ...xy); await page.touchscreen.tap(p.x, p.y);
      await until(page, s => s.mode === 'air'); assert.equal(await page.evaluate(() => window.SHREDDER.game.popCharge), 0);
    }
    const trusted = await page.evaluate(() => window.mobileQA.native.filter(e => e.type === 'touchstart'));
    assert.ok(trusted.length >= 2 && trusted.every(e => e.trusted));
  });
  await t.test('synthetic TouchEvent fixture recognizes hold, Pan, Swipe, and touchcancel on the real bundle', async () => {
    await restart(page); const p = await point(page), before = (await state(page)).ollies;
    await fixtureTouch(page, 'touchstart', p); await wait(1020); assert.equal((await state(page)).charge, 1);
    await fixtureTouch(page, 'touchmove', { x: p.x, y: p.y + 35 }); await wait(60);
    assert.equal((await state(page)).space, false); assert.equal((await state(page)).crouch, true);
    await fixtureTouch(page, 'touchcancel', { x: p.x, y: p.y + 35 }); await wait(40);
    assert.equal((await state(page)).ollies, before); assert.equal((await state(page)).crouch, false);
    await fixtureTouch(page, 'touchstart', p); await wait(1000); await fixtureTouch(page, 'touchend', p);
    await until(page, s => s.mode === 'air'); await fixtureTouch(page, 'touchstart', p);
    for (let n = 1; n <= 4; n++) { await wait(20); await fixtureTouch(page, 'touchmove', { x: p.x, y: p.y - 10 * n }); }
    await fixtureTouch(page, 'touchend', { x: p.x, y: p.y - 40 }); await wait(35);
    assert.equal((await state(page)).keys.Up, true); await wait(400); assert.equal((await state(page)).keys.Up, false);
    const recognizers = await page.evaluate(() => window.mobileQA.recognizers);
    assert.ok(recognizers.pan >= 4); assert.ok(recognizers.swipe >= 1);
    await page.setViewportSize({ width: 844, height: 390 }); await screenshot(page, 'webkit-landscape-fixture');
    await page.getByRole('button', { name: 'Controls / I', exact: true }).tap();
    assert.match(await page.locator('.overlay').innerText(), /One finger. Anywhere/);
    assert.equal(await page.locator('#game').evaluate(el => getComputedStyle(el).touchAction), 'auto');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await screenshot(page, 'webkit-landscape-help');
  });
  await t.test('synthetic pointer-only Safari API-selection fixture captures and cancels without stale rearm', async () => {
    const pointerPage = await context.newPage();
    await pointerPage.addInitScript(() => { window.TouchEvent = undefined; });
    pointerPage.on('pageerror', e => errors.push(e.message));
    pointerPage.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
    await pointerPage.goto(URL); await pointerPage.getByRole('button', { name: 'Practice first', exact: true }).click();
    await observe(pointerPage);
    await pointerPage.evaluate(() => {
      const canvas = document.getElementById('game'), b = canvas.getBoundingClientRect();
      window.pointerFixture = type => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true,
        pointerId: 44, pointerType: 'touch', isPrimary: true, buttons: type === 'pointerup' ? 0 : 1,
        clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 }));
      // Synthetic IDs cannot acquire native capture; the fixture checks our
      // lost-capture path, not an OS pointer driver.
      canvas.setPointerCapture = id => { window.fixtureCaptured = id; };
      canvas.hasPointerCapture = id => window.fixtureCaptured === id;
      canvas.releasePointerCapture = () => { window.fixtureCaptured = null; };
      window.pointerFixture('pointerdown');
    });
    await wait(350); assert.equal((await state(pointerPage)).gauge, true);
    await pointerPage.evaluate(() => window.pointerFixture('lostpointercapture')); await wait(40);
    assert.equal((await state(pointerPage)).space, false);
    await pointerPage.evaluate(() => { window.pointerFixture('pointermove'); window.pointerFixture('pointerup'); }); await wait(30);
    assert.equal((await state(pointerPage)).ollies, 0); await pointerPage.close();
  });
  assert.deepEqual(errors, []); assert.deepEqual(network, []);
  fs.writeFileSync(path.join(OUT, 'webkit-evidence.json'), JSON.stringify({ engine: browser.version(), errors, network,
    limitation: 'Trusted touchscreen taps; synthetic TouchEvent/PointerEvent lifecycle fixtures for long gestures. Not real Safari hardware.',
    evidence: await page.evaluate(() => window.mobileQA) }, null, 2));
});
