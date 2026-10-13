const HUD_FONT = 'Microsoft JhengHei, PingFang TC, sans-serif';

// Geometry of the top-left info block (panel + the pill row under it); _redraw() draws from it and the how-to page (charpanel.js) spotlights it.
const HUD_L = { PX: 10, PY: 10, PW: 360, PH: 100, GAP: 8, PILL_H: 32, PILL_GAP: 10 };
HUD_L.rect = { x: HUD_L.PX, y: HUD_L.PY, w: HUD_L.PW, h: HUD_L.PH + HUD_L.PILL_GAP + HUD_L.PILL_H };
HUD_L.pill = function (i) { const pw = (HUD_L.PW - 2 * HUD_L.GAP) / 3; return { x: HUD_L.PX + i * (pw + HUD_L.GAP), y: HUD_L.PY + HUD_L.PH + HUD_L.PILL_GAP, w: pw, h: HUD_L.PILL_H }; };

class HUD {
  constructor(scene) {
    this.scene = scene;
    this._lastHp = RUN.hp;
    this._lowOn = false;
    this._introShown = false;
    this._bossWarned = false;
    this._bossBar = null;
    this._bossName = null;
    this._bossFill = null;
    this._bossFrame = null;
    this._bossFlash = null;
    this._bossFlashTween = null;
    this._bossFlashOn = false;
    this._bossFlashT = 0;
    this._bossFlashDur = 120;
    this._bossFlashColor = 0xffffff;
    this._bossFlashActive = false;
    this._bossFlashPending = false;
    this._bossFlashPendingColor = 0xffffff;
    this._bossFlashPendingDur = 120;
    this._bossFlashPendingOn = false;
    this._bossFlashPendingActive = false;
    this._bossFlashPendingT = 0;
    this._bossFlashPendingDur = 120;
    this._bossFlashPendingColor = 0xffffff;
    this._bossFlashPendingOn = false;
    this._bossFlashPendingActive = false;
    this._bossFlashPendingT = 0;
    this._build();
  }

  _build() {
    const s = this.scene;
    const lvl = GAME_DATA.levels[RUN.level - 1];
    const maxHp = this._maxHp();
    const hp = RUN.hp;

    // Top-left info panel (user 2026-10-12, proposal A): one translucent rounded panel; panel = avatar + HP bar + level chip + name; pills below = weather / enemies / coin stack + coins.
    // Everything except the texts is drawn on one Graphics (this.panel) in _redraw(); the coin number is extras.js's coinText, placed to match (CoinText at 48,122).
    const T = (sz, col, stroke) => s.add.text(0, 0, '', { fontFamily: HUD_FONT, fontSize: sz + 'px', fontStyle: 'bold', color: col, stroke: stroke || '#0a1224', strokeThickness: 3 }).setScrollFactor(0).setDepth(103);   // type scale: 14 (secondary) / 18 (primary) only
    this.panel = s.add.graphics().setScrollFactor(0).setDepth(100);
    this._flash = { color: 0xffffff, alpha: 0 };
    this.hpText = T(14, '#ffffff').setOrigin(0.5);
    this.levelChipText = T(14, '#3a2a00', '#ffc94a').setOrigin(0.5).setText('第 ' + RUN.level + ' 關');   // 'N / 30' was not understood (user 2026-10-12): just the level number
    this.levelText = T(18, '#ffffff').setOrigin(0, 0.5).setText(lvl.name_zh);
    this.weatherLabel = T(14, '#9fb4d0').setOrigin(0, 0.5).setText('天氣');
    this.weatherText = T(18, '#ffffff').setOrigin(0, 0.5).setText(WX.name(s.cond));
    this.windText = (s.cond && s.cond.wx === 'typhoon') ? T(16, '#ffffff').setOrigin(0.5).setVisible(false) : null;   // typhoon only: arrow + wind scale under the weather pill
    this.enemyLabel = T(14, '#9fb4d0').setOrigin(0, 0.5).setText('敵人');
    this.enemyText = T(18, '#ffffff').setOrigin(0, 0.5);
    this._setHpText(hp, maxHp);
    this._updateEnemyText();
    this._redraw();

    // Avatar button: round copy of avatar_<char> (drawn once into a canvas texture) ; tapping it pauses the level and opens the character panel (charpanel.js).
    const avKey = 'hud_avatar_' + RUN.char;
    if (!s.textures.exists(avKey) && s.textures.exists('avatar_' + RUN.char)) {
      const src = s.textures.get('avatar_' + RUN.char).getSourceImage(), cv = s.textures.createCanvas(avKey, 160, 160), c = cv.getContext();
      c.beginPath(); c.arc(80, 80, 80, 0, Math.PI * 2); c.clip(); c.drawImage(src, 0, 0, 160, 160); cv.refresh();
    }
    this.avatarImg = s.textures.exists(avKey) ? s.add.image(0, 0, avKey).setDisplaySize(72, 72).setScrollFactor(0).setDepth(101) : null;
    this.avatarZone = s.add.zone(16, 20, 84, 80).setOrigin(0).setScrollFactor(0).setDepth(104).setInteractive({ useHandCursor: true });
    this.avatarZone.on('pointerdown', () => this.openCharPanel());
    this._onResume = () => { this._resumeFromPanel(); };
    s.events.on('resume', this._onResume);

    this._buildBuffs();
    this._buildRestart();
    this._buildIntro(lvl);
  }

  _maxHp() {
    const p = this.scene.player;
    if (p && p.stats && p.stats.max_hp) return p.stats.max_hp;
    return 100;
  }

  _setHpText(hp, maxHp) {
    this.hpText.setText(Math.max(0, Math.round(hp)) + ' / ' + Math.round(maxHp));
  }

  // Draws the panel, HP bar (+ hit/heal flash), level chip, the pills and the coin stack.  Called every frame from update().
  // Layout grid (user 2026-10-12: fonts / sizes / alignment were inconsistent):  8 px spacing unit, 12 px panel padding, 360 px wide column shared by the panel and the pill row.
  // Type scale: only two sizes - 14 px (secondary: labels, HP numbers, level chip) and 18 px (primary: level name, values, coins); one font, bold, one dark outline colour.
  // Panel: avatar 76 px ring at the left, 16 px gap, then the right column (COLX .. PX+PW-12): HP row (bar) and level row (chip + name), both left-aligned to COLX.
  // Pill row under the panel: three equal pills spanning exactly the panel width (left / right edges aligned with the panel), contents centred.
  _redraw() {
    const g = this.panel;
    const max = this._maxHp(), r = Math.max(0, Math.min(1, RUN.hp / max)), low = r < 0.25;
    const PX = HUD_L.PX, PY = HUD_L.PY, PW = HUD_L.PW, PH = HUD_L.PH, PAD = 12, GAP = HUD_L.GAP, COLX = PX + PAD + 76 + 16, COLR = PX + PW - PAD;
    g.clear();
    g.fillStyle(0x0a1224, 0.58); g.fillRoundedRect(PX, PY, PW, PH, 14);
    g.lineStyle(1.5, 0xffffff, 0.22); g.strokeRoundedRect(PX, PY, PW, PH, 14);
    // avatar ring (the avatar image is this.avatarImg), vertically centred in the panel; ring centre x = PX + PAD + 38
    const ax = PX + PAD + 38, ay = PY + PH / 2;
    g.fillStyle(0x000000, 0.35); g.fillCircle(ax, ay + 2, 40);
    g.lineStyle(3, 0xffc94a, 1); g.strokeCircle(ax, ay, 38);
    if (this.avatarImg) this.avatarImg.setPosition(ax, ay);
    // HP row: the bar spans the whole right column (no heart icon, user 2026-10-12), row centre y = PY + 32
    const hy = PY + 32;
    const bx = COLX, bw = COLR - bx, bh = 24, by = hy - bh / 2, fw = bw * r;
    g.fillStyle(0x000000, 0.55); g.fillRoundedRect(bx, by, bw, bh, 12);
    if (fw > 0) {
      g.fillStyle(low ? 0xc01818 : 0xd8283a, 1); g.fillRoundedRect(bx, by, fw, bh, Math.min(12, fw / 2));
      g.fillStyle(0xffffff, 0.28); g.fillRoundedRect(bx + 2, by + 2, Math.max(0, fw - 4), bh * 0.42, Math.min(8, Math.max(0, fw - 4) / 2));
    }
    if (this._flash.alpha > 0.01) { g.fillStyle(this._flash.color, this._flash.alpha * 0.7); g.fillRoundedRect(bx, by, bw, bh, 12); }
    g.lineStyle(1.5, 0xffffff, 0.35); g.strokeRoundedRect(bx, by, bw, bh, 12);
    this.hpText.setPosition(bx + bw / 2, hy);
    // level row: chip + name, row centre y = PY + 66
    const ly = PY + 68;
    const cw = Math.max(56, this.levelChipText.width + 24);   // chip fits its text ("第 10 關" is wider than "第 1 關")
    g.fillStyle(0xffc94a, 1); g.fillRoundedRect(COLX, ly - 12, cw, 24, 12);
    this.levelChipText.setPosition(COLX + cw / 2, ly); this.levelText.setPosition(COLX + cw + 10, ly);
    // pill row: weather / enemies / coins, equal widths spanning the panel width, 10 px below it
    const py = PY + PH + HUD_L.PILL_GAP, ph = HUD_L.PILL_H, my = py + ph / 2, pw = (PW - 2 * GAP) / 3;
    const pill = (i) => { const x = PX + i * (pw + GAP); g.fillStyle(0x0a1224, 0.58); g.fillRoundedRect(x, py, pw, ph, 16); g.lineStyle(1.5, 0xffffff, 0.22); g.strokeRoundedRect(x, py, pw, ph, 16); return x; };
    const pair = (x, a, b) => { const tot = a.width + 8 + b.width, x0 = x + (pw - tot) / 2; a.setPosition(x0, my); b.setPosition(x0 + a.width + 8, my); };
    {   // weather pill: a long name ("夜晚·雷陣雨") must not overflow it: first drop the "天氣" label, then shrink the text to fit
      const wl = this.weatherLabel, wt = this.weatherText, x = pill(0), room = pw - 14;
      wt.setScale(1); wl.setVisible(true);
      if (wl.width + 8 + wt.width > room) {
        wl.setVisible(false);
        if (wt.width > room) wt.setScale(room / wt.width);
        wt.setPosition(x + (pw - wt.width * wt.scaleX) / 2, my);
      } else pair(x, wl, wt);
    }
    // Typhoon wind chip under the weather pill (user 2026-10-12): arrow = push direction, N級 = strength (|slant| 40..90 -> 9..12, a game scale, not a real wind speed).
    // While the rain has already slanted but the push on the player has not arrived yet (0.7 s, weather.js; also while the push still points the old way), the chip blinks yellow = "wind is coming, do not jump"; then it stays white.
    if (this.windText) {
      const wi = this.scene.windInfo, a = wi ? Math.abs(wi.slant) : 0;
      if (a < 1) this.windText.setVisible(false);
      else {
        const lvl = Math.max(9, Math.min(12, 9 + Math.round(3 * (a - 40) / 50))), warn = Math.abs(wi.push - wi.slant) > 0.15 * a;
        const cx = HUD_L.PX + pw / 2, cy = py + ph + 6 + 13;
        this.windText.setText((wi.slant > 0 ? '→ ' : '← ') + lvl + ' 級').setColor(warn ? '#ffc94a' : '#ffffff').setPosition(cx, cy).setVisible(true);
        this.windText.setAlpha(warn ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.scene.time.now * 0.02)) : 1);
        g.fillStyle(0x0a1224, 0.58); g.fillRoundedRect(HUD_L.PX, py + ph + 6, pw, 26, 13); g.lineStyle(1.5, warn ? 0xffc94a : 0xffffff, warn ? 0.6 : 0.22); g.strokeRoundedRect(HUD_L.PX, py + ph + 6, pw, 26, 13);
      }
    }
    pair(pill(1), this.enemyLabel, this.enemyText);
    // coin stack (three coins, side view, 20 px wide) + the number (extras.js coinText, moved here every frame)
    const px = pill(2), ct = this.scene._ex && this.scene._ex.coinText, nw = ct ? ct.width : 12;
    const tot = 20 + 8 + nw, x0 = px + (pw - tot) / 2, cx = x0 + 10, cy = my - 3;
    for (let k = 0; k < 3; k++) {
      const yy = cy + 7 - k * 6;
      g.fillStyle(0xb87a00, 1); g.fillRect(cx - 10, yy - 1, 20, 5); g.fillEllipse(cx, yy + 4, 20, 7);
      g.fillStyle(0xffd24a, 1); g.fillEllipse(cx, yy, 20, 7);
      g.lineStyle(1.2, 0x8a5a00, 1); g.strokeEllipse(cx, yy, 20, 7);
      g.fillStyle(0xfff0a0, 0.9); g.fillEllipse(cx - 3, yy - 0.5, 8, 2.2);
    }
    if (ct) ct.setPosition(x0 + 28, my);
  }

  // Opens the character panel: pauses the level scene (clock, tweens, physics all stop) and shows CharPanel over it.  Not while the level is ending or the player is dead.
  openCharPanel() {
    const s = this.scene;
    if (this._panelOpen || s.finished || !s.sys.isActive() || (s.player && s.player.dead)) return;
    this._panelOpen = true;
    this._pausedAt = Date.now();
    if (s.touch && s.touch.reset) s.touch.reset();   // a finger held on the touch pad / buttons would otherwise stay "down" while the level cannot see it lift
    s.scene.pause();
    s.scene.launch('CharPanel', { from: s.scene.key });
  }

  // Level scene resumed (panel closed): the level timer must not count the time spent in the panel; drop any touch state left from before.
  _resumeFromPanel() {
    if (!this._panelOpen) return;
    this._panelOpen = false;
    const s = this.scene;
    if (RUN.levelStats && RUN.levelStats.startMs) RUN.levelStats.startMs += Date.now() - this._pausedAt;
    if (s.touch && s.touch.reset) s.touch.reset();
  }

  // True when the pointer is on the avatar button (touch.js ignores such touches so tapping the avatar does not pop up the walk pad).
  avatarHit(pointer) {
    return pointer.x >= 16 && pointer.x <= 100 && pointer.y >= 20 && pointer.y <= 100;
  }

  // Restart-level button (user 2026-10-13): a round button in the top-right corner. The first tap arms it (red, with a hint) for 2.5 s, the second tap restarts the level from the state it started in
  // (HP / coins / kills / SIM uses are put back from the snapshot Level.create took, so a restart cannot be used to farm coins or heal).
  _buildRestart() {
    const s = this.scene, cx = GAME_W - 30, cy = 36, r = 20;
    this._rsArmed = false; this._rsBusy = false;
    this.restartG = s.add.graphics().setScrollFactor(0).setDepth(102);
    this.restartHint = s.add.text(cx - r - 10, cy, '再點一次：重玩本關', { fontFamily: HUD_FONT, fontSize: '16px', fontStyle: 'bold', color: '#ffffff', stroke: '#0a1224', strokeThickness: 4 }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(102).setVisible(false);
    this.restartLabel = s.add.text(cx - r - 10, cy, '重玩本關', { fontFamily: HUD_FONT, fontSize: '16px', fontStyle: 'bold', color: '#ffffff', stroke: '#0a1224', strokeThickness: 4 }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(102);   // always shown; the armed hint replaces it
    this.restartZone = s.add.zone(cx - 26, cy - 26, 52, 52).setOrigin(0).setScrollFactor(0).setDepth(104).setInteractive({ useHandCursor: true });
    this.restartZone.on('pointerdown', () => this._tapRestart());
    this._drawRestart();
  }
  _drawRestart() {
    const g = this.restartG, cx = GAME_W - 30, cy = 36, r = 20, on = this._rsArmed;
    g.clear();
    g.fillStyle(on ? 0xc0392b : 0x0a1224, on ? 0.9 : 0.55); g.fillCircle(cx, cy, r);
    g.lineStyle(2, 0xffffff, on ? 1 : 0.7); g.strokeCircle(cx, cy, r);
    g.lineStyle(3, 0xffffff, 1); g.beginPath(); g.arc(cx, cy, 9, -0.6, 4.2, false); g.strokePath();   // an open circle arrow
    const a = 4.2, hx = cx + Math.cos(a) * 9, hy = cy + Math.sin(a) * 9;
    g.fillStyle(0xffffff, 1); g.fillTriangle(hx + 5, hy - 5, hx - 5, hy - 4, hx + 1, hy + 6);
  }
  _tapRestart() {
    const s = this.scene;
    if (this._rsBusy || s.finished || s.deathStarted || (s.player && s.player.dead) || !s.sys.isActive()) return;
    if (!this._rsArmed) {
      this._rsArmed = true; this.restartHint.setVisible(true); this.restartLabel.setVisible(false); this._drawRestart();
      if (this._rsTimer) this._rsTimer.remove(false);
      this._rsTimer = s.time.delayedCall(2500, () => { this._rsArmed = false; if (this.restartHint && this.restartHint.active) { this.restartHint.setVisible(false); this.restartLabel.setVisible(true); } if (this.restartG && this.restartG.active) this._drawRestart(); });
      return;
    }
    this._rsBusy = true;
    const sn = RUN._lvlSnap;
    if (sn && sn.level === RUN.level) { RUN.hp = sn.hp; RUN.coins = sn.coins; RUN.kills = sn.kills; RUN.simUses = sn.simUses; }
    if (s.touch && s.touch.reset) s.touch.reset();
    fadeTo(s, 'Level');
  }
  // True when the pointer is on the restart button (touch.js ignores such touches).
  restartHit(pointer) {
    return pointer.x >= GAME_W - 56 && pointer.y <= 62;
  }

  _buildBuffs() {
    const s = this.scene;
    this.buffTexts = [];
    this.buffIcons = [];
    this._buffCount = 0;
    const ids = Object.keys(RUN.buffs);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const stacks = RUN.buffs[id];
      if (stacks <= 0) continue;
      const col = this._buffCount % 6;
      const row = Math.floor(this._buffCount / 6);
      const x = GAME_W - 16 - col * 34;
      const y = 72 + row * 34;   // below the restart button (top-right corner, 2026-10-13)
      if (s.textures.exists('icon_' + id)) {
        const icon = s.add.image(x, y, 'icon_' + id).setScrollFactor(0).setDepth(100).setDisplaySize(24, 24);
        this.buffIcons.push(icon);
      } else {
        this.buffIcons.push(null);
      }
      const txt = s.add.text(x - 14, y + 14, 'x' + stacks, { fontFamily: HUD_FONT, fontSize: '12px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5).setScrollFactor(0).setDepth(101);
      this.buffTexts.push(txt);
      this._buffCount++;
    }
  }

  _buildIntro(lvl) {
    const s = this.scene;
    const boss = this._bossDef();
    const lvl0 = GAME_DATA.levels[RUN.level - 1];
    const deferred = lvl0 && lvl0.spawns.some((x) => !GAME_DATA.bosses[x.type]); // boss comes in later (Level._startBossEntrance shows the warning then)
    if (boss && !deferred) {
      this._showBossWarning();
    }
  }

  _bossDef() {
    const lvl = GAME_DATA.levels[RUN.level - 1];
    if (!lvl || !lvl.spawns) return null;
    for (let i = 0; i < lvl.spawns.length; i++) {
      const sp = lvl.spawns[i];
      if (sp.type && GAME_DATA.bosses[sp.type]) return GAME_DATA.bosses[sp.type];
    }
    return null;
  }

  _showBossWarning() {
    const s = this.scene;
    this.warnText = s.add.text(GAME_W / 2, 270, '警告：魔王來襲', { fontFamily: HUD_FONT, fontSize: '44px', color: '#ff3030', stroke: '#000000', strokeThickness: 6 }).setOrigin(0.5).setScrollFactor(0).setDepth(100);
    this.warnText.setAlpha(0);
    
    // Sub-text for Level 5 boss entrance
    this.warnSubText = null;
    if (RUN.level === 5) {
      const phrases = [
        '讓本大王給你點顏色瞧瞧!',
        '小心~別踩到我的腳~',
        '凡人~見證魔王的誕生吧!'
      ];
      const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
      this.warnSubText = s.add.text(GAME_W / 2, 310, randomPhrase, { fontFamily: HUD_FONT, fontSize: '24px', color: '#ffffff', stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5).setScrollFactor(0).setDepth(100);
      this.warnSubText.setAlpha(0);
    }

    this.warnBorder = s.add.rectangle(GAME_W / 2, 270, GAME_W, 540, 0xff0000, 0).setOrigin(0.5).setScrollFactor(0).setDepth(99);
    this.warnBorder.setStrokeStyle(12, 0xff0000, 0);
    let count = 0;
    const flash = () => {
      if (count >= 3) {
        this.warnBorder.setStrokeStyle(12, 0xff0000, 0);
        s.tweens.add({ targets: this.warnText, alpha: 0, duration: 400, onComplete: () => { 
          if (this.warnText) { this.warnText.destroy(); this.warnText = null; } 
          if (this.warnSubText) { this.warnSubText.destroy(); this.warnSubText = null; }
          if (this.warnBorder) { this.warnBorder.destroy(); this.warnBorder = null; } 
        } });
        return;
      }
      count++;
      this.warnText.setAlpha(1);
      if (this.warnSubText) this.warnSubText.setAlpha(1);
      this.warnBorder.setStrokeStyle(12, 0xff0000, 0.8);
      s.time.delayedCall(200, () => {
        this.warnText.setAlpha(0);
        if (this.warnSubText) this.warnSubText.setAlpha(0);
        this.warnBorder.setStrokeStyle(12, 0xff0000, 0);
        s.time.delayedCall(200, flash);
      });
    };
    flash();
  }

  _updateEnemyText() {
    const n = (this.scene.enemiesRemaining != null) ? this.scene.enemiesRemaining : 0;
    this.enemyText.setText(String(n));
  }

  _updateBossBar() {
    const s = this.scene;
    const boss = s.boss;
    if (boss && !boss.dead) {
      if (!this._bossBar) {
        const barLeft = GAME_W / 2 - 300;
        this._bossFrame = s.add.rectangle(GAME_W / 2, 40, 600, 16, 0x111111, 0.85).setOrigin(0.5).setScrollFactor(0).setDepth(100);
        this._bossFill = s.add.rectangle(barLeft, 32, 600, 16, 0xc02020, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(101);
        this._bossName = s.add.text(GAME_W / 2, 22, '', { fontFamily: HUD_FONT, fontSize: '16px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5).setScrollFactor(0).setDepth(102);
        this._bossFlash = s.add.rectangle(barLeft, 32, 600, 16, 0xffffff, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(102);
        this._bossFlashOn = false;
        this._bossFlashT = 0;
        this._bossFlashActive = false;
        this._bossFlashColor = 0xffffff;
        this._bossFlashDur = 120;
        this._bossFlashPending = false;
        this._bossFlashPendingActive = false;
        this._bossFlashPendingT = 0;
        this._bossFlashPendingColor = 0xffffff;
        this._bossFlashPendingDur = 120;
        this._bossFlashPendingOn = false;
        this._lastBossHp = boss.hp;
        this._bossName.setText(boss.def ? boss.def.name_zh : '魔王');
        this._bossBar = true;
      }
      const maxHp = boss.maxHp || 1;
      const ratio = Math.max(0, boss.hp / maxHp);
      this._bossFill.width = 600 * ratio;
      if (this._lastBossHp != null && boss.hp < this._lastBossHp) {
        this._bossFlashPending = true;
        this._bossFlashPendingColor = 0xffffff;
        this._bossFlashPendingDur = 120;
        this._bossFlashPendingOn = true;
      }
      this._lastBossHp = boss.hp;
      this._updateBossFlash(this._delta || 16);
    } else if (this._bossBar) {
      this._destroyBossBar();
    }
  }

  _updateBossFlash(delta) {
    if (this._bossFlashPending && !this._bossFlashActive) {
      this._bossFlashActive = true;
      this._bossFlashPending = false;
      this._bossFlashColor = this._bossFlashPendingColor;
      this._bossFlashDur = this._bossFlashPendingDur;
      this._bossFlashOn = this._bossFlashPendingOn;
      this._bossFlashT = 0;
      this._bossFlash.setFillStyle(this._bossFlashColor, this._bossFlashOn ? 0.7 : 0);
    }
    if (this._bossFlashActive) {
      this._bossFlashT += delta;
      if (this._bossFlashT >= this._bossFlashDur) {
        this._bossFlashActive = false;
        this._bossFlash.setFillStyle(0xffffff, 0);
      }
    }
  }

  _destroyBossBar() {
    if (this._bossFrame) { this._bossFrame.destroy(); this._bossFrame = null; }
    if (this._bossFill) { this._bossFill.destroy(); this._bossFill = null; }
    if (this._bossName) { this._bossName.destroy(); this._bossName = null; }
    if (this._bossFlash) { this._bossFlash.destroy(); this._bossFlash = null; }
    this._bossBar = null;
  }

  update(time, delta) {
    const s = this.scene;
    this._delta = delta;
    const maxHp = this._maxHp();
    const hp = RUN.hp;
    this._setHpText(hp, maxHp);
    if (hp < this._lastHp) {
      this._flashHp(0xffffff, 120);
    } else if (hp > this._lastHp) {
      this._flashHp(0x60ff80, 200);
    }
    this._lastHp = hp;
    this._updateEnemyText();
    this._redraw();
    this._updateBossBar();
    const low = hp < maxHp * 0.25;
    if (low !== this._lowOn) {
      this._lowOn = low;
      FX.lowHpBorder(s, low);
    }
  }

  _flashHp(color, dur) {
    const s = this.scene;
    this._flash.color = color; this._flash.alpha = 1;
    s.tweens.add({ targets: this._flash, alpha: 0, duration: dur });
  }

  destroy() {
    const s = this.scene;
    if (this._onResume) s.events.off('resume', this._onResume);
    if (this.avatarImg) this.avatarImg.destroy();
    if (this.avatarZone) this.avatarZone.destroy();
    if (this.restartG) this.restartG.destroy();
    if (this.restartHint) this.restartHint.destroy();
    if (this.restartLabel) this.restartLabel.destroy();
    if (this.restartZone) this.restartZone.destroy();
    if (this._rsTimer) this._rsTimer.remove(false);
    if (this.panel) this.panel.destroy();
    if (this.hpText) this.hpText.destroy();
    if (this.levelChipText) this.levelChipText.destroy();
    if (this.levelText) this.levelText.destroy();
    if (this.weatherLabel) this.weatherLabel.destroy();
    if (this.weatherText) this.weatherText.destroy();
    if (this.windText) this.windText.destroy();
    if (this.enemyLabel) this.enemyLabel.destroy();
    if (this.enemyText) this.enemyText.destroy();
    for (let i = 0; i < this.buffIcons.length; i++) { if (this.buffIcons[i]) this.buffIcons[i].destroy(); }
    for (let i = 0; i < this.buffTexts.length; i++) { if (this.buffTexts[i]) this.buffTexts[i].destroy(); }
    if (this.introText) this.introText.destroy();
    if (this.warnText) this.warnText.destroy();
    if (this.warnSubText) this.warnSubText.destroy();
    if (this.warnBorder) this.warnBorder.destroy();
    this._destroyBossBar();
  }
}
