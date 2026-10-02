(function (root) {
  'use strict';
  const keys = { Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  const commands = { KeyP: 'pause', Escape: 'pause', KeyI: 'help', KeyR: 'restart', KeyM: 'mute', Enter: 'start' };
  class Input {
    constructor(game, command = () => {}, trusted = () => {}) {
      this.game = game; this.command = command; this.trusted = trusted;
      this.held = new Set(); this.blocked = new Set(); this.queue = []; this.remove = [];
    }
    feed(code, down, repeat = false) {
      if (!keys[code] && !commands[code]) return false;
      if (!down) {
        this.held.delete(code);
        if (this.blocked.delete(code)) return true;
        if (keys[code]) this.queue.push([keys[code], false]);
        return true;
      }
      if (repeat || this.held.has(code) || this.blocked.has(code)) return true;
      this.held.add(code); this.trusted();
      if (commands[code]) this.command(commands[code]);
      else if (this.game.status === 'playing' && this.game.mode !== 'crash') this.queue.push([keys[code], true]);
      if (this.queue.length > 64) this.clear();
      return true;
    }
    flush() { for (const [key, down] of this.queue.splice(0)) this.game.key(key, down); }
    clear() {
      for (const code of this.held) this.blocked.add(code);
      this.held.clear(); this.queue = []; this.game.clearInput();
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
