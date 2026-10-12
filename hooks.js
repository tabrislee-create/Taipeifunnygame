// hooks.js — Hooks (item hook effects) and Skills (per-character abilities) for "Hunter's Ascent".
// Classic script; shares globals: Phaser, GAME_DATA, RUN, calcStats, getHooks, FX.
// No classes. Functions take the Player object `p` and use the scene `p.scene`.

// ---------- shared helpers ----------
function _now(p) { return p.scene.time.now; }
function _facing(p) { return (p.facing === -1) ? -1 : 1; }
function _aliveEnemies(p) {
  var out = [];
  var g = p.scene.enemies;
  if (!g) return out;
  var kids = g.getChildren();
  for (var i = 0; i < kids.length; i++) {
    var e = kids[i];
    if (e && e.ref && !e.ref.dead) out.push(e.ref);
  }
  return out;
}
function _enemiesNear(p, x, y, radius) {
  var out = [];
  var r2 = radius * radius;
  var list = _aliveEnemies(p);
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    var ex = e.sprite.x, ey = e.sprite.y;
    var dx = ex - x, dy = ey - y;
    if (dx * dx + dy * dy <= r2) out.push(e);
  }
  return out;
}
function _enemiesInRect(p, x, y, w, h) {
  var out = [];
  var list = _aliveEnemies(p);
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    var ex = e.sprite.x, ey = e.sprite.y;
    if (ex >= x && ex <= x + w && ey >= y && ey <= y + h) out.push(e);
  }
  return out;
}
function _applyRage(p, dmg) {
  if (p.rageUntil && _now(p) < p.rageUntil) dmg *= 1.5;
  if (p.examUntil && _now(p) < p.examUntil) {
    const ch = GAME_DATA.characters[RUN.char];
    const params = ch && ch.skill ? ch.skill.params : {};
    const pct = (params.attack_damage_percent !== undefined) ? params.attack_damage_percent : 0.5;
    dmg *= (1 + pct);
  }
  return dmg;
}
function _rollCrit(p) {
  var s = p.stats || {};
  var chance = s.crit_chance || 0;   // crit_chance is already a fraction (0.05 = 5%), same as player.hitEnemy
  return Math.random() < chance;
}
function _critMult(p) {
  var s = p.stats || {};
  return s.crit_multiplier || 2;
}
function _skillDamage(p, mult) {
  var s = p.stats || {};
  var base = s.attack_damage || 10;
  var crit = _rollCrit(p);
  var dmg = base * mult * (crit ? _critMult(p) : 1);
  return { dmg: dmg, crit: crit };
}
function _skillHit(p, ref, dmg, crit) {
  ref.takeHit(dmg, p.sprite.x, crit, { proc: true });
  p.afterHit(ref, dmg, crit);   // same as a normal hit / nano_process: on_hit item hooks, % lifesteal, shop flat lifesteal
}
// Gold coins (the run currency RUN.coins, same counter extras.js shows); pops one coin icon over the player's head per gain (FX.goldPop, effects.js)
function _addCoins(p, n) {
  RUN.coins = (RUN.coins || 0) + n;
  var ex = p.scene._ex;
  if (ex && ex.coinText) ex.coinText.setText(String(RUN.coins));
  if (FX.goldPop) FX.goldPop(p.scene, p, n);
}
function _skillGlow(p, color) {
  var scene = p.scene;
  var sp = p.sprite;
  var g = scene.add.graphics();
  g.fillStyle(color, 0.5);
  g.fillCircle(0, 0, 34);
  g.setPosition(sp.x, sp.y);
  g.setDepth(40);
  scene.tweens.add({
    targets: g, alpha: 0, scale: 1.6, duration: 260, ease: 'Cubic.easeOut',
    onUpdate: function () { g.setPosition(sp.x, sp.y); },
    onComplete: function () { g.destroy(); }
  });
}
function _skillCd(p, seconds) { 
  var cd = shopEffect('skill_cd');   // shop "clock shard": fraction off the cooldown (0.3 = -30%)
  if (cd > 0) seconds *= (1 - cd);
  p.skillReadyAt = _now(p) + seconds * 1000; 
}
function _skillFx(p) { FX.screenShake(p.scene, 1, 50); FX.hitStop(p.scene, 30); }

// ---------- Hooks ----------
var Hooks = {
  onHit: function (p, ref, damageDealt, isCrit) {
    if (!p || !ref || ref.dead) return;
    var hooks = getHooks('on_hit');
    if (!hooks || !hooks.length) return;
    if (!p._hookCd) p._hookCd = {};
    var now = _now(p);
    for (var i = 0; i < hooks.length; i++) {
      var h = hooks[i];
      var params = h.params || {};
      var chance = (params.chance === undefined) ? 1 : params.chance;
      if (Math.random() > chance) continue;
      var key = 'on_hit_' + i;
      if (p._hookCd[key] && now < p._hookCd[key]) continue;
      p._hookCd[key] = now + 250;
      if (h.effect === 'damage_bonus') {
        ref.takeHit(params.value || 0, p.sprite.x, false, { proc: true });
      } else if (h.effect === 'status_effect' && params.effect === 'burn') {
        ref.applyBurn(params.dps || 0, params.duration || 0);
      }
    }
  },

  onKill: function (p, x, y) {
    if (!p) return;
    var hooks = getHooks('on_kill');
    if (!hooks || !hooks.length) return;
    for (var i = 0; i < hooks.length; i++) {
      var h = hooks[i];
      var params = h.params || {};
      if (h.effect === 'heal') {
        p.heal(params.value || 0);
      } else if (h.effect === 'spawn_projectile' && params.pattern === 'radial') {
        Hooks.radial(p, x, y, params.count || 6, params.damage || 0);
      }
    }
  },

  onJump: function (p) {
    if (!p) return;
    var hooks = getHooks('on_jump');
    if (!hooks || !hooks.length) return;
    for (var i = 0; i < hooks.length; i++) {
      var h = hooks[i];
      var params = h.params || {};
      if (h.effect === 'dash') {
        var dist = params.distance || 120;
        var dur = params.duration || 0.15;
        var f = _facing(p);
        p.sprite.body.setVelocityX(f * dist / dur);
        p.dashUntil = _now(p) + dur * 1000;
      } else if (h.effect === 'spawn_projectile') {
        Hooks.radial(p, p.sprite.x, p.sprite.y, params.count || 6, params.damage || 0);
      }
    }
  },

  onDamaged: function (p, srcX) {
    if (!p) return;
    var hooks = getHooks('on_damaged');
    if (!hooks || !hooks.length) return;
    for (var i = 0; i < hooks.length; i++) {
      var h = hooks[i];
      var params = h.params || {};
      if (h.effect === 'counter_attack') {
        var near = _enemiesNear(p, p.sprite.x, p.sprite.y, 90);
        for (var j = 0; j < near.length; j++) {
          near[j].takeHit(params.damage || 0, p.sprite.x, false, { proc: true });
        }
      } else if (h.effect === 'shield') {
        var chance = (params.chance === undefined) ? 1 : params.chance;
        if (Math.random() < chance) {
          p.shieldHp += (params.value || 0);
          p.shieldUntil = _now(p) + (params.duration || 0) * 1000;
          FX.shieldRing(p.scene, p.sprite, (params.duration || 0) * 1000);
        }
      }
    }
  },

  periodic: function (p, time) {
    if (!p || p.dead) return;
    var hooks = getHooks('periodic');
    if (!hooks || !hooks.length) return;
    if (!p._periodicNext) p._periodicNext = {};
    for (var i = 0; i < hooks.length; i++) {
      var h = hooks[i];
      if (h.effect !== 'aura_damage') continue;
      var params = h.params || {};
      var interval = (params.interval || 1) * 1000;
      var key = 'periodic_' + i;
      if (p._periodicNext[key] === undefined) p._periodicNext[key] = time + interval;
      if (time < p._periodicNext[key]) continue;
      p._periodicNext[key] = time + interval;
      var radius = params.radius || 60;
      var dmg = params.damage || 0;
      var near = _enemiesNear(p, p.sprite.x, p.sprite.y, radius);
      for (var j = 0; j < near.length; j++) {
        near[j].takeHit(dmg, p.sprite.x, false, { proc: true });
      }
      FX.explosionRing(p.scene, p.sprite.x, p.sprite.y, radius * 0.6);
    }
  },

  radial: function (p, x, y, count, damage) {
    var scene = p.scene;
    if (!scene || !scene.enemies) return;
    count = count || 6;
    var speed = 350;
    var travel = 250;
    var life = (travel / speed) * 1000;
    var g = scene.physics.add.group();
    var overlap = scene.physics.add.overlap(g, scene.enemies, function (proj, enemy) {
      if (!proj.active || !enemy || !enemy.ref || enemy.ref.dead) return;
      enemy.ref.takeHit(damage, proj.x, false, { proc: true });
      proj.destroy();
    });
    for (var i = 0; i < count; i++) {
      var ang = (Math.PI * 2 * i) / count;
      var proj = scene.add.circle(x, y, 6, 0xff8800);
      g.add(proj);
      proj.setDepth(30);
      scene.physics.add.existing(proj);
      proj.body.setAllowGravity(false);
      proj.body.setCircle(6);
      proj.body.setVelocity(Math.cos(ang) * speed, Math.sin(ang) * speed);
      scene.tweens.add({ targets: proj, alpha: 0, delay: life - 120, duration: 120 });
      scene.time.delayedCall(life, (function (pr) {
        return function () { if (pr.active) pr.destroy(); };
      })(proj));
    }
    scene.time.delayedCall(life + 200, function () {
      if (overlap) scene.physics.world.removeCollider(overlap);
      g.clear(true, true);
    });
  }
};

// Auntie take-profit constants (px / ms).  User 2026-10-11, 2nd sketch (blue): 5 K bars, the first two stand on the ground and the other 3 float and grow upward; every bar
// has its own length; bars are 1 px apart (user's earlier request); no white centre line.  The hit area follows the visuals, so the nearest ground enemies are inside it and
// further out the area moves up.  Everything but a Boss that is hit is launched and stunned after landing (params launch_height / stun_seconds).
// Heights are measured up from her feet; bar i spans [barBottom[i], barTop[i]].  Read off the blue sketch (screenshot scaled so she is 105 px tall); the sketch is rough.
var TAKE_PROFIT = {
  barCount: 5,
  barW: 26,
  barGap: 1,                       // empty px between neighbouring bars
  firstGap: 4,                     // from her front edge to the first bar's left edge
  barBottom: [0, 0, 39, 70, 77],
  barTop: [55, 74, 116, 135, 165],
  stepMs: 180,                     // delay between bars
  barLifeMs: 700,                  // bar visible / hit box live
  coinDelayMs: 120,                // coin pops this long after its bar appears
  coinSize: 28,
  coinRise: 30,                    // how far the coin pops above the bar top
  coinLifeMs: 500,
  tickMs: 30                       // hit check interval
};

// ---------- Skills ----------
var Skills = {
  cast: function (p) {
    if (!p || p.dead) return false;
    var now = _now(p);
    if (p.skillReadyAt && now < p.skillReadyAt) return false;
    var ch = GAME_DATA.characters[RUN.char];
    if (!ch || !ch.skill) return false;
    var id = ch.skill.id;
    var ok = false;
    if (id === 'hunt') ok = Skills.hunt(p);
    else if (id === 'blood_rage') ok = Skills.blood_rage(p);
    else if (id === 'shadow_strike') ok = Skills.shadow_strike(p);
    else if (id === 'exam_max') ok = Skills.exam_max(p);
    else if (id === 'nano_process') ok = Skills.nano_process(p);
    else if (id === 'stir_fry') ok = Skills.stir_fry(p);
    else if (id === 'take_profit') ok = Skills.take_profit(p);
    if (ok && p.playAnim) p.playAnim(id);
    return ok;
  },

  hunt: function (p) {
    var scene = p.scene;
    var ch = GAME_DATA.characters[RUN.char];
    var params = ch.skill.params || {};
    var cd = ch.skill.cooldown || 6;
    var dashDist = params.dash_dist || 150;
    var dashDur = 200;
    var f = _facing(p);
    var startX = p.sprite.x;
    var startY = p.sprite.y;
    var velX = f * dashDist / (dashDur / 1000);
    p.invUntil = _now(p) + 300;
    p.dashUntil = _now(p) + dashDur;
    p.sprite.body.setVelocityX(velX);
    p.sprite.body.setVelocityY(0);
    var hitSet = [];
    var trail = [];
    for (var t = 0; t < 5; t++) {
      var rect = scene.add.rectangle(p.sprite.x, p.sprite.y, 16, 40, 0x66dd66, 0.8);
      rect.setDepth(35);
      trail.push(rect);
      scene.tweens.add({ targets: rect, alpha: 0, delay: t * 60, duration: 300, onComplete: (function (r) { return function () { r.destroy(); }; })(rect) });
    }
    var check = function () {
      var enemies = _enemiesInRect(p, Math.min(startX, p.sprite.x) - 20, startY - 40, Math.abs(p.sprite.x - startX) + 40, 80);
      for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (hitSet.indexOf(e) !== -1) continue;
        hitSet.push(e);
        var res = _skillDamage(p, params.dmg_mult || 1);
        _skillHit(p, e, _applyRage(p, res.dmg), res.crit);
      }
    };
    check();
    var iv = scene.time.addEvent({ delay: 30, loop: true, callback: check });
    scene.time.delayedCall(dashDur, function () {
      iv.remove();
      p.dashUntil = 0;
      p.sprite.body.setVelocityX(0);
    });
    _skillFx(p);
    _skillGlow(p, 0x66dd66);
    _skillCd(p, cd);
    return true;
  },

  blood_rage: function (p) {
    var scene = p.scene;
    var ch = GAME_DATA.characters[RUN.char];
    var params = ch.skill.params || {};
    var cd = ch.skill.cooldown || 8;
    var radius = params.radius || 80;
    var near = _enemiesNear(p, p.sprite.x, p.sprite.y, radius);
    for (var i = 0; i < near.length; i++) {
      var res = _skillDamage(p, params.dmg_mult || 2.0);
      _skillHit(p, near[i], _applyRage(p, res.dmg), res.crit);
    }
    var selfDmg = params.self_dmg || 5;
    if (p.hp > 1) {
      p.hp = Math.max(1, p.hp - selfDmg);
      p.sprite.setTintFill(0xff0000);
      scene.time.delayedCall(120, function () { p.sprite.clearTint(); });
    }
    p.rageUntil = _now(p) + (params.buff_dur || 5) * 1000;
    FX.explosionRing(scene, p.sprite.x, p.sprite.y, radius);
    var vg = scene.add.graphics();
    vg.setScrollFactor(0);
    vg.setDepth(90);
    vg.lineStyle(40, 0xff0000, 0.5);
    vg.strokeRect(-20, -20, GAME_W + 40, 580);
    scene.tweens.add({ targets: vg, alpha: 0, duration: 500, onComplete: function () { vg.destroy(); } });
    _skillFx(p);
    _skillGlow(p, 0xff3333);
    _skillCd(p, cd);
    return true;
  },

  shadow_strike: function (p) {
    var scene = p.scene;
    var ch = GAME_DATA.characters[RUN.char];
    var params = ch.skill.params || {};
    var cd = ch.skill.cooldown || 4;
    var range = params.range || 200;
    var list = _aliveEnemies(p);
    var best = null, bestD = range * range;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var dx = e.sprite.x - p.sprite.x, dy = e.sprite.y - p.sprite.y;
      var d2 = dx * dx + dy * dy;
      if (d2 <= bestD) { bestD = d2; best = e; }
    }
    if (!best) return false;
    var ex = best.sprite.x, ey = best.sprite.y;
    var dir = (p.sprite.x <= ex) ? 1 : -1;
    var tx = ex - dir * 40;
    var ty = ey;
    var sx = p.sprite.x, sy = p.sprite.y;
    var puff = function (x, y) {
      for (var k = 0; k < 8; k++) {
        var ang = Math.random() * Math.PI * 2;
        var dist = 10 + Math.random() * 20;
        var c = scene.add.circle(x, y, 5, 0x8844cc, 0.8);
        c.setDepth(35);
        scene.tweens.add({
          targets: c, x: x + Math.cos(ang) * dist, y: y + Math.sin(ang) * dist,
          alpha: 0, scale: 2, duration: 350, onComplete: (function (cc) { return function () { cc.destroy(); }; })(c)
        });
      }
    };
    puff(sx, sy);
    p.sprite.setPosition(tx, ty);
    p.sprite.setFlipX(dir < 0);
    puff(tx, ty);
    var res = _skillDamage(p, params.dmg_mult || 1.2);
    _skillHit(p, best, _applyRage(p, res.dmg), res.crit);
    var line = scene.add.graphics();
    line.setDepth(36);
    line.lineStyle(4, 0x66aaff, 0.9);
    line.lineBetween(sx, sy, tx, ty);
    scene.tweens.add({ targets: line, alpha: 0, duration: 200, onComplete: function () { line.destroy(); } });
    _skillFx(p);
    _skillGlow(p, 0x8844cc);
    var finalCd = cd;
    if (res.crit) finalCd = Math.max(0, cd - (params.crit_refund || 2));
    _skillCd(p, finalCd);
    return true;
  },

  exam_max: function (p) {
    var scene = p.scene;
    var ch = GAME_DATA.characters[RUN.char];
    var params = ch.skill.params || {};
    var cd = ch.skill.cooldown || 8;
    var duration = params.buff_duration || 6;
    
    p.examUntil = _now(p) + duration * 1000;
    
    _skillCd(p, cd);
    _skillFx(p);
    FX.examMax(scene, p, duration * 1000);
    
    return true;
  },

  // Vendor "stir fry" (大火快炒): everything within `radius` takes a one-off damage_multiplier hit and is scorched (fixed damage every
  // burn_interval for burn_duration; red; bosses too; never stacks; independent of the normal attack's ignite).  The vendor is invincible and rooted
  // (no move / jump / turn / attack / skill) for buff_duration.  Visuals: FX.stirFry (effects.js).
  stir_fry: function (p) {
    var scene = p.scene;
    var ch = GAME_DATA.characters[RUN.char];
    var params = ch.skill.params || {};
    var cd = ch.skill.cooldown || 7;
    var duration = (params.buff_duration || 4) * 1000;
    var radius = params.radius || 100;
    var mult = params.damage_multiplier || 2.5;
    var cfg = { durationMs: (params.burn_duration || 2) * 1000, intervalMs: (params.burn_interval || 0.5) * 1000, damage: params.burn_damage || 10 };
    var now = _now(p);

    p.stirUntil = now + duration;
    p.sprite.body.setVelocityX(0);

    _skillCd(p, cd);
    _skillFx(p);
    if (FX.stirFry) FX.stirFry(scene, p, duration, radius);

    var enemies = _enemiesNear(p, p.sprite.x, p.sprite.y, radius);
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      var res = _skillDamage(p, mult);
      _skillHit(p, e, _applyRage(p, res.dmg), res.crit);
      if (!e.dead && e.scorch) e.scorch(now, cfg);
    }
    return true;
  },

  // Auntie "take profit" (獲利了結): 4 red K bars rise in front of her one after another (left to right, getting taller, user's sketch 2026-10-11) and a
  // coin pops out above each bar.  Every K bar and every coin is a hit box worth `hit_multiplier` x attack (default 0.5); one enemy is hit at most once
  // per box (so up to 2 x bar_count hits).  No target needed; cooldown fixed, no refund on kill.  Visuals: FX.takeProfit (effects.js),
  // drawn from the layout built here so the picture and the hit boxes are the same numbers.
  take_profit: function (p) {
    var scene = p.scene;
    var ch = GAME_DATA.characters[RUN.char];
    var params = ch.skill.params || {};
    var cd = ch.skill.cooldown || 6;
    var mult = params.hit_multiplier || 0.5;
    var coinsBar = params.coins_per_bar === undefined ? 2 : params.coins_per_bar, coinsHit = params.coins_per_enemy === undefined ? 1 : params.coins_per_enemy;
    var launchCfg = { heightPx: params.launch_height || 110, stunMs: (params.stun_seconds || 1) * 1000 };
    var layout = Skills.takeProfitLayout(p, params.bar_count || TAKE_PROFIT.barCount);
    // User 2026-10-11: the K bars' coins (icon + hit box + gold) exist only for the FIRST cast on each level; later casts have none of them.
    // The per-enemy gold below pays on every cast.  "Level" = RUN.level within the current run (RUN.startTime), so a new run starts fresh.
    var first = !(RUN._tp && RUN._tp.run === RUN.startTime && RUN._tp.level === RUN.level);
    RUN._tp = { run: RUN.startTime, level: RUN.level };
    if (!first) layout.coins = [];
    var t0 = _now(p);

    _skillCd(p, cd);
    _skillFx(p);
    _skillGlow(p, 0xffd24a);
    if (FX.takeProfit) FX.takeProfit(scene, p, layout);

    var boxes = [];
    for (var i = 0; i < layout.bars.length; i++) boxes.push({ r: layout.bars[i], from: layout.bars[i].startMs, to: layout.bars[i].endMs, hit: [] });
    for (var j = 0; j < layout.coins.length; j++) boxes.push({ r: layout.coins[j], from: layout.coins[j].startMs, to: layout.coins[j].endMs, hit: [] });
    var end = 0;
    for (var k = 0; k < boxes.length; k++) end = Math.max(end, boxes[k].to);

    // Invincible for the whole sequence, with a golden aura around her (FX.takeProfitAura)
    p.invUntil = Math.max(p.invUntil || 0, t0 + end);
    if (FX.takeProfitAura) FX.takeProfitAura(scene, p, end);

    // +coinsBar gold when each K bar's coin pops
    for (var c = 0; c < layout.coins.length; c++) {
      scene.time.delayedCall(layout.coins[c].startMs, function () {
        if (p.dead || !p.sprite || !p.sprite.active) return;
        _addCoins(p, coinsBar);
      });
    }
    var goldEnemies = [];   // each enemy pays +coinsHit once per cast (a Boss counts as an enemy)

    var check = function () {
      if (p.dead || !p.sprite || !p.sprite.active) { iv.remove(); return; }
      var el = scene.time.now - t0;
      var list = _aliveEnemies(p);
      for (var b = 0; b < boxes.length; b++) {
        var bx = boxes[b];
        if (el < bx.from || el > bx.to) continue;
        var rect = new Phaser.Geom.Rectangle(bx.r.x, bx.r.y, bx.r.w, bx.r.h);
        for (var n = 0; n < list.length; n++) {
          var e = list[n];
          if (e.dead || bx.hit.indexOf(e) !== -1) continue;
          if (!Phaser.Geom.Intersects.RectangleToRectangle(rect, bodyRect(e.sprite))) continue;
          bx.hit.push(e);
          var res = _skillDamage(p, mult);
          var dmg = _applyRage(p, res.dmg);
          e.takeHit(dmg, p.sprite.x, res.crit, { proc: true, noKnockback: true });   // many small hits: no knock-back (same as nano_process)
          p.afterHit(e, dmg, res.crit);   // on_hit hooks + lifesteal, same as _skillHit
          if (goldEnemies.indexOf(e) === -1) { goldEnemies.push(e); _addCoins(p, coinsHit); }
          if (!e.dead && e.launch) e.launch(scene.time.now, launchCfg, p.sprite.x);   // everything but a Boss: knocked up and away on a 45 degree path, stunned after landing
        }
      }
      if (el > end) iv.remove();
    };
    var iv = scene.time.addEvent({ delay: TAKE_PROFIT.tickMs, loop: true, callback: check });
    check();
    return true;
  },

  // World-space layout of the take-profit sequence (facing-aware).  bars[i] / coins[i]: { x, y, w, h } = hit box (top-left + size) plus
  // cx (centre x), top / bottom (K bar; bottom is above the ground for floating bars), startMs / endMs (ms after the cast the box is live / drawn).  Coin i belongs to bar i.
  takeProfitLayout: function (p, count) {
    var T = TAKE_PROFIT, f = _facing(p), s = p.sprite;
    var halfW = s.body.halfWidth, ground = s.body.bottom;
    var bars = [], coins = [];
    for (var i = 0; i < count; i++) {
      var k = Math.min(i, T.barTop.length - 1);
      var cx = s.x + f * (halfW + T.firstGap + T.barW / 2 + i * (T.barW + T.barGap));
      var bot = ground - T.barBottom[k], top = ground - T.barTop[k], h = bot - top;
      var t = i * T.stepMs;
      bars.push({ i: i, cx: cx, x: cx - T.barW / 2, y: top, w: T.barW, h: h, top: top, bottom: bot, startMs: t, endMs: t + T.barLifeMs });
      var cs = t + T.coinDelayMs;
      // coin box = the path it pops along: from the bar top up to the apex (plus the coin's own size)
      coins.push({ i: i, cx: cx, x: cx - T.coinSize / 2, y: top - T.coinRise - T.coinSize, w: T.coinSize, h: T.coinRise + T.coinSize,
                   top: top, apexY: top - T.coinRise - T.coinSize / 2, size: T.coinSize, startMs: cs, endMs: cs + T.coinLifeMs });
    }
    return { facing: f, ground: ground, bars: bars, coins: coins };
  },

  nano_process: function (p) {
    var scene = p.scene;
    var ch = GAME_DATA.characters[RUN.char];
    var params = ch.skill.params || {};
    var cd = ch.skill.cooldown || 10;
    var duration = params.buff_duration || 6;
    var radius = params.radius || 160;
    var hitCount = params.hit_count || 3;
    var hitInterval = params.hit_interval || 0.15;
    var dmgMult = params.damage_multiplier || 0.8;
    var critBonus = params.crit_bonus || 0.2;

    p.nanoUntil = _now(p) + duration * 1000;

    _skillCd(p, cd);
    _skillFx(p);
    FX.nanoProcess(scene, p, duration * 1000);
    if (FX.nanoBurst) FX.nanoBurst(scene, p.sprite.x, p.sprite.y, radius);

    for (var i = 1; i <= hitCount; i++) {
      var delay = i * hitInterval * 1000;
      scene.time.delayedCall(delay, function () {
        if (p.dead || !p.sprite || !p.sprite.active) return;
        var enemies = _enemiesNear(p, p.sprite.x, p.sprite.y, radius);
        var st = p.stats;
        var bonus = (_now(p) < p.nanoUntil) ? critBonus : 0;
        for (var j = 0; j < enemies.length; j++) {
          var ref = enemies[j];
          var isCrit = Math.random() < (st.crit_chance + bonus);
          var dmg = Math.round(st.attack_damage * dmgMult * (isCrit ? st.crit_multiplier : 1));
          ref.takeHit(dmg, p.sprite.x, isCrit, { proc: true, noKnockback: true });
          p.afterHit(ref, dmg, isCrit);
        }
      });
    }

    return true;
  }
};
