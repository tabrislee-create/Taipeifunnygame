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
