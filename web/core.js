(function (root) {
  'use strict';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const EPS = 1e-8;
  class Game {
    #characterId = 'jeff';
    get characterId() { return this.#characterId; }
    selectCharacter(identifier) {
      if (this.status !== 'menu' || !['jeff', 'dave'].includes(identifier)) return false;
      this.#characterId = identifier; return true;
    }
    chooseDude() {
      this.status = 'menu'; this.clearInput(); this.events = []; this.pushPhase = 0;
    }
    constructor(settings, course) {
      this.cfg = settings; this.course = course; this.practice = false;
      this.practiceObstacles = false; this.events = []; this.restart(false);
    }
    restart(play = true, practice = this.practice, challenges = this.practiceObstacles) {
      this.practice = practice; this.practiceObstacles = challenges;
      this.currentSpeed = this.cfg.speed;
      this.time = 0; this.worldX = 0; this.laneY = 0; this.jumpZ = 0; this.velocityZ = 0;
      this.status = play ? 'playing' : 'menu'; this.mode = 'rolling'; this.surface = null;
      this.previous = { worldX: 0, jumpZ: 0, laneY: 0 };
      this.score = 0; this.bestCombo = 0; this.bails = 0; this.checkpoint = 0;
      this.clearedHazards = [];
      this.combo = 0; this.multiplier = 1; this.repeats = {}; this.trick = '';
      this.balance = 0; this.unsafeTime = 0; this.flip = null; this.rollTime = 0;
      this.pushClock = 0; this.pushPhase = 0; this.pushAge = Infinity; this.distance = 0; this.events = [];
      this.popCharge = null; this.ignoredRail = null; this.ignoreRailUntil = 0;
      this.clearInput(); this.message = ''; this.crashUntil = 0;
    }
    get objects() {
      return this.practice ? (this.practiceObstacles ? this.course.practiceObjects : []) : this.course.objects;
    }
    get grounded() { return this.mode === 'rolling' || this.mode === 'manual'; }
    get boosting() {
      return this.status === 'playing' && this.mode === 'rolling' && this.jumpZ === 0 &&
        !this.surface && !!this.keys.Right && !this.space && !this.keys.Space &&
        !this.keys.Down && !this.keys.Up && !this.balanceActive;
    }
    moveHorizontal(dt) {
      const base = this.cfg.speed, target = this.boosting ? base * this.cfg.speedMultiplier : base;
      const old = clamp(this.currentSpeed, base, base * this.cfg.speedMultiplier);
      const rate = target > old ? this.cfg.speedAcceleration :
        -(this.mode === 'grind' ? this.cfg.grindSpeedCoast : this.cfg.speedCoast);
      const ramp = Math.min(dt, Math.abs((target - old) / rate));
      this.currentSpeed = clamp(old + rate * ramp, base, base * this.cfg.speedMultiplier);
      // Integrate the ramp and capped remainder, including the exact cap time.
      const motion = (old + this.currentSpeed) * .5 * ramp + this.currentSpeed * (dt - ramp);
      this.worldX += motion; this.distance += motion;
    }
    get charge() {
      if (!this.space || !this.grounded || this.status !== 'playing') return 0;
      const elapsed = this.time - this.space.at - this.cfg.tapThreshold;
      if (elapsed <= EPS) return 0;
      return elapsed + EPS >= this.cfg.fullChargeTime ? 1 : clamp(elapsed / this.cfg.fullChargeTime, 0, 1);
    }
    get chargeVisible() {
      return this.status === 'playing' && this.grounded && !!this.space &&
        this.time - this.space.at + EPS >= this.cfg.tapThreshold;
    }
    get crouching() { return this.grounded && (this.chargeVisible || !!this.keys.Down); }
    get balanceActive() { return !!this.flip || this.mode === 'grind' || this.mode === 'manual'; }
    emit(type, detail = {}) { this.events.push({ type, at: this.time, ...detail }); }
    drainEvents() { return this.events.splice(0); }
    clearInput() {
      this.keys = {}; this.space = null; this.downAt = -Infinity;
      this.pushClock = 0; this.pushPhase = 0; this.pushAge = Infinity;
      if (this.mode === 'manual') this.endManual();
    }
    pause() {
      if (this.status !== 'playing') return;
      this.status = 'paused'; this.clearInput(); this.pushPhase = 0;
    }
    resume() { if (this.status === 'paused') { this.status = 'playing'; this.clearInput(); } }
    key(key, pressed) {
      if (this.status !== 'playing' || this.mode === 'crash') return;
      if (!!this.keys[key] === pressed) return; // Ignore repeated keydown, including gesture repeats.
      this.keys[key] = pressed;
      if (key === 'Space') { if (pressed) this.pressSpace(); else this.releaseSpace(); }
      if (key === 'Down' && pressed) {
        this.downAt = this.time;
        if (this.mode === 'manual') this.endManual();
        if (this.mode === 'grind') this.dropRail();
      }
      if (key === 'Up' && pressed && this.mode === 'air' && !this.flip &&
          this.time - this.downAt <= this.cfg.gestureWindow + EPS) {
        this.downAt = -Infinity; this.flip = { at: this.time, done: false };
        this.balance = 0; this.trick = 'KICKFLIP'; this.emit('flip');
      }
      if (key === 'Up' && !pressed && this.mode === 'manual') this.endManual();
    }
    pressSpace() {
      if (this.mode === 'grind') { this.pop(0.45); return; }
      if (!this.grounded) return;
      if (this.mode === 'manual') this.endManual();
      this.space = { at: this.time }; this.pushPhase = 0;
    }
    // A touch changing into a drag abandons its hold; it must not pop.
    cancelSpaceHold() { this.space = null; this.keys.Space = false; }
    releaseSpace() {
      if (!this.space) return;
      const charge = this.charge;
      this.space = null;
      if (!this.grounded) return;
      this.pop(charge);
    }
    pop(charge) {
      this.mode = 'air'; this.surface = null; this.space = null;
      this.velocityZ = this.cfg.lightPopVelocity + charge * (this.cfg.fullPopVelocity - this.cfg.lightPopVelocity);
      this.popCharge = charge; this.rollTime = 0; this.pushPhase = 0; this.message = '';
      this.emit('ollie');
    }
    award(name, points) {
      const count = this.repeats[name] || 0; this.repeats[name] = count + 1;
      this.multiplier = Math.min(8, 1 + Object.values(this.repeats).reduce((a, b) => a + b, 0) - 1);
      this.combo += Math.round(points / (1 + count * 0.4)); this.trick = name; this.rollTime = 0;
    }
    bank() {
      if (!this.combo) return;
      const total = Math.round(this.combo * this.multiplier);
      this.score += total; this.bestCombo = Math.max(this.bestCombo, total);
      this.combo = 0; this.multiplier = 1; this.repeats = {}; this.emit('bank', { total });
    }
    endManual() { this.mode = 'rolling'; this.rollTime = 0; this.unsafeTime = 0; }
    dropRail() {
      this.ignoredRail = this.surface; // Deliberate dismount passes this beam, not other obstacles.
      this.mode = 'air'; this.surface = null; this.velocityZ = 0;
      this.ignoreRailUntil = this.time + 0.2; this.unsafeTime = 0;
    }
    bail(reason) {
      if (this.mode === 'crash') return;
      this.currentSpeed = this.cfg.speed;
      this.mode = 'crash'; this.bails++; this.combo = 0; this.repeats = {}; this.multiplier = 1;
      this.flip = null; this.clearInput(); this.pushPhase = 0; this.message = reason;
      this.crashUntil = this.time + this.cfg.recoveryTime; this.emit('crash');
    }
    recover() {
      this.currentSpeed = this.cfg.speed;
      this.worldX = this.retryTarget(); this.jumpZ = 0; this.velocityZ = 0;
      this.clearedHazards = this.clearedHazards.filter(point => point.x <= this.worldX);
      this.mode = 'rolling'; this.surface = null; this.balance = 0; this.unsafeTime = 0;
      this.clearInput(); this.message = ''; this.pushClock = 0; this.rollTime = 0;
      this.popCharge = null; this.ignoredRail = null;
      this.previous = { worldX: this.worldX, jumpZ: 0, laneY: this.laneY }; this.emit('recover');
    }
    get hazards() {
      return this.objects.filter(o => ['curb', 'cone', 'jersey_barrier', 'stairs', 'gap', 'rail', 'ledge', 'bench', 'low_bar'].includes(o.type) && this.inLane(o));
    }
    recordClearances() {
      // Passing an exit in the air is not success: wait for a clean flat landing.
      if (!this.grounded || this.surface || this.jumpZ !== 0 || this.flip) return;
      for (const o of this.hazards) {
        if (this.worldX - this.cfg.boardHalfWidth <= o.x + o.width) continue;
        if (!this.clearedHazards.some(point => point.id === o.id)) {
          this.clearedHazards.push({ id: o.id, x: o.x + o.width + this.cfg.boardHalfWidth + 8 });
        }
      }
    }
    retryTarget() {
      const hazards = this.hazards, half = this.cfg.boardHalfWidth;
      const points = this.clearedHazards.map(point => point.x).sort((a, b) => b - a);
      for (const x of points) {
        if (x > this.worldX || hazards.some(o => this.overlapping(o, x))) continue;
        const next = hazards.filter(o => o.x >= x + half).sort((a, b) => a.x - b.x)[0];
        if (!next || next.x - half - x >= this.cfg.speed * 1.4) return x;
      }
      return 0;
    }
    holdDistance(o) {
      return (o.popDistance || 110) + this.currentSpeed * (this.cfg.tapThreshold + this.cfg.fullChargeTime + 0.2);
    }
    inLane(o) { return Math.abs((o.laneY || 0) - this.laneY) < (o.depth || 40) / 2 + this.cfg.laneHalfWidth; }
    overlapping(o, x = this.worldX) { return x + this.cfg.boardHalfWidth > o.x && x - this.cfg.boardHalfWidth < o.x + o.width; }
    gapAt(x) { return this.objects.some(o => o.type === 'gap' && this.inLane(o) && x > o.x && x < o.x + o.width); }
    solidParts(o) {
      if (o.type !== 'stairs') return [o];
      // Each tread is a physical block; down runs omit the old full-height wall.
      const count = o.steps || 3;
      return Array.from({ length: count }, (_, i) => ({ ...o, id: o.id + ':' + i,
        x: o.x + o.width * i / count, width: o.width / count,
        height: o.height * (o.direction === 'down' ? count - i : i + 1) / count }));
    }
    updateBalance(dt) {
      if (!this.balanceActive) return;
      const steer = (this.keys.Right ? 1 : 0) - (this.keys.Left ? 1 : 0);
      const drift = this.cfg.balanceDrift + Math.sin(this.time * 3) * this.cfg.balanceVariation;
      this.balance = clamp(this.balance + (drift + steer * this.cfg.balanceCorrection) * dt, -1, 1);
      if (this.flip) this.flip.done = this.time - this.flip.at + EPS >= this.cfg.flipDuration;
      if (this.mode === 'air') return; // Air tricks fail at landing, never in mid-air.
      this.unsafeTime = Math.abs(this.balance) > this.cfg.balanceSafe ? this.unsafeTime + dt : 0;
      if (this.unsafeTime + EPS >= this.cfg.balanceGrace) this.bail('LOST BALANCE — steer toward the center');
    }
    land(z, surface, impact) {
      if (this.flip && (!this.flip.done || Math.abs(this.balance) > this.cfg.balanceSafe)) {
        this.bail(this.flip.done ? 'KICKFLIP — land inside the safe zone' : 'KICKFLIP — start earlier to finish'); return;
      }
      if (this.flip || this.popCharge !== null) this.award(this.flip ? 'KICKFLIP' : this.popCharge > 0.3 ? 'CHARGED OLLIE' : 'OLLIE', this.flip ? 180 : 40);
      this.popCharge = null; this.flip = null; this.jumpZ = z; this.velocityZ = 0; this.surface = surface;
      this.mode = 'rolling'; this.unsafeTime = 0; this.space = null;
      this.emit('land', { impact: clamp(Math.abs(impact) / this.cfg.fullPopVelocity, 0.2, 1) });
    }
    hitObjects(oldX, oldZ) {
      const half = this.cfg.boardHalfWidth;
      for (const o of this.objects.flatMap(o => this.solidParts(o)).sort((a, b) => b.height - a.height || a.x - b.x)) {
        if (!this.inLane(o) || this.worldX + half <= o.x || oldX - half >= o.x + o.width) continue;
        if (o.id === this.ignoredRail) continue;
        if (o.type === 'crack') {
          if (oldX < o.x && this.worldX >= o.x && this.grounded && this.jumpZ === 0) this.emit('crack', { id: o.id });
          continue;
        }
        if (o.type === 'gap') continue;
        if (o.type === 'low_bar') {
          if (this.jumpZ + (this.crouching ? this.cfg.crouchHeight : this.cfg.bodyHeight) > o.height && this.jumpZ < o.height + (o.thickness || 8)) this.bail('LOW BAR — hold DOWN or load SPACE to crouch');
          continue;
        }
        if (this.surface === o.id && (this.grounded || this.mode === 'grind')) continue;
        // Clip the sweep to the actual X overlap, not the whole frame. A board
        // still rising before the obstacle must not hit its imaginary extension.
        const dx = this.worldX - oldX || EPS;
        const entry = clamp((o.x - half - oldX) / dx, 0, 1);
        const exit = clamp((o.x + o.width + half - oldX) / dx, 0, 1);
        const zIn = oldZ + (this.jumpZ - oldZ) * entry;
        const zOut = oldZ + (this.jumpZ - oldZ) * exit;
        const crossing = this.mode === 'air' && this.velocityZ < 0 && zIn >= o.height - EPS && zOut <= o.height;
        if (crossing) {
          const grindable = o.type === 'rail' || o.type === 'ledge';
          if (grindable && this.keys.Up && !this.flip && this.time >= (this.ignoreRailUntil || 0)) {
            this.mode = 'grind'; this.jumpZ = o.height; this.velocityZ = 0; this.surface = o.id;
            this.balance = 0; this.unsafeTime = 0; this.popCharge = null; this.grindAt = this.time;
            this.award('GRIND', 100); this.emit('grind');
          } else if (o.type === 'rail') this.bail('RAIL — HOLD UP in the air to catch');
          else this.land(o.height, o.id, this.velocityZ);
        } else if (Math.min(zIn, zOut) < o.height - EPS) {
          this.bail(o.type === 'rail' ? 'RAIL — HOLD UP in the air to catch' : o.charged ? 'OBSTACLE — hold SPACE, then release to pop' : 'OBSTACLE — tap SPACE a little earlier');
        }
        if (this.mode === 'crash') return;
      }
    }
    updateContact(dt) {
      if (this.surface) {
        const o = this.objects.flatMap(o => this.solidParts(o)).find(o => o.id === this.surface);
        if (!o || !this.overlapping(o) || !this.inLane(o)) {
          this.surface = null; this.mode = 'air'; this.velocityZ = 0;
        }
      }
      if (this.grounded && !this.surface && this.gapAt(this.worldX)) {
        this.mode = 'air'; this.velocityZ = 0;
      }
      if (this.mode === 'air' && this.jumpZ <= 0) {
        if (this.gapAt(this.worldX)) {
          if (this.jumpZ < -24) this.bail('GAP — use a charged pop');
        } else if (this.previous.jumpZ < -EPS) this.bail('GAP — clear the far edge');
        else this.land(0, null, this.velocityZ);
      }
      if (this.grounded && this.keys.Up && !this.keys.Down && !this.space && this.mode !== 'manual') {
        this.mode = 'manual'; this.balance = 0; this.unsafeTime = 0; this.award('MANUAL', 60);
      }
      if (this.mode === 'manual' || this.mode === 'grind') this.combo += dt * 25;
      if (this.mode === 'rolling') {
        this.rollTime += dt;
        if (this.rollTime + EPS >= this.cfg.bankDelay) this.bank();
      } else this.rollTime = 0;
    }
    updatePush(dt) {
      if (this.mode !== 'rolling' || this.surface || this.jumpZ !== 0 || this.keys.Space || this.keys.Down || this.keys.Up) {
        this.pushClock = 0; this.pushPhase = 0; this.pushAge = Infinity; return;
      }
      const period = this.boosting ? this.cfg.boostPushInterval : this.cfg.pushInterval;
      // A cadence change changes cycle rate, not phase. Animation age stays in
      // seconds, so the 480 ms stroke neither restarts nor jumps on key release.
      const oldCycle = Math.floor(this.pushClock + EPS);
      this.pushClock += dt / period; this.pushAge += dt;
      const cycle = Math.floor(this.pushClock + EPS);
      if (cycle > oldCycle) {
        this.pushAge = Math.max(0, (this.pushClock - cycle) * period);
        this.emit('push');
      }
      this.pushPhase = this.pushAge + EPS < this.cfg.pushDuration ?
        Math.max(0.001, this.pushAge / this.cfg.pushDuration) : 0;
    }
    step(dt) {
      if (this.status !== 'playing' || dt <= 0) return;
      this.previous = { worldX: this.worldX, jumpZ: this.jumpZ, laneY: this.laneY };
      this.time += dt;
      if (this.mode === 'crash') { if (this.time + EPS >= this.crashUntil) this.recover(); return; }
      if (this.ignoredRail && !this.objects.some(o => o.id === this.ignoredRail && this.overlapping(o))) this.ignoredRail = null;
      const oldX = this.worldX, oldZ = this.jumpZ;
      this.moveHorizontal(dt);
      if (this.mode === 'air') {
        this.jumpZ += this.velocityZ * dt - 0.5 * this.cfg.gravity * dt * dt;
        this.velocityZ -= this.cfg.gravity * dt;
      }
      this.updateBalance(dt);
      if (this.mode === 'crash') return;
      this.hitObjects(oldX, oldZ);
      if (this.mode === 'crash') return;
      this.updateContact(dt); this.recordClearances(); this.updatePush(dt);
      for (const x of (this.practice ? this.course.practiceCheckpoints || [0] : this.course.checkpoints)) {
        if (x <= this.worldX && x > this.checkpoint) this.checkpoint = x;
      }
      if (this.practice) {
        if (this.worldX >= this.cfg.practiceLength) { this.worldX = 0; this.currentSpeed = this.cfg.speed; this.pushClock = 0; this.pushAge = Infinity; this.pushPhase = 0; this.checkpoint = 0; this.clearedHazards = []; this.previous.worldX = 0; }
      } else {
        if (this.worldX >= this.course.length && this.mode !== 'crash') {
          this.bank(); this.status = 'finished'; this.clearInput(); this.emit('finish');
        }
      }
    }
  }
  class Runner {
    constructor(game) { this.game = game; this.accumulator = 0; }
    reset() { this.accumulator = 0; }
    advance(seconds, beforeStep) {
      if (this.game.status !== 'playing') { this.reset(); return 0; }
      const dt = 1 / this.game.cfg.fixedHz;
      this.accumulator += Math.min(Math.max(seconds, 0), dt * this.game.cfg.maxCatchUpSteps);
      let count = 0;
      while (this.accumulator + EPS >= dt && count < this.game.cfg.maxCatchUpSteps) {
        if (beforeStep) beforeStep(this.game);
        this.game.step(dt); this.accumulator = Math.max(0, this.accumulator - dt); count++;
      }
      return this.accumulator / dt;
    }
  }
  const api = { Game, Runner, clamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ShredderCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
