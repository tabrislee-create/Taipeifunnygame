var GAME_DATA = null;
// Trial build (user 2026-10-12): open the game with ?demo=1 -> two characters (vendor, auntie), levels 1-5 only, sunny weather only (see weather.js pickWeather).
window.DEMO = true;
var SKY_CUT_LEVELS = [1, 2, 3, 4, 5]; // Levels with transparent-sky backdrops (assets/backdrop_lvNN_sky.png)

function loadJson(url) {
  return fetch(url).then(function(r) { return r.json(); });
}

function toMap(arr) {
  var m = {};
  if (Array.isArray(arr)) {
    for (var i = 0; i < arr.length; i++) {
      var it = arr[i];
      if (it && it.id != null) m[it.id] = it;
    }
  }
  return m;
}

function bootGame() {
  GAME_DATA = {
    enemies: toMap(window.__ENEMIES),
    bosses: toMap(window.__BOSSES),
    themes: toMap(window.__THEMES),
    equipment: toMap(window.__EQUIPMENT),
    buffs: toMap(window.__BUFFS),
    characters: toMap(window.__CHARACTERS),
    weather: window.__WEATHER || {},
    levels: Array.isArray(window.__LEVELS) ? window.__LEVELS : [],
    shop: toMap(window.__SHOP),
    bossHints: (window.__BOSS_HINTS && window.__BOSS_HINTS.hints) || []
  };
  if (window.DEMO) {   // trial build: renamed brands / landmarks in the level and equipment texts
    GAME_DATA.levels.forEach(function (L) { ['name_zh', 'intro_text_zh'].forEach(function (k) { if (L[k]) L[k] = demoName(L[k]); }); });
    Object.keys(GAME_DATA.equipment).forEach(function (id) { var e = GAME_DATA.equipment[id]; ['name_zh', 'name_en', 'desc_zh'].forEach(function (k) { if (e[k]) e[k] = demoName(e[k]); }); });
  }
  if (window.DEMO) {   // trial build: keep two characters and the first five levels (every 'N / total' text and the last-level victory follow GAME_DATA.levels.length)
    GAME_DATA.charOrder = Object.keys(GAME_DATA.characters); GAME_DATA.lockedChars = {};   // the other two characters are shown greyed out as 開發中 (start / loading / select screens) but cannot be played
    Object.keys(GAME_DATA.characters).forEach(function (k) { if (k !== 'vendor' && k !== 'auntie') { var c0 = GAME_DATA.characters[k]; GAME_DATA.lockedChars[k] = { id: k, name_zh: c0.name_zh, concept_zh: c0.concept_zh }; delete GAME_DATA.characters[k]; } });
    GAME_DATA.levels = GAME_DATA.levels.slice(0, 5);
  }
  // Player now starts at x=310 (level.js PLAYER_SPAWN_X): push ground enemies that start (or patrol: range up to 200) near it out to x=560 (same 250px gap as the old 230/480).
  GAME_DATA.levels.forEach(function (lv) { (lv.spawns || []).forEach(function (sp) { if (sp.y_hint != null && sp.y_hint >= 300 && sp.x < 560) sp.x = 560; }); });
  // All levels: lower the ground 55px so the backdrops (landmarks) show above it. Everything that sits on the ground moves with it.
  GAME_DATA.levels.forEach(function (L) {
    if (L._lowered) return;
    var DY = 55;
    L._lowered = true; L.y_ground += DY;
    L.ground.forEach(function (g) { g.y += DY; });
    L.platforms.forEach(function (q) { q.y += DY; });
    L.spawns.forEach(function (sp) { if (sp.y_hint != null) sp.y_hint += DY; });
  });
  window.__GAME_DATA = GAME_DATA;

  window.__game = new Phaser.Game({
    type: Phaser.AUTO,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    input: { activePointers: 4 },
    width: GAME_W,
    height: GAME_H,
    parent: 'game',
    backgroundColor: '#000',
    physics: { default: 'arcade', arcade: { gravity: { y: 1000 }, debug: false } },
    scene: [BootScene, DevMenuScene, CharSelectScene, LevelScene, ClearedScene, ChoiceScene, EndScene, CharPanelScene, HowToScene]
  });
  if (window.__landingDone) setTimeout(window.__landingDone, 350);   // the loading screen (BootScene) takes over from the landing page
}

class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    var W = GAME_W, H = GAME_H;
    var barBg = this.add.rectangle(W / 2, H / 2 + 40, 420, 22, 0x222222).setStrokeStyle(2, 0x888888);
    var bar = this.add.rectangle(W / 2 - 208, H / 2 + 40, 0, 18, 0x4caf50).setOrigin(0, 0.5);
    var title = this.add.text(W / 2, H / 2 - 40, '台北好好玩', {
      fontFamily: 'Microsoft JhengHei, PingFang TC, sans-serif', fontSize: '40px', color: '#ffffff'
    }).setOrigin(0.5);
    var pct = this.add.text(W / 2, H / 2 + 78, '載入中 0%', {
      fontFamily: 'Microsoft JhengHei, PingFang TC, sans-serif', fontSize: '18px', color: '#cccccc'
    }).setOrigin(0.5);

    this.load.on('progress', function (v) {
      bar.width = 416 * v;
      pct.setText('載入中 ' + Math.round(v * 100) + '%');
    });
    this.load.on('loaderror', function () { /* ignore missing textures */ });

    // Intro line under the loading bar: one of the IQ4-written Taipei tour taglines (TITLE_COPY, ui.js), picked at random.
    this.add.text(W / 2, H / 2 + 112, '台北好好玩，帶你從天龍國開始打怪打不停，一路橫跨新北和桃園，逛遍好吃好逛好玩景點。', {
      fontFamily: 'Microsoft JhengHei, PingFang TC, sans-serif', fontSize: '22px', color: '#ffd966', stroke: '#000000', strokeThickness: 3,
      wordWrap: { width: Math.min(W - 80, 700), useAdvancedWrap: true }, align: 'center'
    }).setOrigin(0.5, 0);
    this.add.text(W / 2, H / 2 + 188, demoName(TITLE_COPY[Math.floor(Math.random() * TITLE_COPY.length)]), {
      fontFamily: 'Microsoft JhengHei, PingFang TC, sans-serif', fontSize: '22px', color: '#e8f0e8', stroke: '#000000', strokeThickness: 3,
      wordWrap: { width: Math.min(W - 80, 700), useAdvancedWrap: true }, align: 'center'
    }).setOrigin(0.5, 0);

    // The four playable characters walking in a row above the title.  Their art is queued first, so each one appears as soon as it has loaded;
    // frame-by-frame walk art is used where it exists (PLAYER_WALK_FRAMES), others only bob (missing art stays missing).
    var D = GAME_DATA;
    var chars = D.charOrder || Object.keys(D.characters);   // trial build: all four, the locked two (D.lockedChars) are drawn greyed out with 開發中
    var self = this, slots = [], rowY = H / 2 - 82, SPR_H = 96;
    for (var ci = 0; ci < chars.length; ci++) {
      this.load.image('player_' + chars[ci], 'assets/player_' + chars[ci] + '.png');
      this.load.image('avatar_' + chars[ci], 'assets/avatar_' + chars[ci] + '.png');   // select-screen card portrait (falls back to the full-body art if missing)
      for (var cw = 1; cw <= (PLAYER_WALK_FRAMES[chars[ci]] || 0); cw++) this.load.image('player_' + chars[ci] + '_w' + cw, 'assets/player_' + chars[ci] + '_w' + cw + '.png');
      slots.push({ id: chars[ci], x: W / 2 + (ci - (chars.length - 1) / 2) * 140, sprite: null, frames: PLAYER_WALK_FRAMES[chars[ci]] || 0, locked: !!(D.lockedChars && D.lockedChars[chars[ci]]) });
    }
    this._walkStep = function () {
      var t = performance.now();
      for (var i = 0; i < slots.length; i++) {
        var sl = slots[i], key = 'player_' + sl.id;
        if (!self.textures.exists(key)) continue;
        if (!sl.sprite) {
          sl.sprite = self.add.image(sl.x, rowY, key).setOrigin(0.5, 1);
          sl.sprite.setScale((PLAYER_DISPLAY_H[sl.id] || SPR_H) / sl.sprite.height);   // same display heights as in the game (height standard), feet on rowY (origin 0.5,1; all textures reach their bottom row)
          sl.sy = sl.sprite.scaleY; sl.phase = i * 1.3;
        }
        var ok = sl.frames > 0, f;
        for (f = 1; ok && f <= sl.frames; f++) ok = self.textures.exists(key + '_w' + f);
        if (ok) {
          sl.sprite.setTexture(key + '_w' + (Math.floor(t / PLAYER_WALK_FRAME_MS) % sl.frames + 1));
          sl.sprite.y = rowY;
        } else {
          sl.sprite.y = rowY - Math.abs(Math.sin(t / 130 + sl.phase)) * 4;
          sl.sprite.setAngle(Math.sin(t / 130 + sl.phase) * 3);
        }
      }
    };
    this.game.events.on('step', this._walkStep);   // scene update() does not run while the loader is working

    this.load.image('title_logo', 'assets/title_logo.png');
    this.load.image('fx_wafer', 'assets/fx_wafer.png');
    for (var i = 0; i < chars.length; i++) {
      var c = D.characters[chars[i]];
      if (c && c.skill && c.skill.id) {
        this.load.image('skill_' + c.skill.id, 'assets/skill_' + c.skill.id + '.png');
        this.load.image('skilltext_' + c.skill.id, 'assets/skilltext_' + c.skill.id + '.png');   // brush-calligraphy skill name for the cast banner (missing files are ignored: the name is drawn as text)
      }
    }
    var en = Object.keys(D.enemies);
    for (var j = 0; j < en.length; j++) {
      this.load.image('enemy_' + en[j], 'assets/enemy_' + en[j] + '.png');
    }
    // hopping slimes (blue/green/yellow/red = hue shifts of one sheet, tools/recolor_slime.py): 8-cell spritesheet (288x220 per cell)
    ['blue', 'green', 'yellow', 'red'].forEach(function (c) { this.load.spritesheet('enemy_slime_' + c + '_hop', 'assets/enemy_slime_' + c + '_hop.png', { frameWidth: 288, frameHeight: 220 }); }, this);
    var bo = Object.keys(D.bosses);
    for (var k = 0; k < bo.length; k++) {
      this.load.image(bo[k], 'assets/' + bo[k] + '.png');
    }
    var th = Object.keys(D.themes);
    for (var m = 0; m < th.length; m++) {
      this.load.image('ground_' + th[m], 'assets/ground_' + th[m] + '.png');
      this.load.image('backdrop_' + th[m], 'assets/backdrop_' + th[m] + '.jpg');
    }
    // per-level backdrop + ground art (assets/backdrop_lvNN.jpg, ground_lvNN.png; missing files are ignored, see level.js)
    for (var lv = 1; lv <= 5; lv++) {
      var lk = 'lv' + (lv < 10 ? '0' : '') + lv;
      this.load.image('backdrop_' + lk, 'assets/backdrop_' + lk + '.jpg');
      this.load.image('ground_' + lk, 'assets/ground_' + lk + '.png');
    }
    // Transparent-sky backdrops for specific levels (only load what is in SKY_CUT_LEVELS)
    for (var s = 0; s < SKY_CUT_LEVELS.length; s++) {
      var skLv = SKY_CUT_LEVELS[s];
      var skKey = 'lv' + (skLv < 10 ? '0' : '') + skLv;
      this.load.image('backdrop_' + skKey + '_sky', 'assets/backdrop_' + skKey + '_sky.png');
    }
    this.load.image('underview_lv04', 'assets/underview_lv04.png');   // level 4 glass floor: the view straight down on Taipei (level.js _drawGlassFloor)
    // Cloud pieces for the sunny sky effects (weather.js buildSkyFx)
    WX.skyPieces().forEach(function (p) { this.load.image('skc_' + p[0], 'assets/sky_clouds/' + p[0] + '.png'); }, this);
    var eq = Object.keys(D.equipment);
    for (var n = 0; n < eq.length; n++) {
      this.load.image('icon_' + eq[n], 'assets/icon_' + eq[n] + '.png');
    }
    var bf = Object.keys(D.buffs);
    for (var o = 0; o < bf.length; o++) {
      this.load.image('icon_' + bf[o], 'assets/icon_' + bf[o] + '.png');
    }
    // shop icons (optional assets)
    if (D.shop) {
      var sh = Object.keys(D.shop);
      for (var p = 0; p < sh.length; p++) {
        this.load.image('icon_' + sh[p], 'assets/icon_' + sh[p] + '.png');
      }
    }
  }

  create() {
    if (this._walkStep) this.game.events.off('step', this._walkStep);
    this.scene.start(window.__entry === 'dev' ? 'DevMenu' : 'CharSelect');   // the landing page (index.html) is the only start page: its start button -> character select, its 開發者選項 button -> the developer menu
  }
}

Promise.all([
  loadJson('./data/enemies.json'),
  loadJson('./data/bosses.json'),
  loadJson('./data/themes.json'),
  loadJson('./data/equipment.json'),
  loadJson('./data/buffs.json'),
  loadJson('./data/characters.json'),
  loadJson('./data/levels.json'),
  loadJson('./data/weather.json'),
  loadJson('./data/shop_items.json'),
  loadJson('./data/boss_hints.json')
]).then(function (res) {
  window.__ENEMIES = res[0];
  window.__BOSSES = res[1];
  window.__THEMES = res[2];
  window.__EQUIPMENT = res[3];
  window.__BUFFS = res[4];
  window.__CHARACTERS = res[5];
  window.__LEVELS = res[6];
  window.__WEATHER = res[7];
  window.__SHOP = res[8] || [];
  window.__BOSS_HINTS = res[9] || { hints: [] };
  bootGame();
}).catch(function (err) {
  console.error('Failed to load game data', err);
});
