(function (root) {
  'use strict';
  function element(tag, className, text) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = text; return node;
  }
  class UI {
    constructor(host, action, data) {
      this.data = data; this.choices = [];
      this.host = host; this.action = action; this.lastPanel = ''; this.help = false;
      this.loading = 'Loading Skater Dudes…'; this.challenges = false;
      this.hud = element('div', 'hud');
      const left = element('div', 'score-block'), right = element('div', 'combo-block');
      left.append(element('span', 'eyebrow', 'BANKED SCORE')); this.score = element('strong', 'score', '0'); left.append(this.score);
      right.append(element('span', 'eyebrow', 'CURRENT COMBO')); this.combo = element('strong', 'combo', '—'); right.append(this.combo);
      this.stats = element('div', 'stats'); this.trick = element('div', 'trick'); left.append(this.stats); right.append(this.trick);
      this.hud.append(left, right); host.append(this.hud);
      this.panel = element('section', 'overlay'); this.panel.setAttribute('aria-label', 'Skater Dudes menu'); host.append(this.panel);
      this.audioStatus = document.getElementById('audio-status');
      this.status = document.getElementById('game-status');
    }
    button(text, command, primary = false) {
      const button = element('button', primary ? 'button primary' : 'button', text);
      button.type = 'button'; button.addEventListener('click', () => this.action(command)); return button;
    }
    setLoading(message) { this.loading = message; this.lastPanel = ''; }
    sound(message) { this.audioStatus.textContent = message; }
    controls(parent) {
      const controls = element('dl', 'controls');
      for (const [key, meaning] of [
        ['TAP SPACE', 'Release before 300 ms for a small ollie. No crouch or charge gauge.'],
        ['HOLD → RELEASE', 'Hold 300 ms to crouch and show the left gauge, then charge for 600 ms more. Full pop takes 900 ms; release to jump.'],
        ['↓ THEN ↑', 'Kickflip in the air. Start early; finish the flip before you land.'],
        ['HOLD ↑', 'Manual on the ground. Catch a rail or ledge from above in the air.'],
        ['HOLD →', 'Build speed on flat street. Release to coast. Space, Down and tricks stop acceleration.'],
        ['← / → IN TRICKS', 'Balance only: steer the white needle into the mint safe zone.'],
        ['↓ / SPACE', 'Down ends a manual or grind. Space pops off a rail. Hold Down to duck a low bar.']
      ]) { controls.append(element('dt', '', key), element('dd', '', meaning)); }
      parent.append(controls);
    }
    chooseCharacters(parent, game) {
      const group = element('fieldset', 'dude-chooser');
      group.append(element('legend', '', 'Choose your dude'));
      const cards = element('div', 'dude-cards'); this.choices = [];
      for (const identifier of ['jeff', 'dave']) {
        const character = this.data.characters[identifier];
        const label = element('label', 'dude-card');
        const radio = element('input'); radio.type = 'radio'; radio.name = 'dude'; radio.value = character.id;
        const image = element('img', 'dude-preview'); image.src = this.data.images[character.previewKey].src;
        image.alt = character.name + ' skate sprite'; image.width = 120; image.height = 90;
        const name = element('strong', '', character.name), state = element('span', 'dude-state');
        state.setAttribute('aria-hidden', 'true');
        radio.setAttribute('aria-label', character.name);
        radio.addEventListener('change', () => {
          if (radio.checked) game.selectCharacter(character.id);
          this.syncCharacters(game);
        });
        label.append(radio, image, name, state); cards.append(label);
        this.choices.push({ radio, state });
      }
      group.append(cards); parent.append(group); this.syncCharacters(game);
    }
    syncCharacters(game) {
      for (const { radio, state } of this.choices) {
        radio.checked = radio.value === game.characterId;
        state.textContent = radio.checked ? 'Selected' : 'Choose';
      }
    }
    makePanel(game) {
      this.panel.replaceChildren(); this.choices = [];
      const content = element('div', 'panel-content'); this.panel.append(content);
      if (this.loading) {
        content.append(element('div', 'eyebrow', 'SKATER DUDES / OFFLINE PROTOTYPE'), element('h1', '', 'WARMING UP.'), element('p', '', this.loading));
        if (this.loading.startsWith('Artwork')) content.append(this.button('Retry artwork', 'retry', true));
        return;
      }
      if (game.status === 'menu' && !this.help) {
        const intro = element('div', 'intro'), guide = element('div', 'guide'); content.classList.add('menu-grid');
        intro.append(element('div', 'eyebrow', 'ONE STREET. NO SECOND GUESSING.'), element('h1', 'title', 'SKATER DUDES'),
          element('p', 'lead', 'Find your line. Stick the landing.'),
          element('p', 'description', 'A side-on skate run through the late shift. Build a combo, balance it, bank it. Bail? Retry after a cleared obstacle, with room to prepare.'));
        intro.append(element('p', 'dedication', 'Dedicated to Oscar, the raddest skater dude I know'));
        this.chooseCharacters(intro, game);
        const buttons = element('div', 'menu-buttons');
        buttons.append(this.button('Ride the street  ↗', 'route', true), this.button('Practice first', 'practice'));
        intro.append(buttons);
        const label = element('label', 'practice-option'), check = element('input'); check.type = 'checkbox'; check.checked = this.challenges;
        check.addEventListener('change', () => { this.challenges = check.checked; });
        label.append(check, document.createTextNode(' Add a curb and rail to practice')); intro.append(label);
        intro.append(element('p', 'fineprint', '90 seconds at base speed · 32 hazards · infinite attempts · headphones welcome'));
        guide.append(element('div', 'eyebrow', 'THE HOLD-RELEASE POP'), element('h2', '', 'Hold. Let go. Pop.'),
          element('p', '', 'A quick tap makes a small ollie. For more height, hold Space, then release it to jump.'),
          element('div', 'pop-steps', 'HOLD 900 ms  →  RELEASE TO POP'),
          element('p', 'callout', 'Roll for the first 300 ms. Then crouch and charge for 600 ms more: 900 ms total. Keep holding until the RELEASE mark.'),
          element('p', 'fineprint', 'Down → Up: kickflip · Hold Up: manual / grind\nHold Right: build speed on street · Hold Down: duck\nLeft / Right in tricks: balance only · I: all controls'));
        content.append(intro, guide); return;
      }
      if (game.status === 'finished' && !this.help) {
        content.append(element('div', 'eyebrow', 'THE NIGHT SHIFT / COMPLETE'), element('h1', '', 'LINE FINISHED.'),
          element('p', 'summary-score', Math.round(game.score).toLocaleString() + ' BANKED'),
          element('p', '', `Best combo ${Math.round(game.bestCombo).toLocaleString()} · ${game.bails} bails · 2.52 km of street`));
        const buttons = element('div', 'menu-buttons'); buttons.append(this.button('Run it again', 'restart', true), this.button('Flat practice', 'practice'), this.button('Choose dude', 'choose-dude'));
        content.append(buttons); return;
      }
      content.append(element('div', 'eyebrow', game.practice ? 'FLAT PRACTICE / NO PRESSURE' : 'THE NIGHT SHIFT'), element('h1', '', this.help ? 'SKATER DUDES / CONTROLS' : 'TAKE A BREATHER.'));
      if (this.help) {
        this.controls(content);
        content.append(element('p', 'fineprint', 'Release Space to jump. Full charge stays full while held, with no automatic jump. Landing while holding Space never jumps again. Pause or focus loss cancels charge. Normal ollies need no balancing.'));
      } else content.append(element('p', '', 'Your run is paused. Resume when you are ready.'));
      const buttons = element('div', 'menu-buttons');
      const back = game.status === 'menu' ? 'Back to menu' : game.status === 'finished' ? 'Back to results' : 'Back to the street';
      buttons.append(this.button(back, 'resume', true), this.button(this.help ? 'Hide controls' : 'Controls / I', 'help'), this.button('Start over / R', 'restart'));
      if (!this.help) buttons.append(this.button(game.practice ? 'Ride the route' : 'Flat practice', game.practice ? 'route' : 'practice'));
      if (game.status !== 'menu') buttons.append(this.button('Choose dude', 'choose-dude'));
      content.append(buttons);
    }
    update(game) {
      this.score.textContent = Math.round(game.score).toLocaleString();
      this.combo.textContent = game.combo ? `${Math.round(game.combo)} × ${game.multiplier}` : '—';
      this.stats.textContent = `${game.practice ? 'PRACTICE' : (game.worldX / 10000).toFixed(2) + ' / 2.52 km'} · ${game.bails} BAILS`;
      this.trick.textContent = game.combo ? game.trick : 'ROLL CLEAN TO BANK';
      const show = game.status !== 'playing' || !!this.loading;
      this.panel.hidden = !show; this.hud.hidden = game.status === 'menu' || !!this.loading;
      const key = game.status + ':' + this.help + ':' + this.loading;
      if (show && key !== this.lastPanel) { this.makePanel(game); this.lastPanel = key; }
      const status = game.status === 'playing' ? game.practice ? 'Practice · rolling' : 'The night shift · rolling' : game.status;
      if (this.status.textContent !== status) this.status.textContent = status;
      document.getElementById('pause-button').textContent = game.status === 'paused' ? 'Resume / P' : 'Pause / P';
    }
  }
  root.ShredderUI = { UI };
})(typeof window !== 'undefined' ? window : globalThis);
