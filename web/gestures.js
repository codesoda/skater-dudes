(function (root) {
  'use strict';
  const SLOP = 12, CATCH_SECONDS = .35;
  const HOLD = 'touch-hold', DRAG = 'touch-drag', CATCH = 'touch-catch';
  class Gestures {
    constructor(game, input, feedback = () => {}, now = () => performance.now()) {
      this.game = game; this.input = input; this.feedback = feedback; this.now = now;
      this.contact = null; this.catchUntil = null; this.resetRegion = null;
      input.onClear.add(() => this.cancel());
    }
    get active() { return this.game.status === 'playing' && this.game.mode !== 'crash'; }
    start(x, y) {
      if (!this.active || this.contact) { this.cancel(); return; }
      this.stopCatch();
      this.contact = { x, y, at: this.now(), panned: false, tap: false,
        jump: this.game.mode === 'rolling', balance: this.game.balanceActive,
        manual: false, direction: null, downY: null, turnY: null, downAt: -Infinity,
        leftX: null, leftAt: -Infinity, turnX: null };
      if (this.contact.jump) this.input.feed('Space', true, false, HOLD);
      this.feedback(this.contact.jump ? 'Hold to load · release to pop · drag down to duck' : 'Air: down then up to flip · swipe up to catch');
    }
    tap() { if (this.contact) this.contact.tap = true; }
    direction(code) {
      for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) {
        // A ground manual remains held while the same finger balances sideways.
        const down = key === code || key === 'ArrowUp' && this.contact?.manual;
        this.input.feed(key, down, false, DRAG);
      }
    }
    pan(x, y) {
      const c = this.contact;
      if (!c || !this.active) return;
      const dx = x - (c.turnX ?? c.x), dy = y - (c.turnY ?? c.y);
      if (!c.panned && Math.hypot(dx, dy) <= SLOP) return;
      c.panned = true; this.input.cancelSource(HOLD);
      const g = this.game, horizontal = Math.abs(dx) > Math.abs(dy);
      if (g.balanceActive) c.balance = true;
      // Track a downward stroke's turning point, not only its original origin.
      // This lets Down -> Up win before the end-only Swipe recognizer fires.
      const reversal = g.mode === 'air' && !g.flip && c.downY !== null &&
        this.now() - c.downAt <= 400 && c.downY - y > SLOP;
      if (reversal) {
        c.turnY = c.downY; c.downY = null; c.leftX = null; c.manual = false; this.direction('ArrowUp');
        this.catchUntil = g.time + CATCH_SECONDS;
        c.direction = 'flip'; this.feedback('Kickflip · drag left / right to balance'); return;
      }
      if (Math.hypot(dx, dy) <= SLOP) {
        this.direction(null); c.direction = null; c.leftX = null; c.downY = null; return;
      }
      if (g.mode === 'air' && !g.flip && !c.balance && c.leftX !== null &&
          this.now() - c.leftAt <= 400 && x - c.leftX > SLOP) {
        c.turnX = c.leftX; c.leftX = null; c.downY = null; this.direction('ArrowRight');
        c.balance = true; c.direction = 'tre'; this.feedback('Tre flip · drag left / right to balance'); return;
      }
      if (!horizontal && dy > SLOP) {
        c.manual = false; c.leftX = null; this.stopCatch(); this.direction('ArrowDown');
        if (c.direction !== 'down') { c.downAt = this.now(); c.downY = y; }
        else c.downY = Math.max(c.downY, y);
        c.direction = 'down'; this.feedback(g.mode === 'air' ? 'Drag up now to kickflip' : 'Duck · release to stand (no jump)');
      } else if (!horizontal && dy < -SLOP) {
        if (g.grounded && !c.balance) c.manual = true;
        if (g.mode === 'air') {
          if (c.direction !== 'up') this.catchUntil = g.time + CATCH_SECONDS;
          this.direction(this.catchUntil > g.time ? 'ArrowUp' : null);
        } else this.direction(c.manual ? 'ArrowUp' : null);
        c.direction = 'up'; this.feedback(c.manual ? 'Manual · drag sideways to balance · release to end' : 'Catch window · drag sideways in tricks to balance');
      } else if (horizontal && Math.abs(dx) > SLOP) {
        if (g.mode === 'air' && !g.flip && !c.balance && dx < -SLOP && c.downY === null) {
          if (c.direction !== 'left') { c.leftAt = this.now(); c.leftX = x; this.direction('ArrowLeft'); }
          else c.leftX = Math.min(c.leftX, x);
          c.direction = 'left'; this.feedback('Reverse right now to tre flip'); return;
        }
        const plain = g.mode === 'rolling' && g.jumpZ === 0 && !g.surface;
        this.direction(c.balance && g.balanceActive ? dx > 0 ? 'ArrowRight' : 'ArrowLeft' :
          !c.balance && plain && dx > 0 ? 'ArrowRight' : null);
        c.direction = 'side'; this.feedback(c.balance ? 'Balance · steer toward center' : 'Build speed · release to coast');
      }
    }
    swipe(direction) {
      const c = this.contact;
      // Pan already supplied held actions. Only a quick upward air swipe needs
      // an end-of-contact catch window; never add a second boost or flip edge.
      if (c?.panned && this.game.mode === 'air' && !this.game.flip && direction > 45 && direction < 135) {
        this.input.feed('ArrowUp', true, false, CATCH);
        this.catchUntil = this.game.time + CATCH_SECONDS;
      }
    }
    end(x, y) {
      const c = this.contact;
      if (!c) return;
      if (!this.active || Math.hypot(x - c.x, y - c.y) > SLOP && !c.panned) { this.cancel(); return; }
      if (!c.panned && c.jump && (c.tap || this.now() - c.at >= 300)) this.input.feed('Space', false, false, HOLD);
      else this.input.cancelSource(HOLD);
      this.input.cancelSource(DRAG); this.contact = null; this.feedback('');
    }
    stopCatch() { this.input.cancelSource(CATCH); this.catchUntil = null; }
    update() {
      if (!this.active) { this.cancel(); return; }
      if (this.catchUntil !== null && (this.game.time >= this.catchUntil || this.game.mode !== 'air')) {
        this.stopCatch();
        if (!this.contact?.manual) this.input.feed('ArrowUp', false, false, DRAG);
      }
      if (this.contact && this.game.balanceActive) this.contact.balance = true;
      // A balance hold must never turn into a boost after landing or dropping.
      const plain = this.game.mode === 'rolling' && this.game.jumpZ === 0 && !this.game.surface;
      if (!this.game.balanceActive && (this.contact?.balance || !plain && this.contact?.direction !== 'left')) {
        this.input.feed('ArrowLeft', false, false, DRAG); this.input.feed('ArrowRight', false, false, DRAG);
      }
    }
    cancel() {
      this.input.cancelSource(HOLD); this.input.cancelSource(DRAG); this.stopCatch();
      this.contact = null; this.feedback(''); this.resetRegion?.();
    }
  }
  function attach(canvas, gestures, ZT = root.ZingTouch) {
    // 1.0.6 prefers TouchEvent when both APIs exist, and has no cancel hook.
    // Use its selected stream, native touch capture, and explicit window cleanup.
    const pointer = !!root.PointerEvent && !root.TouchEvent;
    const region = new ZT.Region(canvas, false, false);
    let identifier = null, captured = null;
    const listeners = [];
    function listen(target, type, fn, options = false) {
      target.addEventListener(type, fn, options);
      listeners.push(() => target.removeEventListener(type, fn, options));
    }
    function reset() {
      identifier = null; region.state.resetInputs();
      const id = captured; captured = null;
      if (id !== null) {
        try { if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id); }
        catch (_) { /* The browser may already have revoked capture. Input is canceled above. */ }
      }
    }
    gestures.resetRegion = reset;
    function inside(x, y) {
      const b = canvas.getBoundingClientRect();
      return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
    }
    function guard(e) {
      const start = e.type === (pointer ? 'pointerdown' : 'touchstart');
      const contacts = pointer ? [e] : Array.from(e.touches);
      if (contacts.length > 1 || pointer && e.isPrimary === false) { gestures.cancel(); return; }
      const point = pointer ? e : Array.from(e.changedTouches).find(t => start || t.identifier === identifier);
      if (!point) return;
      if (start) {
        if (identifier !== null || !gestures.active || e.target !== canvas || pointer && e.pointerType === 'mouse') return;
        identifier = pointer ? e.pointerId : point.identifier;
        if (pointer) {
          captured = identifier;
          try { canvas.setPointerCapture?.(identifier); }
          catch (_) { gestures.cancel(); return; }
        }
        canvas.focus({ preventScroll: true }); gestures.input.trusted();
      } else if (identifier === null) return;
      if (!inside(point.clientX, point.clientY)) { gestures.cancel(); return; }
      if (e.cancelable) e.preventDefault();
    }
    for (const type of pointer ? ['pointerdown', 'pointermove', 'pointerup'] : ['touchstart', 'touchmove', 'touchend']) {
      listen(root, type, guard, { capture: true, passive: false });
    }
    // The final bubble listener also covers an end the library discarded.
    listen(root, pointer ? 'pointerup' : 'touchend', () => {
      if (gestures.contact) gestures.cancel(); else reset();
    });
    for (const type of ['pointercancel', 'touchcancel', 'blur', 'orientationchange']) listen(root, type, () => gestures.cancel(), true);
    listen(canvas, 'lostpointercapture', () => { if (captured !== null) gestures.cancel(); });
    listen(root.document, 'visibilitychange', () => { if (root.document.hidden) gestures.cancel(); });
    const tap = new ZT.Tap({ maxDelay: 299, tolerance: SLOP });
    const pan = new ZT.Pan({ threshold: 1 });
    const swipe = new ZT.Swipe({ escapeVelocity: .2 });
    const hold = new ZT.Gesture();
    hold.start = inputs => inputs.length === 1 && identifier !== null ? { phase: 'start', x: inputs[0].current.x, y: inputs[0].current.y } : null;
    hold.move = inputs => {
      if (inputs.length !== 1) gestures.cancel();
      return null;
    };
    hold.end = inputs => inputs.length === 1 ? { phase: 'end', x: inputs[0].current.x, y: inputs[0].current.y } : null;
    // Register explicitly: bare Gesture instances in 1.0.6 otherwise share null IDs.
    for (const [name, recognizer, handler] of [
      ['skate-tap', tap, () => gestures.tap()],
      ['skate-pan', pan, e => {
        const data = e.detail.data[0], c = gestures.contact;
        if (!c || !data) return;
        const angle = data.directionFromOrigin * Math.PI / 180;
        gestures.pan(c.x + Math.cos(angle) * data.distanceFromOrigin, c.y - Math.sin(angle) * data.distanceFromOrigin);
      }],
      ['skate-swipe', swipe, e => gestures.swipe(e.detail.data[0].currentDirection)],
      ['skate-hold', hold, e => {
        if (e.detail.phase === 'start') gestures.start(e.detail.x, e.detail.y);
        else gestures.end(e.detail.x, e.detail.y);
      }]
    ]) { region.register(name, recognizer); region.bind(canvas, name, handler); }
    return () => { gestures.cancel(); region.unbind(canvas); for (const remove of listeners) remove(); };
  }
  const api = { Gestures, attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ShredderGestures = api;
})(typeof window !== 'undefined' ? window : globalThis);
