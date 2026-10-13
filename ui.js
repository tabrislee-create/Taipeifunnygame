// TITLE_COPY moved to titlecopy.js (the landing page in index.html needs it before the game scripts are loaded)
// Hard mode is a toggle on the landing page (index.html: window.__landingHard); the trial build has it too since 2026-10-13.
Object.defineProperty(window, 'HARD_MODE', { get: function () { return !!window.__landingHard; }, set: function (v) { window.__landingHard = !!v; } });
var FONT = 'Microsoft JhengHei, PingFang TC, sans-serif';
var RARITY_COLOR = { common: 0xaaaaaa, rare: 0x4aa3ff, epic: 0xb061ff };
var RARITY_ZH = { common: '普通', rare: '稀有', epic: '傳奇' };
var SLOT_ZH = { weapon: '武器', armor: '防具', boots: '鞋子', charm: '飾品' };

var STAT_ZH = { max_hp: '生命', move_speed: '移動速度', jump_velocity: '跳躍', attack_damage: '攻擊力', attack_range: '攻擊範圍', crit_chance: '暴擊率', crit_multiplier: '暴擊倍率', defense: '防禦', lifesteal: '吸血', attack_speed: '攻擊速度' };
// one stat modifier -> comparable number and display text (percent mods and chance-like flat mods are shown as %)
function statNum(m) { return m ? m.value : 0; }
function statText(k, m) {
  if (!m) return '無';
  var v = m.value, pct = m.type === 'percent' || k === 'crit_chance' || k === 'lifesteal';
  var n = pct ? Math.round(v * 1000) / 10 : Math.round(v * 100) / 100;
  return (n >= 0 ? '+' : '') + n + (pct ? '%' : '');
}

function hexColor(c) { return '#' + c.toString(16).padStart(6, '0'); }
function fmtTime(ms) {
  var mm = Math.floor(ms / 60000);
  var ss = Math.floor((ms % 60000) / 1000);
  return (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
}
function mkBtn(scene, x, y, w, h, label, keyName, fn) {
  var rect = scene.add.rectangle(x, y, w, h, 0x2a6a3a).setInteractive();
  var t = scene.add.text(x, y, label, { fontFamily: FONT, fontSize: 21, color: '#ffffff' }).setOrigin(0.5);
  var btn = { rect: rect, t: t, fn: fn, label: label, hover: false };
  rect.on('pointerover', function () { btn.hover = true; rect.setFillStyle(0xffcc00); t.setColor('#111111'); rect.setScale(1.1); t.setScale(1.1); });
  rect.on('pointerout', function () { btn.hover = false; rect.setFillStyle(0x2a6a3a); t.setColor('#ffffff'); rect.setScale(1); t.setScale(1); });
  rect.on('pointerdown', function () { rect.setScale(0.95); t.setScale(0.95); fn(); });
  rect.on('pointerup', function () { if (!btn.hover) { rect.setScale(1); t.setScale(1); } });
  if (keyName) {
    var K = scene.input.keyboard.addKeys(keyName);
    K[keyName].on('down', function () { fn(); });
  }
  return btn;
}
function fadeTo(scene, key, data) {
  scene.cameras.main.fadeOut(300);
  scene.cameras.main.once('camerafadeoutcomplete', function () { scene.scene.start(key, data); });
}
function charStats(ch) {
  var s = { maxHp: 100, move_speed: 220, attack_damage: 10 };
  var st = ch.stats || {};
  for (var k in st) {
    var m = st[k];
    if (m.type === 'percent') s[k] = s[k] * (1 + m.value);
    else s[k] = s[k] + m.value;
  }
  return s;
}

// Developer menu (user 2026-10-12: the old title screen is gone, the landing page in index.html is the only start page): opened by the landing page's 開發者選項 button.
// 4 steps: character -> level 1..30 -> time of day -> weather (time / weather limited to what that level can have, WX.options); starts a fresh run with that character at that level, forced via WX.devTime / WX.devWx (two axes, user 2026-10-12). 關閉 / Esc goes back to the landing page.
class DevMenuScene extends Phaser.Scene {
  constructor() { super('DevMenu'); }
  create() {
    this.cameras.main.fadeIn(200);
    var bg = this.add.graphics();
    bg.fillGradientStyle(0x1f4d2b, 0x1f4d2b, 0x8fd18f, 0x8fd18f, 1);
    bg.fillRect(0, 0, GAME_W, 540);
    bg.setDepth(-50);
    var self = this, objs = [], pick = { char: null, time: undefined, weather: undefined };
    var cx = GAME_W / 2;
    function add(o) { o.setDepth(200); objs.push(o); return o; }
    function clear() { for (var i = 0; i < objs.length; i++) objs[i].destroy(); objs = []; }
    function close() { clear(); if (window.showLanding) window.showLanding(); }
    // items: [{ label, sub, boss, value }]; draws a titled grid panel, calls onPick(value). backFn adds a 上一步 button.
    function panel(title, items, cols, cw, ch, onPick, backFn) {
      clear();
      var gap = 8, n = items.length, rows = Math.ceil(n / cols);
      var pw = Math.max(cols * cw + (cols - 1) * gap + 40, 360), ph = rows * ch + (rows - 1) * gap + 112, top = 270 - ph / 2;
      var dim = add(self.add.rectangle(cx, 270, GAME_W, 540, 0x000000, 0.6).setInteractive());
      dim.on('pointerdown', function () { /* swallow clicks behind the panel */ });
      add(self.add.rectangle(cx, 270, pw, ph, 0x16301f, 0.97).setStrokeStyle(2, 0x6ab07a));
      add(self.add.text(cx, top + 24, title, { fontFamily: FONT, fontSize: 22, fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5));
      var rowN = Math.min(cols, n), x0 = cx - (rowN * cw + (rowN - 1) * gap) / 2 + cw / 2, y0 = top + 56 + ch / 2;
      items.forEach(function (it, i) {
        var gx = x0 + (i % cols) * (cw + gap), gy = y0 + Math.floor(i / cols) * (ch + gap);
        var base = it.boss ? 0x6a2a2a : 0x2a6a3a;
        var r = add(self.add.rectangle(gx, gy, cw, ch, base).setInteractive({ useHandCursor: true }));
        var t1 = add(self.add.text(gx, gy - (it.sub ? 11 : 0), it.label, { fontFamily: FONT, fontSize: 17, fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5));
        var t2 = it.sub ? add(self.add.text(gx, gy + 11, it.sub, { fontFamily: FONT, fontSize: 12, color: '#dddddd' }).setOrigin(0.5)) : null;
        r.on('pointerover', function () { r.setFillStyle(0xffcc00); t1.setColor('#111111'); if (t2) t2.setColor('#222222'); });
        r.on('pointerout', function () { r.setFillStyle(base); t1.setColor('#ffffff'); if (t2) t2.setColor('#dddddd'); });
        r.on('pointerdown', function () { onPick(it.value); });
      });
      var by = top + ph - 28;
      if (backFn) {
        var bb = add(self.add.rectangle(cx - 80, by, 120, 36, 0x444444).setInteractive({ useHandCursor: true }));
        add(self.add.text(cx - 80, by, '上一步', { fontFamily: FONT, fontSize: 17, color: '#ffffff' }).setOrigin(0.5));
        bb.on('pointerdown', backFn);
      }
      var cb = add(self.add.rectangle(backFn ? cx + 80 : cx, by, 120, 36, 0x444444).setInteractive({ useHandCursor: true }));
      add(self.add.text(backFn ? cx + 80 : cx, by, '關閉 (Esc)', { fontFamily: FONT, fontSize: 17, color: '#ffffff' }).setOrigin(0.5));
      cb.on('pointerdown', close);
    }
    function stepChar() {
      var items = Object.keys(GAME_DATA.characters).map(function (id) { return { label: GAME_DATA.characters[id].name_zh, value: id }; });
      panel('開發者選項 1/4：選擇角色', items, 4, 140, 56, function (id) { pick.char = id; stepLevel(); }, null);
    }
    function stepLevel() {
      var n = Math.min(30, GAME_DATA.levels.length), items = [];
      for (var lv = 1; lv <= n; lv++) {
        var isBoss = lv % 5 === 0, nm = (GAME_DATA.levels[lv - 1] && GAME_DATA.levels[lv - 1].name_zh) || '';
        items.push({ label: '第 ' + lv + ' 關' + (isBoss ? '·魔王' : ''), sub: nm, boss: isBoss, value: lv });
      }
      panel('開發者選項 2/4：選擇關卡', items, 6, 112, 56, function (lv) { pick.level = lv; stepTime(); }, stepChar);
    }
    // time and weather come after the level: only the ones WX.options says this level can really have are offered (user 2026-10-13)
    function stepTime() {
      var items = WX.options(pick.level).times.map(function (t) { return { label: t[0], value: t[1] }; });
      panel('開發者選項 3/4：選擇時間（第 ' + pick.level + ' 關）', items, 4, 112, 56, function (v) { pick.time = v === '' ? undefined : v; stepWeather(); }, stepLevel);
    }
    function stepWeather() {
      var items = WX.options(pick.level).weathers.map(function (w) { return { label: w[0], value: w[1] }; });
      panel('開發者選項 4/4：選擇天氣（第 ' + pick.level + ' 關）', items, 4, 112, 56, function (v) {
        pick.weather = v === '' ? undefined : v;
        newRun(pick.char, HARD_MODE);
        RUN.level = pick.level;
        WX.devTime = pick.time; WX.devWx = pick.weather;
        clear(); fadeTo(self, 'Level');
      }, stepTime);
    }
    stepChar();
    this.input.keyboard.addKey('ESC').on('down', close);
  }
}

class CharSelectScene extends Phaser.Scene {
  constructor() { super('CharSelect'); }
  init() { this._cards = []; this._sel = false; this._popupOpen = false; this._popupObjs = []; WX.devTime = undefined; WX.devWx = undefined; }
  create() {
    this.cameras.main.fadeIn(300);
    var bg = this.add.graphics();
    bg.fillGradientStyle(0x1f4d2b, 0x1f4d2b, 0x8fd18f, 0x8fd18f, 1);
    bg.fillRect(0, 0, GAME_W, 540);
    bg.setDepth(-50);
    this._bg = WX.start(this, 'title');
    this.add.text(GAME_W / 2, 32, '選擇你的角色', { fontFamily: FONT, fontSize: 30, fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);
    var ids = GAME_DATA.charOrder || Object.keys(GAME_DATA.characters);   // trial build: all four; the locked two (GAME_DATA.lockedChars) are greyed out and cannot be picked
    var cx = GAME_W / 2;
    // 4 cards layout: spacing adjusted for 960 width. Card width 200, gap 20. Total 860. (The trial build has 2 characters: the same cards, centred.)
    var W = 200;
    var gap = 20;
    var nCards = Math.min(4, ids.length);
    var totalW = nCards * W + (nCards - 1) * gap;
    var startX = cx - totalW / 2 + W / 2;
    var xs = []; for (var xi = 0; xi < nCards; xi++) xs.push(startX + xi * (W + gap));
    var K = this.input.keyboard.addKeys('ONE,TWO,THREE,FOUR');
    var self = this;
    for (var i = 0; i < nCards; i++) {
      var id = ids[i];
      var lockedCh = GAME_DATA.lockedChars && GAME_DATA.lockedChars[id];
      var ch = lockedCh || GAME_DATA.characters[id];
      var card = this._mkCard(id, xs[i], 290, ch, W);
      if (lockedCh) {   // greyed out, no hover / click / key, a small 開發中 under the card
        card.border.clear(); card.border.fillStyle(0x5a5f5c, 0.95); card.border.lineStyle(2, 0x8a908c, 1); card.border.fillRoundedRect(-card.w / 2, 0, card.w, card.h, 12); card.border.strokeRoundedRect(-card.w / 2, 0, card.w, card.h, 12);   // only the card's background turns grey (user 2026-10-12); portrait and texts keep their normal colours
        this.add.text(xs[i], 290 + card.h / 2 + 18, '開發中', { fontFamily: FONT, fontSize: 18, fontStyle: 'bold', color: '#dddddd', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5);
        card.locked = true; this._cards.push(card); continue;
      }
      card._zone = this.add.zone(xs[i], 290, card.w, card.h).setInteractive();
      (function (card, i) {
        card._zone.on('pointerover', function () { if (self._popupOpen) return; card.cont.setScale(1.05); card.border.clear(); card.border.lineStyle(3, 0xffcc00, 1); card.border.strokeRoundedRect(-card.w / 2, 0, card.w, card.h, 12); });
        card._zone.on('pointerout', function () { if (self._popupOpen) return; card.cont.setScale(1); card.border.clear(); card.border.fillStyle(0x1a3a2a, 0.9); card.border.lineStyle(2, 0x3a6a4a, 1); card.border.fillRoundedRect(-card.w / 2, 0, card.w, card.h, 12); card.border.strokeRoundedRect(-card.w / 2, 0, card.w, card.h, 12); });
        card._zone.on('pointerdown', function () { if (!self._popupOpen) self._pick(i); });
        var keyName = ['ONE', 'TWO', 'THREE', 'FOUR'][i];
        K[keyName].on('down', function () { if (!self._popupOpen) self._pick(i); });
      })(card, i);
      this._cards.push(card);
    }
  }
  _mkCard(id, x, y, ch, W) {
    var TW = W - 20, cont = this.add.container(x, y), yy = 14, T = 26;
    var border = this.add.graphics();
    cont.add(border);
    function txt(scene, str, color, bold, wrap) {
      var o = scene.add.text(0, yy, str, { fontFamily: FONT, fontSize: T, fontStyle: bold ? 'bold' : 'normal', color: color, wordWrap: wrap ? { width: TW, useAdvancedWrap: true } : undefined, align: 'center' }).setOrigin(0.5, 0);
      cont.add(o); yy += o.height + 6; return o;
    }
    var hasAv = this.textures.exists('avatar_' + id), AV = 112;
    var spr = this.add.sprite(0, yy + (hasAv ? AV / 2 : 32), hasAv ? 'avatar_' + id : 'player_' + id);
    spr.setScale((hasAv ? AV : 64) / spr.height);
    cont.add(spr); yy += hasAv ? AV + 8 : 70;
    var nm = txt(this, ch.name_zh, '#ffffff', true); nm.setFontSize(34);
    txt(this, ch.concept_zh, '#dddddd', false, true);
    var H = Math.max(yy + 8, 250);
    border.fillStyle(0x1a3a2a, 0.9); border.lineStyle(2, 0x3a6a4a, 1);
    border.fillRoundedRect(-W / 2, 0, W, H, 12); border.strokeRoundedRect(-W / 2, 0, W, H, 12);
    for (var k = 0; k < cont.list.length; k++) cont.list[k].y -= H / 2;
    cont.y = y + 100;
    this.tweens.add({ targets: cont, y: y, duration: 400, delay: 0, ease: 'Back.Out' });
    this.tweens.add({ targets: spr, y: spr.y - 3, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    return { cont: cont, border: border, id: id, w: W, h: H };
  }
  _pick(i) {
    if (this._sel) return;
    this._showPopup(this._cards[i].id);
  }
  _showPopup(id) {
    var self = this;
    this._popupOpen = true;
    var ch = GAME_DATA.characters[id];
    var objs = [];
    function add(o, d) { o.setDepth(d || 201); objs.push(o); return o; }
    // Dim background (solid enough that the cards behind do not show through the popup area)
    var dim = add(this.add.rectangle(GAME_W / 2, 270, GAME_W, 540, 0x000000, 0.82).setInteractive(), 200);
    dim.on('pointerdown', function () { /* swallow */ });

    var pw = 840, PAD = 26, BTN_H = 46;
    var px = GAME_W / 2;
    var TW = pw - PAD * 2;
    var cx = px;
    // Content is laid out from y = 0 first; the panel is then sized to fit and centred, so long texts never run under the buttons.
    var y = 0, items = [], dividers = [], contentH = 0;
    // Characters with a level-buff section: body text 4 px smaller. If the content is still too tall for the screen (Vendor's long skill text + level buff, 2026-10-13: the last line sat on the buttons),
    // the layout is redone with every font 2 px smaller, up to 4 times.
    function layout(sm, ex) {
    y = 0; items = []; dividers = [];
    function put(o, dy) { items.push(o); o._ly = y; y += o.height + dy; return o; }
    function T(text, size, color, bold, italic, wrap) {
      var st = { fontFamily: FONT, fontSize: size, color: color };
      if (bold) st.fontStyle = 'bold';
      if (italic) st.fontStyle = 'italic';
      if (wrap) { st.wordWrap = { width: TW, useAdvancedWrap: true }; st.align = 'center'; st.lineSpacing = 2; }
      return self.add.text(cx, 0, text, st).setOrigin(0.5, 0);
    }
    function divider() { y += 2; dividers.push(y); y += 10; }

    // Name, bio, quote
    put(T(ch.name_zh, 38 - ex, '#ffffff', true), 6);
    put(T(ch.bio_zh, 24 - sm, '#dddddd', false, false, true), 8);
    put(T('"' + ch.quote_zh + '"', 24 - sm, '#ffd966', false, true, true), 6);
    divider();

    // Stats: 3-column grid, gains in green and penalties in red
    var stats = ch.stats || {};
    var cells = [];
    for (var k in stats) cells.push({ label: STAT_ZH[k] || k, val: statText(k, stats[k]) });
    var COLS = 3, CW = TW / COLS, ROW_H = 30;
    for (var i = 0; i < cells.length; i++) {
      var col = i % COLS, row = Math.floor(i / COLS);
      var neg = cells[i].val.charAt(0) === '-';
      var label = self.add.text(px - TW / 2 + col * CW + 8, 0, cells[i].label, { fontFamily: FONT, fontSize: 21 - ex, color: '#a9c9b1' }).setOrigin(0, 0);
      var val = self.add.text(px - TW / 2 + (col + 1) * CW - 26, 0, cells[i].val, { fontFamily: FONT, fontSize: 22 - ex, fontStyle: 'bold', color: neg ? '#ff9a8a' : '#b5f0a8' }).setOrigin(1, 0);
      label._ly = val._ly = y + row * ROW_H;
      items.push(label, val);
    }
    y += Math.ceil(cells.length / COLS) * ROW_H + 2;
    divider();

    // Normal-attack effect (only characters whose normal attack has an extra effect)
    if (ch.attack_desc_zh) {
      put(T('普攻特效', 26 - ex, '#ffd966', true), 2);
      put(T(ch.attack_desc_zh, 23 - sm, '#e8e8e8', false, false, true), 6);
      divider();
    }

    // Skill, cooldown on the title line
    var skill = ch.skill;
    put(T('技能: ' + skill.name_zh + '　冷卻 ' + skill.cooldown + ' 秒', 26 - ex, '#ffd966', true), 2);
    put(T(skill.desc_zh, 23 - sm, '#e8e8e8', false, false, true), 0);

    // Level buff (characters.json level_buff): when it applies and what it gives
    if (ch.level_buff) {
      divider();
      put(T('關卡加成: ' + ch.level_buff.name_zh, 26 - ex, '#ffd966', true), 2);
      put(T(ch.level_buff.when_zh + '：' + ch.level_buff.desc_zh, 23 - sm, '#e8e8e8', false, false, true), 0);
    }

    }
    var base0 = ch.level_buff ? 4 : 0, ex = 0;
    for (;;) {
      layout(base0 + ex, ex);
      contentH = y;
      if (contentH + PAD * 2 + 14 + BTN_H + 12 <= 536 || ex >= 8) break;
      for (var q = 0; q < items.length; q++) items[q].destroy();
      ex += 2;
    }
    var ph = Math.min(536, contentH + PAD * 2 + 14 + BTN_H + 12);
    var py = 270, top = py - ph / 2;
    add(this.add.rectangle(px, py, pw, ph, 0x16301f, 1).setStrokeStyle(2, 0x6ab07a), 200);
    var base = top + PAD;
    for (var j = 0; j < items.length; j++) { items[j].y = base + items[j]._ly; add(items[j]); }
    var g = add(this.add.graphics());
    g.lineStyle(1, 0x3a6a4a, 1);
    for (var d = 0; d < dividers.length; d++) {
      g.lineBetween(px - TW / 2, base + dividers[d], px + TW / 2, base + dividers[d]);
    }

    // Buttons
    var btnY = top + ph - PAD / 2 - BTN_H / 2 - 4;
    var okBtn = add(this.add.rectangle(cx - 100, btnY, 150, BTN_H, 0x2a6a3a).setInteractive({ useHandCursor: true }));
    add(this.add.text(cx - 100, btnY, '確定', { fontFamily: FONT, fontSize: 24, color: '#ffffff' }).setOrigin(0.5));
    okBtn.on('pointerdown', function () {
      self._closePopup();
      self._sel = true;
      newRun(id, HARD_MODE);
      REC.start(id, ch.name_zh, HARD_MODE);   // play records (records.js, trial build only)
      fadeTo(self, 'Level');
    });

    var cancelBtn = add(this.add.rectangle(cx + 100, btnY, 150, BTN_H, 0x6a2a2a).setInteractive({ useHandCursor: true }));
    add(this.add.text(cx + 100, btnY, '取消', { fontFamily: FONT, fontSize: 24, color: '#ffffff' }).setOrigin(0.5));
    cancelBtn.on('pointerdown', function () {
      self._closePopup();
    });

    this._popupObjs = objs;
  }
  _closePopup() {
    for (var i = 0; i < this._popupObjs.length; i++) {
      this._popupObjs[i].destroy();
    }
    this._popupObjs = [];
    this._popupOpen = false;
  }
  destroy() { if (this._bg) this._bg.destroy(); }
}

class ClearedScene extends Phaser.Scene {
  constructor() { super('Cleared'); }
  init(data) { this._done = false; this._cleared = data.cleared; this._stats = data.stats; }
  create() {
    this.cameras.main.fadeIn(300);
    var bgG = this.add.graphics();
    bgG.fillGradientStyle(0x1f4d2b, 0x1f4d2b, 0x2f7a45, 0x2f7a45, 1);
    bgG.fillRect(0, 0, GAME_W, 540);
    bgG.setDepth(-50);
    this._bg = WX.start(this, 'forest');
    var lvl = GAME_DATA.levels[this._cleared - 1];
    var title = this.add.text(GAME_W / 2, 150, '第 ' + lvl.n + ' / ' + GAME_DATA.levels.length + ' 關完成！', { fontFamily: FONT, fontSize: 40, fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);
    title.setScale(0);
    this.tweens.add({ targets: title, scaleX: 1, scaleY: 1, duration: 600, ease: 'Elastic.Out' });
    var elapsed = this._stats.time;
    var t1 = this.add.text(GAME_W / 2, 260, '用時 ' + fmtTime(elapsed), { fontFamily: FONT, fontSize: 21, color: '#ffffff' }).setOrigin(0.5);
    var t2 = this.add.text(GAME_W / 2, 300, '受傷次數 ' + this._stats.hits, { fontFamily: FONT, fontSize: 21, color: '#ffffff' }).setOrigin(0.5);
    var t3 = this.add.text(GAME_W / 2, 340, '擊敗敵人 ' + this._stats.kills, { fontFamily: FONT, fontSize: 21, color: '#ffffff' }).setOrigin(0.5);
    t1.setAlpha(0); t2.setAlpha(0); t3.setAlpha(0);
    this.tweens.add({ targets: t1, alpha: 1, duration: 800 });
    this.tweens.add({ targets: t2, alpha: 1, duration: 800, delay: 200 });
    this.tweens.add({ targets: t3, alpha: 1, duration: 800, delay: 400 });
    var self = this;
    var K = this.input.keyboard.addKeys('ENTER,SPACE');
    K.ENTER.on('down', function () { self._go(); });
    K.SPACE.on('down', function () { self._go(); });
    this.add.zone(GAME_W / 2, 270, GAME_W, 540).setInteractive().on('pointerdown', function () { self._go(); });
    this.time.delayedCall(2200, function () { self._go(); });
  }
  _go() {
    if (this._done) return;
    this._done = true;
    fadeTo(this, 'Choice', { cleared: this._cleared });
  }
  destroy() { if (this._bg) this._bg.destroy(); }
}

class EndScene extends Phaser.Scene {
  constructor() { super('End'); }
  init(data) { this._btns = []; this._confetti = []; this._result = data.result; this._noiseTimer = 0; }
  create() {
    this.cameras.main.fadeIn(300);
    var self = this;
    if (this._result === 'dead') REC.died(RUN.level);   // play records (records.js, trial build only); the result-screen line is read before a victory closes the record
    var recLine = REC.endLine();
    if (this._result !== 'dead') REC.finish('clear');
    if (this._result === 'dead') {
      this._bg = this.add.rectangle(GAME_W / 2, 270, GAME_W, 540, 0x3a0a0a);
      var title = this.add.text(GAME_W / 2, 150, '遊戲結束', { fontFamily: FONT, fontSize: 64, fontStyle: 'bold', color: '#ff3333' }).setOrigin(0.5);
      this.tweens.add({ targets: title, x: GAME_W / 2 - 8, duration: 100, yoyo: true, repeat: 3, onComplete: function () { title.x = GAME_W / 2; } });
      this._noise = this.add.graphics();
      this.add.text(GAME_W / 2, 260, '抵達第 ' + RUN.level + ' / ' + GAME_DATA.levels.length + ' 關', { fontFamily: FONT, fontSize: 21, color: '#ffffff' }).setOrigin(0.5);
      this.add.text(GAME_W / 2, 300, '擊敗敵人：' + RUN.kills, { fontFamily: FONT, fontSize: 21, color: '#ffffff' }).setOrigin(0.5);
      if (recLine) this.add.text(GAME_W / 2, 342, recLine, { fontFamily: FONT, fontSize: 21, color: '#ffd966' }).setOrigin(0.5);
      this._btns.push(mkBtn(this, GAME_W / 2, 400, 220, 50, '重新挑戰本關', 'R', function () { RUN.deaths++; RUN.hp = calcStats().max_hp; fadeTo(self, 'Level'); }));
      this._btns.push(mkBtn(this, GAME_W / 2, 470, 220, 50, '回主選單', 'M', function () { REC.finish('dead'); if (window.showLanding) window.showLanding(); }));
    } else {
      this._bg = this.add.rectangle(GAME_W / 2, 270, GAME_W, 540, 0x8a6a10);
      var vt = this.add.text(GAME_W / 2, 150, '勝利！', { fontFamily: FONT, fontSize: 72, fontStyle: 'bold', color: '#ffd700' }).setOrigin(0.5);
      vt.setScale(0);
      this.tweens.add({ targets: vt, scaleX: 1.5, scaleY: 1.5, duration: 400, ease: 'Sine.Out', onComplete: function () { self.tweens.add({ targets: vt, scaleX: 1, scaleY: 1, duration: 400, ease: 'Bounce.Out' }); } });
      this.add.text(GAME_W / 2, 210, (window.DEMO ? '試玩版到此結束，完整版共 30 關' : '你征服了台北好好玩'), { fontFamily: FONT, fontSize: 24, color: '#ffd700' }).setOrigin(0.5);
      if (recLine) this.add.text(GAME_W / 2, 244, recLine, { fontFamily: FONT, fontSize: 19, color: '#ffffff' }).setOrigin(0.5);
      var elapsed = Date.now() - RUN.startTime;
      this.add.text(GAME_W / 2, 280, '總時間 ' + fmtTime(elapsed), { fontFamily: FONT, fontSize: 21, color: '#ffffff' }).setOrigin(0.5);
      this.add.text(GAME_W / 2, 320, '擊敗敵人：' + RUN.kills, { fontFamily: FONT, fontSize: 21, color: '#ffffff' }).setOrigin(0.5);
      this.add.text(GAME_W / 2, 360, '死亡次數：' + RUN.deaths, { fontFamily: FONT, fontSize: 21, color: '#ffffff' }).setOrigin(0.5);
      if (window.DEMO) this.add.text(GAME_W / 2, 402, '感謝遊玩！', { fontFamily: FONT, fontSize: 32, fontStyle: 'bold', color: '#ffffff', stroke: '#5a3a00', strokeThickness: 5 }).setOrigin(0.5);   // trial build (user 2026-10-12)
      var cols = [0xffd700, 0xff4444, 0x44ff44, 0x4444ff, 0xff44ff, 0x44ffff];
      for (var i = 0; i < 40; i++) {
        var r = this.add.rectangle(Math.random() * GAME_W, Math.random() * 540, 6, 6, cols[Math.floor(Math.random() * 6)]);
        r.setDepth(50);
        this._confetti.push({ r: r, vy: 60 + Math.random() * 120, rv: (Math.random() - 0.5) * 200 });
      }
      this._btns.push(mkBtn(this, GAME_W / 2, 450, 220, 50, '再玩一次', 'ENTER', function () { newRun(); if (window.showLanding) window.showLanding(); }));
    }
  }
  update(time, delta) {
    if (this._result === 'dead') {
      this._noiseTimer += delta;
      if (this._noiseTimer > 100) {
        this._noiseTimer = 0;
        this._noise.clear();
        this._noise.fillStyle(0x888888, 0.08);
        for (var i = 0; i < 60; i++) this._noise.fillRect(Math.random() * GAME_W, Math.random() * 540, 4, 4);
      }
    } else {
      for (var j = 0; j < this._confetti.length; j++) {
        var c = this._confetti[j];
        c.r.y += c.vy * delta / 1000;
        c.r.rotation += c.rv * delta / 1000;
        if (c.r.y > 560) { c.r.y = -10; c.r.x = Math.random() * GAME_W; }
      }
    }
  }
  destroy() { if (this._bg && this._bg.destroy) this._bg.destroy(); }
}
