const Extras = {
  init(scene) {
    if (!scene || !scene.enemies) return;
    if (!RUN.coins) RUN.coins = 0;
    scene._ex = {
      coins: [], glows: [], spikes: [], fountains: [], chest: null,
      chestHint: null, chestOpened: false, fountainUsed: false,
      coinText: null, comboText: null, comboCount: 0, lastKill: 0,
      comboActive: false, comboActiveUntil: 0, keyE: null,
      camX: 0, camY: 0, camW: GAME_W, camH: 540
    };
    const ex = scene._ex;
    const cam = scene.cameras.main;
    ex.camX = cam.scrollX; ex.camY = cam.scrollY; ex.camW = cam.width; ex.camH = cam.height;
    ex.coinText = scene.add.text(0, 0, String(RUN.coins || 0), {   // hud.js _redraw positions it next to the coin stack every frame
      fontFamily: 'Microsoft JhengHei, PingFang TC, sans-serif', fontSize: '18px', fontStyle: 'bold',
      color: '#ffd24a', stroke: '#0a1224', strokeThickness: 3
    }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(103);
    ex.comboText = scene.add.text(944, 120, '', {
      fontFamily: 'Microsoft JhengHei, PingFang TC, sans-serif', fontSize: '22px',
      color: '#ffffff', stroke: '#000000', strokeThickness: 4
    }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(100);
    const lvl = GAME_DATA.levels[RUN.level - 1];
    const n = lvl.n;
    const kids = scene.enemies.getChildren();
    for (let i = 0; i < kids.length; i++) {
      const ref = kids[i] && kids[i].ref;
      if (!ref || !ref.def) continue;
      if (RUN.hard) {
        ref.hp = Math.round(ref.hp * 1.2);
        ref.maxHp = Math.round(ref.maxHp * 1.2);
        if (ref.dmgMult != null) ref.dmgMult *= 1.1;
      }
      if (n >= 6 && !GAME_DATA.bosses[ref.def.id]) {
        if (Extras._seeded(n, i) < 0.1) Extras._makeElite(scene, ref);
      }
    }
    // treasure chests removed (user 2026-10-12: 取消寶箱); _makeChest / _openChest stay unused: [2, 4, 7, 9, 12, 14, 17, 19] were the chest levels
    // blue ground puddle (the healing fountain) removed (user 2026-10-12: 地面陷阱(一灘藍色的?)取消); _makeFountain stays unused: [3, 6, 8, 11, 13, 16, 18] were the fountain levels
    if (n >= 6) Extras._makeSpikes(scene, lvl);
  },

  update(scene, time, delta) {
    const ex = scene._ex;
    if (!ex) return;
    const cam = scene.cameras.main;
    ex.camX = cam.scrollX; ex.camY = cam.scrollY; ex.camW = cam.width; ex.camH = cam.height;
    const p = scene.player;
    const px = p ? p.sprite.x : 0, py = p ? p.sprite.y : 0;
    for (let i = ex.glows.length - 1; i >= 0; i--) {
      const g = ex.glows[i];
      if (!g || !g.ref || g.ref.dead) { if (g) g.destroy(); ex.glows.splice(i, 1); continue; }
      g.x = g.ref.sprite.x; g.y = g.ref.sprite.y;
    }
    for (let i = ex.coins.length - 1; i >= 0; i--) {
      const c = ex.coins[i];
      if (!c || !c.active) { if (c) c.destroy(); ex.coins.splice(i, 1); continue; }
      if (time > c.deadAt) { c.active = false; c.destroy(); ex.coins.splice(i, 1); continue; }
      if (c.y > 650) { c.active = false; c.destroy(); ex.coins.splice(i, 1); continue; }
      const dx = px - c.x, dy = py - c.y, d = Math.hypot(dx, dy);
      if (d < 20) {
        RUN.coins = (RUN.coins || 0) + c.value;
        if (ex.coinText) ex.coinText.setText(String(RUN.coins));
        Extras._float(scene, c.x, c.y - 10, '+' + c.value, '#ffd24a');
        c.active = false; c.destroy(); ex.coins.splice(i, 1); continue;
      }
      if (d < 90 && d > 0.01) {
        if (c.body) { c.body.setAllowGravity(false); c.body.setVelocity(0, 0); }
        const sp = 260 * (delta / 1000);
        c.x += (dx / d) * sp; c.y += (dy / d) * sp;
      }
    }
    if (!ex.hpGfx) ex.hpGfx = scene.add.graphics().setDepth(6);
    const hg = ex.hpGfx; hg.clear(); ex.hpBars = [];
    const hkids = scene.enemies.getChildren();
    for (let hi2 = 0; hi2 < hkids.length; hi2++) {
      const es = hkids[hi2], ref = es.ref;
      if (!ref || ref.dead || !es.active || !es.body) continue;
      if (ref.def && GAME_DATA.bosses[ref.def.id]) continue;
      const ratio = Math.max(0, Math.min(1, ref.hp / (ref.maxHp || 1)));
      const bw = Math.max(28, Math.min(52, es.body.width)), bh = 5;
      const bx = es.x, by = es.body.top - 10;
      hg.fillStyle(0x000000, 0.7); hg.fillRect(bx - bw / 2 - 1, by - 1, bw + 2, bh + 2);
      hg.fillStyle(ratio > 0.5 ? 0x44cc44 : (ratio > 0.25 ? 0xddaa22 : 0xcc3333), 1); hg.fillRect(bx - bw / 2, by, bw * ratio, bh);
      ex.hpBars.push({ ref: ref, x: bx, y: by, w: bw, ratio: ratio });
    }
    if (ex.chest && !ex.chestOpened && p && !p.dead) {
      const near = Math.abs(p.sprite.x - ex.chest.x) < 40 && Math.abs(p.sprite.y - ex.chest.y) < 60;
      if (near) Extras._openChest(scene); // touching the chest opens it (no E key / button)
    }
    if (ex.fountain && !ex.fountainUsed && p && !p.dead) {
      if (Math.abs(p.sprite.x - ex.fountain.x) < 50 && Math.abs(p.sprite.y - ex.fountain.y) < 60) {
        ex.fountainUsed = true;
        if (p.heal) p.heal(30);
        if (typeof FX !== 'undefined') FX.healGlow(scene, p.sprite.x, p.sprite.y);
        if (ex.fountain.base) ex.fountain.base.setFillStyle(0x888888, 0.8);
        if (ex.fountain.drops) for (const d of ex.fountain.drops) d.setVisible(false);
      }
    }
    if (p && !p.dead && p.sprite && p.sprite.body) {
      const feet = p.sprite.y + p.sprite.displayHeight * 0.42;
      for (const s of ex.spikes) {
        if (p.sprite.x > s.x - 24 && p.sprite.x < s.x + 24 && feet > s.y - 14 && feet < s.y + 4) {
          if (p.takeDamage) p.takeDamage(10, s.x);
          break;
        }
      }
    }
    if (ex.comboCount > 0 && time - ex.lastKill > 2000) {
      ex.comboCount = 0;
      if (ex.comboText) ex.comboText.setText('');
    }
  },

  onEnemyDead(scene, ref, x, y) {
    const ex = scene._ex;
    if (!ex) return;
    if (ref && ref.fell) return;
    const isBoss = !!(ref && ref.def && GAME_DATA.bosses[ref.def.id]);
    const elite = !!(ref && ref.elite);
    const value = isBoss ? 20 : (elite ? 3 : 1);
    for (let i = 0; i < value; i++) Extras._spawnCoin(scene, x, y, 1);
    const now = scene.time.now;
    if (now - ex.lastKill <= 2000) ex.comboCount++; else ex.comboCount = 1;
    ex.lastKill = now;
    if (ex.comboText) {
      ex.comboText.setText('連擊 x' + ex.comboCount);
      ex.comboText.setColor(ex.comboCount >= 10 ? '#ffd24a' : '#ffffff');
      ex.comboText.setScale(1.4);
      scene.tweens.add({ targets: ex.comboText, scaleX: 1, scaleY: 1, duration: 180, ease: 'Back.easeOut' });
    }
    if (ex.comboCount >= 5 && now > ex.comboActiveUntil) {
      ex.comboActiveUntil = now + 3000;
      if (scene.player && scene.player.streakUntil != null) scene.player.streakUntil = now + 3000;
      Extras._float(scene, x, y - 40, 'COMBO!', '#ffcc00', 28);
    }
  },

  destroy(scene) {
    const ex = scene._ex;
    if (!ex) return;
    for (const c of ex.coins) if (c) c.destroy();
    for (const g of ex.glows) if (g) g.destroy();
    for (const s of ex.spikes) if (s && s.g) s.g.destroy();
    if (ex.hpGfx) { ex.hpGfx.destroy(); ex.hpGfx = null; }
    if (ex.fountain) {
      if (ex.fountain.base) ex.fountain.base.destroy();
      if (ex.fountain.drops) for (const d of ex.fountain.drops) d.destroy();
    }
    if (ex.chest) { if (ex.chest.body) ex.chest.body.destroy(); ex.chest.destroy(); }
    if (ex.chestHint) ex.chestHint.destroy();
    if (ex.coinText) ex.coinText.destroy();
    if (ex.comboText) ex.comboText.destroy();
    scene._ex = null;
  },

  _seeded(n, i) {
    let h = (Math.imul(n, 374761393) + Math.imul(i, 668265263)) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return (h >>> 0) / 4294967296;
  },

  _makeElite(scene, ref) {
    ref.elite = true;
    ref.hp = Math.round(ref.hp * 1.5);
    ref.maxHp = Math.round(ref.maxHp * 1.5);
    if (ref.dmgMult != null) ref.dmgMult *= 1.2;
    if (ref.sprite && ref.sprite.setTint) ref.sprite.setTint(0xffd24a);
    const g = scene.add.circle(ref.sprite.x, ref.sprite.y, 30, 0xffd24a, 0.35).setDepth(-1);
    g.ref = ref;
    scene._ex.glows.push(g);
    scene.tweens.add({ targets: g, alpha: 0.12, scale: 1.3, duration: 700, yoyo: true, repeat: -1 });
  },

  _spawnCoin(scene, x, y, value) {
    const c = scene.add.circle(x, y, 12, 0xffcc33).setStrokeStyle(2, 0xaa7700).setDepth(5);   // coin icon x2 (was radius 6, user 2026-10-12)
    c.value = value;
    c.deadAt = scene.time.now + 12000;
    c.active = true;
    scene._ex.coins.push(c);
    scene.physics.add.existing(c);
    c.body.setCircle(12);
    c.body.setBounce(0.3);
    c.body.setGravityY(2000);
    c.body.setVelocity(Math.random() * 120 - 60, -200);
    c.body.setDragX(300);
    if (scene.groundGroup) scene.physics.add.collider(c, scene.groundGroup);
    if (scene.platformGroup) scene.physics.add.collider(c, scene.platformGroup, null, function (coin, plat) { return coin.body.velocity.y >= 0 && coin.body.bottom <= plat.body.top + 14; });
  },

  _makeChest(scene, lvl) {
    let best = null;
    for (const seg of lvl.ground) if (!best || seg.w > best.w) best = seg;
    if (!best) return;
    const cx = best.x + best.w / 2, cy = best.y - 14;
    const body = scene.add.rectangle(cx, cy, 36, 28, 0x6b4423).setStrokeStyle(2, 0x3a2410).setDepth(4);
    const lid = scene.add.rectangle(cx, cy - 10, 36, 6, 0xffcc33).setDepth(5);
    body.lid = lid;
    scene._ex.chest = body;
  },

  _openChest(scene) {
    const ex = scene._ex;
    if (!ex || ex.chestOpened) return;
    ex.chestOpened = true;
    const c = ex.chest;
    c.setFillStyle(0x3a2410);
    if (c.lid) c.lid.setFillStyle(0x8a6a2a);
    if (ex.chestHint) ex.chestHint.setVisible(false);
    if (Math.random() < 0.5) {
      const n = 15 + Math.floor(Math.random() * 16);
      for (let i = 0; i < n; i++) Extras._spawnCoin(scene, c.x + (Math.random() * 40 - 20), c.y - 10, 1);
    } else {
      const p = scene.player;
      if (p && p.heal) p.heal(Math.round(p.stats.max_hp * 0.3));
      if (typeof FX !== 'undefined') FX.healGlow(scene, c.x, c.y);
    }
  },

  _makeFountain(scene, lvl) {
    const fx = lvl.width * 0.4;
    let best = null, bd = 1e9;
    for (const seg of lvl.ground) {
      const d = Math.abs(seg.x + seg.w / 2 - fx);
      if (d < bd) { bd = d; best = seg; }
    }
    if (!best) return;
    const cx = best.x + best.w / 2, cy = best.y - 10;
    const base = scene.add.ellipse(cx, cy, 40, 20, 0x3a86ff, 0.85).setStrokeStyle(2, 0x1d4ed8).setDepth(4);
    const drops = [];
    for (let i = 0; i < 4; i++) {
      const d = scene.add.circle(cx + (i - 1.5) * 8, cy - 12, 3, 0x88e0ff).setDepth(5);
      scene.tweens.add({ targets: d, y: cy - 30, alpha: 0, duration: 700 + i * 120, yoyo: true, repeat: -1, delay: i * 150 });
      drops.push(d);
    }
    scene._ex.fountain = { x: cx, y: cy, base: base, drops: drops };
  },

  _makeSpikes(scene, lvl) {
    const n = lvl.n;
    const count = 2 + Math.floor((n - 6) / 3);
    const spawnXs = (lvl.spawns || []).map(s => s.x);
    spawnXs.push(310); // player spawn (PLAYER_SPAWN_X in level.js): no spikes right at the start
    const placed = [];
    let idx = 0;
    let gi = -1;
    for (const seg of lvl.ground) {
      gi++;
      if (placed.length >= count) break;
      let lo = Math.max(seg.x + 24, 150);
      let hi = Math.min(seg.x + seg.w - 24, lvl.exit_x - 150);
      if (gi > 0) lo = Math.max(lo, seg.x + 160);
      if (gi < lvl.ground.length - 1) hi = Math.min(hi, seg.x + seg.w - 160);
      if (hi <= lo) continue;
      let tries = 0;
      while (placed.length < count && tries < 12) {
        tries++;
        const sx = lo + Extras._seeded(n, idx++) * (hi - lo);
        let ok = true;
        for (const px of spawnXs) if (Math.abs(px - sx) < 150) { ok = false; break; }
        if (ok) for (const q of placed) if (Math.abs(q - sx) < 60) { ok = false; break; }
        if (ok) {
          placed.push(sx);
          const g = scene.add.graphics().setDepth(4);
          g.fillStyle(0x999999);
          for (let k = 0; k < 3; k++) {
            const bx = sx - 24 + k * 16;
            g.fillTriangle(bx, seg.y, bx + 16, seg.y, bx + 8, seg.y - 14);
          }
          scene._ex.spikes.push({ x: sx, y: seg.y, g: g });
        }
      }
    }
  },

  _float(scene, x, y, str, color, size) {
    const t = scene.add.text(x, y, str, {
      fontFamily: 'Microsoft JhengHei, PingFang TC, sans-serif', fontSize: (size || 16) + 'px',
      color: color || '#ffffff', stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5).setDepth(101);
    scene.tweens.add({ targets: t, y: y - 34, alpha: 0, duration: 800, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }
};
