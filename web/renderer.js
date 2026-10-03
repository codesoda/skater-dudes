(function (root) {
  'use strict';
  const mix = (a, b, t) => a + (b - a) * t;
  class Renderer {
    constructor(canvas, data) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.data = data;
      this.images = {}; this.patterns = {}; this.ready = false;
    }
    async load() {
      const failed = [];
      await Promise.all(Object.entries(this.data.images).map(([key, asset]) => new Promise(resolve => {
        const image = new Image();
        image.onload = () => { this.images[key] = image; resolve(); };
        image.onerror = () => { failed.push(key); resolve(); };
        image.src = asset.src;
      })));
      for (const key of ['asphalt', 'concrete']) if (this.images[key]) {
        const tile = document.createElement('canvas'); tile.width = 64; tile.height = 64;
        tile.getContext('2d').drawImage(this.images[key], 0, 0, 64, 64);
        this.patterns[key] = this.ctx.createPattern(tile, 'repeat');
      }
      this.ready = true; return failed;
    }
    sprite(key, x, y, width, height) {
      const a = this.data.images[key], image = this.images[key];
      if (!a || !image) return false;
      const w = width ?? a.drawWidth, h = height ?? a.drawHeight;
      this.ctx.drawImage(image, x - a.anchor[0] / a.width * w, y - a.anchor[1] / a.height * h, w, h);
      return true;
    }
    text(text, x, y, size = 14, color = '#f4f1d7', align = 'left') {
      const c = this.ctx; c.fillStyle = color; c.font = `bold ${size}px ui-monospace, monospace`;
      c.textAlign = align; c.fillText(text, x, y); c.textAlign = 'left';
    }
    groundY(game, laneY = 0) {
      // Derive wheel contact from bitmap metadata, not a guessed sprite offset.
      const board = this.data.images.board_flat;
      const wheels = (board.groundAnchor[1] - board.anchor[1]) * board.drawHeight / board.height;
      return game.cfg.baselineY + laneY + wheels;
    }
    background(game, camera) {
      const c = this.ctx;
      c.fillStyle = '#222337'; c.fillRect(0, 0, 960, 540);
      const city = this.images.city;
      if (city) {
        const width = 960, scroll = camera * 0.18, first = Math.floor(scroll / width);
        // Alternate mirrored tiles so the non-seamless city has no hard joins.
        for (let tile = first; tile <= first + 1; tile++) {
          const left = tile * width - scroll, mirrored = Math.abs(tile % 2) === 1;
          c.save(); c.translate(left + (mirrored ? width : 0), -64);
          c.scale(mirrored ? -1 : 1, 1); c.drawImage(city, 0, 0, width, 456); c.restore();
        }
      }
      const shade = c.createLinearGradient(0, 200, 0, 396);
      shade.addColorStop(0, 'rgba(25,24,44,0)'); shade.addColorStop(1, 'rgba(22,22,37,.7)');
      c.fillStyle = shade; c.fillRect(0, 200, 960, 196);
      c.save(); c.translate(-(camera % 64), 0);
      c.fillStyle = this.patterns.concrete || '#969ba0'; c.fillRect(-64, 366, 1088, 30); c.restore();
      c.fillStyle = '#454857'; c.fillRect(0, 388, 960, 10);
      c.fillStyle = '#b5b4aa'; c.fillRect(0, 388, 960, 3);
      c.save(); c.translate(-(camera % 64), 0);
      c.fillStyle = this.patterns.asphalt || '#3f454c'; c.fillRect(-64, 398, 1088, 142); c.restore();
      c.fillStyle = 'rgba(25,29,43,.40)'; c.fillRect(0, 398, 960, 142);
      // Long side-on seams and lane paint establish a broad, flat street.
      c.strokeStyle = '#232b36'; c.lineWidth = 2;
      const offset = ((camera % 180) + 180) % 180;
      for (let x = -offset; x < 960; x += 180) { c.beginPath(); c.moveTo(x, 367); c.lineTo(x, 387); c.stroke(); }
      c.fillStyle = '#b7a879';
      for (let x = -(camera % 220); x < 960; x += 220) c.fillRect(x, 512, 100, 4);
      c.fillStyle = '#242b38'; c.fillRect(0, 534, 960, 6);
    }
    shadow(x, y, width, opacity = 0.3) {
      const c = this.ctx; c.fillStyle = `rgba(9,13,25,${opacity})`;
      c.beginPath(); c.ellipse(x, y, width / 2, 5, 0, 0, Math.PI * 2); c.fill();
    }
    gap(o, x, y) {
      const a = this.data.images.gap_center, image = this.images.gap_center;
      if (!a || !image || !this.images.gap_left || !this.images.gap_right) return;
      const scale = 58 / 256, [sx, sy, right, bottom] = a.tileBox;
      const tileWidth = (right - sx) * scale, height = (bottom - sy) * scale;
      // Physical void is exactly [x, x + width]. Repeat at a fixed scale and
      // crop the last tile; never stretch the cutaway to the obstacle width.
      for (let offset = 0; offset < o.width; offset += tileWidth) {
        const width = Math.min(tileWidth, o.width - offset);
        this.ctx.drawImage(image, sx, sy, width / scale, bottom - sy,
          x + offset, y, width, height);
      }
      for (const [key, edge] of [['gap_left', x], ['gap_right', x + o.width]]) {
        const cap = this.data.images[key];
        this.ctx.drawImage(this.images[key], edge - cap.collisionEdgeX * scale,
          y - cap.groundLipY * scale, cap.width * scale, cap.height * scale);
      }
    }
    concreteBlock(o, x, ground) {
      const image = this.images.ledge;
      if (!image) return;
      const c = this.ctx, scale = .7, top = ground - o.height;
      const height = o.height - (o.baseHeight || 0);
      // Existing concrete: fixed-scale endcaps, tiled middle, cropped last tile.
      // Slice the top separately; taller faces repeat stone, never stretch it.
      const cap = Math.min(10 * scale, o.width / 2);
      const columns = [[7, 10, x, cap], [253, 10, x + o.width - cap, cap]];
      for (let dx = cap; dx < o.width - cap; dx += 236 * scale) {
        const width = Math.min(236 * scale, o.width - cap - dx);
        columns.push([17, width / scale, x + dx, width]);
      }
      for (const [sx, sw, dx, dw] of columns) {
        const lip = Math.min(24 * scale, height);
        c.drawImage(image, sx, 6, sw, lip / scale, dx, top, dw, lip);
        for (let dy = lip; dy < height; dy += 52 * scale) {
          const dh = Math.min(52 * scale, height - dy);
          c.drawImage(image, sx, 32, sw, dh / scale, dx, top + dy, dw, dh);
        }
      }
      c.fillStyle = '#bfc8c2'; c.fillRect(x, top, o.width, 1);
    }
    obstacle(o, game, camera) {
      const c = this.ctx, x = o.x - camera, y = this.groundY(game, o.laneY || 0);
      if (o.charged) {
        const hold = game.holdDistance(o);
        c.fillStyle = '#e1b474'; c.fillRect(x - hold, y + 32, 3, 18);
        this.text('HOLD', x - hold, y + 64, 10, '#e1b474', 'center');
        const mark = o.popDistance || 110;
        c.fillStyle = '#88dfca'; c.fillRect(x - mark, y + 32, 3, 18);
        this.text('RELEASE', x - mark, y + 64, 10, '#88dfca', 'center');
      }
      if (o.type === 'gap') {
        this.gap(o, x, y);
        this.text('GAP', x + o.width / 2, y + 76, 11, '#f1b75b', 'center'); return;
      }
      if (o.type === 'crack') {
        if (!this.sprite('crack', x, y, 54, 10)) {
          c.strokeStyle = '#111723'; c.beginPath(); c.moveTo(x - 25, y);
          c.lineTo(x - 8, y - 4); c.lineTo(x + 6, y + 3); c.lineTo(x + 25, y); c.stroke();
        }
        return;
      }
      const a = this.data.images[o.type];
      this.shadow(x + o.width / 2, y + 2, o.width + 15);
      if (o.type === 'ledge') {
        this.concreteBlock(o, x, y);
      } else if (o.type === 'stairs') {
        for (const tread of game.solidParts(o)) this.concreteBlock(tread, tread.x - camera, y);
      } else if (a && this.images[o.type]) {
        const contact = o.type === 'low_bar' ? (a.clearanceY ?? 22) : (a.contactTop ?? (o.type === 'bench' ? 68 : 4));
        const h = a.height * o.height / Math.max(1, a.anchor[1] - contact);
        this.sprite(o.type, x + o.width / 2, y, o.width, h);
      } else {
        c.fillStyle = '#a7b5bd';
        if (o.type === 'low_bar') {
          c.fillRect(x, y - o.height - 8, o.width, 8);
          c.fillRect(x, y - o.height, 5, o.height); c.fillRect(x + o.width - 5, y - o.height, 5, o.height);
        } else c.fillRect(x, y - o.height, o.width, o.height);
      }
      // Contact stripe agrees with the physics, including the bench seat.
      if (o.type === 'rail') {
        c.fillStyle = '#70e3cb'; c.fillRect(x + 3, y - o.height, o.width - 6, 2);
      }
      if (o.hint) this.text(o.hint, x + 50, y - o.height - 14, 11, '#a5efda');
      if (o.charged) this.text('▲', x + o.width / 2, y + 25, 13, '#ffc062', 'center');
    }
    skater(game, x, feet, laneGround) {
      const c = this.ctx;
      if (game.mode === 'grind') {
        const board = this.data.images.board_flat;
        feet += (board.groundAnchor[1] - board.truckAnchor[1]) * board.drawHeight / board.height;
      }
      this.shadow(x, laneGround, 62, 0.34); // Never rises or changes depth with jumpZ.
      let pose = 'roll', board = 'board_flat';
      if (game.mode === 'crash') pose = 'crash';
      else if (game.mode === 'grind') pose = 'grind';
      else if (game.mode === 'manual') { pose = 'manual'; board = 'board_manual'; }
      else if (game.mode === 'air') pose = 'ollie';
      else if (game.crouching) pose = 'crouch';
      else if (game.pushPhase > 0) pose = game.pushPhase < 0.5 ? 'push1' : 'push2';
      if (game.mode !== 'grind' && game.balanceActive && !game.flip && Math.abs(game.balance) > 0.12) pose = game.balance > 0 ? 'lean_forward' : 'lean_back';
      const progress = game.flip ? Math.min(1, (game.time - game.flip.at) / game.cfg.flipDuration) : 0;
      if (game.flip) pose = progress < 0.78 ? 'flip' : 'catch';
      c.save(); c.translate(x + (game.mode === 'grind' ? Math.sin(game.time * 70) * .35 : 0), feet);
      if (game.mode === 'crash') { c.translate(24, -2); c.rotate(0.2); }
      if (game.flip && progress < 0.9) {
        c.save(); c.translate(0, 9); c.rotate(Math.sin(progress * Math.PI * 2) * 0.18);
        c.scale(1, Math.max(0.18, Math.abs(Math.cos(progress * Math.PI * 2))));
        if (!this.sprite(progress > 0.25 && progress < 0.72 ? 'board_flip' : 'board_edge', 0, 0, 64)) this.sprite('board_flat', 0, 0, 64);
        c.restore();
      } else if (!this.sprite(board, 0, 0, 64)) this.sprite('board_flat', 0, 0, 64);
      const characters = this.data.characters;
      const character = Object.hasOwn(characters, game.characterId) ? characters[game.characterId] : characters.jeff;
      // Missing Dave art must never disguise itself as Jeff. Load gates all body poses.
      c.save();
      if (game.mode === 'grind') c.transform(1, 0, game.balance * .18, 1, 0, 0);
      if (!this.sprite(character.poses[pose], 0, 0)) this.sprite(character.poses.roll, 0, 0);
      c.restore(); c.restore();
      if (game.mode === 'grind') {
        const a = this.data.images.board_flat;
        const contact = feet + (a.truckAnchor[1] - a.anchor[1]) * a.drawHeight / a.height;
        c.fillStyle = 'rgba(255,198,100,.65)'; c.fillRect(x - 64, contact, 84, 2);
        for (let i = 0; i < 12; i++) {
          c.fillStyle = i % 2 ? '#ffe9ac' : '#ffac62';
          const age = (game.time * 3 + i / 12) % 1;
          c.fillRect(x - 20 - age * 75, contact + age * age * 24 + Math.sin(i * 7) * age * 10, 3 + age * 8, 2);
        }
      }
    }
    world(game, camera, x, feet, laneGround) {
      const items = [];
      for (let wx = Math.floor(camera / 430) * 430; wx < camera + 1100; wx += 430) {
        const key = Math.abs(Math.floor(wx / 430)) % 3 === 0 ? 'billboard' : 'streetlamp';
        items.push({ depth: -65, draw: () => this.sprite(key, wx - camera, 384) });
        if (Math.abs(Math.floor(wx / 430)) % 2 === 0) items.push({ depth: -58, draw: () => this.sprite('bin', wx + 165 - camera, 387) });
      }
      for (const cp of game.practice ? [] : game.course.checkpoints) if (cp > camera - 80 && cp < camera + 1040 && cp > 0) {
        items.push({ depth: -48, draw: () => this.sprite('checkpoint', cp - camera, 397) });
      }
      if (!game.practice && game.course.length - camera < 1080) items.push({ depth: -42, draw: () => this.sprite('finish', game.course.length - camera, 400) });
      for (const o of [...game.objects].sort((a, b) => a.height - b.height)) if (o.x + o.width > camera - 100 && o.x < camera + 1360) {
        items.push({ depth: (o.laneY || 0) - 0.1, draw: () => this.obstacle(o, game, camera) });
      }
      items.push({ depth: game.laneY, draw: () => this.skater(game, x, feet, laneGround) });
      // Foreground props use ground depth; altitude never enters this sort.
      for (let wx = Math.floor(camera / 1900) * 1900 + 850; wx < camera + 1060; wx += 1900) {
        if (wx > camera - 100) items.push({ depth: 76, draw: () => {
          this.shadow(wx - camera, 524, 45); this.sprite('bin', wx - camera, 524);
        } });
      }
      items.sort((a, b) => a.depth - b.depth); for (const item of items) item.draw();
    }
    meters(game, feet = game.cfg.baselineY + game.laneY - game.jumpZ) {
      const c = this.ctx;
      if (game.status !== 'playing' || game.mode === 'crash') return;
      if (game.chargeVisible) {
        c.fillStyle = 'rgba(17,23,37,.94)'; c.fillRect(18, 198, 112, 177);
        this.text('POP CHARGE', 28, 218, 12, '#ffd180');
        c.fillStyle = '#44465b'; c.fillRect(34, 235, 22, 124);
        c.fillStyle = '#ffbf66'; c.fillRect(34, 359 - game.charge * 124, 22, game.charge * 124);
        this.text(Math.round(game.charge * 100) + '%', 67, 258, 13);
        this.text('RELEASE', 64, 285, 11, '#80edd0');
        this.text('TO POP', 64, 304, 11);
      }
      if (!game.balanceActive) return;
      if (!game.flip && (game.mode === 'manual' || game.mode === 'grind')) {
        const characters = this.data.characters;
        const character = Object.hasOwn(characters, game.characterId) ? characters[game.characterId] : characters.jeff;
        const pose = game.mode === 'manual' && Math.abs(game.balance) > .12 ? game.balance > 0 ? 'lean_forward' : 'lean_back' : game.mode;
        const body = this.data.images[character.poses[pose]], board = this.data.images.board_flat;
        // Match the rendered body anchor, including truck contact on elevated grinds.
        if (game.mode === 'grind') feet += (board.groundAnchor[1] - board.truckAnchor[1]) * board.drawHeight / board.height;
        const center = Math.max(98, Math.min(862, game.cfg.playerScreenX));
        const top = Math.max(8, Math.min(476, feet - body.anchor[1] * body.drawHeight / body.height - 8 - 56));
        c.fillStyle = 'rgba(15,23,37,.94)'; c.fillRect(center - 90, top, 180, 56);
        const label = game.mode === 'grind' && game.time - game.grindAt < .75 ? '50-50 LOCKED' : game.mode.toUpperCase();
        this.text(label, center, top + 16, 11, '#e2d8ff', 'center');
        c.fillStyle = '#7b496f'; c.fillRect(center - 72, top + 24, 144, 10);
        c.fillStyle = '#70dfbb'; c.fillRect(center - game.cfg.balanceSafe * 72, top + 24, game.cfg.balanceSafe * 144, 10);
        c.fillStyle = '#ffffff'; c.fillRect(center - 2 + game.balance * 72, top + 21, 4, 16);
        this.text(game.unsafeTime > 0 ? 'CORRECT NOW! ← →' : 'BALANCE ← →', center, top + 48, 10, game.unsafeTime > 0 ? '#ffbf66' : '#eee6ff', 'center');
        return;
      }
      c.fillStyle = 'rgba(15,23,37,.94)'; c.fillRect(305, 49, 350, 93);
      const flip = game.flip, progress = flip ? Math.min(1, (game.time - flip.at) / game.cfg.flipDuration) : 1;
      const label = flip ? progress < 1 ? 'KICKFLIP · ROTATING' : 'KICKFLIP · CATCH READY' : game.mode === 'grind' && game.time - game.grindAt < .75 ? '50-50 LOCKED' : game.mode.toUpperCase();
      this.text(label, 480, 69, 13, '#e2d8ff', 'center');
      c.fillStyle = '#7b496f'; c.fillRect(330, 80, 300, 16);
      c.fillStyle = '#70dfbb'; c.fillRect(480 - game.cfg.balanceSafe * 150, 80, game.cfg.balanceSafe * 300, 16);
      c.fillStyle = '#ffffff'; c.fillRect(478 + game.balance * 150, 77, 4, 22);
      this.text(game.unsafeTime > 0 ? 'CORRECT NOW!  ←   →' : 'BALANCE  ←   →  KEEP CENTERED', 480, 115, 11, game.unsafeTime > 0 ? '#ffbf66' : '#eee6ff', 'center');
      if (flip) { c.fillStyle = progress === 1 ? '#70dfbb' : '#be94ee'; c.fillRect(330, 129, 300 * progress, 3); }
    }
    hint(game) {
      if (game.status !== 'playing' || game.mode === 'crash') return;
      const next = game.objects.find(o => o.type !== 'crack' && o.x > game.worldX && o.x - game.worldX < Math.max(game.cfg.hintDistance, game.currentSpeed * 2));
      let text = '';
      if (next) {
        if (next.hint) text = next.hint + (next.intent === 'grind' ? ' · POP THEN HOLD ↑ · BALANCE ← →' : next.direction === 'down' ? ' · ROLL DOWN OR POP OFF' : ' · HOLD SPACE, RELEASE TO JUMP · ROLL ON TOP');
        else if (next.type === 'rail') text = 'UP TO GRIND · POP THEN HOLD ↑ · BALANCE ← →';
        else if (next.type === 'low_bar') text = 'LOW BAR AHEAD · HOLD ↓ TO DUCK';
        else if (!next.charged) text = 'SMALL OBSTACLE · TAP SPACE';
        else if (next.x - game.worldX > game.holdDistance(next)) text = 'CHARGED POP AHEAD · HOLD SPACE, LOAD 900 ms · RELEASE AT MARK';
        else text = game.charge >= 1 ? 'FULL CHARGE · KEEP HOLDING UNTIL MARK, THEN RELEASE' : 'LOAD NOW · 300 ms INTENT + 600 ms CHARGE → RELEASE';
      }
      else if (game.practice && game.time < 18) text = 'TAP = SMALL OLLIE   ·   HOLD → RELEASE = BIG POP';
      else if (!game.practice && game.worldX < 1300) text = 'TAKE A BREATH. TAP SPACE TO OLLIE. THE STREET IS YOURS.';
      if (!text) return;
      this.ctx.fillStyle = 'rgba(17,23,37,.91)'; this.ctx.fillRect(200, 154, 660, 32);
      this.text(text, 530, 175, 13, '#ffe2a4', 'center');
    }
    render(game, alpha = 1) {
      const c = this.ctx; c.imageSmoothingEnabled = false;
      const x = mix(game.previous.worldX, game.worldX, alpha), z = mix(game.previous.jumpZ, game.jumpZ, alpha);
      const lane = mix(game.previous.laneY, game.laneY, alpha), camera = x - game.cfg.playerScreenX;
      this.background(game, camera);
      this.world(game, camera, game.cfg.playerScreenX, game.cfg.baselineY + lane - z, this.groundY(game, lane));
      this.hint(game); this.meters(game, game.cfg.baselineY + lane - z);
      if (game.mode === 'crash') {
        c.fillStyle = 'rgba(28,13,36,.35)'; c.fillRect(0, 0, 960, 540);
        this.text('BAIL!  BACK ON YOUR BOARD…', 480, 224, 24, '#ffc286', 'center');
        this.text(game.message, 480, 254, 13, '#fff1e1', 'center');
      }
    }
  }
  root.ShredderRenderer = { Renderer };
})(typeof window !== 'undefined' ? window : globalThis);
