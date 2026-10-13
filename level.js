const THEME_COLORS = {
  "cave": [4025302, 1317433],
  "desert": [13013062, 12223037],
  "forest": [6592030, 10642972],
  "night_village": [10317117, 6762510],
  "orchard": [13590273, 8862467],
  "sky": [16117990, 13223100],
  "swamp": [6987818, 8740371],
  "volcano": [15224858, 5252621]
};

const MAX_PLATFORM_H = 130;
// The floating touch pad (200 wide, clamped to x 8..208 at the far left) must not cover the character, so the player starts to its right.
const PLAYER_SPAWN_X = 310;   // was 230; moved right 80px so the level-1 touch hint (far left) does not overlap the player

// Perspective ground (levels 1-6, user 2026-10-12): numbers are in the backdrop's own picture rows (3168 px wide source), made by art_eval/persp/make_persp_assets.py.
// bottom = source row at the picture's bottom edge, band = rows of walkable ground at the bottom, vpy = source row of the horizon, vpx = vanishing point as a fraction of the picture width,
// base / pave = lit / typical colour of the band's paving in the picture (raw, before any colour look): the walls and floor of the hole are shades of base, the coping stones use pave;
// _drawPitsPersp runs both through the current weather look (WX.skyLook: saturation / brightness) so they follow the backdrop in every weather.
const PERSP = {
  1: { bottom: 1250, band: 60, vpy: 1100, vpx: 0.5, base: [244, 198, 158], pave: [232, 177, 139], frontMax: 528 },
  2: { bottom: 1129, band: 65, vpy: 967, vpx: 0.5, base: [245, 215, 190], pave: [241, 206, 181], frontMax: 528 },   // frontMax: the front edge of the hole's floor (front plane) must stay above this screen row (user 2026-10-12: level 2's pit floor ran off the bottom edge); the pit gets shallower to fit
  3: { bottom: 1215, band: 70, vpy: 1040, vpx: 0.5, base: [108, 91, 96], pave: [81, 70, 80], frontMax: 528 },
  4: { bottom: 1250, band: 60, vpy: 1100, vpx: 0.5781, base: [42, 57, 133], pave: [32, 42, 121], glass: true },   // glass: the rim of a hole is the bright teal glass edge (like the cross-section's top rows), with red warning lamps
  5: { bottom: 1312, band: 76, vpy: 1157, vpx: 0.5, base: [157, 137, 126], pave: [145, 128, 120] },   // level 5 (user 2026-10-12): perspective floor like levels 1-4; no pits on this level, so only the band / cross-section are used
  6: { bottom: 1135, band: 76, vpy: 980, vpx: 0.5, base: [198, 135, 77], pave: [153, 103, 67], frontMax: 528 },   // level 6 (user 2026-10-12, night market): picture cut at the street band in front of the shops; same frontMax as level 3 (same y_ground)
  18: { bottom: 1312, band: 76, vpy: 990, vpx: 0.5, base: [125, 114, 113], pave: [112, 103, 106], frontMax: 528 }   // level 18 (user 2026-10-13, Ximending wide panorama pano45_s2101): numbers from art_eval/lv_shinkai/v3/out/L18v3_pano45p_s2105_persp.json (2026-10-13: 2105p + TAIPEI painted by add_taipei_text.py, no grey band; replaced 2101p, backup art_eval/persp/prev2101p_*) (vpy 899 measured from the crossing stripe edges 2026-10-13, was the pipeline default 1157)
};
// Pebble pit (level data pit_kind: 'pebble', user 2026-10-12: Taiwan's pebble health-walk path at the bottom of a pit): the player on the pebbles walks slower and every step hurts a little. Values are first guesses.
const PEBBLE_SLOW = 0.6, PEBBLE_DMG = 3, PEBBLE_TICK_MS = 600;
const ENEMY_SLIP_ACCEL = 1600;   // px/s^2 of an enemy's ground speed change on a dry street's worth of grip (x wetGrip when wet); the player uses 3600. First guess, user to tune.
const FIRE_ENTER_DMG = 8, FIRE_DMG = 2, FIRE_TICK_MS = 500, FIRE_LINGER_MS = 2500;
const POISON_DMG = 1, POISON_TICK_MS = 500, POISON_LINGER_MS = 8000;
// Warning board lines per pit kind (a random one is shown on the far wall of each pit). spikes / pebble / fire = the user's words (2026-10-12); poison = suggestions, to be picked by the user. The level-4 bottomless pit uses the level's own pit_warning_texts.
const PIT_WARN = { spikes: ['很尖', '救人喔!'], pebble: ['健康?', '我踩!'], fire: ['燒A!', '五分熟'], poison: ['有毒!', '別喝!', '毒你喔', '快閃!', '不是珍奶'] };
const FLOOD_SLOW = 0.5;   // flood (user 2026-10-13): walking speed x0.5 (the jump is x1/sqrt2 = half the height, in player.js)
const PERSP_FACE_DY = 12;   // the cross-section's top edge sits this far below the ground line (= the picture's bottom edge)

class LevelScene extends Phaser.Scene {
  constructor() { super('Level'); }

  init(data) {
    this.lvl = GAME_DATA.levels[RUN.level - 1];
    this.theme = GAME_DATA.themes[this.lvl.theme];
    this.groundSegments = this.lvl.ground;
    this.enemiesRemaining = 0;
    this.exitOpen = false;
    this.finished = false;
    this.deathStarted = false;
    RUN.levelStats = { hits: 0, kills: 0, startMs: Date.now() };
  }

  create() {
    const lvl = this.lvl;
    const theme = this.theme;

    // Weather is drawn first: a flood (WX.isFlood: thunder / typhoon on an outdoor flat level) removes the pits and closes the gaps in the ground, which are built below.
    RUN._lvlSnap = { level: RUN.level, hp: RUN.hp, coins: RUN.coins || 0, kills: RUN.kills || 0, simUses: RUN.simUses || 0 };   // the HUD's restart button puts these back
    if (window.REC) REC.levelStart(RUN.level);   // play records (records.js, trial build only)
    this.cond = WX.pick(RUN.level);   // { time: day | dusk | night, wx: weather id or null }
    this.weatherId = this.cond.wx;
    this.flood = WX.isFlood(this.cond, RUN.level);
    let groundSegs = lvl.ground;
    if (this.flood) {   // flood: no pits, so each ground segment is stretched to meet the next one (lvl.ground itself is left alone)
      const sorted = lvl.ground.slice().sort((a, b) => a.x - b.x);
      groundSegs = sorted.map((sg, i) => (i < sorted.length - 1 ? Object.assign({}, sg, { w: sorted[i + 1].x - sg.x }) : sg));
      this.groundSegments = groundSegs;
    }

    this.physics.world.setBounds(0, 0, lvl.width, 700);
    this.cameras.main.setBounds(0, 0, lvl.width, 540);

    // Sky gradient (fixed)
    const g = this.add.graphics();
    g.fillGradientStyle(theme.sky_gradient_top, theme.sky_gradient_top, theme.sky_gradient_bottom, theme.sky_gradient_bottom, 1);
    g.fillRect(0, 0, GAME_W, 540);
    g.setScrollFactor(0).setDepth(-30);

    // Backdrop (slow parallax)
    // Per-level artwork (backdrop_lvNN.jpg + ground_lvNN.png); levels without it fall back to the theme art. `sysm` = level-1 mechanics (no platforms, spike pits, exit arrow).
    const lvKey = 'lv' + String(RUN.level).padStart(2, '0');
    const custom = this.textures.exists('backdrop_' + lvKey) && this.textures.exists('ground_' + lvKey);
    const sysm = true; // every level uses the level-1 mechanics: no floating platforms, spike pits instead of open gaps, breathing arrow + walk to the right screen edge to finish (name kept from level 1)
    
    // Check for sky-cut backdrop
    this.skyCut = this.textures.exists('backdrop_' + lvKey + '_sky');
    const bdKey = this.skyCut ? 'backdrop_' + lvKey + '_sky' : (custom ? 'backdrop_' + lvKey : 'backdrop_' + theme.id);
    
    const bd = this.add.image(GAME_W / 2, 270, bdKey).setScrollFactor(0).setDepth(-20).setAlpha(custom ? 1 : 0.9);
    
    // Scale logic: use actual texture dimensions for sky-cut images too
    const isCustomArt = this.skyCut || custom;
    const s = Math.max(isCustomArt ? (GAME_W + 2 * 0.03 * Math.max(0, lvl.width - GAME_W) + 4) / bd.width : GAME_W / bd.width, 540 / bd.height);
    bd.setScale(s);
    
    // level 1 is a far view: the picture ends at the foot of the building, so sit its bottom edge on the ground line (the plaza tile is drawn by the program)
    this._persp = isCustomArt ? PERSP[RUN.level] : null;   // levels 1-4: perspective ground (the picture's bottom strip is the walkable band, see _drawPitsPersp)
    this._lvKey = lvKey;
    if ((RUN.level <= 6 || RUN.level === 18) && isCustomArt) { bd.setOrigin(0.5, 1); bd.y = lvl.y_ground + (this._persp ? PERSP_FACE_DY : 8); }

    this.backdrop = bd;

    // Level 4 glass floor (user 2026-10-12): the walkable band of the backdrop is semi-transparent glass; the strip behind the backdrop (the view straight down on Taipei) shows through it (see _drawGlassFloor)
    this._glassUV = null; this._glassG = null; this._glassLook = false;
    if (this._persp && RUN.level === 4 && this.textures.exists('underview_lv04')) {
      this._glassUV = this.add.image(0, 0, 'underview_lv04').setOrigin(0, 0).setScrollFactor(0).setDepth(-21);
      this._glassG = this.add.graphics().setDepth(-0.4);   // panel seams and reflections: above the backdrop, below the pit graphics (-0.1), so the holes cover them
    }

    // Static ground group
    this.groundGroup = this.physics.add.staticGroup();
    this.platformGroup = this.physics.add.staticGroup(); // one-way: only collide when landing from above

    // Ground segments
    this._groundParts = [];
    for (const seg of groundSegs) {
      const fdy = this._persp ? PERSP_FACE_DY : 0; // perspective levels: the cross-section starts below the paving band
      const ts = this.add.tileSprite(seg.x, seg.y + fdy, seg.w, 140 - fdy, custom ? 'ground_' + lvKey : 'ground_' + theme.id);
      ts.setOrigin(0, 0);
      if (this._persp) ts.setDepth(-0.2); // the pit graphics (-0.1) draw the coping over the face
      const r = this.add.rectangle(seg.x + seg.w / 2, seg.y + 70, seg.w, 140, 0x000000, 0);
      this.physics.add.existing(r, true);
      this.groundGroup.add(r);
      this._groundParts.push({ seg: seg, ts: ts, body: r });
    }

    // Level 1: every gap in the ground is a pit with a floor and spikes (see _buildPit / _pitAt)
    this._sysm = sysm;
    this._pits = [];
    this._look = null;
    this._pitFG = null; this._pitFM = null; this._pitSmoke = null; this._pitFire = null; this._pitSM = null; this._pitFireF = null; this._pitSmokeF = null;
    this._pitG = null;   // the scene object is reused between levels: drop the previous run's (destroyed) pit graphics
    this._pitStatus = { burn: { until: 0, nextTick: 0 }, poison: { until: 0, nextTick: 0 } };
    this._inPit = null;
    if (this.flood && this._persp) this._ensurePitLayers();   // the ground cross-sections are still placed by _drawPitsPersp
    if (sysm && !this.flood) {
      const segs = lvl.ground.slice().sort((a, b) => a.x - b.x);
      for (let i = 0; i < segs.length - 1; i++) {
        const l = segs[i].x + segs[i].w, r = segs[i + 1].x;
        if (r - l > 20) {
          let kind = 'spikes';
          if (lvl.deep_pit) {
            kind = 'deep';
          } else if (this._persp && lvl.pit_kinds && lvl.pit_kinds.length) {
            kind = lvl.pit_kinds[Math.floor(Math.random() * lvl.pit_kinds.length)];
          } else if (this._persp && lvl.pit_kind) {
            kind = lvl.pit_kind;
          }
          const pit = { l: l, r: r, floor: this._pitFloorY(), deep: kind === 'deep', pebble: kind === 'pebble', kind: kind };
          this._pits.push(pit);
          this._buildPit(pit);
        }
      }
      this._buildPitWarnings();
    }

    // Platforms
    const tc = THEME_COLORS[theme.id] || [13421772, 8947848];
    for (const p0 of (sysm ? [] : lvl.platforms)) { // no floating platforms (solid stepped ones may come with later level design)
      const p = Object.assign({}, p0, { y: Math.max(p0.y, lvl.y_ground - MAX_PLATFORM_H) }); // jump apex is ~140, keep every platform reachable
      const body = this.add.rectangle(p.x + p.w / 2, p.y + 10, p.w, 20, tc[1]);
      this.physics.add.existing(body, true);
      this.platformGroup.add(body);
      const top = this.add.rectangle(p.x + p.w / 2, p.y + 2.5, p.w, 5, tc[0]);
    }

    // Weather
    this.wx = WX.start(this, theme.id, this.cond);

    // Enemies group (before player)
    this.enemies = this.physics.add.group();

    // Player
    this.player = new Player(this, PLAYER_SPAWN_X, lvl.y_ground - 100);
    this.player.beginSpawn(PLAYER_SPAWN_X, lvl.y_ground);   // level start: blink in above the ground, controls unlock on landing

    if (this._persp) this._insetGroundAtPits();   // perspective levels: the player falls once his centre passes the rim (see _insetGroundAtPits)

    // Colliders
    this.physics.add.collider(this.player.sprite, this.groundGroup);
    this.physics.add.collider(this.enemies, this.groundGroup);
    const oneWay = (obj, plat) => obj.body.velocity.y >= 0 && obj.body.bottom <= plat.body.top + 14;
    this.physics.add.collider(this.player.sprite, this.platformGroup, null, oneWay);
    this.physics.add.collider(this.enemies, this.platformGroup, null, oneWay);

    // Spawns
    const hasMinions = lvl.spawns.some((x) => !GAME_DATA.bosses[x.type]);
    // Hard mode (user 2026-10-13): minions x1.5-2, drawn once each time the level starts; that many extra copies go to randomly chosen minion spawn points (one extra per point at most)
    const minionSps = lvl.spawns.filter((x) => !GAME_DATA.bosses[x.type] && GAME_DATA.enemies[x.type]), doubled = new Set();
    this._hardMinionMult = RUN.hard ? 1.5 + Math.random() * 0.5 : 1;
    if (RUN.hard) {
      const idx = minionSps.map((x, i) => i), extra = Math.min(minionSps.length, Math.round(minionSps.length * (this._hardMinionMult - 1)));
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      idx.slice(0, extra).forEach((i) => doubled.add(minionSps[i]));
    }
    for (const sp of lvl.spawns) {
      if (GAME_DATA.bosses[sp.type] && hasMinions) {
        this._pendingBoss = sp; // level 5: the boss only appears after every minion is dead (_startBossEntrance)
      } else if (GAME_DATA.bosses[sp.type]) {
        const boss = new Boss(this, GAME_DATA.bosses[sp.type], sp.x, lvl.y_ground - 20);
        this.enemies.add(boss.sprite);
        this.boss = boss;
        this.enemiesRemaining++;
      } else {
        const def = GAME_DATA.enemies[sp.type];
        if (def) {
          this.addEnemy(def, sp.x, sp.y_hint);
          if (doubled.has(sp)) this.addEnemy(def, Math.min(this.lvl.width - 80, sp.x + 56), sp.y_hint);   // hard mode extra copy (see above)
        }
      }
    }

    // Exit door
    this.exitDoor = this.add.rectangle(lvl.exit_x, lvl.y_ground, 48, 96, 0x777777).setOrigin(0.5, 1);
    this.exitLabel = this.add.text(lvl.exit_x, lvl.y_ground - 108, '出口', {
      fontFamily: 'Microsoft JhengHei, PingFang TC, sans-serif',
      fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 4
    }).setOrigin(0.5);

    // Level 1: no exit door; once the level is cleared a breathing translucent arrow shows at the right edge of the screen and walking to that edge ends the level
    this._exitArrow = null;
    if (sysm) {
      this.exitDoor.setVisible(false); this.exitLabel.setVisible(false);
      const ag = this.add.graphics();
      ag.fillStyle(0xffffff, 1); ag.fillTriangle(-20, -42, 34, 0, -20, 42);
      ag.lineStyle(4, 0x6b7077, 0.8); ag.strokeTriangle(-20, -42, 34, 0, -20, 42);
      this._exitArrow = this.add.container(GAME_W - 56, 210, [ag]).setScrollFactor(0).setDepth(90).setAlpha(0.3).setVisible(false);
      this.tweens.add({ targets: this._exitArrow, alpha: 0.7, scale: 1.12, x: GAME_W - 46, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }

    // Camera follow
    this.cameras.main.startFollow(this.player.sprite, true, 0.1, 0.1);

    // HUD
    this.hud = new HUD(this);
    this._showIntro(lvl);

    // Keys
    const K = this.input.keyboard.addKeys('LEFT,RIGHT,UP,A,D,W,SPACE,J,K');
    this.touch = (typeof TouchControls !== 'undefined') ? TouchControls.create(this) : null;
    const T = this.touch || {};
    this.keys = {
      left: { get isDown() { return K.A.isDown || K.LEFT.isDown || !!T.left; } },
      right: { get isDown() { return K.D.isDown || K.RIGHT.isDown || !!T.right; } },
      up: { get isDown() { return K.W.isDown || K.UP.isDown || K.SPACE.isDown || !!T.up; } },
      attack: { get isDown() { return K.J.isDown || !!T.attack; } },
      skill: { get isDown() { return K.K.isDown || !!T.skill; } }
    };

    // How-to-play overlay: the first time level 1 starts in a run (RUN._howto is reset by newRun) the level is paused under a translucent mask with text guides until the player taps OK (charpanel.js HowToScene)
    if (RUN.level === 1 && !RUN._howto) {
      RUN._howto = true;
      this.time.delayedCall(60, () => {
        if (!this.sys.isActive() || this.finished) return;
        if (this.touch && this.touch.reset) this.touch.reset();
        this.scene.pause();
        this.scene.launch('HowTo', { from: this.scene.key });
      });
    }

    // Events
    this.events.on('enemy-dead', this.onEnemyDead, this);
    this.events.on('player-dead', this.onPlayerDead, this);

    // Shutdown cleanup
    this.events.once('shutdown', () => {
      if ((typeof Extras !== 'undefined')) Extras.destroy(this);
      this.events.off('enemy-dead', this.onEnemyDead, this);
      this.events.off('player-dead', this.onPlayerDead, this);
      if (this.wx) this.wx.destroy();
      if (this.hud) this.hud.destroy();
      this._lowHp = null; this._vignette = null;   // FX.lowHpBorder keeps these on the scene, which is reused by the next level / retry: stale refs blocked the red border and vignette from being rebuilt
      if (this.touch && this.touch.destroy) this.touch.destroy();   // its skTick sits on scene.events, which outlives the level: left on, it wrote to the destroyed countdown text and stopped the game loop on the next level's skill cast
      delete window.__level;
    });

    // Debug hooks
    window.__level = this;
    // ?dbg=1 (remembered until ?dbg=0): on-screen state readout for diagnosing "stuck" reports on phones (nothing is created without the flag)
    try { if (/[?&]dbg=1/.test(location.search)) localStorage.setItem('dbg', '1'); else if (/[?&]dbg=0/.test(location.search)) localStorage.removeItem('dbg'); } catch (e) {}   // the flag sticks, so an installed app (no URL params) can show it too
    var dbgOn = false; try { dbgOn = localStorage.getItem('dbg') === '1'; } catch (e) {}
    if (dbgOn) {
      this._dbgTxt = this.add.text(4, 150, '', { fontFamily: 'monospace', fontSize: '12px', color: '#00ff66', backgroundColor: '#000000bb' }).setScrollFactor(0).setDepth(9999);
      this._dbgFrames = 0; this._dbgErr = '';
      window.addEventListener('error', (e) => { this._dbgErr = String(e.message || e).slice(0, 80); });
      window.addEventListener('unhandledrejection', (e) => { this._dbgErr = String(e.reason).slice(0, 80); });
    }
    window.GAME_DEBUG = {
      killAll: () => { for (const s of this.enemies.getChildren()) if (s.ref && !s.ref.dead) s.ref.takeHit(99999, 0, false, {}); },
      godMode: false,
      tp: (x) => { this.player.sprite.x = x; },
      goto: (n) => { RUN.level = n; this.scene.restart(); }
    };

    if ((typeof Extras !== 'undefined')) Extras.init(this);

    // Fade in
    this.cameras.main.fadeIn(300);
  }

  hasGroundAt(x) {
    return this.groundSegments.some((g) => x >= g.x && x <= g.x + g.w);
  }

  _dbgUpdate(time, delta) {
    const P = this.player, s = P && P.sprite, now = this.time.now;
    this._dbgFrames++;
    const f = (v) => (v > now ? Math.round(v - now) : 0);
    const T = this.touch || {};
    const L = [
      'fr ' + this._dbgFrames + ' fps ' + Math.round(this.game.loop.actualFps) + ' dt ' + Math.round(delta),
      'finished ' + !!this.finished + ' deathStarted ' + !!this.deathStarted + ' dead ' + !!(P && P.dead),
      'paused ' + this.physics.world.isPaused + ' _hitStop ' + !!this._hitStop,
      'ts time ' + this.time.timeScale + ' tw ' + this.tweens.timeScale + ' ph ' + this.physics.world.timeScale,
      s ? 'spawning ' + !!P.spawning + ' ov ' + (P._ov ? P._ov.kind : '-') + ' alpha ' + s.alpha.toFixed(2) + ' tintFill ' + s.tintFill : '',
      s ? 'x ' + Math.round(s.x) + ' y ' + Math.round(s.y) + ' vx ' + Math.round(s.body.velocity.x) + ' vy ' + Math.round(s.body.velocity.y) + ' down ' + (s.body.blocked.down || s.body.touching.down) : '',
      P ? 'knock ' + f(P._knockUntil) + ' inv ' + f(P.invUntil) + ' exam ' + f(P.examUntil) + ' skillCd ' + f(P.skillReadyAt) : '',
      'touch L' + (+!!T.left) + ' R' + (+!!T.right) + ' U' + (+!!T.up) + ' A' + (+!!T.attack) + ' S' + (+!!T.skill),
      P ? 'char ' + RUN.char + ' prevSkill ' + !!P._prevSkill + ' prevUp ' + !!P._prevUp + ' prevAtk ' + !!P._prevAtk : '',
      'hp ' + RUN.hp + ' lvl ' + RUN.level + ' err ' + this._dbgErr
    ];
    this._dbgTxt.setText(L.join('\n'));
  }

  update(time, delta) {
    if (this._dbgTxt) this._dbgUpdate(time, delta);
    if (this.finished || this.deathStarted) return;
    if ((typeof Extras !== 'undefined')) Extras.update(this, time, delta);

    // Backdrop parallax
    if (this.backdrop) this.backdrop.x = GAME_W / 2 - this.cameras.main.scrollX * 0.03;
    if (this._pitG) this._drawPitsPersp();
    if (this._glassUV) this._drawGlassFloor();

    // Player update
    this.player.terrainSlow = this._pebbleUnder() ? PEBBLE_SLOW : 1;   // read by Player.update (the pebbles slow the walk)
    this.player.update(time, delta, this.keys);

    // Enemies update
    for (const s of this.enemies.getChildren()) {
      const r = s.ref;
      if (r && !r.dead) {
        r.update(time, delta, this.player);
        // Flood (user 2026-10-13): ground enemies walk at half speed (same per-frame scaling as the pebble pit below; flyers and knockback are left alone)
        if (this.flood && s.body && !(r.isFlyer && r.isFlyer()) && time > (r._knockUntil || 0) && (s.body.blocked.down || s.body.touching.down)) s.body.velocity.x *= FLOOD_SLOW;
        // Wet street (weather.js sets this.wetGrip < 1): a ground enemy's speed change is rate-limited like the player's, so it slides when it stops or turns (user 2026-10-12: enemies slip too).
        // Flyers, knockback (_knockUntil) and anything in the air are left alone; the command r.update just wrote to the body is the target the real speed eases toward.
        if (s.body) {
          const grip = this.wetGrip || 1, onGround = s.body.blocked.down || s.body.touching.down;
          if (grip < 1 && onGround && !(r.isFlyer && r.isFlyer()) && time > (r._knockUntil || 0)) {
            const cmd = s.body.velocity.x, prev = r._slipVx === undefined ? cmd : r._slipVx, a = ENEMY_SLIP_ACCEL * grip * (delta / 1000);
            const vx = Math.abs(cmd - prev) <= a ? cmd : prev + Math.sign(cmd - prev) * a;
            s.body.setVelocityX(vx); r._slipVx = vx;
          } else r._slipVx = s.body.velocity.x;
        }
        // Enemy pit effects
        if (this._sysm && s.body) {
          const pit = this._pitAt(s.x);
          if (pit && s.body.bottom >= pit.floor - 6) {
            if (pit.kind === 'pebble') {
              s.body.velocity.x *= PEBBLE_SLOW;
              if (!r._pitNextTick) r._pitNextTick = time + PEBBLE_TICK_MS;
              if (time >= r._pitNextTick) {
                r._pitNextTick = time + PEBBLE_TICK_MS;
                if (typeof r.pitDamage === 'function') r.pitDamage(PEBBLE_DMG);
              }
            } else if (pit.kind === 'fire') {
              if (!r._pitEntered) {
                r._pitEntered = true;
                if (typeof r.pitDamage === 'function') r.pitDamage(FIRE_ENTER_DMG);
              }
              if (!r._pitNextTick) r._pitNextTick = time + FIRE_TICK_MS;
              if (time >= r._pitNextTick) {
                r._pitNextTick = time + FIRE_TICK_MS;
                if (typeof r.applyBurn === 'function') r.applyBurn(FIRE_DMG * 1000 / FIRE_TICK_MS, FIRE_LINGER_MS / 1000);
              }
            } else if (pit.kind === 'poison') {
              if (!r._pitNextTick) r._pitNextTick = time + POISON_TICK_MS;
              if (time >= r._pitNextTick) {
                r._pitNextTick = time + POISON_TICK_MS;
                if (typeof r.applyPoison === 'function') r.applyPoison(POISON_DMG, POISON_TICK_MS, POISON_LINGER_MS);
              }
            }
          } else {
            r._pitEntered = false;
            r._pitNextTick = 0;
          }
        }
      }
    }

    // Pit check for enemies (Death/Reset)
    for (const s of this.enemies.getChildren().slice()) {
      if (s.ref && !s.ref.dead && (s.y > 620 || (this._sysm && (s.body ? s.body.bottom : s.y) > this.lvl.y_ground + 34 && this._pitAt(s.x)))) {
        const pit = this._pitAt(s.x);
        if (pit && (pit.kind === 'pebble' || pit.kind === 'fire' || pit.kind === 'poison')) {
          continue; // Effects handled in update loop
        }
        if (pit && pit.kind === 'spikes') {
          if (s.ref.pitReset) { s.ref.pitReset(); continue; }
        }
        s.ref.fell = true;
        s.ref.die();
      }
    }

    // HUD update
    if (this.hud) this.hud.update(time, delta);

    // Pit check (level 1: landing on the spikes of a pit; elsewhere: falling out of the world)
    const ps = this.player.sprite;
    const pitHere = ps.body && this._pitAt(ps.x), deepPit = pitHere && pitHere.deep && ps.body.bottom > this.lvl.y_ground + 110 ? pitHere : null;
    if (deepPit && !this.player.dead) {   // bottomless pit: the same end as dying (End screen, retry this level); the debug god mode only puts the player back before the pit
      if (window.GAME_DEBUG && GAME_DEBUG.godMode) this.player.beginSpawn(Math.max(40, deepPit.l - ps.displayWidth * 2), this.lvl.y_ground);
      else { RUN.hp = 0; this.player.dead = true; this.events.emit('player-dead'); }
      return;
    }
    const inv = this.player.examUntil > time || this.player.nanoUntil > time; // skill invincibility (Greenie's exam max, Geek's nano process): pits/spikes neither hurt nor reset
    
    // Player Pit Status Logic
    if (this._sysm && ps.body && !this.player.dead) {
      const currentPit = this._pitAt(ps.x);
      const isOnFloor = currentPit && ps.body.bottom >= currentPit.floor - 6;
      
      // Enter detection
      if (isOnFloor && this._inPit !== currentPit) {
        this._inPit = currentPit;
        if (currentPit.kind === 'fire') {
          this.player.tickDamage(FIRE_ENTER_DMG, 0xff9040);
          this._pitStatus.burn.until = time + FIRE_LINGER_MS;
          this._pitStatus.burn.nextTick = time + FIRE_TICK_MS;
        } else if (currentPit.kind === 'poison') {
          this._pitStatus.poison.until = time + POISON_LINGER_MS;
          this._pitStatus.poison.nextTick = time + POISON_TICK_MS;
        }
      } else if (!isOnFloor) {
        this._inPit = null;
      }

      // Refresh duration if standing in pit
      if (isOnFloor) {
        if (currentPit.kind === 'fire') this._pitStatus.burn.until = time + FIRE_LINGER_MS;
        if (currentPit.kind === 'poison') this._pitStatus.poison.until = time + POISON_LINGER_MS;
      }

      // Tick Damage
      if (this._pitStatus.burn.until > time) {
        if (time >= this._pitStatus.burn.nextTick) {
          this.player.tickDamage(FIRE_DMG, 0xff9040);
          this._pitStatus.burn.nextTick = time + FIRE_TICK_MS;
        }
      }
      if (this._pitStatus.poison.until > time) {
        if (time >= this._pitStatus.poison.nextTick) {
          this.player.tickDamage(POISON_DMG, 0x66ff66);
          this._pitStatus.poison.nextTick = time + POISON_TICK_MS;
        }
      }
    } else {
      this._inPit = null;
    }

    const onSpikes = this._sysm && ps.body && ps.body.bottom > this.lvl.y_ground + 34 && pitHere && pitHere.kind === 'spikes';
    if (this._pebbleUnder() && Math.abs(ps.body.velocity.x) > 20 && time >= (this._pebbleNext || 0)) { this._pebbleNext = time + PEBBLE_TICK_MS; this.player.tickDamage(PEBBLE_DMG); }   // walking on the pebbles hurts (standing still does not)
    
    if (inv) {
    } else if (onSpikes) {
      this.player.takeDamage(20, 0, true);
      if (!this.player.dead) {
        const pit = this._pitAt(ps.x);
        // reset two character widths before the pit's left edge: blink in just above the ground there and drop (player.beginSpawn)
        this.player.beginSpawn(Math.max(40, (pit ? pit.l : ps.x) - ps.displayWidth * 2), this.lvl.y_ground);
      }
    } else if (this.player.sprite.y > 620) {
      this.player.takeDamage(20, 0, true);
      const lg = this.player._lastGround;   // the player keeps its last footing in _lastGround (lastGroundedX/Y never existed)
      const lastX = (lg && lg.x) || PLAYER_SPAWN_X;
      const lastY = (lg && lg.y) || this.lvl.y_ground;
      this.player.sprite.x = lastX - 100;
      this.player.sprite.y = lastY - 60;
    }

    // Exit overlap
    if (this._exitArrow) this._exitArrow.setVisible(!!this.exitOpen && !this.finished);
    if (this.exitOpen && !this.finished) {
      const atExit = this._sysm ? (this.player.sprite.x - this.cameras.main.scrollX > GAME_W - 45) : Math.abs(this.player.sprite.x - this.lvl.exit_x) < 40;
      if (atExit) {
        this.finished = true;
        RUN.levelStats.time = Date.now() - RUN.levelStats.startMs;
        if (RUN.level === GAME_DATA.levels.length) { // last level (30; the trial build ?demo=1 has 5)
          this.scene.start('End', { result: 'victory' });
        } else {
          this.cameras.main.fadeOut(300);
          this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start('Cleared', { cleared: RUN.level, stats: RUN.levelStats });
          });
        }
      }
    }
  }

  // Level entrance caption: place name + one short sentence, fades in, holds, fades out (data: levels.json name_zh / intro_text_zh).
  _showIntro(lvl) {
    if (!lvl.intro_text_zh) return;
    const F = 'Microsoft JhengHei, PingFang TC, sans-serif', cx = GAME_W / 2;
    const t1 = this.add.text(0, -16, lvl.name_zh, { fontFamily: F, fontSize: '21px', fontStyle: 'bold', color: '#ffffff', stroke: '#1a1a1a', strokeThickness: 5 }).setOrigin(0.5);
    const t2 = this.add.text(0, 18, lvl.intro_text_zh, { fontFamily: F, fontSize: '21px', color: '#fff6d8', stroke: '#1a1a1a', strokeThickness: 4, wordWrap: { width: Math.min(GAME_W - 80, 780), useAdvancedWrap: true }, align: 'center' }).setOrigin(0.5, 0);
    const parts = [t1, t2]; let extra = 0;
    const ct = GAME_DATA.condText && GAME_DATA.condText[RUN.level], line = ct && this.cond && ct[this.cond.time] && ct[this.cond.time][this.cond.wx || 'none'];   // levels 1-5: one sentence for this level x time x weather (data/level_condition_text.json, written by IQ4)
    const lineText = line || (this.weatherId === 'typhoon' ? '颱風天戶外活動請注意：強風會吹偏空中的你，小心腳下的尖刺坑！' : null);   // other levels keep the old typhoon safety line
    if (lineText) {
      const t3 = this.add.text(0, 18 + t2.height + 10, lineText, { fontFamily: F, fontSize: '21px', fontStyle: 'bold', color: line ? '#9fe3ff' : '#ffb347', stroke: '#1a1a1a', strokeThickness: 4, wordWrap: { width: Math.min(GAME_W - 80, 780), useAdvancedWrap: true }, align: 'center' }).setOrigin(0.5, 0);
      parts.push(t3); extra = t3.height + 10;
    }
    const w = Math.max(t1.width, t2.width, parts.length > 2 ? parts[2].width : 0) + 56, h = 40 + t2.height + 22 + extra;
    const bg = this.add.graphics(); bg.fillStyle(0x000000, 0.38); bg.fillRoundedRect(-w / 2, -40, w, h, 18);
    const box = this.add.container(cx, 205, [bg].concat(parts)).setScrollFactor(0).setDepth(150).setAlpha(0);
    this.tweens.add({ targets: box, alpha: 1, y: 213, duration: 400, ease: 'Sine.Out' });
    this.tweens.add({ targets: box, alpha: 0, delay: 3200, duration: 700, onComplete: () => box.destroy() });
  }

  // Spiked pit: dark cavity, stone floor, a row of upward spikes; an invisible static floor body catches whatever falls in.
  _buildPit(pit) {
    if (this._persp) { // perspective levels: the hole, its walls, the blades and the coping are all drawn every frame by _drawPitsPersp; here only the physics floor
      this._ensurePitLayers();
      if (pit.deep) return;   // bottomless (level data deep_pit): no floor body, no blades; falling in ends the level (see update)
      const fp = this.add.rectangle((pit.l + pit.r) / 2, pit.floor + 10, pit.r - pit.l, 20, 0x000000, 0);
      this.physics.add.existing(fp, true);
      this.groundGroup.add(fp);
      return;
    }
    const y0 = this.lvl.y_ground, w = pit.r - pit.l; let g = this.add.graphics().setDepth(-0.1);   // cavity / floor / walls sit behind the player (depth 0): at 0.2 they hid a player (or anything at depth 0) that fell in
    g.fillGradientStyle(0x4a3c46, 0x4a3c46, 0x1c1620, 0x1c1620, 1);
    g.fillRect(pit.l, y0, w, pit.floor - y0);
    g.fillStyle(0xc7b19e, 1); g.fillRect(pit.l, pit.floor, w, y0 + 140 - pit.floor);
    g.lineStyle(3, 0x8f7a68, 1); g.lineBetween(pit.l, y0, pit.l, pit.floor); g.lineBetween(pit.r, y0, pit.r, pit.floor);
    g.lineStyle(2, 0x8f7a68, 1); g.lineBetween(pit.l, pit.floor, pit.r, pit.floor);
    const n = Math.max(2, Math.round(w / 16)), sw = w / n;
    g = this.add.graphics().setDepth(0.2);   // spikes stay in front, as before
    for (let i = 0; i < n; i++) {
      const x = pit.l + i * sw;
      g.fillStyle(0xd4dae1, 1); g.fillTriangle(x + 1, pit.floor, x + sw - 1, pit.floor, x + sw / 2, pit.floor - 28);
      g.fillStyle(0xf4f7fa, 1); g.fillTriangle(x + 1, pit.floor, x + sw / 2, pit.floor, x + sw / 2, pit.floor - 28);
      g.lineStyle(2, 0x59606a, 1); g.strokeTriangle(x + 1, pit.floor, x + sw - 1, pit.floor, x + sw / 2, pit.floor - 28);
    }
    const f = this.add.rectangle((pit.l + pit.r) / 2, pit.floor + 10, w, 20, 0x000000, 0);
    this.physics.add.existing(f, true);
    this.groundGroup.add(f);
  }

  // Graphics layers shared by all pits of a perspective level (also needed on a flood level without pits: _drawPitsPersp places the ground cross-sections).
  _ensurePitLayers() {
      if (!this._pitG) this._pitG = this.add.graphics().setDepth(-0.1);
      if (!this._pitFG) {   // floor decoration layer above it, clipped to the hole openings (user 2026-10-12 bug: pebbles / flames spilled over the neighbouring ground's cross-section, which then looked transparent)
        this._pitFire = this.add.graphics().setDepth(-0.04);   // flames of fire pits: in front of the warning board text (-0.05), clipped to the hole openings like the other floor details
        this._pitSmoke = this.add.graphics().setDepth(-0.03);   // black smoke of fire pits: behind the characters; clipped to 'the hole openings + everything above the walkway's front edge' so it never covers the cross-section
        this._pitSM = this.make.graphics({ x: 0, y: 0, add: false }); this._pitSmoke.setMask(this._pitSM.createGeometryMask());
        this._pitFG = this.add.graphics().setDepth(-0.1); this._pitFM = this.make.graphics({ x: 0, y: 0, add: false }); this._pitFG.setMask(this._pitFM.createGeometryMask());
        this._pitFire.setMask(this._pitFM.createGeometryMask());
        // front copies (user 2026-10-12: a character that falls in stands BETWEEN the back and the front flames / smoke / vapour): the rows nearer than the feet plane (k > SP) are drawn above the characters
        this._pitFireF = this.add.graphics().setDepth(2.5); this._pitFireF.setMask(this._pitFM.createGeometryMask());
        this._pitSmokeF = this.add.graphics().setDepth(2.52); this._pitSmokeF.setMask(this._pitSM.createGeometryMask());
      }
  }

  // Every pit gets a yellow warning board mounted on its far wall (drawn by _drawPitsPersp; here only the random line of text and its clip mask are made).
  // Lines: PIT_WARN[kind]; the bottomless pit (deep_pit, level 4) uses the level's pit_warning_texts.
  _buildPitWarnings() {
    const F = 'Microsoft JhengHei, PingFang TC, sans-serif';
    for (const pit of this._pits) {
      const list = pit.deep ? this.lvl.pit_warning_texts : PIT_WARN[pit.kind];
      const word = list && list.length ? list[Math.floor(Math.random() * list.length)] : (pit.deep ? '很深' : '');   // a random line each time the level is entered
      if (!word) continue;
      const t = this.add.text(0, 0, word, { fontFamily: F, fontSize: '30px', fontStyle: 'bold', color: '#15181c' }).setOrigin(0.5).setDepth(-0.05).setVisible(false);
      t.setData('fit', Math.min(1, 76 / t.width));   // the room beside the triangle is about 76 px: longer lines shrink to fit
      pit._warnT = t;
      pit._warnM = this.make.graphics({ x: 0, y: 0, add: false });   // clip mask for the text, filled every frame by _drawPitsPersp
      t.setMask(pit._warnM.createGeometryMask());
    }
  }

  // Where a ground segment ends at a pit, its collision box is pulled back by the player's half body width: Arcade keeps a body standing as long as it overlaps the ground at all,
  // so with the full-width box the player hung on until his body was >24 px past the rim (and a jump only had to clear pit width - body width). Now he stands while his CENTRE is on the
  // ground and falls as soon as the centre passes the rim, which is where the hole is drawn (feet plane). Landing on the far side likewise needs the centre past the far rim.
  _insetGroundAtPits() {
    const h = this.player.sprite.body.halfWidth;
    for (const gp of this._groundParts) {
      let x0 = gp.seg.x, x1 = gp.seg.x + gp.seg.w;
      if (this._pits.some((q) => Math.abs(q.l - x1) < 1)) x1 -= h;
      if (this._pits.some((q) => Math.abs(q.r - x0) < 1)) x0 += h;
      if (x0 === gp.seg.x && x1 === gp.seg.x + gp.seg.w) continue;
      gp.body.destroy();   // also leaves the static group
      const r = this.add.rectangle((x0 + x1) / 2, gp.seg.y + 70, x1 - x0, 140, 0x000000, 0);
      this.physics.add.existing(r, true);
      this.groundGroup.add(r);
      gp.body = r;
    }
  }

  // Perspective hole (levels 1-4, PERSP): the vanishing point is a point of the backdrop picture (joints vertical at the picture centre, leaning more toward the edges), so it moves with the
  // backdrop parallax. The picture's bottom strip is the walkable band; each face is clipped to the visible hole (band opening + front notch). Spikes are black blades in 4 depth rows.
  _drawPitsPersp() {
    const g = this._pitG; g.clear();
    const gs = this._pitSmoke, g3 = this._pitFire, sm = this._pitSM, gsf = this._pitSmokeF, g3f = this._pitFireF; if (gs) gs.clear(); if (g3) g3.clear(); if (gsf) gsf.clear(); if (g3f) g3f.clear(); if (sm) sm.clear();
    const g2 = this._pitFG, hm = this._pitFM; g2.clear(); hm.clear(); hm.fillStyle(0xffffff, 1);
    const bd = this.backdrop, cf = this._persp, sx = this.cameras.main.scrollX, dw = bd.displayWidth;
    const ppr = bd.scaleY * bd.width / 3168;                                   // screen px per source-picture row
    const YB = bd.y, VPY = YB - (cf.bottom - cf.vpy) * ppr, VPX = bd.x + (cf.vpx - 0.5) * dw + sx;
    if (sm) { sm.fillStyle(0xffffff, 1); sm.fillRect(-200, -400, GAME_W + 400, YB + 400); }   // smoke mask: the whole area above the walkway's front edge (+ the openings, added per pit below)
    const BT = YB - cf.band * ppr, yg = this.lvl.y_ground;
    const SF = (BT - VPY) / (YB - VPY), SP = (yg - VPY) / (YB - VPY);
    const P = (x, y, k) => [VPX + (k / SP) * (x - VPX), VPY + k * (y - VPY)];   // x is a world x on the FEET plane (k = SP, where the characters walk and the collision is): the hole is exactly as wide as the physical pit there, wider in front (k = 1), narrower behind
    const lerp = (a, b, t) => a + (b - a) * t;
    const lk = this._look || (this._look = WX.skyLook(this.cond));   // same saturation / brightness as the backdrop gets
    const tone = (c) => { const gr = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; return c.map((v) => Math.max(0, Math.min(255, (gr + (v - gr) * (1 + lk.sat)) * lk.bri))); };
    const bs = tone(cf.base), pv = tone(cf.pave), sh = (k) => [bs[0] * k, bs[1] * k, bs[2] * k], hx = (k, c) => { c = c || bs; return (Math.min(255, Math.round(c[0] * k)) << 16) | (Math.min(255, Math.round(c[1] * k)) << 8) | Math.min(255, Math.round(c[2] * k)); };   // shades of the level's paving colour
    const mix = (c0, c1, t) => (Math.round(lerp(c0[0], c1[0], t)) << 16) | (Math.round(lerp(c0[1], c1[1], t)) << 8) | Math.round(lerp(c0[2], c1[2], t));
    const clip = (subj, clipPoly) => { // Sutherland-Hodgman, clipPoly convex, inside = cross >= 0
      let out = subj;
      for (let i = 0; i < clipPoly.length && out.length; i++) {
        const a = clipPoly[i], b = clipPoly[(i + 1) % clipPoly.length], inp = out; out = [];
        const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        for (let j = 0; j < inp.length; j++) {
          const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
          if (sp >= 0) out.push(p);
          if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([lerp(p[0], q[0], t), lerp(p[1], q[1], t)]); }
        }
      }
      return out;
    };
    const xf = (x) => VPX + (x - VPX) / SP;   // world x on the feet plane -> x on the front plane (the cross-section face is nearer than the feet)
    for (const gp of this._groundParts) { const a = xf(gp.seg.x), b = xf(gp.seg.x + gp.seg.w); gp.ts.x = a; gp.ts.width = b - a; }
    for (const pit of this._pits) {
      const l = pit.l, r = pit.r;
      if (r < sx - 260 || l > sx + GAME_W + 260) { if (pit._warnT) pit._warnT.setVisible(false); continue; }
      const F = pit.deep ? 640 : VPY + (pit.floor - VPY) / SP; // floor y in the front plane (a bottomless pit: far below the screen)
      const fl = P(l, YB, 1), fr = P(r, YB, 1), bl = P(l, YB, SF), br = P(r, YB, SF);
      const fFl = P(l, F, 1), fFr = P(r, F, 1), bFl = P(l, F, SF), bFr = P(r, F, SF);
      const holeParts = [[bl, br, fr, fl], [fl, fr, [fr[0], 540], [fl[0], 540]]]; // band opening (trapezoid) + front notch (rect): the union is concave on one side, so clip to each convex part
      for (const part of holeParts) { hm.fillPoints(part.map((p) => ({ x: p[0], y: p[1] })), true); if (sm) sm.fillPoints(part.map((p) => ({ x: p[0], y: p[1] })), true); }   // the visible opening of this pit = the clip of the decoration layers
      let qg = g;   // quad() draws on qg (the warning board switches it to the decoration layer)
      const quad = (pts, col) => { for (const part of holeParts) { const c = clip(pts, part); if (c.length > 2) { qg.fillStyle(col, 1); qg.fillPoints(c.map((p) => ({ x: p[0], y: p[1] })), true); } } };
      const strips = (tl, tr, bl2, br2, c0, c1, n) => { // vertical gradient in n strips
        for (let i = 0; i < n; i++) {
          const t0 = i / n, t1 = (i + 1) / n;
          const A = [lerp(tl[0], bl2[0], t0), lerp(tl[1], bl2[1], t0)], B = [lerp(tr[0], br2[0], t0), lerp(tr[1], br2[1], t0)];
          const C = [lerp(tr[0], br2[0], t1), lerp(tr[1], br2[1], t1)], D = [lerp(tl[0], bl2[0], t1), lerp(tl[1], bl2[1], t1)];
          quad([A, B, C, D], mix(c0, c1, (t0 + t1) / 2));
        }
      };
      const dp = pit.deep, dk = (a, b) => (dp ? 0.03 : b);   // bottomless: the walls fade to black
      strips(bl, br, bFl, bFr, sh(dp ? 0.5 : 0.78), sh(dk(0, 0.27)), dp ? 16 : 12);                           // far wall
      if (VPX > l) strips(fl, bl, fFl, bFl, sh(dp ? 0.45 : 0.69), sh(dk(0, 0.21)), dp ? 16 : 12);              // left wall, inner face
      if (VPX < r) strips(br, fr, bFr, fFr, sh(dp ? 0.42 : 0.64), sh(dk(0, 0.19)), dp ? 16 : 12);               // right wall, inner face
      quad([fFl, fFr, bFr, bFl], dp ? 0x02040a : pit.pebble ? hx(1, tone([118, 114, 108])) : pit.kind === 'fire' ? hx(1, tone([46, 26, 22])) : hx(0.98));                                                // floor (bottomless: black; pebbles: pale cement joints)
      if (!dp) quad([bFl, bFr, P(r, F, SF + (1 - SF) * 0.18), P(l, F, SF + (1 - SF) * 0.18)], hx(0.38)); // contact shadow under the far wall
      if (cf.glass) {   // the glass slab's edge (bright teal, the same colours as the cross-section texture rows 0-10) runs round the hole on its three walls
        const T = 11, eg = [128, 214, 208], ed = [28, 92, 98];
        strips(bl, br, P(l, YB + T, SF), P(r, YB + T, SF), eg, ed, 5);
        if (VPX > l) strips(fl, bl, P(l, YB + T, 1), P(l, YB + T, SF), eg, ed, 5);
        if (VPX < r) strips(br, fr, P(r, YB + T, SF), P(r, YB + T, 1), eg, ed, 5);
      }
      // anti-climb wall spike strips (flat steel blades on a base plate), two rows in depth so the perspective shows; blades are in the x-y plane of their row
      const blade = (cx, k, w, h, barb) => {
        const B0 = P(cx - w / 2, F, k), B1 = P(cx + w / 2, F, k), T = P(cx + w * 0.06, F - h, k), M = P(cx, F, k);
        quad([B0, B1, T], 0x0c0e12);                                                                 // rim / shadow side
        quad([[B0[0] + 1.4 * k, B0[1]], [M[0], M[1]], [T[0] - 0.3, T[1] + 2.5 * k]], 0x5a616d);      // lit half
        quad([[M[0], M[1]], [B1[0] - 1.4 * k, B1[1]], [T[0] + 0.3, T[1] + 2.5 * k]], 0x242830);      // shaded half
        if (barb) for (const sg of [-1, 1]) {                                                         // arrow-head barbs like the reference
          const sx0 = cx + sg * w * 0.1, sx1 = cx + sg * w * 0.16; // hooks: leave the shaft near the head, swing out and point down
          quad([P(sx0, F - h * 0.8, k), P(cx + sg * w * 0.95, F - h * 0.5, k), P(sx1, F - h * 0.56, k)], sg < 0 ? 0xdfe5eb : 0x7f8996);
        }
      };
      const nRows = 4, rowList = [];
      const kNear = 1 - 2 / (F - VPY), kFar = SF + (1 - SF) * 0.2; // nearest row sits 2px behind the front cross-section edge; rows evenly spaced in depth, far to near
      for (let q = 0; q < nRows; q++) rowList.push({ k: kFar + (kNear - kFar) * q / (nRows - 1), off: q % 2 ? 0 : 0.5 });
      if (pit.pebble) {   // pebble health-walk floor: rows of dark polished stones, staggered, seen in perspective (positions are fixed by a hash, so they do not shimmer)
        const nC = Math.max(6, Math.round((r - l) / 11)), nR = 9, hs = (i, j) => { const v = Math.sin(i * 127.1 + j * 311.7 + l * 0.37) * 43758.5453; return v - Math.floor(v); };
        const stone = tone([50, 56, 64]), lite = tone([150, 160, 172]);
        for (let j = 0; j < nR; j++) {
          const k = SF + (1 - SF) * (0.06 + 0.9 * j / (nR - 1));
          for (let i = 0; i < nC; i++) {
            const x = l + ((i + 0.5 + (j % 2) * 0.5) / nC) * (r - l) + (hs(i, j) - 0.5) * 3; if (x < l + 3 || x > r - 3) continue;
            const p = P(x, F, k), w = (10 + hs(j, i) * 2) * k / SP, h = Math.max(3.5, w * 0.72), sh = 0.8 + hs(i + 5, j) * 0.45;
            g2.fillStyle(hx(sh, stone), 1); g2.fillEllipse(p[0], p[1], w, h);
            g2.fillStyle(hx(1, lite), 0.5); g2.fillEllipse(p[0] - w * 0.15, p[1] - h * 0.22, w * 0.36, h * 0.28);   // highlight on the polished stone
          }
        }
      }
      if (!pit.deep && pit.kind === 'spikes') for (const row of rowList) {
        const k = row.k, sp = 16, w = 10;
        const x0 = l + 8, x1 = r - 8;
        const a = P(x0 - 4, F, k), b = P(x1 + 4, F, k), a2 = P(x0 - 4, F - 3.5, k), b2 = P(x1 + 4, F - 3.5, k);
        quad([a, b, b2, a2], 0x2a2e35);                                                                // base plate (side)
        quad([a2, b2, P(x1 + 4, F - 3.5, k - 0.025), P(x0 - 4, F - 3.5, k - 0.025)], 0x434a55);        // base plate top
        let i = 0;
        for (let x = x0 + sp * row.off + w / 2; x < x1; x += sp / 2, i++) {
          const tall = i % 2 === 0;
          blade(x, k, tall ? w : w * 0.8, tall ? 22 : 11, false);
        }
      }

      // Fire pit (kind 'fire'): three rows of flame tongues standing on the pit floor, back row first. Shapes and colours after the vendor's wok flames (three layers: outer feather, body, inner).
      // Everything is projected with P(x, y, k): x = world x on the feet plane, y = front-plane height (the floor is at F, a tongue's tip at F - h), k = depth (SF back wall ... 1 front edge).
      // IQ4 wrote the first version of this block and the poison block below; the clip, the depth rows and the colours were wrong and were rewritten by hand after two rejected rounds.
      const frac = (n) => { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v); };   // fixed pseudo-random 0..1 (does not change from frame to frame)
      if (!pit.deep && pit.kind === 'fire') {
        // Same flame shape as the vendor's stir-fry fire (effects.js STIR_FIRE / tongue): five layers (outer red feather ... pale core), a base that leans and a tip that sways and curls, flickering height.
        // Three rows of tongues, back row first, each row drawn with k = its depth; heights are in front-plane px (a tongue at depth k is k times as tall on screen).
        const t = this.time.now, ts = t / 1000, rowK = [0.12, 0.4, 0.72, 0.97], rowN = [4, 5, 5, 6];
        const LAY = [[1.35, 1.12, 0xff2a00, 0.22], [1.0, 1.0, 0xff5a00, 0.78], [0.72, 0.8, 0xff9500, 0.8], [0.45, 0.55, 0xffd23a, 0.85], [0.22, 0.28, 0xfff4c0, 0.9]];
        for (let ri = 0; ri < 4; ri++) {
          const k = SF + (1 - SF) * rowK[ri], n = rowN[ri], spacing = (r - l - 20) / n, G = k < SP ? g3 : g3f;   // rows behind the feet plane under the characters, rows in front of it over them
          const gp0 = P((l + r) / 2, F, k);
          G.fillStyle(0xff4a00, 0.22); G.fillEllipse(gp0[0], gp0[1], (r - l) * 0.95 * k / SP, 16 * k);   // glow on the floor under the row
          for (let fi = 0; fi < n; fi++) {
            const fx = Math.max(l + 10, Math.min(r - 10, l + 10 + (fi + 0.5) * spacing + (ri % 2 ? 0.3 : -0.3) * spacing));
            const ph = ri * 2.1 + fi * 1.7, wB = spacing * 1.25, hB = (46 + 34 * frac(ri * 5 + fi + 1)) * (ri === 0 ? 1.15 : 1);
            const kf = 0.86 + 0.09 * Math.sin(ts * 9.3 + ph) + 0.06 * Math.sin(ts * 15.1 + ph * 2.3), lean = 5 * Math.sin(ts * 0.9 + ph);
            for (const L of LAY) {
              const hh = hB * kf * L[1], ww = wB * L[0], right = [], left = [];
              for (let q = 0; q <= 6; q++) {
                const u = q / 6;
                const dx = lean * u * u + 9 * Math.pow(u, 1.4) * Math.sin(ts * 6.2 + ph - u * 3.2) + 2.5 * u * Math.sin(ts * 11 + ph * 1.7);   // the tip bends and curls
                const hw = ww / 2 * Math.pow(1 - u, 0.85) * (u < 0.18 ? 0.8 + u * 1.1 : 1);
                const pr = P(fx + dx + hw, F - hh * u, k), pl = P(fx + dx - hw, F - hh * u, k);
                right.push({ x: pr[0], y: pr[1] }); left.unshift({ x: pl[0], y: pl[1] });
              }
              G.fillStyle(L[2], L[3]); G.fillPoints(right.concat(left.slice(1)), true);
            }
          }
        }
        if (gs) {   // black smoke: puffs rise out of the hole, swell, drift sideways a little and fade (fixed seeds, position from the clock)
          for (let si = 0; si < 16; si++) {
            const life = 1300 + 700 * frac(si * 3.3 + 1), u = ((t + life * frac(si * 5.1 + 2)) % life) / life, kS = SF + (1 - SF) * (0.35 + 0.6 * frac(si * 2.7 + 3));
            const base = P(l + 14 + (r - l - 28) * frac(si * 4.3 + 5), F - 16, kS);
            const sx = base[0] + (8 + 14 * frac(si * 1.7)) * u + 6 * Math.sin(t / 380 + si), sy = base[1] - (14 + 105 * (1 - Math.pow(1 - u, 1.4)));
            const rad = (5 + 9 * u) * (0.6 + 0.4 * kS), al = 0.8 * Math.min(1, u * 8) * (1 - u * u);   // small puffs (user 2026-10-12: smaller diameter)
            const GS = kS < SP ? gs : gsf;
            GS.fillStyle(0x4a4541, al * 0.5); GS.fillCircle(sx, sy, rad * 1.3);
            GS.fillStyle(0x16130f, al); GS.fillCircle(sx, sy, rad);
          }
        }
      }

      // Poison pit (kind 'poison'): the whole floor is a green pool that breathes, a lighter blob rolls around in it and bubbles rise and pop (after the green slime's puddle).
      if (!pit.deep && pit.kind === 'poison') {
        const t = this.time.now, W = r - l, green = tone([76, 217, 100]), edge = hx(1, tone([31, 143, 58]));
        quad([fFl, fFr, bFr, bFl], hx(0.92 + 0.08 * Math.sin(t / 120), green));                                       // pool
        g2.lineStyle(2, edge, 0.9); g2.lineBetween(fFl[0], fFl[1], fFr[0], fFr[1]);                                      // darker line along the near edge
        const kb0 = SF + (1 - SF) * (0.5 + 0.4 * Math.sin(t / 210)), hp = P(l + W / 2 + Math.sin(t / 330) * W * 0.26, F, kb0);
        g2.fillStyle(hx(1, tone([182, 255, 154])), 0.55);                                                              // rolling lighter blob
        g2.fillEllipse(hp[0], hp[1], W * 0.32 * kb0 / SP * (1 + 0.25 * Math.sin(t / 190)), 8 * kb0 * (1 - 0.3 * Math.sin(t / 190)));
        for (let bi = 0; bi < 14; bi++) {                                                                              // bubbles: fixed x, depth, period and phase per bubble
          const kb = SF + (1 - SF) * ((bi % 4) / 3), life = 450 + 350 * frac(bi * 5.3 + 2), prog = ((t + life * frac(bi * 7.1 + 3)) % life) / life;
          const bx = l + 8 + (W - 16) * frac(bi * 3.7 + 1), rise = 14 + 16 * frac(bi * 2.3 + 4), sway = Math.sin(prog * 6 + bi) * 3;
          const sc = prog < 0.8 ? 1 + 0.5 * (prog / 0.8) : 1.5 + (prog - 0.8) * 5, al = prog < 0.8 ? 0.5 : 0.5 * (1 - (prog - 0.8) / 0.2);
          const bp = P(bx + sway, F - rise * prog, kb), br = (2 + 3 * frac(bi * 1.9 + 5)) * sc * kb / SP;
          const GB = kb < SP ? g3 : g3f;
          GB.fillStyle(hx(1, tone([200, 255, 176])), al); GB.fillCircle(bp[0], bp[1], br);   // bubbles and vapour are in front of the warning board (like the flames), clipped to the opening
          GB.lineStyle(1, edge, al); GB.strokeCircle(bp[0], bp[1], br);
        }
        if (gs) {   // green vapour: small pale puffs rise from the pool out of the hole, thin out and fade (fixed seeds, position from the clock); the smoke layer's mask keeps them off the cross-section
          for (let vi = 0; vi < 20; vi++) {
            const life = 1500 + 900 * frac(vi * 3.1 + 1), u = ((t + life * frac(vi * 6.3 + 2)) % life) / life, kV = SF + (1 - SF) * (0.3 + 0.7 * frac(vi * 2.9 + 3));
            const base = P(l + 12 + (W - 24) * frac(vi * 4.7 + 5), F - 6, kV);
            const vx = base[0] + (6 + 10 * frac(vi * 1.3)) * u + 5 * Math.sin(t / 420 + vi * 1.7), vy = base[1] - (10 + 95 * (1 - Math.pow(1 - u, 1.3)));
            const rad = (2.5 + 5 * u) * (0.6 + 0.4 * kV), al = 0.5 * Math.min(1, u * 6) * (1 - u);
            const GV = kV < SP ? gs : gsf;
            GV.fillStyle(hx(1, tone([120, 255, 140])), al * 0.45); GV.fillCircle(vx, vy, rad * 1.5);
            GV.fillStyle(hx(1, tone([190, 255, 190])), al); GV.fillCircle(vx, vy, rad);
          }
        }
      }
      if (pit._warnT) {   // the warning board, mounted on the far wall (user 2026-10-12: 警語位置改到洞的剖面牆上); drawn in the wall's own scale
        const wallB = VPY + SF * (F - VPY), topPad = cf.glass ? 14 : 4;   // the far wall runs from BT down to wallB: a shallow pit's wall is short, so the board is made smaller to fit it (the same size for every view)
        const kk = Math.min(SF / SP, (wallB - BT - topPad - 4) / 58), cxs = P((l + r) / 2, YB, SF)[0];
        if (kk < 0.3) { pit._warnT.setVisible(false); } else {
        qg = g2;
        const c = [cxs], cy = BT + topPad + 29 * kk;
        const farQ = [bl, br, bFr, bFl], wq = (pts, col) => { const w = clip(pts, farQ); if (w.length > 2) quad(w, col); };   // the board is clipped to the part of the far wall that shows (the side wall / near edge hide the rest)
        const B = (x0, y0, x1, y1, col) => wq([[c[0] + x0 * kk, cy + y0 * kk], [c[0] + x1 * kk, cy + y0 * kk], [c[0] + x1 * kk, cy + y1 * kk], [c[0] + x0 * kk, cy + y1 * kk]], col);
        B(-64, -29, 64, 29, 0x15181c); B(-61, -26, 61, 26, 0xffd21f);                                  // board with a dark border
        wq([[c[0] - 50 * kk, cy + 15 * kk], [c[0] - 24 * kk, cy + 15 * kk], [c[0] - 37 * kk, cy - 17 * kk]], 0x15181c);   // warning triangle
        B(-38.5, -9, -35.5, 3, 0xffd21f); B(-38.5, 7, -35.5, 10, 0xffd21f);                               // exclamation mark
        pit._warnT.setVisible(true).setPosition(c[0] + 20 * kk, cy).setScale(pit._warnT.getData('fit') * kk);
        const mg = pit._warnM; mg.clear(); mg.fillStyle(0xffffff, 1);   // the text gets the same clip as a mask
        for (const part of holeParts) { const w = clip(farQ, part); if (w.length > 2) mg.fillPoints(w.map((p) => ({ x: p[0], y: p[1] })), true); }
        qg = g;
        }
      }
      if (!pit.deep && !pit._slab) { // cut face under the hole floor: same texture and phase as the neighbouring ground cross-section
        const sg = this.lvl.ground.filter((q) => q.x + q.w <= l + 1).sort((a, b) => b.x - a.x)[0] || this.lvl.ground[0];
        const gk = 'ground_' + this._lvKey, top = sg.y + PERSP_FACE_DY, tex = this.textures.get(gk).getSourceImage();
        const sl = this.add.tileSprite(l, F, r - l, Math.max(1, top + tex.height - F), gk).setOrigin(0, 0).setDepth(-0.15);
        sl.tilePositionY = F - top;
        pit._slab = sl;
      }
      if (pit._slab) { pit._slab.setPosition(fFl[0], F); pit._slab.width = fFr[0] - fFl[0]; }   // follows the front-plane edges (moves with the vanishing point)
      // coping: a row of stone blocks framing the opening (like the paving, thin seams instead of a thick outline)
      const cw = 10;
      const poly = (pts, col, al) => { g.fillStyle(col, al == null ? 1 : al); g.fillPoints(pts.map((p) => ({ x: p[0], y: p[1] })), true); };
      const seam = (a, b, al, col) => { g.lineStyle(1, col == null ? 0x2a2430 : col, al); g.lineBetween(a[0], a[1], b[0], b[1]); };
      const sides = [[l - cw, l, -1], [r, r + cw, 1]];
      for (const sd of sides) {
        const x0 = sd[0], x1 = sd[1];
        poly([P(x0, YB, 1), P(x1, YB, 1), P(x1, YB, SF), P(x0, YB, SF)], cf.glass ? 0x86dcd4 : hx(1, pv));   // coping top (glass level: the bright glass-edge teal)
        for (const f of [0.38, 0.72]) { const k = SF + (1 - SF) * f; seam(P(x0, YB, k), P(x1, YB, k), 0.35); } // block seams (depth rows)
        const outer = sd[2] < 0 ? x0 : x1;
        seam(P(outer, YB, 1), P(outer, YB, SF), 0.4);                                           // outer edge = a paving joint
      }
      // inner lip of the opening: faint highlight on the stone edge, shadow just inside
      for (const e of [[fl, bl], [fr, br]]) { seam(e[0], e[1], cf.glass ? 0.9 : 0.55, cf.glass ? 0xe0f7f2 : hx(1, pv)); }
      if (cf.glass) {   // small red warning lamps on the bright rim, breathing (alternate sides in opposite phase)
        const tm = this.time.now / 1000;
        sides.forEach((sd, si) => {
          for (let li = 0; li < 3; li++) {
            const k = SF + (1 - SF) * (0.18 + 0.32 * li), p = P((sd[0] + sd[1]) / 2, YB, k), b = 0.5 + 0.5 * Math.sin(tm * 3.9 + si * Math.PI + li * 0.8);
            g.fillStyle(0xff2a2a, 0.1 + 0.3 * b); g.fillCircle(p[0], p[1], 4.5 * k + 2);
            g.fillStyle(0xff3b30, 0.3 + 0.7 * b); g.fillCircle(p[0], p[1], 1.4 + 1.3 * k);
          }
        });
      }
      seam(bl, br, 0.4, 0x2a2430);
      g.lineStyle(1, 0x2a2430, 0.5); g.lineBetween(fFl[0], fFl[1], fFr[0], fFr[1]);
    }
  }

  // Level 4 glass floor: the strip behind the backdrop is squeezed into the walkable band (it only shows through the semi-transparent band rows) and drifts slowly (parallax 0.12, the backdrop 0.03,
  // the floor and the panel seams 1.0), which is what makes the floor read as see-through. Seams run to the vanishing point like the paving joints of the other levels.
  _drawGlassFloor() {
    const uv = this._glassUV, g = this._glassG; if (!uv || !uv.active || !this._look) return;
    g.clear();
    const bd = this.backdrop, cf = this._persp, sx = this.cameras.main.scrollX, dw = bd.displayWidth;
    const ppr = bd.scaleY * bd.width / 3168, YB = bd.y, VPY = YB - (cf.bottom - cf.vpy) * ppr, VPX = bd.x + (cf.vpx - 0.5) * dw + sx, BT = YB - cf.band * ppr;
    const SF = (BT - VPY) / (YB - VPY), SP = (this.lvl.y_ground - VPY) / (YB - VPY);
    const P = (x, y, k) => [VPX + (k / SP) * (x - VPX), VPY + k * (y - VPY)];
    if (!this._glassLook) {   // same colour look as the backdrop (weather / colour preset)
      this._glassLook = true; const lk = this._look;
      if (this.renderer.type === Phaser.WEBGL && uv.postFX) { const cm = uv.postFX.addColorMatrix(); if (lk.sat !== 0) cm.saturate(lk.sat); if (lk.bri !== 1) cm.brightness(lk.bri, true); }
      else if (lk.tint) uv.setTint(lk.tint);
    }
    uv.setPosition(-sx * 0.12, BT); uv.setDisplaySize(uv.width, YB - BT);
    const PANEL = 170;
    for (let x = Math.floor((sx - 300) / PANEL) * PANEL; x < sx + GAME_W + 300; x += PANEL) {   // panel seams (steel frame): dark line + a pale line beside it
      const a = P(x, YB, 1), b = P(x, YB, SF);
      g.lineStyle(2, 0x07161c, 0.8); g.lineBetween(a[0], a[1], b[0], b[1]);
      g.lineStyle(1, 0xbff0ea, 0.3); g.lineBetween(a[0] + 2, a[1], b[0] + 2, b[1]);
    }
    for (let x = Math.floor((sx - 300) / 520) * 520; x < sx + GAME_W + 300; x += 520) {   // soft diagonal reflections
      const o = (x * 7) % 90;
      g.fillStyle(0xdffcf6, 0.1); g.fillPoints([{ x: x + o, y: BT }, { x: x + o + 34, y: BT }, { x: x + o + 14, y: YB }, { x: x + o - 20, y: YB }], true);
    }
    g.lineStyle(1, 0x0a1e26, 0.8); g.lineBetween(sx - 100, YB, sx + GAME_W + 100, YB);   // front edge of the glass slab
  }

  // Move x out of every pit (widened by `margin` px each side) to the nearest edge; loops in case the shift lands in the next pit.
  _clearOfPits(x, margin) {
    for (let n = 0; n < this._pits.length + 1; n++) {
      const p = this._pits.find((q) => x > q.l - margin && x < q.r + margin);
      if (!p) break;
      x = (x - (p.l - margin) < (p.r + margin) - x) ? p.l - margin : p.r + margin;
    }
    return x;
  }

  // Depth of a pit's floor: lvl.y_ground + 62, but on a perspective level with PERSP.frontMax the floor is raised until its front edge (front plane) is on screen at that row.
  _pitFloorY() {
    const yg = this.lvl.y_ground, deep = yg + 62, cf = this._persp, bd = this.backdrop;
    if (!cf || !cf.frontMax || !bd) return deep;
    const ppr = bd.scaleY * bd.width / 3168, YB = bd.y, VPY = YB - (cf.bottom - cf.vpy) * ppr, SP = (yg - VPY) / (YB - VPY);
    return Math.min(deep, Math.floor(VPY + SP * (cf.frontMax - VPY)));
  }

  // the pebble pit the player is standing on (feet on its floor), or null
  _pebbleUnder() {
    const ps = this.player && this.player.sprite; if (!ps || !ps.body) return null;
    const p = this._pitAt(ps.x);
    return p && p.pebble && ps.body.bottom >= p.floor - 6 ? p : null;
  }

  _pitAt(x) {
    for (const p of this._pits) if (x > p.l && x < p.r) return p;
    return null;
  }

  // All enemies dead: normally open the exit; if a boss is waiting (level 5) bring it in instead.
  _afterClear() {
    if (this._pendingBoss) this._startBossEntrance(); else this.openExit();
  }

  // Player goes back to the level start (blink in + drop, controls locked until landed) and the boss blinks in above its spot and drops.
  _startBossEntrance() {
    const sp = this._pendingBoss; this._pendingBoss = null;
    const lvl = this.lvl;
    this.player.beginSpawn(PLAYER_SPAWN_X, lvl.y_ground);
    const boss = new Boss(this, GAME_DATA.bosses[sp.type], sp.x, lvl.y_ground - 20);
    boss.beginEntrance(lvl.y_ground);
    this.enemies.add(boss.sprite);
    this.boss = boss;
    this.enemiesRemaining++;
    if (this.hud && this.hud._showBossWarning) this.hud._showBossWarning();
  }

  addEnemy(def, x, y_hint) {
    x = this._clearOfPits(x, 48); // never spawn over (or at the edge of) a spike pit
    const enemy = new Enemy(this, def, x, y_hint - 40, RUN.level);
    this.enemies.add(enemy.sprite);
    this.enemiesRemaining++;
  }

  onEnemyDead(data) {
    if (data && data.ref && data.ref.fell) {
      this.enemiesRemaining--;
      if (this.enemiesRemaining <= 0 && !this.exitOpen) this._afterClear();
      return;
    }
    this.enemiesRemaining--;
    RUN.kills++;
    RUN.levelStats.kills++;
    if ((typeof Extras !== 'undefined') && data && data.ref) Extras.onEnemyDead(this, data.ref, data.x, data.y);
    if (data && data.ref && !data.ref.lastHitProc) {
      // Forward on_kill hooks handled by player or hooks module externally
      if (this.player.onKill) this.player.onKill(data.x, data.y);
    }
    if (this.enemiesRemaining <= 0 && !this.exitOpen) {
      this._afterClear();
    }
  }

  openExit() {
    this.exitOpen = true;
    FX.levelClearFlash(this, this.lvl.exit_x, this.lvl.y_ground - 48);
    this.exitDoor.setFillStyle(0xffcc00);
    this.tweens.add({ targets: this.exitDoor, alpha: 0.5, yoyo: true, repeat: -1, duration: 400 });
  }

  onPlayerDead() {
    if (this.deathStarted) return;
    this.deathStarted = true;
    if (FX.deathSequence) {
      FX.deathSequence(this, this.player, () => this.scene.start('End', { result: 'dead' }));
    } else {
      this.deathSequence();
    }
  }

  deathSequence() {
    const player = this.player;
    const sprite = player.sprite;
    const cam = this.cameras.main;

    // Freeze input by stopping update logic (deathStarted flag handles it)
    sprite.setTint(0x888888);

    // Slow motion
    if (FX.slowMo) FX.slowMo(0.2, 700);

    // Camera zoom
    this.tweens.add({ targets: cam, zoom: 1.2, duration: 300, ease: 'Power2' });

    // Shards at 200ms
    this.time.delayedCall(200, () => {
      const tex = sprite.texture;
      const tw = tex.width / 2;
      const th = tex.height / 4;
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 2; col++) {
          const shard = this.add.image(sprite.x, sprite.y, tex.key);
          shard.setCrop(col * tw, row * th, tw, th);
          shard.setScale(sprite.scaleX, sprite.scaleY);
          const angle = Math.atan2(row - 1.5, col - 0.5) + (Math.random() - 0.5) * 0.5;
          const speed = 150;
          shard.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
          this.physics.add.existing(shard);
          shard.body.allowGravity = true;
          this.tweens.add({ targets: shard, alpha: 0, rotation: (Math.random() - 0.5) * 10, duration: 600 });
        }
      }
      // Red burst particles (simple graphics circles)
      for (let i = 0; i < 12; i++) {
        const p = this.add.circle(sprite.x, sprite.y, 4, 0xff0000);
        const angle = (i / 12) * Math.PI * 2;
        this.tweens.add({ targets: p, x: sprite.x + Math.cos(angle) * 80, y: sprite.y + Math.sin(angle) * 80, alpha: 0, duration: 600, onComplete: () => p.destroy() });
      }
      sprite.setVisible(false);
    });

    // Grayscale + vignette at 400ms
    this.time.delayedCall(400, () => {
      if (cam.postFX) {
        try { cam.postFX.addColorMatrix().grayscale(1); } catch (e) {}
      }
      const vig = this.add.graphics();
      vig.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x1a1a1a, 1);
      vig.fillRect(24, 24, 912, 492);
      vig.setScrollFactor(0).setDepth(99);
      this.tweens.add({ targets: vig, alpha: 0.8, duration: 400 });
    });

    // Black overlay at 800ms
    this.time.delayedCall(800, () => {
      const black = this.add.rectangle(GAME_W / 2, 270, GAME_W, 540, 0x000000).setScrollFactor(0).setDepth(199);
      this.tweens.add({ targets: black, alpha: 1, duration: 400 });
    });

    // Done at 1200ms
    this.time.delayedCall(1200, () => {
      this.scene.start('End', { result: 'dead' });
    });
  }
}
