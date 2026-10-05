(function () {
  'use strict';
  const data = window.SHREDDER_DATA;
  const canvas = document.getElementById('game');
  const game = new window.ShredderCore.Game(data.settings, data.course, data.courses);
  const runner = new window.ShredderCore.Runner(game);
  const renderer = new window.ShredderRenderer.Renderer(canvas, data);
  const ui = new window.ShredderUI.UI(document.getElementById('stage'), command, data);
  const audio = new window.ShredderAudio.Audio(data.audio || {}, message => ui.sound(message));
  const input = new window.ShredderInput.Input(game, command, () => audio.unlock());
  const gestures = new window.ShredderGestures.Gestures(game, input, message => ui.gesture(message));
  window.ShredderGestures.attach(canvas, gestures);
  let previousTime = null, loaded = false;
  function resetClock() { runner.reset(); previousTime = null; input.clear(); }
  function activate() {
    resetClock(); ui.help = false; audio.setActive(true); audio.unlock(); canvas.focus({ preventScroll: true });
  }
  function pause() {
    game.pause(); resetClock(); audio.setActive(false); renderer.render(game, 1); ui.update(game);
  }
  function command(name) {
    if (name === 'retry') { load(); return; }
    if (name === 'mute') {
      audio.setMuted(!audio.muted);
      document.getElementById('mute-button').textContent = audio.muted ? 'Sound off / M' : 'Sound on / M'; return;
    }
    if (!loaded) return;
    if (name === 'choose-dude') {
      game.chooseDude(); resetClock(); ui.help = false; audio.setActive(false);
      renderer.render(game, 1); ui.update(game);
      ui.panel.querySelector('input[name="dude"]:checked')?.focus({ preventScroll: true }); return;
    }
    if (name === 'route' || name === 'practice' || name === 'restart' || name === 'start' && game.status === 'menu') {
      const practice = name === 'practice' || name === 'restart' && game.practice;
      game.restart(true, practice, ui.challenges); activate();
    } else if (name === 'next-level') {
      if (game.advanceCourse()) activate();
    } else if (name === 'resume' || name === 'pause' && game.status === 'paused') {
      if (game.status === 'paused') { game.resume(); activate(); }
      else ui.help = false;
    } else if (name === 'pause') pause();
    else if (name === 'help') {
      if (ui.help) { ui.help = false; if (game.status === 'paused') { game.resume(); activate(); } }
      else { pause(); ui.help = true; }
    }
    ui.update(game);
    // Menus can be long on phones. Return to the live canvas and toolbar after
    // their document-space layout collapses; do not lock native menu scrolling.
    if (game.status === 'playing' && ui.touch) window.scrollTo({ top: 0, behavior: 'instant' });
  }
  input.attach(window, pause);
  for (const [id, name] of [['pause-button', 'pause'], ['help-button', 'help'], ['mute-button', 'mute']]) {
    document.getElementById(id).addEventListener('click', () => command(name));
  }
  canvas.addEventListener('pointerdown', () => { canvas.focus(); audio.unlock(); });
  function frame(now) {
    const delta = previousTime === null ? 0 : (now - previousTime) / 1000; previousTime = now;
    const alpha = runner.advance(delta, () => { gestures.update(); input.flush(); });
    const events = game.drainEvents();
    if (events.some(event => event.type === 'crash' || event.type === 'recover' || event.type === 'finish')) input.clear();
    audio.update(game, events);
    if (game.status !== 'playing') audio.setActive(false);
    renderer.render(game, game.status === 'playing' ? alpha : 1); ui.update(game);
    requestAnimationFrame(frame);
  }
  async function load() {
    loaded = false; ui.setLoading('Loading Skater Dudes…'); ui.update(game);
    try {
      const failed = await renderer.load();
      const essential = ['board_flat', ...Object.values(data.characters).flatMap(character => Object.values(character.poses))];
      if (essential.some(key => !renderer.images[key] || failed.includes(key))) {
        ui.setLoading('Artwork could not load. Retry, or rebuild the offline HTML with embedded PNGs.');
      } else {
        loaded = true; ui.setLoading('');
        if (failed.length) ui.sound(`${failed.length} optional art assets are unavailable. The street is playable.`);
      }
    } catch (_) { ui.setLoading('Artwork could not load. Retry, or rebuild the offline HTML.'); }
    ui.update(game);
  }
  // Small inspection surface for local browser playtests; never used to bypass gameplay.
  window.SHREDDER = { game, runner, input, gestures, renderer, audio, ui, command };
  load(); requestAnimationFrame(frame);
})();
