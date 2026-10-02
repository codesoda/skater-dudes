(function (root) {
  'use strict';
  class Audio {
    constructor(data, report = () => {}) {
      this.data = data; this.report = report; this.ctx = null; this.buffers = {};
      this.nodes = new Set(); this.loops = new Map(); this.cues = [];
      this.active = false; this.muted = false; this.generation = 0;
      this.contact = null; this.loading = null; this.decoded = false; this.decodeFailures = 0;
      this.suspending = Promise.resolve(); this.resuming = Promise.resolve();
      this.now = () => performance.now();
    }
    create() {
      const Context = root.AudioContext || root.webkitAudioContext;
      if (!Context) { this.report('Audio unavailable. You can still play.'); return false; }
      this.ctx = new Context();
      // Four one-shot voices share a quarter-gain bus. The 0.9 master
      // bounds music + both fading contact loops + four SFX below 0.91.
      this.master = this.ctx.createGain(); this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain(); this.sfx.gain.value = 0.25;
      this.sfx.connect(this.master);
      this.ctx.addEventListener('statechange', () => {
        if (this.ctx.state !== 'running') for (const item of this.nodes) if (item.stopping) item.finish();
      });
      return true;
    }
    async decode() {
      const entries = Object.entries(this.data);
      await Promise.all(entries.map(async ([key, asset]) => {
        try {
          const bytes = atob(asset.src.split(',')[1]);
          const buffer = Uint8Array.from(bytes, c => c.charCodeAt(0)).buffer;
          const decoded = await this.ctx.decodeAudioData(buffer);
          // Browser resampling can overshoot the WAV peak. Trim the decoded
          // buffer uniformly, preserving its waveform and loop seam.
          let peak = 0;
          for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
            for (const value of decoded.getChannelData(channel)) peak = Math.max(peak, Math.abs(value));
          }
          if (peak > 0.66) for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
            const samples = decoded.getChannelData(channel);
            for (let i = 0; i < samples.length; i++) samples[i] *= 0.66 / peak;
          }
          this.buffers[key] = decoded;
        } catch (_) { this.decodeFailures++; }
      }));
      this.decoded = true;
    }
    async unlock() {
      if (!this.active || this.muted) return;
      const generation = this.generation;
      try {
        if (!this.ctx && !this.create()) return;
        // Finish the old suspend transaction before resuming a new session.
        await this.suspending;
        if (generation !== this.generation || !this.active || this.muted) return;
        const resumed = this.ctx.resume(); this.resuming = resumed.catch(() => {});
        await resumed;
        if (generation !== this.generation || !this.active || this.muted) return;
        if (!this.loading) this.loading = this.decode();
        await this.loading;
        if (generation !== this.generation || !this.active || this.muted) return;
        if (this.ctx.state !== 'running') { this.report('Sound blocked. Press M twice or click Sound to retry.'); return; }
        this.report(this.decodeFailures ? 'Some sounds could not load. Gameplay is ready.' : ''); this.syncLoops(); this.flush();
      } catch (_) { this.report('Sound blocked. Click Sound to retry. Gameplay still works.'); }
    }
    setActive(active) {
      if (active === this.active) return;
      this.active = active; this.generation++;
      if (!active) this.silence();
    }
    setMuted(muted) {
      this.muted = muted; this.generation++;
      if (muted) this.silence();
      else this.unlock();
    }
    stop(item) {
      if (item.stopping) return item.ended;
      item.stopping = true;
      if (this.ctx.state !== 'running') {
        try { item.source.stop(); } catch (_) { /* Already stopped. */ }
        item.finish(); return item.ended;
      }
      const now = this.ctx.currentTime;
      item.gain.gain.cancelScheduledValues(now);
      item.gain.gain.setValueAtTime(item.gain.gain.value, now);
      item.gain.gain.linearRampToValueAtTime(0, now + 0.025);
      try { item.source.stop(now + 0.03); } catch (_) { item.finish(); }
      return item.ended;
    }
    silence() {
      this.cues = []; this.contact = null; this.loops.clear();
      const ended = [...this.nodes].map(item => this.stop(item));
      const previous = this.suspending, resumed = this.resuming;
      // Never suspend on a wall timer: wait for resume and stopped sources first.
      this.suspending = previous.then(() => resumed).then(() => Promise.all(ended)).then(async () => {
        if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
      }).catch(() => {});
    }
    start(key, loop = false, volume = 1) {
      if (!this.active || this.muted || !this.decoded || this.ctx?.state !== 'running' || !this.buffers[key]) return null;
      const source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
      source.buffer = this.buffers[key]; source.loop = loop;
      const asset = this.data[key];
      if (loop) { source.loopStart = asset.loopStart || 0; source.loopEnd = asset.loopEnd || source.buffer.duration; }
      const level = (asset.gain ?? 0.5) * volume;
      gain.gain.value = loop ? 0 : level;
      if (loop) gain.gain.linearRampToValueAtTime(level, this.ctx.currentTime + 0.025);
      source.connect(gain); gain.connect(loop ? this.master : this.sfx);
      let resolve;
      const item = { source, gain, key, loop, stopping: false, ended: new Promise(r => { resolve = r; }) };
      item.finish = () => {
        source.disconnect(); gain.disconnect(); this.nodes.delete(item);
        if (this.loops.get(key) === item) this.loops.delete(key);
        resolve();
      };
      source.onended = item.finish; this.nodes.add(item); source.start(); return item;
    }
    syncLoops() {
      if (!this.active || this.muted) return;
      const wantedContact = this.contact === 'grind' ? ['grind'] : [];
      const wanted = new Set(['music', ...wantedContact]);
      for (const [key, item] of this.loops) if (!wanted.has(key)) { this.loops.delete(key); this.stop(item); }
      for (const key of wanted) if (!this.loops.has(key)) {
        const item = this.start(key, true); if (item) this.loops.set(key, item);
      }
    }
    update(game, events) {
      if (!this.active || this.muted) return;
      this.contact = game.status === 'playing' && game.mode !== 'crash' ?
        game.mode === 'grind' ? 'grind' : game.grounded && game.jumpZ >= 0 ? 'rolling' : null : null;
      this.syncLoops();
      const sounds = new Set(['ollie', 'land', 'crash', 'push', 'bank', 'crack']);
      for (const event of events) if (event.type === 'grind') {
        this.cues.push({ key: 'land', volume: .28, at: this.now() });
      } else if (sounds.has(event.type)) {
        this.cues.push({ key: event.type, volume: event.impact || 1, at: this.now() - Math.max(0, game.time - event.at) * 1000 });
      }
      this.cues = this.cues.slice(-24); this.flush();
    }
    flush() {
      this.cues = this.cues.filter(cue => this.now() - cue.at <= 250);
      if (!this.active || this.muted || !this.decoded || this.ctx?.state !== 'running') return;
      for (const cue of this.cues.splice(0)) {
        const sfx = [...this.nodes].filter(item => !item.loop);
        if (sfx.length >= 4) {
          // Steal immediately so fading tails cannot grow an unbounded pool.
          const oldest = sfx[0];
          try { oldest.source.stop(); } catch (_) { /* Already ended. */ }
          oldest.finish();
        }
        this.start(cue.key, false, cue.volume);
      }
    }
  }
  root.ShredderAudio = { Audio };
})(typeof window !== 'undefined' ? window : globalThis);
