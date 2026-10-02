(function (root) {
  'use strict';
  const keys = { Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  const commands = { KeyP: 'pause', Escape: 'pause', KeyI: 'help', KeyR: 'restart', KeyM: 'mute', Enter: 'start' };
  class Input {
    constructor(game, command = () => {}, trusted = () => {}) {
      this.game = game; this.command = command; this.trusted = trusted;
      this.held = new Set(); this.blocked = new Set(); this.queue = []; this.remove = [];
      this.sources = new Map([['keyboard', this.held]]); this.owners = new Map(); this.onClear = new Set();
    }
    feed(code, down, repeat = false, source = 'keyboard') {
      if (!keys[code] && !commands[code]) return false;
      if (!this.sources.has(source)) this.sources.set(source, new Set());
      const held = this.sources.get(source);
      if (!down) {
        held.delete(code);
        if (source === 'keyboard' && this.blocked.delete(code)) return true;
        this.release(code, source); return true;
      }
      if (repeat || held.has(code) || source === 'keyboard' && this.blocked.has(code)) return true;
      held.add(code); this.trusted();
      if (commands[code]) this.command(commands[code]);
      else if (this.game.status === 'playing' && this.game.mode !== 'crash') {
        const owners = this.owners.get(code) || new Set();
        if (!owners.size) this.queue.push([keys[code], true]);
        owners.add(source); this.owners.set(code, owners);
      }
      if (this.queue.length > 64) this.clear();
      return true;
    }
    release(code, source, cancel = false) {
      const owners = this.owners.get(code);
      if (!owners?.delete(source) || owners.size) return;
      this.owners.delete(code); this.queue.push([keys[code], false, cancel && code === 'Space']);
    }
    cancelSource(source) {
      for (const code of this.sources.get(source) || []) this.release(code, source, true);
      if (source !== 'keyboard') this.sources.delete(source);
    }
    flush() {
      for (const [key, down, cancel] of this.queue.splice(0)) {
        if (cancel) this.game.cancelSpaceHold();
        else this.game.key(key, down);
      }
    }
    clear() {
      for (const code of this.held) this.blocked.add(code);
      this.held.clear(); this.sources = new Map([['keyboard', this.held]]); this.owners.clear();
      this.queue = []; this.game.clearInput();
      for (const reset of this.onClear) reset();
    }
    nativeControl(target) {
      return /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(target?.tagName || '') || target?.isContentEditable;
    }
    attach(target, onInactive) {
      const listen = (node, type, fn) => { node.addEventListener(type, fn); this.remove.push(() => node.removeEventListener(type, fn)); };
      listen(target, 'keydown', e => {
        // Native radio arrows/Space and button Enter must not become game commands.
        if (this.nativeControl(e.target)) return;
        if (this.feed(e.code, true, e.repeat)) e.preventDefault();
      });
      listen(target, 'keyup', e => {
        if (this.nativeControl(e.target)) {
          if (this.held.has(e.code) || this.blocked.has(e.code)) this.feed(e.code, false);
          return;
        }
        if (this.feed(e.code, false)) e.preventDefault();
      });
      listen(target, 'blur', () => { this.clear(); onInactive(); });
      if (target.document) listen(target.document, 'visibilitychange', () => {
        if (target.document.hidden) { this.clear(); onInactive(); }
      });
      return () => { for (const remove of this.remove.splice(0)) remove(); this.clear(); };
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { Input };
  root.ShredderInput = { Input };
})(typeof window !== 'undefined' ? window : globalThis);
