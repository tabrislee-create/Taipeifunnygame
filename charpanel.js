// Character panel (user 2026-10-12): tap the avatar in the top-left HUD -> the level scene is paused (scene.pause: its clock, tweens and physics all stop, cooldowns and buff timers included)
// and this scene is drawn over it: character stats, skill, the five equipment slots, every buff with its stacks, and the shop items active this level. Close = X, 繼續遊戲, Esc, or a tap outside the panel.
// Opened by HUD.openCharPanel (hud.js).  Scrolls with the wheel, dragging (touch) or the up / down keys.
// Type scale (same as the HUD, plus one heading size): 14 = secondary (labels, tags, descriptions, stat lines), 18 = primary (values, item names, section titles, button), 24 = the character's name.
// Grid: 24 px panel padding, two columns (left 232 px, 24 px gutter, right = the rest), every label left-aligned and every value right-aligned inside its column.
var CP_STAT_LABEL = {
  max_hp: '最大生命', move_speed: '移動速度', jump_velocity: '跳躍力', attack_damage: '攻擊力', attack_range: '攻擊範圍', crit_chance: '暴擊率',
  crit_multiplier: '暴擊傷害', defense: '防禦', lifesteal: '吸血', attack_speed: '攻擊速度'
};
var CP_RARITY_NAME = { common: '普通', rare: '稀有', epic: '史詩' };

// "攻擊力 +5、暴擊率 +8%" from a stats object ({key: {type:'flat'|'percent', value}}), each value multiplied by `n` (stacks).
function cpStatLine(stats, n) {
  var out = [];
  n = n || 1;
  for (var k in (stats || {})) {
    var m = stats[k], v = m.value * n, label = CP_STAT_LABEL[k] || k;
    if (k === 'jump_velocity') v = -v;   // more negative = higher jump
    var sign = v >= 0 ? '+' : '-', a = Math.abs(v);
    if (m.type === 'percent') out.push(label + ' ' + sign + Math.round(a * 1000) / 10 + '%');
    else if (k === 'crit_chance' || k === 'lifesteal' || k === 'attack_speed') out.push(label + ' ' + sign + Math.round(a * 1000) / 10 + '%');
    else out.push(label + ' ' + sign + Math.round(a * 10) / 10);
  }
  return out.join('、');
}

class CharPanelScene extends Phaser.Scene {
  constructor() { super('CharPanel'); }

  init(data) { this._from = (data && data.from) || 'Level'; }

  create() {
    const GW = (typeof GAME_W !== 'undefined' && GAME_W) ? GAME_W : 960, F = 'Microsoft JhengHei, PingFang TC, sans-serif';
    const ch = GAME_DATA.characters[RUN.char], st = calcStats();
    const PW = Math.min(GW - 40, 880), PH = 490, px = Math.round((GW - PW) / 2), py = 25, PAD = 24;
    const T = (x, y, str, sz, col, extra) => this.add.text(x, y, str, Object.assign({ fontFamily: F, fontSize: sz + 'px', fontStyle: 'bold', color: col || '#ffffff', stroke: '#0a1224', strokeThickness: 3 }, extra || {}));
    const SEC = '#9fb4d0';   // secondary text colour (labels, tags)
    this._close = () => { this.scene.stop(); this.scene.resume(this._from); };

    // dim background (a tap on it closes) + panel
    const dim = this.add.rectangle(GW / 2, 270, GW, 540, 0x000000, 0.62).setInteractive();
    dim.on('pointerdown', this._close);
    const g = this.add.graphics();
    g.fillStyle(0x0a1224, 0.97); g.fillRoundedRect(px, py, PW, PH, 18);
    g.lineStyle(2, 0xffffff, 0.25); g.strokeRoundedRect(px, py, PW, PH, 18);
    this.add.zone(px, py, PW, PH).setOrigin(0).setInteractive();   // swallows taps on the panel itself so they do not reach the dim layer

    // ---- left column: avatar + name, concept, HP, stats ----
    const lx = px + PAD, lw = 232, top = py + PAD;
    const AV = 104;   // avatar ring diameter
    const avKey = 'hud_avatar_' + RUN.char, avTex = this.textures.exists(avKey) ? avKey : ('avatar_' + RUN.char);
    g.fillStyle(0x000000, 0.35); g.fillCircle(lx + AV / 2, top + AV / 2 + 2, AV / 2 + 2);
    g.lineStyle(4, 0xffc94a, 1); g.strokeCircle(lx + AV / 2, top + AV / 2, AV / 2);
    if (this.textures.exists(avTex)) this.add.image(lx + AV / 2, top + AV / 2, avTex).setDisplaySize(AV - 8, AV - 8);
    const nx = lx + AV + 16, ncy = top + AV / 2;
    T(nx, ncy - 14, ch.name_zh, 24, '#ffffff').setOrigin(0, 0.5);
    T(nx, ncy + 16, '第 ' + RUN.level + ' / ' + GAME_DATA.levels.length + ' 關', 14, SEC).setOrigin(0, 0.5);
    let y = top + AV + 16;
    const cc = T(lx, y, ch.concept_zh || '', 14, '#ffe9a8', { wordWrap: { width: lw }, lineSpacing: 4 });
    y += Math.max(cc.height, 18) + 16;
    g.fillStyle(0xffffff, 0.14); g.fillRect(lx, y, lw, 1); y += 13;
    const ROW = 26;   // one label (14, left) + value (18, right-aligned) per row
    const hpMax = Math.round(st.max_hp);
    const stats = [
      ['生命', Math.max(0, Math.round(RUN.hp)) + ' / ' + hpMax],
      ['攻擊力', Math.round(st.attack_damage * 10) / 10],
      ['攻擊速度', (st.attack_speed >= 0 ? '+' : '') + Math.round(st.attack_speed * 100) + '%'],
      ['暴擊率', Math.round(st.crit_chance * 100) + '%'],
      ['暴擊傷害', '×' + Math.round(st.crit_multiplier * 100) / 100],
      ['防禦（減傷）', Math.round(st.defense_pct * 100) + '%'],
      ['移動速度', Math.round(st.move_speed)],
      ['攻擊範圍', Math.round(st.attack_range)],
      ['吸血', Math.round(st.lifesteal * 1000) / 10 + '%']
    ];
    stats.forEach((r, i) => {
      const cy = y + i * ROW + ROW / 2;
      T(lx, cy, r[0], 14, SEC).setOrigin(0, 0.5); T(lx + lw, cy, String(r[1]), 18, '#ffffff').setOrigin(1, 0.5);
    });

    // ---- close (X, on the panel's top-right corner) and the continue button ----
    const cx = px + PW - 6, cy = py + 6;
    g.fillStyle(0x2a3a5c, 1); g.fillCircle(cx, cy, 16); g.lineStyle(2, 0xffffff, 0.7); g.strokeCircle(cx, cy, 16);
    g.lineStyle(2.5, 0xffffff, 0.95); g.lineBetween(cx - 6, cy - 6, cx + 6, cy + 6); g.lineBetween(cx - 6, cy + 6, cx + 6, cy - 6);
    this.add.zone(cx - 24, cy - 24, 48, 48).setOrigin(0).setInteractive({ useHandCursor: true }).on('pointerdown', this._close);
    const bw = 176, bh = 36, bx = px + PW / 2 - bw / 2, by = py + PH - PAD - bh;
    g.fillStyle(0x2f6fc8, 1); g.fillRoundedRect(bx, by, bw, bh, 18); g.lineStyle(2, 0xffffff, 0.9); g.strokeRoundedRect(bx, by, bw, bh, 18);
    T(bx + bw / 2, by + bh / 2, '繼續遊戲', 18, '#ffffff').setOrigin(0.5);
    this.add.zone(bx, by, bw, bh).setOrigin(0).setInteractive({ useHandCursor: true }).on('pointerdown', this._close);
    this.input.keyboard.on('keydown-ESC', this._close);
    PWA.mkButtons(this, bx + bw + 16, by + bh / 2, 'l');   // fullscreen / install buttons (pwa.js), right of the continue button

    // ---- right column: scrollable list (top aligned with the left column, bottom 16 px above the button) ----
    const vx = lx + lw + PAD, vy = top, vw = px + PW - PAD - vx - 12, vh = by - 16 - vy;
    const list = this.add.container(vx, vy);
    let ly = 0;
    const section = (title) => {
      if (ly > 0) ly += 12;
      list.add(this.add.rectangle(0, ly + 11, 5, 20, 0xffc94a).setOrigin(0, 0.5));
      list.add(T(16, ly + 11, title, 18, '#ffc94a').setOrigin(0, 0.5));
      ly += 32;
    };
    // one row: 44 px icon box at x 0, text at x 56: title (18) + tag (14) on one line, stat line (14, green), description (14); rows 12 px apart
    const TX = 56, TW = vw - TX;
    const row = (iconKey, titleStr, titleCol, tagStr, statStr, descStr, edge) => {
      const t0 = ly;
      const t1 = T(TX, t0 + 11, titleStr, 18, titleCol).setOrigin(0, 0.5); list.add(t1);
      if (tagStr) list.add(T(TX + t1.width + 10, t0 + 11, tagStr, 14, SEC).setOrigin(0, 0.5));
      let ty = t0 + 28;
      if (statStr) { const s2 = T(TX, ty, statStr, 14, '#7fe0a0', { wordWrap: { width: TW }, lineSpacing: 3 }); list.add(s2); ty += s2.height + 4; }
      if (descStr) { const d = T(TX, ty, descStr, 14, '#d6e2f2', { wordWrap: { width: TW }, lineSpacing: 3 }); list.add(d); ty += d.height; }
      const h = Math.max(48, ty - t0);
      const box = this.add.graphics(); box.fillStyle(0x000000, 0.4); box.fillRoundedRect(0, t0, 44, 44, 8); box.lineStyle(2, edge == null ? 0x8aa0c0 : edge, edge == null ? 0.5 : 1); box.strokeRoundedRect(0, t0, 44, 44, 8);
      list.add(box);
      if (iconKey && this.textures.exists(iconKey)) list.add(this.add.image(22, t0 + 22, iconKey).setDisplaySize(38, 38));
      ly = t0 + h + 12;
    };

    const sk = ch.skill;
    section('技能');
    row(this.textures.exists('skill_' + sk.id) ? 'skill_' + sk.id : null, sk.name_zh, '#ffe9a8', '冷卻 ' + sk.cooldown + ' 秒', '', sk.desc_zh + (sk.flavor_zh ? '\n「' + sk.flavor_zh + '」' : ''), 0xffc94a);

    section('裝備');
    const slotList = [['武器', RUN.inv.weapon], ['防具', RUN.inv.armor], ['鞋子', RUN.inv.boots], ['飾品', RUN.inv.charms[0]], ['飾品', RUN.inv.charms[1]]];
    slotList.forEach((s) => {
      const it = s[1] ? GAME_DATA.equipment[s[1]] : null;
      if (!it) { row(null, '（空）', '#7f93b0', s[0], '', '', null); return; }
      row('icon_' + it.id, it.name_zh, '#' + RARITY_COLOR[it.rarity].toString(16).padStart(6, '0'), s[0] + ' · ' + (CP_RARITY_NAME[it.rarity] || it.rarity), cpStatLine(it.stats, 1), it.desc_zh, RARITY_COLOR[it.rarity]);
    });

    const buffIds = Object.keys(RUN.buffs).filter((id) => RUN.buffs[id] > 0 && GAME_DATA.buffs[id]);
    section('Buff（' + buffIds.length + ' 種）');
    if (!buffIds.length) row(null, '（尚無）', '#7f93b0', '', '', '', null);
    buffIds.forEach((id) => {
      const b = GAME_DATA.buffs[id], n = RUN.buffs[id];
      row('icon_' + id, b.name_zh + ' ×' + n, '#' + RARITY_COLOR[b.rarity].toString(16).padStart(6, '0'), b.max_stacks ? '上限 ' + b.max_stacks + ' 層' : '', cpStatLine(b.stats, n), b.desc_zh, RARITY_COLOR[b.rarity]);
    });

    const shopIds = Object.keys(RUN.shop || {}).filter((id) => GAME_DATA.shop && GAME_DATA.shop[id]);
    if (shopIds.length) {
      section('商店道具（本關生效）');
      shopIds.forEach((id) => { const it = GAME_DATA.shop[id]; row(this.textures.exists('icon_' + id) ? 'icon_' + id : null, it.name_zh, '#ffd24a', '', '', it.desc_zh, 0xffd24a); });
    }
    const contentH = Math.max(0, ly - 12);

    // mask + scroll
    const mg = this.make.graphics({ x: 0, y: 0, add: false }); mg.fillStyle(0xffffff); mg.fillRect(vx, vy, vw + 14, vh);
    list.setMask(mg.createGeometryMask());
    const maxScroll = Math.max(0, contentH - vh);
    let scroll = 0;
    const bar = this.add.graphics();
    const apply = () => {
      scroll = Math.max(0, Math.min(maxScroll, scroll)); list.y = vy - scroll;
      bar.clear();
      if (maxScroll > 0) {
        const th = Math.max(30, vh * vh / contentH), ty = vy + (vh - th) * (scroll / maxScroll);
        bar.fillStyle(0xffffff, 0.12); bar.fillRoundedRect(vx + vw + 8, vy, 6, vh, 3);
        bar.fillStyle(0xffffff, 0.55); bar.fillRoundedRect(vx + vw + 8, ty, 6, th, 3);
      }
    };
    apply();
    this.input.on('wheel', (p, objs, dx, dy) => { scroll += dy * 0.6; apply(); });
    let dragY = null;
    this.input.on('pointerdown', (p) => { if (p.x >= vx && p.x <= vx + vw + 14 && p.y >= vy && p.y <= vy + vh) dragY = p.y; });
    this.input.on('pointermove', (p) => { if (dragY != null && p.isDown) { scroll -= p.y - dragY; dragY = p.y; apply(); } });
    this.input.on('pointerup', () => { dragY = null; });
    this.input.keyboard.on('keydown-DOWN', () => { scroll += 40; apply(); });
    this.input.keyboard.on('keydown-UP', () => { scroll -= 40; apply(); });
  }
}

// How-to-play overlay (user 2026-10-12): the first time level 1 starts in a run, the level is paused and this scene is drawn over it - a translucent dark mask with holes (spotlights) on the HUD,
// the player and the touch controls, text guides pointing at them, and an OK button.  OK / Enter / a tap on OK resumes the level.  Opened from LevelScene.create (level.js), once per run (RUN._howto).
// Same look as the character panel (charpanel.js): dark navy rounded boxes, white 25 % border, bold text with a dark outline, yellow accent.
class HowToScene extends Phaser.Scene {
  constructor() { super('HowTo'); }

  init(data) { this._from = (data && data.from) || 'Level'; this._t0 = Date.now(); this._closed = false; this._mode = (data && data.mode) || 'touch'; }

  create() {
    const GW = (typeof GAME_W !== 'undefined' && GAME_W) ? GAME_W : 960, F = 'Microsoft JhengHei, PingFang TC, sans-serif', SEC = '#9fb4d0', GOLD = 0xffc94a;
    const lvl = this.scene.get(this._from), hasTouch = !!(lvl && lvl.touch);
    const TS = (x, y, str, sz, col, extra) => this.add.text(x, y, str, Object.assign({ fontFamily: F, fontSize: sz + 'px', fontStyle: 'bold', color: col || '#ffffff', stroke: '#0a1224', strokeThickness: 3 }, extra || {}));
    this._close = () => {
      if (this._closed) return; this._closed = true;
      if (this._from === 'Level' && RUN.levelStats && RUN.levelStats.startMs) RUN.levelStats.startMs += Date.now() - this._t0;   // the level timer does not count the time spent here (opened from the pause panel / title: not the level's business)
      if (lvl && lvl.touch && lvl.touch.reset) lvl.touch.reset();
      this.scene.stop(); this.scene.resume(this._from);
    };

    // ---- static layer: the mask texture, a tap-swallowing zone, the OK button and the three view tabs ----
    const rt = this.add.renderTexture(0, 0, GW, 540).setOrigin(0, 0).setDepth(0);
    this.add.zone(0, 0, GW, 540).setOrigin(0).setInteractive().setDepth(1);   // swallows taps outside the buttons
    const bw2 = 176, bh = 38, obx = GW / 2 - bw2 / 2, oby = 490;
    const okg = this.add.graphics().setDepth(5);
    okg.fillStyle(0x2f6fc8, 1); okg.fillRoundedRect(obx, oby, bw2, bh, 19); okg.lineStyle(2, 0xffffff, 0.9); okg.strokeRoundedRect(obx, oby, bw2, bh, 19);
    TS(obx + bw2 / 2, oby + bh / 2, 'OK', 22, '#ffffff').setOrigin(0.5).setDepth(6);
    this.add.zone(obx, oby, bw2, bh).setOrigin(0).setInteractive({ useHandCursor: true }).setDepth(7).on('pointerdown', this._close);
    if (this._from === 'Level') this.input.keyboard.on('keydown-ENTER', this._close);   // from the title screen Enter would also start the game
    // tabs (bottom right): 手機操作 (default) / 電腦操作 / 安裝到桌面
    const tabs = [['touch', '手機操作'], ['keys', '電腦操作'], ['install', '安裝到桌面']], tabG = this.add.graphics().setDepth(5), tabT = [];
    const TW = 112, TH = 34, TX0 = GW - 24 - 3 * TW - 2 * 6, TY = oby + 2;
    const drawTabs = () => {
      tabG.clear();
      tabs.forEach((t, i) => {
        const x = TX0 + i * (TW + 6), on = this._mode === t[0];
        tabG.fillStyle(on ? 0x2f6fc8 : 0x121f3a, 1); tabG.fillRoundedRect(x, TY, TW, TH, 17); tabG.lineStyle(2, 0xffffff, on ? 0.9 : 0.3); tabG.strokeRoundedRect(x, TY, TW, TH, 17);
        tabT[i].setColor(on ? '#ffffff' : '#9fb4d0');
      });
    };
    tabs.forEach((t, i) => {
      const x = TX0 + i * (TW + 6);
      tabT.push(TS(x + TW / 2, TY + TH / 2, t[1], 16, '#9fb4d0').setOrigin(0.5).setDepth(6));
      this.add.zone(x, TY, TW, TH).setOrigin(0).setInteractive({ useHandCursor: true }).setDepth(7).on('pointerdown', () => { if (this._mode !== t[0]) { this._mode = t[0]; build(); } });
    });
    TS(24, TY + TH / 2, '切換說明 ▶', 14, '#9fb4d0').setOrigin(0, 0.5).setDepth(6).setVisible(false);

    // ---- dynamic layer: rebuilt whenever the view changes ----
    let dyn = [];
    const D = (o) => { dyn.push(o); return o; };
    const T = (x, y, str, sz, col, extra) => D(TS(x, y, str, sz, col, extra));
    const build = () => {
      dyn.forEach((o) => { if (o.active !== false) { this.tweens.killTweensOf(o); o.destroy(); } }); dyn = [];
      drawTabs();
      const mode = this._mode;
      const holes = this.make.graphics({ x: 0, y: 0, add: false }); holes.fillStyle(0xffffff, 1);
      const BXs = GW - 90, RX = GW - 242;   // the touch buttons sit at GW - 90 (touch.js); the right-hand callout column is anchored to the right edge: this page is laid out for any screen width, not only 960
      const spots = [];
      if (mode !== 'install') { spots.push([4, 4, 372, 156, 16], [262, 336, 96, 130, 14]); if (mode === 'touch') spots.push([BXs - 124 - 62, 333 - 62, Math.min(62 + 124 + 62 + 62, GW - 4 - (BXs - 124 - 62)), 62 + 107 + 62 + 12, 20], [150 - 78, 410 - 56, 156, 112, 20]); }   // HUD, the player, (touch view) the buttons and the walk pad
      spots.forEach((r) => holes.fillRoundedRect(r[0], r[1], r[2], r[3], r[4]));
      rt.clear(); rt.fill(0x000000, mode === 'install' ? 0.8 : 0.66); if (spots.length) rt.erase(holes); holes.destroy();
      if (spots.length) {
        const glow = D(this.add.graphics().setDepth(2));
        spots.forEach((r) => { glow.lineStyle(6, GOLD, 0.25); glow.strokeRoundedRect(r[0], r[1], r[2], r[3], r[4]); glow.lineStyle(3, GOLD, 1); glow.strokeRoundedRect(r[0], r[1], r[2], r[3], r[4]); });
        this.tweens.add({ targets: glow, alpha: { from: 1, to: 0.45 }, duration: 700, yoyo: true, repeat: -1 });
      }
      const box = D(this.add.graphics().setDepth(3));
      const callout = (x, y, w, title, body, arrow) => {
        const bt = T(x + 16, y + 38, body, 18, '#ffffff', { wordWrap: { width: w - 32, useAdvancedWrap: true }, lineSpacing: 3 }).setDepth(4); T(x + 16, y + 10, title, 20, '#ffc94a').setDepth(4);
        const h = 38 + bt.height + 14;
        box.fillStyle(0x0a1224, 0.96); box.fillRoundedRect(x, y, w, h, 14); box.lineStyle(2, 0xffffff, 0.25); box.strokeRoundedRect(x, y, w, h, 14);
        box.fillStyle(GOLD, 1); box.fillRoundedRect(x, y + 10, 5, 20, 2);
        if (arrow) {
          const [ax, ay, bx, by] = arrow, an = Math.atan2(by - ay, bx - ax);
          box.lineStyle(3, GOLD, 1); box.lineBetween(ax, ay, bx, by);
          box.fillStyle(GOLD, 1); box.fillTriangle(bx, by, bx - 12 * Math.cos(an - 0.45), by - 12 * Math.sin(an - 0.45), bx - 12 * Math.cos(an + 0.45), by - 12 * Math.sin(an + 0.45));
        }
        return h;
      };

      if (mode === 'install') { this._buildInstall(box, T, callout); return; }

      // numbered gold dots on the HUD parts that are explained (1 life bar / avatar, 2 enemies, 3 coins)
      const dot = (n, x, y) => { box.fillStyle(GOLD, 1); box.fillCircle(x, y, 12); box.lineStyle(2, 0x0a1224, 1); box.strokeCircle(x, y, 12); T(x, y, String(n), 16, '#0a1224', { stroke: '#ffc94a', strokeThickness: 0 }).setOrigin(0.5).setDepth(4); };
      dot(1, 22, 22); dot(2, 140, 138); dot(3, 262, 138);
      let cy = 12;
      cy += callout(396, cy, 306, '① 血條與頭像', '紅色血條歸零就失敗；點頭像可暫停，看角色數值。') + 10;
      cy += callout(396, cy, 306, '② 敵人', '場上剩幾隻；全打倒後出口箭頭出現，走到畫面右端過關。') + 10;
      callout(396, cy, 306, '③ 金幣', '撿金幣；過關後可刷新獎勵。');
      let cy2 = 12;
      cy2 += callout(RX, cy2, 234, '跳出的數字', '白＝你打出的傷害\n黃＝暴擊\n紅＝你受到的傷害') + 10;
      callout(RX, cy2, 234, '地上的坑', '尖刺：扣血並送回洞前\n鵝卵石：減速\n火焰、毒液：持續扣血');
      T(310, 318, '這是你', 18, '#ffc94a').setOrigin(0.5, 1).setDepth(4);
      box.fillStyle(GOLD, 1); box.fillTriangle(310, 332, 300, 320, 320, 320);

      if (mode === 'touch') {   // touch controls: the walk pad on the left half, three buttons at the bottom right
        if (!hasTouch) this._mockTouch(box);   // on a computer the level has no touch controls: draw them so the highlighted places are not empty
        callout(16, 248, 236, '左半邊螢幕', '按住往左右滑動就會移動。', [140, 344, 140, 356]);
        callout(396, 332, 270, '右下三顆按鈕', '上＝跳躍　左＝技能　右＝攻擊。從上方跳踩在敵人頭上，也能攻擊（魔王除外）。', [666, 400, BXs - 124 - 62 - 4, 416]);
      } else {                   // keyboard
        const bx = 396, by = 328, bw = GW - 396 - 8, bh2 = 152;
        box.fillStyle(0x0a1224, 0.96); box.fillRoundedRect(bx, by, bw, bh2, 14); box.lineStyle(2, 0xffffff, 0.25); box.strokeRoundedRect(bx, by, bw, bh2, 14);
        box.fillStyle(GOLD, 1); box.fillRoundedRect(bx, by + 10, 5, 20, 2);
        T(bx + 16, by + 10, '鍵盤操作', 20, '#ffc94a').setDepth(4);
        const cap = (x, y, label, w) => { box.fillStyle(0x2a3a5c, 1); box.fillRoundedRect(x, y, w, 30, 6); box.lineStyle(2, 0xffffff, 0.6); box.strokeRoundedRect(x, y, w, 30, 6); T(x + w / 2, y + 15, label, 16, '#ffffff').setOrigin(0.5).setDepth(4); return x + w + 6; };
        const label = (x, y, str) => T(x, y + 15, str, 18, SEC).setOrigin(0, 0.5).setDepth(4);
        const y1 = by + 46, y2 = by + 84, rx = bx + 300;
        label(bx + 16, y1, '移動'); let x = bx + 70; x = cap(x, y1, '←', 34); x = cap(x, y1, '→', 34); label(x + 2, y1, '/'); x += 22; x = cap(x, y1, 'A', 34); cap(x, y1, 'D', 34);
        label(rx, y1, '跳躍'); x = rx + 56; x = cap(x, y1, '↑', 34); x = cap(x, y1, 'W', 34); cap(x, y1, '空白鍵', 66);
        label(bx + 16, y2, '攻擊'); cap(bx + 70, y2, 'J', 34);
        label(rx, y2, '技能'); cap(rx + 56, y2, 'K', 34); T(rx + 104, y2 + 15, '（冷卻中顯示倒數）', 14, SEC).setOrigin(0, 0.5).setDepth(4);
        const y3 = by + 120; label(bx + 16, y3, '踩踏'); T(bx + 70, y3 + 15, '從上方跳到敵人頭上，也能攻擊（魔王除外）', 18, '#ffffff').setOrigin(0, 0.5).setDepth(4);
      }
    };
    build();
  }

  // illustration of the touch controls (pad hint + the three round buttons, same places and glyphs as touch.js) for the touch view when the player is on a computer
  _mockTouch(box) {
    const GW = (typeof GAME_W !== 'undefined' && GAME_W) ? GAME_W : 960, BX = GW - 90;   // same anchor as touch.js
    const ink = (w, a) => box.lineStyle(w, 0xffffff, a == null ? 0.95 : a);
    const circ = (x, y, r) => { box.fillStyle(0x000000, 0.35); box.fillCircle(x, y, r); box.lineStyle(2, 0xffffff, 0.55); box.strokeCircle(x, y, r); };
    circ((BX - 62), 333, 56); ink(6); [[-9, 8], [-9, -4]].forEach((o) => { box.beginPath(); box.moveTo((BX - 62) - 18, 333 + o[1] + 6); box.lineTo((BX - 62), 333 + o[1] - 10 + 6); box.lineTo((BX - 62) + 18, 333 + o[1] + 6); box.strokePath(); });   // jump: two chevrons
    circ((BX - 124), 440, 56); box.fillStyle(0xffffff, 0.95); box.fillTriangle((BX - 124), 440 - 26, (BX - 124) + 9, 440 - 9, (BX - 124) - 9, 440 - 9); box.fillTriangle((BX - 124) + 26, 440, (BX - 124) + 9, 440 + 9, (BX - 124) + 9, 440 - 9); box.fillTriangle((BX - 124), 440 + 26, (BX - 124) - 9, 440 + 9, (BX - 124) + 9, 440 + 9); box.fillTriangle((BX - 124) - 26, 440, (BX - 124) - 9, 440 - 9, (BX - 124) - 9, 440 + 9); box.fillRect((BX - 124) - 9, 440 - 9, 18, 18);   // skill: four-point star
    circ(BX, 440, 56); ink(7); box.lineBetween(BX - 4, 440 + 4, BX + 22, 440 - 22); ink(6); box.lineBetween(BX - 17, 440 - 5, BX + 5, 440 + 17); ink(8); box.lineBetween(BX - 8, 440 + 8, BX - 19, 440 + 19);   // attack: a sword
    box.fillStyle(0x000000, 0.35); box.fillRoundedRect(150 - 78, 410 - 36, 156, 72, 36); box.lineStyle(2, 0xffffff, 0.55); box.strokeRoundedRect(150 - 78, 410 - 36, 156, 72, 36);   // walk pad: a pill with a knob
    box.fillStyle(0xffffff, 0.9); box.fillCircle(150, 410, 22); ink(4, 0.8); box.lineBetween(150 - 60, 410, 150 - 36, 410); box.lineBetween(150 + 36, 410, 150 + 60, 410);
  }

  // "安裝到桌面": how to add the game to the home screen on Android (Chrome) and iOS (Safari)
  _buildInstall(box, T, callout) {
    const GW = (typeof GAME_W !== 'undefined' && GAME_W) ? GAME_W : 960, GOLD = 0xffc94a, pw = 880, px = Math.round((GW - pw) / 2), py = 16, ph = 462;
    box.fillStyle(0x0a1224, 0.97); box.fillRoundedRect(px, py, pw, ph, 18); box.lineStyle(2, 0xffffff, 0.25); box.strokeRoundedRect(px, py, pw, ph, 18);
    T(px + 24, py + 30, '安裝到桌面', 28, '#ffffff').setOrigin(0, 0.5).setDepth(4);
    T(px + 24, py + 62, '加到主畫面後，從桌面圖示開啟就是全螢幕、不用再輸入網址。請先把手機橫放。', 18, '#9fb4d0').setOrigin(0, 0.5).setDepth(4);
    const col = (x, title, sub, steps) => {
      box.fillStyle(0x121f3a, 1); box.fillRoundedRect(x, py + 88, 408, 318, 14); box.lineStyle(2, 0xffffff, 0.18); box.strokeRoundedRect(x, py + 88, 408, 318, 14);
      box.fillStyle(GOLD, 1); box.fillRoundedRect(x, py + 100, 5, 22, 2);
      const tt = T(x + 18, py + 111, title, 22, '#ffc94a').setOrigin(0, 0.5).setDepth(4); T(x + 18 + tt.width + 12, py + 112, sub, 16, '#9fb4d0').setOrigin(0, 0.5).setDepth(4);
      let y = py + 144;
      steps.forEach((st, i) => {
        box.fillStyle(GOLD, 1); box.fillCircle(x + 30, y + 16, 14); T(x + 30, y + 16, String(i + 1), 18, '#0a1224', { stroke: '#ffc94a', strokeThickness: 0 }).setOrigin(0.5).setDepth(4);
        const tx = T(x + 56, y + 3, st, 18, '#ffffff', { wordWrap: { width: 336, useAdvancedWrap: true }, lineSpacing: 3 }).setDepth(4);
        y += Math.max(40, tx.height + 12);
      });
    };
    col(px + 24, 'Android', 'Chrome 瀏覽器', ['用 Chrome 開啟遊戲網址。', '點右上角的「⋮」選單。', '選「安裝應用程式」（舊版叫「加到主畫面」）。', '確認後，桌面會出現遊戲圖示，點它就能全螢幕玩。']);
    col(px + 24 + 408 + 16, 'iPhone / iPad', 'Safari 瀏覽器', ['一定要用 Safari 開啟遊戲網址（其他瀏覽器沒有這個選項）。', '點網址列旁或下方的「分享」鈕（方框加向上箭頭）。', '往下滑，選「加入主畫面」。', '點右上角「新增」，桌面就會出現遊戲圖示。']);
    if (window.DEMO) T(px + pw / 2, py + 430, '試玩版網址：https://tabrislee-create.github.io/Taipeifunnygame/', 16, '#ffd966').setOrigin(0.5).setDepth(4);
  }
}
