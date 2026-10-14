class ChoiceScene extends Phaser.Scene {
  constructor() { super('Choice'); }
  init(data) {
    this._sel = false;
    this._confirming = false;
    this._cards = [];
    this._cleared = data.cleared;
    this._shopItems = [];
    this._bossHint = null;
    this._coinText = null;
    this._refreshBtn = null;
    this._shopCards = [];

    // Reset shop state for the new level
    RUN.shop = {};

    // Pick 2 random shop items
    var shopIds = Object.keys(GAME_DATA.shop || {});
    if (shopIds.length >= 2) {
      var idx1 = Math.floor(Math.random() * shopIds.length);
      var idx2 = Math.floor(Math.random() * shopIds.length);
      while (idx2 === idx1) idx2 = Math.floor(Math.random() * shopIds.length);
      this._shopItems = [GAME_DATA.shop[shopIds[idx1]], GAME_DATA.shop[shopIds[idx2]]];
    } else if (shopIds.length === 1) {
      this._shopItems = [GAME_DATA.shop[shopIds[0]], null];
    }

    // Check for boss hint
    var nextLevel = this._cleared + 1;
    var isBossLevel = false;
    if (GAME_DATA.bosses) {
      var bossKeys = Object.keys(GAME_DATA.bosses);
      for (var i = 0; i < bossKeys.length; i++) {
        if (GAME_DATA.bosses[bossKeys[i]].level === nextLevel) {
          isBossLevel = true;
          break;
        }
      }
    }
    if (isBossLevel && GAME_DATA.bossHints && GAME_DATA.bossHints.length > 0) {
      this._bossHint = GAME_DATA.bossHints[Math.floor(Math.random() * GAME_DATA.bossHints.length)];
    }
  }

  create() {
    this.cameras.main.fadeIn(300);
    var bg = this.add.graphics();
    bg.fillGradientStyle(0x1f4d2b, 0x1f4d2b, 0x8fd18f, 0x8fd18f, 1);
    bg.fillRect(0, 0, GAME_W, 540);
    bg.setDepth(-50);
    this._bg = WX.start(this, 'title');

    // Look follows the character panel (charpanel.js): one dark rounded panel, white 25 % border, 24 px padding, bold text with a dark outline, yellow accent bars before the section titles.
    // Type sizes (user 2026-10-12: 字體盡量加大): title 28, section 22, item name 22, tags / descriptions / buttons 18, small notes 16.
    var F = FONT, SEC = '#9fb4d0', self0 = this;
    // 大字版 (2026-10-14, 24 px text): the longest description (~30 characters) must stay at 3 lines -> a wider panel (up to 940) and cards, the panel uses nearly the whole height,
    // tighter gaps between the rows; everything still fits on one screen (no scrolling, so a tap on a card is never mistaken for a drag)
    var big = this._big = !!window.__bigText;
    var PW = big ? Math.min(GAME_W - 20, 940) : 880, PH = big ? 524 : 490, PX = Math.round((GAME_W - PW) / 2), PY = big ? 4 : 25, PAD = 24, GAP = 17;
    this._L = { PX: PX, PY: PY, PW: PW, PH: PH, PAD: PAD, CW: big ? Math.floor((PW - 2 * PAD - 2 * GAP) / 3) : 266, GAP: GAP, CY0: PY + (big ? 96 : 70 + 36), CH: big ? 244 : 212 };
    var T = function (x, y, str, sz, col, extra) { return self0.add.text(x, y, str, Object.assign({ fontFamily: F, fontSize: sz + 'px', fontStyle: 'bold', color: col || '#ffffff', stroke: '#0a1224', strokeThickness: 3 }, extra || {})); };
    this._T = T;
    this.add.rectangle(GAME_W / 2, 270, GAME_W, 540, 0x000000, 0.45).setDepth(-40);
    var pg = this.add.graphics();
    pg.fillStyle(0x0a1224, 0.97); pg.fillRoundedRect(PX, PY, PW, PH, 18);
    pg.lineStyle(2, 0xffffff, 0.25); pg.strokeRoundedRect(PX, PY, PW, PH, 18);

    var lvl = GAME_DATA.levels[this._cleared - 1];
    T(PX + PAD, PY + PAD + 14, '第 ' + lvl.n + ' / ' + GAME_DATA.levels.length + ' 關完成！', 28, '#ffffff').setOrigin(0, 0.5);

    // coin pill (same look as the HUD pills): two coins + the amount
    var cpw = 160, cph = 42, cpx = PX + PW - PAD - cpw, cpy = PY + PAD - 2;
    pg.fillStyle(0x0a1224, 0.58); pg.fillRoundedRect(cpx, cpy, cpw, cph, 18); pg.lineStyle(1.5, 0xffffff, 0.22); pg.strokeRoundedRect(cpx, cpy, cpw, cph, 18);
    for (var ck = 0; ck < 2; ck++) {
      var cyy = cpy + cph / 2 + 4 - ck * 6, ccx = cpx + 28;
      pg.fillStyle(0xb87a00, 1); pg.fillRect(ccx - 11, cyy - 1, 22, 5); pg.fillEllipse(ccx, cyy + 4, 22, 8);
      pg.fillStyle(0xffd24a, 1); pg.fillEllipse(ccx, cyy, 22, 8); pg.lineStyle(1.2, 0x8a5a00, 1); pg.strokeEllipse(ccx, cyy, 22, 8);
    }
    this._coinText = T(cpx + cpw - 18, cpy + cph / 2, String(RUN.coins || 0), 24, '#ffd24a').setOrigin(1, 0.5);

    var section = function (y, title) {
      self0.add.rectangle(PX + PAD, y + 12, 5, 24, 0xffc94a).setOrigin(0, 0.5);
      T(PX + PAD + 16, y + 12, title, 22, '#ffc94a').setOrigin(0, 0.5);
    };
    section(PY + (big ? 62 : 70), '獎勵');
    this._buildCards();

    var shopY = this._L.CY0 + this._L.CH + (big ? 8 : 12);   // below the three reward cards
    section(shopY, '商店');
    var sy = shopY + (big ? 32 : 36), SH = big ? 84 : 78, CW = this._L.CW, GAP = this._L.GAP, sx0 = PX + PAD;
    this._shopY = sy; this._shopH = SH;
    this._shopGfx = this.add.graphics();

    // Refresh button (slot 1): the only thing the shop sells in the trial build
    var rcx = sx0 + CW / 2, rcy = sy + SH / 2;
    var refreshRect = this.add.rectangle(rcx, rcy, CW, SH, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
    var refreshText = T(rcx, rcy, '刷新獎勵（10 金）', 22, '#ffffff').setOrigin(0.5);
    this._refreshBtn = { rect: refreshRect, text: refreshText, x: sx0, y: sy, w: CW, h: SH };
    refreshRect.on('pointerdown', function () { this._refreshChoices(); }.bind(this));

    this._shopCards = [];
    for (var si = 0; si < 2; si++) {
      var bx = sx0 + (si + 1) * (CW + GAP), bcx = bx + CW / 2, bcy = sy + SH / 2;
      if (window.DEMO) {   // trial build: the shop items are not ready yet - a construction icon and "施工中"
        pg.fillStyle(0x0d1730, 1); pg.fillRoundedRect(bx, sy, CW, SH, 14); pg.lineStyle(2, 0x8aa0c0, 0.3); pg.strokeRoundedRect(bx, sy, CW, SH, 14);
        var ix = bx + 50, iy = sy + SH / 2 + 4;   // traffic-cone: dark base, orange body with two white bands, small tip
        pg.fillStyle(0x1b2540, 1); pg.fillRoundedRect(ix - 24, iy + 20, 48, 9, 3);
        pg.fillStyle(0xff8a1a, 1); pg.fillTriangle(ix - 17, iy + 22, ix + 17, iy + 22, ix, iy - 26);
        pg.fillStyle(0xffffff, 1); pg.fillTriangle(ix - 11.5, iy + 3, ix + 11.5, iy + 3, ix + 8.5, iy - 7); pg.fillTriangle(ix - 11.5, iy + 3, ix - 8.5, iy - 7, ix + 8.5, iy - 7);
        pg.fillTriangle(ix - 15, iy + 15, ix + 15, iy + 15, ix + 11.5, iy + 6); pg.fillTriangle(ix - 15, iy + 15, ix - 11.5, iy + 6, ix + 11.5, iy + 6);
        pg.fillStyle(0x16233f, 1); pg.fillCircle(ix, iy - 27, 3);
        T(bx + 100 + (CW - 100) / 2, sy + SH / 2, '施工中', 24, '#9fb4d0').setOrigin(0.5);
        continue;
      }
      var sRect = this.add.rectangle(bcx, bcy, CW, SH, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
      var sName = T(bx + 16, sy + 10, '', 20, '#ffffff').setOrigin(0, 0);
      var sDesc = T(bx + 16, sy + (big ? 44 : 38), '', 16, SEC, { wordWrap: { width: CW - 32, useAdvancedWrap: true }, lineSpacing: 2 }).setOrigin(0, 0);
      var sPrice = T(bx + CW - 16, sy + 10, '', 20, '#ffd24a').setOrigin(1, 0);
      var sBought = T(bcx, bcy, '已購買', 22, '#ffffff', { backgroundColor: '#000000aa', padding: { x: 12, y: 5 } }).setOrigin(0.5).setVisible(false);
      this._shopCards.push({ rect: sRect, nameT: sName, descT: sDesc, priceT: sPrice, boughtT: sBought, item: this._shopItems[si], x: bx, y: sy, w: CW, h: SH });
      (function (idx) { sRect.on('pointerdown', function () { self0._buyShopItem(idx); }); })(this._shopCards.length - 1);
    }

    if (this._bossHint) {
      var hint = T(GAME_W / 2, PY + PH - PAD - 2, this._bossHint, 18, '#ffd966', { wordWrap: { width: PW - 2 * PAD - 40, useAdvancedWrap: true }, align: 'center' }).setOrigin(0.5);
      var hb = this.add.graphics(); hb.fillStyle(0x16233f, 1); hb.fillRoundedRect(GAME_W / 2 - hint.width / 2 - 18, hint.y - hint.height / 2 - 6, hint.width + 36, hint.height + 12, 14);
      hb.lineStyle(1.5, 0xffd966, 0.5); hb.strokeRoundedRect(GAME_W / 2 - hint.width / 2 - 18, hint.y - hint.height / 2 - 6, hint.width + 36, hint.height + 12, 14);
      hint.setDepth(2); hb.setDepth(1);
    }

    var K = this.input.keyboard.addKeys('ONE,TWO,THREE,FOUR,FIVE,SIX');
    var self = this;
    K.ONE.on('down', function () { self._pick(0); });
    K.TWO.on('down', function () { self._pick(1); });
    K.THREE.on('down', function () { self._pick(2); });
    K.FOUR.on('down', function () { self._refreshChoices(); });
    K.FIVE.on('down', function () { self._buyShopItem(0); });
    K.SIX.on('down', function () { self._buyShopItem(1); });

    this._refreshShopUI();
  }

  _buildCards() {
    var choices = drawChoices(this._cleared);
    var L = this._L, self = this, cy = L.CY0 + L.CH / 2;
    for (var i = 0; i < 3; i++) {
      var cx = L.PX + L.PAD + i * (L.CW + L.GAP) + L.CW / 2;
      var card = this._mkRewardCard(choices[i], cx, cy);
      card._zone = this.add.zone(cx, cy, card.w, card.h).setInteractive({ useHandCursor: true });
      (function (card, i, cy) {
        card._zone.on('pointerover', function () { card.cont.y = cy - 6; });
        card._zone.on('pointerout', function () { card.cont.y = cy; });
        card._zone.on('pointerdown', function () { self._pick(i); });
      })(card, i, cy);
      this._cards.push(card);
    }
  }

  // One reward card in the character panel's row style: 52 px icon box (rarity-coloured edge), name (22) + tag (18, rarity colour), description (18), small note at the bottom (16).
  _mkRewardCard(card, x, y) {
    var item = card.item, T = this._T;
    var rc = RARITY_COLOR[item.rarity];
    var W = this._L.CW, H = this._L.CH, PADC = 16, isSim = item.id === 'w_sim_card';
    var cont = this.add.container(x, y);
    var bg = this.add.graphics();
    bg.fillStyle(0x121f3a, 1); bg.fillRoundedRect(-W / 2, -H / 2, W, H, 14);
    bg.lineStyle(2, rc, 0.95); bg.strokeRoundedRect(-W / 2, -H / 2, W, H, 14);
    bg.fillStyle(0x000000, 0.4); bg.fillRoundedRect(-W / 2 + PADC, -H / 2 + PADC, 52, 52, 8);
    bg.lineStyle(2, rc, 1); bg.strokeRoundedRect(-W / 2 + PADC, -H / 2 + PADC, 52, 52, 8);
    cont.add(bg);

    var icon = this.add.sprite(-W / 2 + PADC + 26, -H / 2 + PADC + 26, 'icon_' + item.id);
    icon.setDisplaySize(44, 44);
    cont.add(icon);

    var tx = -W / 2 + PADC + 64;
    cont.add(T(tx, -H / 2 + PADC + 14, item.name_zh, 22, '#ffffff', { wordWrap: { width: W - PADC - 64 - 8 } }).setOrigin(0, 0.5));
    var tagText = isSim ? '特殊攻擊·30 次' : (item.slot ? '裝備·' + SLOT_ZH[item.slot] + ' ' + RARITY_ZH[item.rarity] : '增益 ' + RARITY_ZH[item.rarity]);
    cont.add(T(tx, -H / 2 + PADC + 42, tagText, 18, hexColor(rc)).setOrigin(0, 0.5));

    cont.add(T(-W / 2 + PADC, -H / 2 + PADC + 68, item.desc_zh, 18, '#d6e2f2', { wordWrap: { width: W - PADC - (this._big ? 8 : PADC), useAdvancedWrap: true }, lineSpacing: this._big ? 2 : 3 }).setOrigin(0, 0));

    var bottomText = isSim ? (RUN.simUses > 0 ? '目前剩 ' + RUN.simUses + ' 次，再拿重置為 30' : '用完後恢復普通攻擊') : (item.slot ? '目前：' + (card.current ? card.current.name_zh : '無') : '只作用於下一關');
    cont.add(T(-W / 2 + PADC, H / 2 - PADC + 2, bottomText, 16, '#7f93b0').setOrigin(0, 1));

    return { cont: cont, item: item, card: card, w: W, h: H };
  }

  _refreshShopUI() {
    var coins = RUN.coins || 0;
    if (this._coinText) this._coinText.setText(String(coins));
    var g = this._shopGfx;
    if (g) g.clear();
    var slot = function (o, fill, edge, edgeA) {
      g.fillStyle(fill, 1); g.fillRoundedRect(o.x, o.y, o.w, o.h, 14);
      g.lineStyle(2, edge, edgeA); g.strokeRoundedRect(o.x, o.y, o.w, o.h, 14);
    };

    // Refresh Button: green when affordable, dark and dim otherwise
    if (this._refreshBtn) {
      var rb = this._refreshBtn;
      if (coins >= 10) {
        slot(rb, 0x2a6a3a, 0xffffff, 0.9);
        rb.text.setColor('#ffffff');
        rb.rect.setInteractive({ useHandCursor: true });
      } else {
        slot(rb, 0x121f3a, 0x8aa0c0, 0.35);
        rb.text.setColor('#7f93b0');
        rb.rect.disableInteractive();
      }
    }

    // Shop Items (none in the trial build: the two right-hand slots say 施工中)
    for (var i = 0; i < this._shopCards.length; i++) {
      var sc = this._shopCards[i];
      if (!sc.item) {
        sc.rect.setVisible(false);
        sc.nameT.setVisible(false);
        sc.descT.setVisible(false);
        sc.priceT.setVisible(false);
        sc.boughtT.setVisible(false);
        continue;
      }

      // Update text content
      sc.nameT.setText(sc.item.name_zh);
      sc.descT.setText(sc.item.desc_zh);
      sc.priceT.setText(sc.item.price + ' 金');

      var isBought = RUN.shop && RUN.shop[sc.item.id];
      var canBuy = coins >= sc.item.price && !isBought;

      if (isBought) {
        slot(sc, 0x0d1730, 0x8aa0c0, 0.3);
        sc.nameT.setColor('#7f93b0');
        sc.descT.setColor('#5d6f8a');
        sc.priceT.setColor('#5d6f8a');
        sc.boughtT.setVisible(true);
        sc.rect.disableInteractive();
      } else if (canBuy) {
        slot(sc, 0x1c3a66, 0xffd24a, 0.95);
        sc.nameT.setColor('#ffffff');
        sc.descT.setColor('#d6e2f2');
        sc.priceT.setColor('#ffd24a');
        sc.boughtT.setVisible(false);
        sc.rect.setInteractive({ useHandCursor: true });
      } else {
        slot(sc, 0x121f3a, 0x8aa0c0, 0.35);
        sc.nameT.setColor('#7f93b0');
        sc.descT.setColor('#5d6f8a');
        sc.priceT.setColor('#5d6f8a');
        sc.boughtT.setVisible(false);
        sc.rect.disableInteractive();
      }
    }
  }

  _buyShopItem(index) {
    if (this._sel || this._confirming) return;
    var sc = this._shopCards[index];
    if (!sc || !sc.item) return;
    
    var coins = RUN.coins || 0;
    if (coins < sc.item.price) return;
    if (RUN.shop && RUN.shop[sc.item.id]) return;

    RUN.coins = coins - sc.item.price;
    RUN.shop[sc.item.id] = 1;
    this._refreshShopUI();
  }

  _refreshChoices() {
    if (this._sel || this._confirming) return;
    var coins = RUN.coins || 0;
    if (coins < 10) return;

    RUN.coins = coins - 10;

    // Destroy old cards
    for (var i = 0; i < this._cards.length; i++) {
      if (this._cards[i].cont) this._cards[i].cont.destroy();
      if (this._cards[i]._zone) this._cards[i]._zone.destroy();
    }
    this._cards = [];

    this._buildCards();
    this._refreshShopUI();
  }

  _pick(i) {
    if (this._sel || this._confirming) return;
    var card = this._cards[i].card;
    if (card.kind === 'equip' && card.current && card.item.id !== 'w_sim_card') {
      this._confirmSwap(i);
      return;
    }
    this._commit(i);
  }

  _confirmSwap(i) {
    var self = this, card = this._cards[i].card, oldIt = card.current, newIt = card.item;
    this._confirming = true;
    var cx = GAME_W / 2, objs = [];
    function add(o, d) { o.setDepth(d || 202); objs.push(o); return o; }
    add(this.add.rectangle(cx, 270, GAME_W, 540, 0x000000, 0.7).setInteractive(), 200);
    add(this.add.text(cx, 40, '要置換' + SLOT_ZH[newIt.slot] + '嗎？', { fontFamily: FONT, fontSize: 28, fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5));
    var keys = {}; Object.keys(oldIt.stats || {}).concat(Object.keys(newIt.stats || {})).forEach(function (k) { keys[k] = 1; });
    function panel(it, x, head, other) {
      var W = 400, rc = RARITY_COLOR[it.rarity], y = 76;
      var g = add(self.add.graphics(), 201); g.fillStyle(0x111111, 0.9); g.lineStyle(3, rc, 1);
      var lines = [];
      function line(str, color, bold, wrap) { var t = add(self.add.text(x, y, str, { fontFamily: FONT, fontSize: 21, fontStyle: bold ? 'bold' : 'normal', color: color, wordWrap: wrap ? { width: W - 28, useAdvancedWrap: true } : undefined, align: 'center' }).setOrigin(0.5, 0)); y += t.height + 6; return t; }
      line(head, '#ffd966', true);
      line(it.name_zh, '#ffffff', true);
      line(RARITY_ZH[it.rarity], hexColor(rc));
      line(it.desc_zh, '#cccccc', false, true);
      Object.keys(keys).forEach(function (k) {
        var m = (it.stats || {})[k], o = (other.stats || {})[k];
        var better = k === 'jump_velocity' ? statNum(m) < statNum(o) : statNum(m) > statNum(o);
        var color = statNum(m) === statNum(o) ? '#dddddd' : (it === newIt ? (better ? '#7dff7d' : '#ff8a8a') : '#dddddd');
        line((STAT_ZH[k] || k) + '  ' + statText(k, m), color);
      });
      g.fillRoundedRect(x - W / 2, 70, W, y - 70 + 8, 12); g.strokeRoundedRect(x - W / 2, 70, W, y - 70 + 8, 12);
    }
    panel(oldIt, cx - 215, '目前裝備', newIt);
    panel(newIt, cx + 215, '新裝備', oldIt);
    function close() { objs.forEach(function (o) { o.destroy(); }); self.input.keyboard.off('keydown-ENTER', ok); self.input.keyboard.off('keydown-ESC', no); self._confirming = false; }
    function ok() { close(); self._commit(i); }
    function no() { close(); }
    function btn(x, label, color, cb) {
      var r = add(self.add.rectangle(x, 490, 170, 50, color, 1).setInteractive({ useHandCursor: true }), 202);
      add(self.add.text(x, 490, label, { fontFamily: FONT, fontSize: 21, color: '#ffffff' }).setOrigin(0.5), 203);
      r.on('pointerdown', cb);
    }
    btn(cx - 100, '置換 (Enter)', 0x2a6a3a, ok);
    btn(cx + 100, '取消 (Esc)', 0x6a2a2a, no);
    this.input.keyboard.on('keydown-ENTER', ok);
    this.input.keyboard.on('keydown-ESC', no);
  }

  _commit(i) {
    this._sel = true;
    var self = this;
    for (var j = 0; j < 3; j++) {
      var c = this._cards[j];
      if (j === i) this.tweens.add({ targets: c.cont, scaleX: 1.2, scaleY: 1.2, duration: 300 });
      else this.tweens.add({ targets: c.cont, alpha: 0, duration: 300 });
    }
    RUN.buffs = {};
    applyChoice(this._cards[i].card);
    RUN.level += 1;
    RUN.hp = calcStats().max_hp;
    this.time.delayedCall(320, function () { fadeTo(self, 'Level'); });
  }

  destroy() { if (this._bg) this._bg.destroy(); }
}
