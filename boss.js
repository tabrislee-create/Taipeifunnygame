const RAIN_COLS = [0x3aa0ff, 0x40d060, 0xffd830, 0xff3a3a, 0xff4fd8, 0xff9a20];   // rainbow_sky_rain strip colours
const RAIN_G = 900;   // strip gravity (px/s^2)

class Boss {
  constructor(scene, def, x, y) {
    this.scene = scene;
    this.def = def;
    this.id = def.id;
    this.name = def.name_zh;
    this.maxHp = def.hp;
    this.hp = def.hp;
    this.dead = false;
    this._am = RUN.hard ? 1.1 + Math.random() * 0.1 : 1;   // hard mode (user 2026-10-13): every boss attack hits x1.1-1.2, drawn once each time the boss appears
    this.contactDamage = 15 * this._am;
    this.displayHeight = 200;
    this._phaseIndex = 0;
    this._patternIndex = 0;
    this._state = 'idle';
    this._stateTimer = 0;
    this._idleDuration = 800;
    this._telegraphMs = 0;
    this._activePattern = null;
    this._dashDir = 1;
    this._dashRemaining = 0;
    this._dashSpeed = 0;
    this._dashContact = false;
    this._jumpTargetX = 0;
    this._jumpStartX = 0;
    this._jumpStartY = 0;
    this._jumpDuration = 0;
    this._jumpElapsed = 0;
    this._jumpHeight = 0;
    this._jumpRadius = 0;
    this._jumpDamage = 0;
    this._waveDir = 1;
    this._waveRemaining = 0;
    this._waveSpeed = 0;
    this._waveDamage = 0;
    this._waveHit = false;
    this._laserActive = false;
    this._laserTimer = 0;
    this._laserDuration = 0;
    this._laserDamage = 0;
    this._laserHitTimer = 0;
    this._laserRect = null;
    this._laserBand = null;
    this._laserDir = 1;
    this._burnDps = 0;
    this._burnTimer = 0;
    this._burnAcc = 0;
    this._scorchEnd = 0; this._scorchStep = 0; this._scorchCfg = null;   // Vendor's skill: red + fixed damage per interval, never stacks (independent of applyBurn)
    this._burnFxTimer = 0;
    this._hitCd = 0;
    this._invuln = 0;
    this._deadEmitted = false;
    this._spawnedAdds = false;
    this._telegraphed = false;
    this._telegraphObjs = [];
    this._projectiles = [];
    this._waveObj = null;
    this._rain = null; this._rainStripes = []; this._rainPuddles = []; this._rainGlow = []; this._rainG = null;   // rainbow_sky_rain state
    this._glints = []; this._pools = []; this._glintAcc = 0;       // code-drawn light effects (no flares baked into the art)
    this._afx = 1; this._afy = 1; this._hitSquashUntil = 0; this._flashUntil = 0; this._landSquashT = -1e9;   // procedural squash & stretch
    this._phase = this._computePhase();
    this._freezeUntil = 0; this._seq = null; this._initSeq();   // skill selection (see _nextPattern)
    this._buildSprite(x, y);
    // (user 2026-10-13) no phase bar over the boss's head: the boss HP bar is the one at the top of the screen. _phaseBar stays null, so _drawPhaseBar() returns at once.
    if (scene.enemies) scene.enemies.add(this.sprite);
    this.sprite.ref = this;
  }

  _buildSprite(x, y) {
    const scene = this.scene;
    const tex = scene.textures.get(this.id);
    const src = tex.getSourceImage();
    const th = src.height || 160;
    const tw = src.width || 160;
    const scale = this.displayHeight / th;
    const dispW = tw * scale;
    const sprite = scene.physics.add.sprite(x, y, this.id);
    sprite.setDisplaySize(dispW, this.displayHeight);
    sprite.baseScaleX = sprite.scaleX; // FX.squash restores to these; without them rapid hits compound and the sprite stays stretched
    sprite.baseScaleY = sprite.scaleY;
    sprite.setOrigin(0.5, 1);
    sprite.setDepth(5);
    sprite.setFlipX(true);
    const body = sprite.body;
    // body size/offset are in source-texture pixels; bottom-aligned (origin is bottom-center)
    const hb = this.def.hitbox || { w: 0.6, h: 0.85 };   // data may widen the box for blob-shaped bosses
    body.setSize(tw * hb.w, th * hb.h);
    body.setOffset(tw * (1 - hb.w) / 2, th * (1 - hb.h) - (this.def.sink || 0) / scale);   // def.sink (display px): the art hangs this far below the hitbox, so a flat puddle edge sits in the ground instead of floating
    if (!scene.textures.exists('fx_star')) {   // 4-point star used by the glints
      const sg = scene.make.graphics({ x: 0, y: 0, add: false });
      sg.fillStyle(0xffffff, 1);
      const pts = [];
      for (let i = 0; i < 8; i++) { const r = i % 2 === 0 ? 15 : 3.2, a = i * Math.PI / 4 - Math.PI / 2; pts.push(new Phaser.Geom.Point(16 + Math.cos(a) * r, 16 + Math.sin(a) * r)); }
      sg.fillPoints(pts, true); sg.generateTexture('fx_star', 32, 32); sg.destroy();
    }
    body.setImmovable(true);
    body.setAllowGravity(true);
    this.sprite = sprite;
    this._dispW = dispW;
    this._dispH = this.displayHeight;
  }

  // Entrance (level 5): blink semi-transparent high above the ground, drop, land with a shake; harmless and untouchable until landed.
  beginEntrance(groundY) {
    const s = this.sprite, scene = this.scene;
    this._entering = true; this._enterAt = scene.time.now; this._enterDropAt = 0;
    s.body.reset(s.x, groundY - 260);
    s.body.setAllowGravity(false); s.body.setVelocity(0, 0);
    s.setAlpha(0.5);
  }

  _updateEntrance() {
    const s = this.sprite, now = this.scene.time.now;
    if (!this._enterDropAt) {
      s.body.setVelocity(0, 0);
      s.setAlpha(Math.floor((now - this._enterAt) / 90) % 2 ? 0.25 : 0.65);
      if (now - this._enterAt < 900) return;
      this._enterDropAt = now; s.body.setAllowGravity(true); return;
    }
    s.setAlpha(Math.floor((now - this._enterAt) / 90) % 2 ? 0.25 : 0.65);
    if (now - this._enterDropAt > 60 && (s.body.blocked.down || s.body.touching.down || s.body.bottom >= this._groundY() - 2)) {
      this._entering = false; s.setAlpha(1);
      s.body.setVelocity(0, 0);
      FX.explosionRing(this.scene, s.x, this._groundY(), 140);
      FX.screenShake(this.scene, 0.015, 350);
      this._stateTimer = 0; this._state = 'idle';
      this._landSquashT = now;
      if (this.def.intro_text_zh) {
        const t = this.scene.add.text(GAME_W / 2, 150, this.def.intro_text_zh, { fontFamily: 'Microsoft JhengHei, PingFang TC, sans-serif', fontSize: '30px', color: '#fff6d8', stroke: '#1a1a1a', strokeThickness: 5 }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setAlpha(0);
        this.scene.tweens.add({ targets: t, alpha: 1, duration: 300, yoyo: true, hold: 1500, onComplete: function () { t.destroy(); } });
      }
    }
  }

  _buildPhaseBar() {
    const g = this.scene.add.graphics();
    g.setDepth(95);
    this._phaseBar = g;
    this._drawPhaseBar();
  }

  _drawPhaseBar() {
    const g = this._phaseBar;
    if (!g) return;
    g.clear();
    const phases = this.def.phases || [];
    if (phases.length <= 1) return;
    const w = 120, h = 6;
    const x = this.sprite.x - w / 2;
    const y = this.sprite.y - this._dispH - 26;
    g.fillStyle(0x000000, 0.5);
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
    for (let i = 0; i < phases.length; i++) {
      const prev = i === 0 ? 100 : phases[i - 1].hp_below_pct;
      const cur = phases[i].hp_below_pct;
      const x1 = x + (100 - prev) / 100 * w;
      const x2 = x + (100 - cur) / 100 * w;
      const active = i === this._phaseIndex;
      g.fillStyle(active ? 0xff4444 : 0x555555, 0.9);
      g.fillRect(x1, y, Math.max(1, x2 - x1), h);
    }
  }

  _computePhase() {
    const phases = this.def.phases || [];
    const pct = this.maxHp > 0 ? (this.hp / this.maxHp) * 100 : 0;
    let best = -1, bestPct = Infinity;
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i].hp_below_pct;
      if (p >= pct && p < bestPct) { bestPct = p; best = i; }
    }
    if (best < 0) best = phases.length - 1;
    return best;
  }

  _phaseLabel(i) {
    const n = (this.def.phases || []).length;
    if (i === n - 1) return '最終階段';
    if (i === 1) return '第二階段';
    return '第' + (i + 1) + '階段';
  }

  _checkPhase() {
    const np = this._computePhase();
    if (np !== this._phaseIndex) {
      this._phaseIndex = np;
      this._patternIndex = 0;
      this._state = 'idle';
      this._stateTimer = 0;
      this._clearTelegraph();
      this._clearWave();
      this._clearLaser();
      this._rainGlowOff();
      this._initSeq();
      const first = this._seq && this._seq[0];
      if (first && first.immediate) { const pat = this._nextPattern(); if (pat) this._startTelegraph(pat); }   // pattern flag immediate: that opening skill starts the moment the phase begins, no idle wait
      FX.bossPhase(this.scene, this.sprite, this._phaseLabel(np));
      this._drawPhaseBar();
    }
  }

  _clearTelegraph() {
    for (const o of this._telegraphObjs) { if (o && o.destroy) o.destroy(); }
    this._telegraphObjs = [];
  }

  _clearWave() {
    if (this._waveObj) { this._waveObj.destroy(); this._waveObj = null; }
  }

  _clearLaser() {
    if (this._laserRect) { this._laserRect.destroy(); this._laserRect = null; }
    if (this._laserBand) { this._laserBand.destroy(); this._laserBand = null; }
    this._laserActive = false;
  }

  _groundY() {
    const lvl = this.scene.lvl;
    if (lvl && lvl.y_ground != null) return lvl.y_ground;
    return 400;
  }

  // Leftmost x the boss may ever stand at (def.roam_min_x): keeps it from cornering the player against the left edge.
  _minX() { const b = this._worldBounds(); return Math.max(b.left + this._dispW * 0.3, this.def.roam_min_x || 0); }

  _worldBounds() {
    const lvl = this.scene.lvl;
    const w = (lvl && lvl.width) ? lvl.width : 960;
    return { left: 0, right: w };
  }

  _activePatterns() {
    const phases = this.def.phases || [];
    const ph = phases[this._phaseIndex];
    return (ph && ph.patterns) ? ph.patterns : [];
  }

  // Skill selection (user 2026-10-13). A pattern may carry: id (cooldown key, shared between phases), cd_ms (from the moment it starts), seq (opening sequence of the phase, in order, ignores cooldowns),
  // immediate (the first seq skill starts at once when the phase begins), once (only ever used inside the seq), trigger 'on_hit' (not in the rotation: starts when the player's normal attack hits, see _onNormalHit).
  // Free choice = a random skill whose cooldown is over. A boss whose data has none of these fields keeps the old fixed rotation (_nextPatternRotate).
  _initSeq() {
    const pats = this._activePatterns();
    this._seq = pats.filter((p) => p.seq).sort((x, y) => x.seq - y.seq);
  }

  _nextPattern() {
    const pats = this._activePatterns();
    if (!pats.length) return null;
    if (!pats.some((p) => p.cd_ms || p.trigger || p.seq)) return this._nextPatternRotate(pats);
    const now = this.scene.time.now;
    if (!this._skillCd) this._skillCd = new Map();
    const stamp = (p) => { this._skillCd.set(p.id || p.primitive, now + (p.cd_ms || 0)); return p; };
    if (this._seq && this._seq.length) return stamp(this._seq.shift());
    if (now < this._freezeUntil) return null;
    const ready = pats.filter((p) => !p.trigger && !p.once && now >= (this._skillCd.get(p.id || p.primitive) || 0));
    return ready.length ? stamp(ready[Math.floor(Math.random() * ready.length)]) : null;
  }

  // 藍色衝撞 (phase 1): started by the player's normal attack (not skills / procs / burn) hitting the boss, only while the boss is not busy with another skill or frozen after a landing; own cooldown.
  _onNormalHit(info) {
    if (info && info.proc) return;
    if (this._seq && this._seq.length) return;   // the opening skill (summon) comes first
    if (this._state !== 'idle' && this._state !== 'cooldown') return;
    const now = this.scene.time.now;
    if (now < this._freezeUntil) return;
    const pats = this._activePatterns(), pat = pats.find((p) => p.trigger === 'on_hit');
    if (!pat) return;
    if (!this._skillCd) this._skillCd = new Map();
    // a skill that is due (opening sequence pending, or a free-choice skill whose cooldown is over) goes first: otherwise hitting the boss non-stop would starve the summon
    if ((this._seq && this._seq.length) || pats.some((p) => !p.trigger && !p.once && now >= (this._skillCd.get(p.id || p.primitive) || 0))) return;
    const key = pat.id || pat.primitive;
    if (now < (this._skillCd.get(key) || 0)) return;
    this._skillCd.set(key, now + (pat.cd_ms || 0));
    this._startTelegraph(pat);
  }

  _nextPatternRotate(pats) {
    // a pattern with skill_cd_ms (the 6-minion summon: 30 s, user 2026-10-12) is skipped while its own cooldown runs; the next one in the rotation is used instead
    const now = this.scene.time.now;
    if (!this._skillCd) this._skillCd = new Map();
    for (let tries = 0; tries < pats.length; tries++) {
      const p = pats[this._patternIndex % pats.length];
      this._patternIndex++;
      if (p.skill_cd_ms && now < (this._skillCd.get(p) || 0)) continue;
      if (p.skill_cd_ms) this._skillCd.set(p, now + p.skill_cd_ms);
      return p;
    }
    return null;
  }


  _startTelegraph(pattern) {
    this._activePattern = pattern;
    this._telegraphed = false;
    this._state = 'telegraph';
    this._stateTimer = 0;
    this._telegraphMs = pattern.telegraph_ms || 500;
  }

  _doTelegraph(pattern) {
    const scene = this.scene;
    const s = this.sprite;
    const gy = this._groundY();
    const b = this._worldBounds();
    const pr = pattern.primitive;
    const p = pattern.params || {};
    const tm = this._telegraphMs;
    if (pr === 'dash') {
      const dir = (this._dashDir >= 0) ? 1 : -1;
      const dist = p.distance || 200;
      const x0 = s.x;
      const x1 = dir > 0 ? Math.min(b.right, x0 + dist) : Math.max(this._minX(), x0 - dist);
      const cx = (x0 + x1) / 2;
      const w = Math.abs(x1 - x0);
      this._telegraphObjs.push(FX.telegraphRect(scene, cx, gy - 30, w, 60, tm));
    } else if (pr === 'projectile_fan') {
      this._telegraphObjs.push(FX.telegraphCircle(scene, s.x, s.y - this._dispH * 0.6, 40, tm));
    } else if (pr === 'jump_slam') {
      const px = Math.max(this._minX(), (scene.player && scene.player.sprite) ? scene.player.sprite.x : s.x);   // landing spot is clamped like the jump itself
      this._telegraphObjs.push(FX.telegraphCircle(scene, px, gy - 10, p.shockwave_radius || 120, tm));
    } else if (pr === 'ground_wave') {
      const dir = (this._dashDir >= 0) ? 1 : -1;
      const x0 = s.x;
      const x1 = dir > 0 ? Math.min(b.right, x0 + 900) : Math.max(b.left, x0 - 900);
      const cx = (x0 + x1) / 2;
      const w = Math.abs(x1 - x0);
      this._telegraphObjs.push(FX.telegraphRect(scene, cx, gy - 18, w, 36, tm));
    } else if (pr === 'green_terrain_aoe') {
      const pl = scene.player && scene.player.sprite;
      this._aoeX = Math.max(b.left + 40, Math.min(b.right - 40, pl ? pl.x : s.x));   // aimed where the player stood when the telegraph began
      this._telegraphObjs.push(FX.telegraphCircle(scene, this._aoeX, gy - 10, p.radius || 150, tm));
    } else if (pr === 'rainbow_homing_projectile') {
      this._telegraphObjs.push(FX.telegraphCircle(scene, s.x, s.y - this._dispH * 0.6, 40, tm));
    } else if (pr === 'rainbow_sky_rain') {
      this._telegraphObjs.push(FX.telegraphCircle(scene, s.x, s.y - this._dispH * 1.0 - 20, 70, tm));
      this._rainGlowOn();   // the colour outline starts with the charge (invulnerable from here on)
      if (scene.textures.exists('bossskill_rain')) { this._rainTextImg = scene.add.image(s.x, s.y, 'bossskill_rain').setDepth(97).setAlpha(0); this._rainTextImg.setDisplaySize(260, 260 * this._rainTextImg.height / this._rainTextImg.width); this._telegraphObjs.push(this._rainTextImg); }   // brush-calligraphy skill name over the head for the whole charge
    } else if (pr === 'summon_adds') {
      for (const sl of this._summonSlots(p)) this._telegraphObjs.push(FX.telegraphCircle(scene, sl.x, gy - 20, 30, tm));
    } else if (pr === 'laser_sweep') {
      const dir = (this._dashDir >= 0) ? 1 : -1;
      const x0 = s.x;
      const x1 = dir > 0 ? b.right : b.left;
      const cx = (x0 + x1) / 2;
      const w = Math.abs(x1 - x0);
      this._telegraphObjs.push(FX.telegraphRect(scene, cx, gy - 18, w, 36, tm));
    }
  }

  _execute(pattern) {
    const scene = this.scene;
    const s = this.sprite;
    const gy = this._groundY();
    const b = this._worldBounds();
    const pr = pattern.primitive;
    const p = pattern.params || {};
    const dir = (this._dashDir >= 0) ? 1 : -1;
    if (pr === 'dash') {
      this._state = 'dash';
      this._dashDir = dir;
      this._dashRemaining = p.distance || 200;
      this._dashSpeed = p.speed || 400;
      this._dashContact = true;
    } else if (pr === 'projectile_fan') {
      this._state = 'cooldown';
      this._stateTimer = 0;
      this._fireFan(p);
    } else if (pr === 'jump_slam') {
      this._state = 'jump';
      this._jumpTargetX = (scene.player && scene.player.sprite) ? scene.player.sprite.x : s.x;
      this._jumpTargetX = Math.max(this._minX(), Math.min(b.right - 40, this._jumpTargetX));
      this._jumpStartX = s.x;
      this._jumpStartY = s.y;
      this._jumpHeight = p.jump_height || 150;
      this._jumpDuration = 2 * Math.sqrt(2 * this._jumpHeight / 1000) * 1000;
      this._jumpElapsed = 0;
      this._jumpRadius = p.shockwave_radius || 120;
      this._jumpDamage = (p.damage || 20) * this._am;
      s.body.setAllowGravity(false);
      s.body.setVelocity(0, 0);
    } else if (pr === 'ground_wave') {
      this._state = 'wave';
      this._waveDir = dir;
      this._waveRemaining = 900;
      this._waveSpeed = p.speed || 250;
      this._waveDamage = (p.damage || 15) * this._am;
      this._waveHit = false;
      const wx = s.x + dir * 30;
      const wy = gy - 18;
      const wave = scene.add.rectangle(wx, wy, 40, 36, 0xff6600, 0.9);
      wave.setDepth(6);
      this._waveObj = wave;
    } else if (pr === 'green_terrain_aoe') {
      this._state = 'cooldown';
      this._stateTimer = 0;
      this._spawnPool(this._aoeX != null ? this._aoeX : s.x, p);
    } else if (pr === 'rainbow_homing_projectile') {
      this._state = 'cooldown';
      this._stateTimer = 0;
      this._fireHoming(p);
    } else if (pr === 'rainbow_sky_rain') {
      this._startRain(p);
    } else if (pr === 'summon_adds') {
      this._state = 'cooldown';
      this._stateTimer = 0;
      this._summon(p);
    } else if (pr === 'laser_sweep') {
      this._state = 'laser';
      this._laserActive = true;
      this._laserDir = dir;
      this._laserDuration = (p.duration || 1.5) * 1000;
      this._laserTimer = 0;
      this._laserDamage = (p.damage || 12) * this._am;
      this._laserHitTimer = 0;
      const x0 = s.x;
      const x1 = dir > 0 ? b.right : b.left;
      const cx = (x0 + x1) / 2;
      const w = Math.abs(x1 - x0);
      const rect = scene.add.rectangle(cx, gy - 18, w, 36, 0xff2222, 0.55);
      rect.setDepth(7);
      this._laserRect = rect;
      const band = scene.add.rectangle(cx, gy - 18, w, 36, 0xffffff, 0.25);
      band.setDepth(8);
      this._laserBand = band;
      scene.tweens.add({ targets: band, alpha: 0.05, duration: 120, yoyo: true, repeat: -1 });
    } else {
      this._state = 'cooldown';
      this._stateTimer = 0;
    }
  }

  _fireFan(p) {
    const scene = this.scene;
    const s = this.sprite;
    const count = p.count || 5;
    const spread = p.spread || 60;
    const speed = p.speed || 300;
    const damage = (p.damage || 12) * this._am;
    const mx = s.x - 40;
    const my = s.y - this._dispH * 0.6;
    const px = (scene.player && scene.player.sprite) ? scene.player.sprite.x : s.x;
    const py = (scene.player && scene.player.sprite) ? scene.player.sprite.y - 28 : s.y;
    const base = Math.atan2(py - my, px - mx);
    const half = (spread * Math.PI / 180) / 2;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
      const ang = base + t * half;
      const proj = scene.add.circle(mx, my, 16, 0xff2a2a, 1);   // x2 (was 8) and red (was yellow), user 2026-10-12
      proj.setStrokeStyle(3, 0x8a0a0a);
      proj.setDepth(6);
      proj._vx = Math.cos(ang) * speed;
      proj._vy = Math.sin(ang) * speed;
      proj._life = 3000;
      proj._dmg = damage;
      proj._hit = false;
      proj._stun = 500;   // a hit stuns the player for 0.5 s (user 2026-10-13)
      this._projectiles.push(proj);
    }
  }

  // Green puddle (same look as the green slime's): hurts once per tick_interval while the player stands in it, fades out at the end.
  _spawnPool(x, p) {
    const scene = this.scene, self = this, r = p.radius || 150, dur = p.duration || 3000, tick = p.tick_interval || 500, dmg = (p.damage_per_tick || 5) * this._am;
    const pool = scene.add.ellipse(x, this._groundY() - 10, r * 2, 28, 0x4cd964, 0.8).setStrokeStyle(2, 0x1f8f3a).setDepth(1.9);
    const t0 = scene.time.now;
    const upd = function () {
      if (!pool.active) { scene.events.off('update', upd); return; }
      const now = scene.time.now, left = t0 + dur - now;
      if (left <= 0) { pool.destroy(); scene.events.off('update', upd); return; }
      pool.setAlpha(left < 600 ? 0.8 * left / 600 : 0.72 + 0.08 * Math.sin(now / 120));
      const pl = scene.player;
      if (pl && !pl.dead && Phaser.Geom.Intersects.RectangleToRectangle(pool.getBounds(), bodyRect(pl.sprite))) pl.applyDot(2000, dmg, tick);   // standing in it (re)starts a 2 s damage-over-time, one tick per tick_interval (user 2026-10-13)
    };
    scene.events.on('update', upd);
    this._pools.push(pool);
  }

  // Slowly homing colour orbs (blue / green / yellow / red): fly out upward, then turn toward the player at a limited rate.
  _fireHoming(p) {
    const scene = this.scene, s = this.sprite, count = p.count || 4, speed = p.speed || 180;
    const cols = [0x3aa0ff, 0x40d060, 0xffd830, 0xff3a3a];
    const mx = s.x - 30 * (s.flipX ? -1 : 1), my = s.y - this._dispH * 0.6;
    for (let i = 0; i < count; i++) {
      const proj = scene.add.circle(mx, my, 18, cols[i % cols.length], 1);   // x2 (was 9, user 2026-10-12)
      proj.setStrokeStyle(3, 0xffffff); proj.setDepth(6);
      const ang = -Math.PI / 2 + (count === 1 ? 0 : (i / (count - 1) - 0.5) * 1.6);   // fan upward
      proj._vx = Math.cos(ang) * speed; proj._vy = Math.sin(ang) * speed; proj._speed = speed;
      proj._life = p.lifetime || 3000; proj._dmg = (p.damage || 12) * this._am; proj._hit = false; proj._home = 1.5 + 0.0;   // rad/s turn rate
      this._projectiles.push(proj);
    }
  }

  // Between skills (idle / cooldown) a boss with def.walk_speed wanders at random: every 0.8-2.5 s it keeps going, turns around and backs off, or stands still.
  // It never chases the player; it stays inside [_minX(), right edge] and turns around at either end or at a pit.
  _updateWalk(dt) {
    const sp = this.def.walk_speed, s = this.sprite, scene = this.scene, now = scene.time.now;
    this._moving = false;
    if (!sp || (this._state !== 'idle' && this._state !== 'cooldown') || now < this._freezeUntil) return;
    const b = this._worldBounds(), lo = this._minX(), hi = b.right - this._dispW * 0.3;
    if (!this._roamUntil || now >= this._roamUntil) {
      const r = Math.random();
      this._roamUntil = now + 800 + Math.random() * 1700;
      if (r < 0.25) this._roamDir = 0;                                   // stand still
      else if (r < 0.6) this._roamDir = this._roamDir ? -this._roamDir : (Math.random() < 0.5 ? 1 : -1);   // turn around / back off
      else this._roamDir = this._roamDir || (Math.random() < 0.5 ? 1 : -1);                                 // keep going
    }
    if (!this._roamDir) return;
    let nx = s.x + this._roamDir * sp * dt;
    if (nx <= lo) { nx = lo; this._roamDir = 1; }
    else if (nx >= hi) { nx = hi; this._roamDir = -1; }
    else if (scene.hasGroundAt && !scene.hasGroundAt(nx + this._roamDir * this._dispW * 0.35)) { this._roamDir = -this._roamDir; return; }   // never slide off an edge into a pit
    s.x = nx; this._moving = true;
  }

  // Squash & stretch driven by the state machine; skipped while a hit-squash tween runs. Also the code-drawn iridescent tint flow.
  _updateAnim(dt, now) {
    const s = this.sprite; if (!s || !s.active) return;
    let fx = 1 + 0.02 * Math.sin(now / 420), fy = 1 - 0.02 * Math.sin(now / 420);   // idle breathing
    const st = this._state;
    if (st === 'telegraph') { const k = 0.5 + 0.5 * Math.sin(now / 70); fx = 1.06 + 0.04 * k; fy = 0.9 - 0.03 * k; }
    else if (st === 'jump') { const t = this._jumpDuration ? this._jumpElapsed / this._jumpDuration : 0; fx = t < 0.5 ? 0.9 : 0.93; fy = t < 0.5 ? 1.16 : 1.1; }
    else if (st === 'dash') { fx = 1.18 + 0.03 * Math.sin(now / 40); fy = 0.86; }
    else if (st === 'rain' || this._rainCharge()) { fx = 1.1 + 0.03 * Math.sin(now / 60); fy = 0.94; }
    else if (st === 'wave' || st === 'laser') { fx = 1.05; fy = 0.93; }
    else if (this._moving) { const k = Math.sin(now / 110); fx = 1.06 + 0.06 * k; fy = 0.95 - 0.06 * k; }   // slithering wobble
    const land = (now - this._landSquashT) / 320;
    if (land >= 0 && land < 1) { const k = 1 - land; fx = Math.max(fx, 1 + 0.2 * k); fy = Math.min(fy, 1 - 0.22 * k); }
    const a = Math.min(1, dt * 14);
    this._afx += (fx - this._afx) * a; this._afy += (fy - this._afy) * a;
    if (now >= this._hitSquashUntil) s.setScale(s.baseScaleX * this._afx, s.baseScaleY * this._afy);
    const rageP = this._activePattern && this._activePattern.params && this._activePattern.params.fx === 'rage' && (st === 'telegraph' || st === 'dash');
    if (this._scorchEnd > 0) {   // scorched: solid red instead of the hue drift
      s.setTint(0xff3030);
    } else if (st === 'rain' || this._rainCharge()) {   // rainbow_sky_rain (charge + fire): fast hue cycle
      const c = Phaser.Display.Color.HSVToRGB((now / 260) % 1, 0.4, 1);
      s.setTint(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
    } else if (rageP) {   // 狂暴連衝: flickers orange
      s.setTint(Math.floor(now / 70) % 2 ? 0xff8a1a : 0xffc890);
    } else if (now >= this._flashUntil) {   // slow pastel hue drift = light flowing through the body
      const h = (now / 5200) % 1, c = Phaser.Display.Color.HSVToRGB(h, 0.16, 1);
      s.setTint(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
    }
  }

  // Twinkling star glints on the body (drawn here, not in the art).
  _updateGlints(dt, now) {
    const s = this.sprite, scene = this.scene;
    this._glintAcc += dt * 1000;
    while (this._glintAcc >= 140 && this._glints.length < 14) {
      this._glintAcc -= 140;
      const img = scene.add.image(0, 0, 'fx_star').setDepth(6).setBlendMode(Phaser.BlendModes.ADD);
      img.setTint([0xffffff, 0xffe6f2, 0xd8f4ff, 0xfff4c0][Math.floor(Math.random() * 4)]);
      this._glints.push({ img: img, ox: (Math.random() - 0.5) * this._dispW * 0.72, oy: -(0.1 + Math.random() * 0.8) * this._dispH, t0: now, life: 420 + Math.random() * 380, sz: 0.5 + Math.random() * 0.8, rot: Math.random() * 1.5 });
    }
    if (this._glintAcc > 280) this._glintAcc = 0;
    for (let i = this._glints.length - 1; i >= 0; i--) {
      const g = this._glints[i], k = (now - g.t0) / g.life;
      if (k >= 1) { g.img.destroy(); this._glints.splice(i, 1); continue; }
      const env = Math.sin(Math.PI * k);   // 0 -> 1 -> 0
      g.img.setPosition(s.x + g.ox * this._afx, s.y + g.oy * this._afy).setScale(g.sz * env).setAlpha(env).setRotation(g.rot + k * 1.2);
    }
  }

  _clearGlints() { for (const g of this._glints) g.img.destroy(); this._glints = []; }

  // Where the minions appear: one slot per minion, alternating right / left of the boss, clamped to the arena. params.sequence = list of enemy types in the order they appear (blue x2, green x2, red x2 for the level-5 boss),
  // otherwise params.count copies of params.enemy_type.
  _summonSlots(p) {
    const s = this.sprite, b = this._worldBounds(), types = (p.sequence && p.sequence.length) ? p.sequence : Array.from({ length: p.count || 1 }, () => p.enemy_type), out = [];
    for (let i = 0; i < types.length; i++) {
      const off = (i % 2 === 0 ? 1 : -1) * (100 + (i * 40) % 200);
      out.push({ type: types[i], x: Math.max(this._minX() + 20, Math.min(b.right - 40, s.x + off)) });
    }
    return out;
  }

  // The minions come out one after another (params.interval_ms apart, default 350), each with a small spark.
  _summon(p) {
    const scene = this.scene, gy = this._groundY(), gap = p.interval_ms || 350, self = this;
    this._summonSlots(p).forEach(function (sl, i) {
      const def = (GAME_DATA && GAME_DATA.enemies) ? GAME_DATA.enemies[sl.type] : null;
      if (!def) return;
      scene.time.delayedCall(i * gap, function () {
        if (self.dead || !scene.addEnemy || !self.sprite || !self.sprite.active) return;
        FX.hitSpark(scene, sl.x, gy - 30);
        scene.addEnemy(def, sl.x, gy - 40);
      });
    });
  }

  // ---- skill visuals added 2026-10-12 (user) ----
  // Crescent-moon light in front of the slime while it dashes (藍色衝撞): convex side forward, tips back toward the slime. Three layers (wide glow, body, bright core).
  _crescent(g, ox, oy, R, dir, a0deg, thick, col, alpha) {
    const a0 = a0deg * Math.PI / 180, Ri = R * thick, a1 = Math.asin(Math.min(1, R * Math.sin(a0) / Ri));
    const ix = ox + dir * (R * Math.cos(a0) - Ri * Math.cos(a1)), pts = [];
    for (let i = 0; i <= 14; i++) { const a = -a0 + 2 * a0 * i / 14; pts.push({ x: ox + dir * R * Math.cos(a), y: oy + R * Math.sin(a) }); }
    for (let i = 14; i >= 0; i--) { const a = -a1 + 2 * a1 * i / 14; pts.push({ x: ix + dir * Ri * Math.cos(a), y: oy + Ri * Math.sin(a) }); }
    g.fillStyle(col, alpha); g.fillPoints(pts, true);
  }

  // Per-frame skill visuals, drawn on one Graphics: the dash crescent (pattern params.fx 'crescent') and the yellow light under the slime during 黃色跳壓 (telegraph, jump, landing).
  _updateFx(now) {
    const s = this.sprite; if (!s || !s.active) return;
    if (!this._fxG) this._fxG = this.scene.add.graphics().setDepth(5.5);
    const g = this._fxG; g.clear();
    const pat = this._activePattern, pr = pat && pat.primitive, fx = pat && pat.params && pat.params.fx, st = this._state;
    if (st === 'dash' && fx === 'crescent') {
      const dir = this._dashDir >= 0 ? 1 : -1, R = this._dispH * 0.55, ox = s.x + dir * (this._dispW * 0.42), oy = s.y - this._dispH * 0.42, k = 0.85 + 0.15 * Math.sin(now / 55);
      this._crescent(g, ox, oy, R * 1.14, dir, 66, 1.45, 0x59c8ff, 0.22 * k);
      this._crescent(g, ox, oy, R, dir, 66, 1.6, 0x8fe4ff, 0.6 * k);
      this._crescent(g, ox, oy, R * 0.97, dir, 66, 2.1, 0xf0fdff, 0.9 * k);
    }
    const ti = this._rainTextImg;
    if (ti && ti.active && st === 'telegraph' && pr === 'rainbow_sky_rain') {   // name: fades in 0.25 s, out for the last 0.3 s; kept clear of the HUD boss bar at the top
      const t = this._stateTimer, tm = this._telegraphMs || 1;
      ti.setAlpha(Math.max(0, Math.min(1, t / 250, (tm - t) / 300)));
      ti.setPosition(s.x, Math.max(60 + ti.displayHeight / 2, s.y - this._dispH - 66 - ti.displayHeight / 2));
    }
    if (st === 'telegraph' && pr === 'rainbow_sky_rain') {   // colour orb gathering over the head
      const p = Math.min(1, this._stateTimer / (this._telegraphMs || 1)), hx = s.x, hy = s.y - this._dispH - 20, R = 10 + 46 * p;
      for (let i = 0; i < 6; i++) { const a = now / 300 + i * Math.PI / 3; g.fillStyle(RAIN_COLS[i], 0.55); g.fillCircle(hx + Math.cos(a) * R * 0.5, hy + Math.sin(a) * R * 0.3, R * 0.55); }
      g.fillStyle(0xffffff, 0.2 + 0.5 * p); g.fillCircle(hx, hy, R * 0.4);
    }
    const sinceLand = now - this._landSquashT;
    if ((st === 'telegraph' && pr === 'jump_slam') || st === 'jump' || (sinceLand >= 0 && sinceLand < 380 && pr === 'jump_slam')) {
      const bx = s.x, by = s.body ? s.body.bottom : s.y, W = this._dispW * 1.4, flash = sinceLand >= 0 && sinceLand < 380 ? 1 + 0.7 * (1 - sinceLand / 380) : 1;
      const pulse = 0.8 + 0.2 * Math.sin(now / 60);
      for (let i = 0; i < 5; i++) {   // stacked ellipses: a pool of yellow light under the slime that fades upward
        const w = W * (1 - i * 0.12) * flash, h = (30 - i * 4) * flash;
        g.fillStyle(i < 2 ? 0xffe14a : 0xfff3a0, Math.min(1, (0.8 - i * 0.11) * pulse * flash));
        g.fillEllipse(bx, by - 4 - i * 9, w, h);
      }
    }
  }

  // Rainbow sky (pattern rainbow_sky_rain, user 2026-10-13): after the 2 s charge the boss stands still and INVULNERABLE for params.duration_ms, lobbing params.count coloured strips from its head,
  // alternating left / right, landing 100-620 px away (8 shuffled distance bins per side; strips 3 and 7 of each side are aimed at the player when they stand on that side).
  // A strip hurts once (params.damage) if it touches the player in flight or splashes within 45 px of where it lands; the puddle it leaves is visual only.
  // Rainbow sky: invulnerable for the whole skill, the 2 s charge included (user 2026-10-13).
  _rainCharge() { return this._state === 'telegraph' && !!this._activePattern && this._activePattern.primitive === 'rainbow_sky_rain'; }
  _skillInv() { return this._state === 'rain' || this._state === 'jump' || this._rainCharge(); }   // also the whole flight of 黃色跳壓 (user 2026-10-13)

  _startRain(p) {
    this._state = 'rain';
    this._stateTimer = 0;
    this._rainHits = 0;   // strips that have hit the player this cast: the n-th one does x(1 + 0.2 (n-1))
    this._rain = { t: 0, n: 0, total: p.count || 20, gap: p.interval_ms || 200, dur: p.duration_ms || 4000, dmg: (p.damage || 10) * this._am, bins: { '-1': this._rainBins(), '1': this._rainBins() }, k: { '-1': 0, '1': 0 } };
    this._rainDmg = this._rain.dmg;
    this._rainGlowOn();
    FX.screenShake(this.scene, 0.006, 200);
  }

  _rainBins() {
    const a = [0, 1, 2, 3, 4, 5, 6, 7];
    for (let i = 7; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  _updateRainState(delta) {
    const r = this._rain; if (!r) return;
    r.t += delta;
    while (r.n < r.total && r.t >= r.n * r.gap) { this._lobStripe(r.n % 2 ? 1 : -1); r.n++; }
    if (r.t >= r.dur) {
      this._rain = null;
      this._rainGlowOff();
      this._state = 'cooldown';
      this._stateTimer = 0;
    }
  }

  _lobStripe(side) {
    const s = this.sprite, r = this._rain, key = String(side), k = r.k[key]++, gy = this._groundY(), b = this._worldBounds();
    const x0 = s.x, y0 = s.y - this._dispH * 0.95, pl = this.scene.player;
    let D = 100 + (r.bins[key][k % 8] + Math.random()) * 65;
    if ((k === 3 || k === 7) && pl && !pl.dead && (pl.sprite.x - s.x) * side > 0) D = Math.abs(pl.sprite.x - s.x) + (Math.random() - 0.5) * 60;
    D = Math.max(100, Math.min(620, D));
    const lx = Math.max(b.left + 20, Math.min(b.right - 20, x0 + side * D));
    D = Math.abs(lx - x0);
    const rise = (70 + D * 0.13) * (0.9 + Math.random() * 0.2);   // apex stays ~150 px above the head at most (screen top)
    const vy = -Math.sqrt(2 * RAIN_G * rise), Hd = (gy - 6) - y0;
    const tl = (-vy + Math.sqrt(vy * vy + 2 * RAIN_G * Math.max(0, Hd))) / RAIN_G;
    this._rainStripes.push({ x: x0, y: y0, vx: (lx - x0) / tl, vy: vy, col: RAIN_COLS[Math.floor(Math.random() * RAIN_COLS.length)], trail: [{ x: x0, y: y0 }], hit: false });
  }

  _updateRain(dt, now) {
    const sts = this._rainStripes, pud = this._rainPuddles;
    if (!sts.length && !pud.length && !this._rainGlow.length) return;
    if (!this._rainG) this._rainG = this.scene.add.graphics().setDepth(6.2);
    const g = this._rainG; g.clear();
    const scene = this.scene, pl = scene.player, gy = this._groundY(), dmg = this._rainDmg || 10;
    const plOk = pl && !pl.dead && pl.sprite.active;
    for (let i = sts.length - 1; i >= 0; i--) {
      const st = sts[i];
      st.vy += RAIN_G * dt; st.x += st.vx * dt; st.y += st.vy * dt;
      st.trail.unshift({ x: st.x, y: st.y });
      let len = 0, keep = st.trail.length;
      for (let j = 1; j < st.trail.length; j++) { len += Math.hypot(st.trail[j].x - st.trail[j - 1].x, st.trail[j].y - st.trail[j - 1].y); if (len > 90) { keep = j + 1; break; } }
      st.trail.length = keep;
      const n = st.trail.length;
      for (let pass = 0; pass < 2; pass++) {   // coloured body, then a thin pale core
        for (let j = n - 1; j >= 1; j--) {
          const w = (4 + 12 * (1 - j / n)) * (pass ? 0.4 : 1);
          g.lineStyle(w, pass ? 0xffffff : st.col, pass ? 0.8 : 0.95);
          g.beginPath(); g.moveTo(st.trail[j].x, st.trail[j].y); g.lineTo(st.trail[j - 1].x, st.trail[j - 1].y); g.strokePath();
        }
      }
      let done = false;
      if (plOk && !st.hit && now >= pl.invUntil) {
        const rc = bodyRect(pl.sprite), pts = [st.trail[0], st.trail[Math.min(3, n - 1)]];
        for (const q of pts) if (q.x >= rc.x - 10 && q.x <= rc.right + 10 && q.y >= rc.y - 10 && q.y <= rc.bottom + 10) { st.hit = true; if (pl.takeDamage(this._rainDmg * (1 + 0.2 * this._rainHits), st.x)) this._rainHits++; FX.hitSpark(scene, q.x, q.y); done = true; break; }
      }
      if (!done && st.vy > 0 && st.y >= gy - 6) {
        if (plOk && !st.hit && now >= pl.invUntil && Math.abs(pl.sprite.x - st.x) <= 45 && pl.sprite.body.bottom >= gy - 70) { st.hit = true; if (pl.takeDamage(this._rainDmg * (1 + 0.2 * this._rainHits), st.x)) this._rainHits++; }
        const pu = scene.add.ellipse(st.x, gy - 8, 78, 16, st.col, 0.85).setDepth(1.95);
        pud.push({ o: pu, t0: now });
        FX.hitSpark(scene, st.x, gy - 8);
        done = true;
      }
      if (done) sts.splice(i, 1);
    }
    for (let i = pud.length - 1; i >= 0; i--) {
      const q = pud[i], a = 1 - (now - q.t0) / 800;
      if (a <= 0) { q.o.destroy(); pud.splice(i, 1); } else q.o.setAlpha(0.85 * a);
    }
    const s = this.sprite;
    if (this._rainGlow.length && s && s.active) {   // iridescent outline: 8 offset tinted silhouettes behind the sprite, hue rotating
      for (let i = 0; i < this._rainGlow.length; i++) {
        const im = this._rainGlow[i], a = i * Math.PI / 4, c = Phaser.Display.Color.HSVToRGB(((now / 350) + i / 8) % 1, 1, 1);
        im.setPosition(s.x + Math.cos(a) * 5, s.y + Math.sin(a) * 5).setScale(s.scaleX, s.scaleY).setFlipX(s.flipX).setTintFill(Phaser.Display.Color.GetColor(c.r, c.g, c.b)).setAlpha(0.75 + 0.25 * Math.sin(now / 90 + i));
      }
    }
  }

  _rainGlowOn() {
    if (this._rainGlow.length) return;   // already glowing since the charge began
    for (let i = 0; i < 8; i++) this._rainGlow.push(this.scene.add.image(this.sprite.x, this.sprite.y, this.id).setOrigin(0.5, 1).setDepth(4.9));
  }

  _rainGlowOff() {
    for (const im of this._rainGlow) im.destroy();
    this._rainGlow = [];
  }

  _clearRain() {
    this._rain = null;
    this._rainGlowOff();
    for (const st of this._rainStripes) st.trail = [];
    this._rainStripes = [];
    for (const q of this._rainPuddles) q.o.destroy();
    this._rainPuddles = [];
    if (this._rainG) { this._rainG.destroy(); this._rainG = null; }
  }

  _updateProjectiles(dt) {
    const scene = this.scene;
    const player = scene.player;
    for (let i = this._projectiles.length - 1; i >= 0; i--) {
      const proj = this._projectiles[i];
      if (proj._home && player && !player.dead) {   // limited turn rate toward the player's body centre, constant speed
        const want = Math.atan2(player.sprite.body.center.y - proj.y, player.sprite.body.center.x - proj.x);
        let cur = Math.atan2(proj._vy, proj._vx), d = want - cur;
        while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        cur += Math.max(-proj._home * dt, Math.min(proj._home * dt, d));
        proj._vx = Math.cos(cur) * proj._speed; proj._vy = Math.sin(cur) * proj._speed;
      }
      proj.x += proj._vx * dt;
      proj.y += proj._vy * dt;
      proj._life -= dt * 1000;
      let remove = proj._life <= 0;
      if (!remove && player && !player.dead && !proj._hit) {
        if (Phaser.Geom.Intersects.RectangleToRectangle(proj.getBounds(), bodyRect(player.sprite))) {
          if (player.takeDamage(proj._dmg, proj.x) && proj._stun) player.applyStun(proj._stun);
          proj._hit = true;
          remove = true;
        }
      }
      if (remove) {
        FX.hitSpark(scene, proj.x, proj.y);
        proj.destroy();
        this._projectiles.splice(i, 1);
      }
    }
  }

  _updateWave(dt) {
    const scene = this.scene;
    const player = scene.player;
    const wave = this._waveObj;
    if (!wave) return;
    const step = this._waveSpeed * dt;
    wave.x += this._waveDir * step;
    this._waveRemaining -= step;
    if (player && !player.dead && !this._waveHit) {
      if (Phaser.Geom.Intersects.RectangleToRectangle(wave.getBounds(), bodyRect(player.sprite))) {
        player.takeDamage(this._waveDamage, wave.x);
        this._waveHit = true;
      }
    }
    if (this._waveRemaining <= 0) {
      FX.deathPoof(scene, wave.x, wave.y);
      this._clearWave();
      this._state = 'cooldown';
      this._stateTimer = 0;
    }
  }

  _updateLaser(dt) {
    const scene = this.scene;
    const player = scene.player;
    this._laserTimer += dt * 1000;
    this._laserHitTimer += dt * 1000;
    if (player && !player.dead && this._laserRect && this._laserHitTimer >= 500) {
      if (Phaser.Geom.Intersects.RectangleToRectangle(this._laserRect.getBounds(), bodyRect(player.sprite))) {
        player.takeDamage(this._laserDamage, this.sprite.x);
        this._laserHitTimer = 0;
      }
    }
    if (this._laserTimer >= this._laserDuration) {
      this._clearLaser();
      this._state = 'cooldown';
      this._stateTimer = 0;
    }
  }

  _updateJump(dt) {
    const s = this.sprite;
    this._jumpElapsed += dt * 1000;
    const t = Math.min(1, this._jumpElapsed / this._jumpDuration);
    const x = this._jumpStartX + (this._jumpTargetX - this._jumpStartX) * t;
    const h = 4 * this._jumpHeight * t * (1 - t);
    s.x = x;
    s.y = this._jumpStartY - h;
    if (t >= 1) {
      s.y = this._jumpStartY;
      s.body.setAllowGravity(true);
      s.body.setVelocity(0, 0);
      FX.explosionRing(this.scene, s.x, this._groundY(), this._jumpRadius);
      FX.screenShake(this.scene, 0.012, 250);
      this._landSquashT = this.scene.time.now;
      this._freezeUntil = this.scene.time.now + 1000;   // after the landing: stands still, no skills, 1 s (user 2026-10-13)
      const player = this.scene.player;
      if (player && !player.dead && player.sprite.body.onFloor()) {
        if (Math.abs(player.sprite.x - s.x) <= this._jumpRadius) {
          if (player.takeDamage(this._jumpDamage, s.x)) player.blockAttack(2000);   // sealed normal attack for 2 s (user 2026-10-13)
        }
      }
      this._state = 'cooldown';
      this._stateTimer = 0;
    }
  }

  _updateDash(dt) {
    const s = this.sprite;
    const b = this._worldBounds();
    const step = this._dashSpeed * dt;
    s.x += this._dashDir * step;
    this._dashRemaining -= step;
    FX.dashTrail(this.scene, s.x, s.y - this._dispH * 0.5, this._dashDir);
    if (this._dashDir > 0 && s.x >= b.right - this._dispW * 0.3) { s.x = b.right - this._dispW * 0.3; this._dashRemaining = 0; }
    if (this._dashDir < 0 && s.x <= this._minX()) { s.x = this._minX(); this._dashRemaining = 0; }
    if (this._dashRemaining <= 0) {
      this._dashContact = false;
      this._state = 'cooldown';
      this._stateTimer = 0;
    }
  }

  // Vendor's skill (stir fry): cfg = { durationMs, intervalMs, damage }. Ignores boss invulnerability frames; already scorched -> ignored.
  scorch(now, cfg) {
    if (this.dead || this._entering || this._scorchEnd > 0 || this._skillInv()) return;
    this._scorchCfg = { durationMs: cfg.durationMs, intervalMs: cfg.intervalMs, damage: cfg.damage, ticks: Math.floor(cfg.durationMs / cfg.intervalMs + 1e-6) };
    this._scorchEnd = now + cfg.durationMs;
    this._scorchStep = 0;
  }

  _updateScorch(now) {
    if (this._scorchEnd <= 0) return;
    const sc = this._scorchCfg, t0 = this._scorchEnd - sc.durationMs;
    while (this._scorchStep < sc.ticks && now >= t0 + (this._scorchStep + 1) * sc.intervalMs) {
      this._scorchStep++;
      if (this._skillInv()) continue;   // invulnerable: that tick is lost, not postponed
      this.hp -= sc.damage;
      FX.damageNumber(this.scene, this.sprite.x, this.sprite.y - this._dispH, sc.damage, false, false);
      FX.burnFlame(this.scene, this.sprite.x, this.sprite.y - this._dispH * 0.5);
      if (this.hp <= 0) { this.hp = 0; this._die(); return; }
    }
    if (now >= this._scorchEnd) this._scorchEnd = 0;
  }

  _updateBurn(dt) {
    if (this._skillInv()) return;
    if (this._burnDps > 0 && this._burnTimer > 0) {
      this._burnTimer -= dt;
      this._burnAcc += this._burnDps * dt;
      this._burnFxTimer -= dt;
      if (this._burnFxTimer <= 0) {
        FX.burnFlame(this.scene, this.sprite.x, this.sprite.y - this._dispH * 0.5);
        this._burnFxTimer = 0.2;
      }
      if (this._burnAcc >= 1) {
        const d = Math.floor(this._burnAcc);
        this._burnAcc -= d;
        this.hp -= d;
        FX.damageNumber(this.scene, this.sprite.x, this.sprite.y - this._dispH, d, false, false);
        if (this.hp <= 0) { this.hp = 0; this._die(); return; }
      }
      if (this._burnTimer <= 0) this._burnDps = 0;
    }
  }

  _die() {
    if (this.dead) return;
    this.dead = true;
    this._clearTelegraph();
    this._clearWave();
    this._clearLaser();
    this._clearRain();
    for (const proj of this._projectiles) proj.destroy();
    this._projectiles = [];
    this._clearGlints();
    if (this._fxG) { this._fxG.destroy(); this._fxG = null; }
    for (const pl of this._pools) if (pl && pl.destroy) pl.destroy();
    this._pools = [];
    if (this._phaseBar) { this._phaseBar.destroy(); this._phaseBar = null; }
    const x = this.sprite.x, y = this.sprite.y;
    FX.deathPoof(this.scene, x, y - this._dispH * 0.5);
    FX.screenShake(this.scene, 0.015, 400);
    if (!this._deadEmitted) {
      this._deadEmitted = true;
      this.scene.events.emit('enemy-dead', { x: x, y: y, ref: this });  // contract payload, same as Enemy
    }
    this.sprite.destroy();
  }

  takeHit(damage, srcX, isCrit, info) {
    if (this.dead || this._entering) return;
    if (this._invuln > 0 || this._skillInv()) return;   // rainbow_sky_rain: invulnerable
    this.hp -= damage;
    FX.hitEnemy(this.scene, this.sprite, isCrit, this.sprite.x, this.sprite.y - this._dispH * 0.5);
    FX.damageNumber(this.scene, this.sprite.x, this.sprite.y - this._dispH, damage, isCrit, false);
    this._hitCd = 0.08;
    this._invuln = 0.05;
    this._hitSquashUntil = this.scene.time.now + 320; this._flashUntil = this.scene.time.now + 160;
    if (this.hp <= 0) { this.hp = 0; this._die(); return; }
    this._onNormalHit(info);
  }

  applyBurn(dps, duration) {
    if (this.dead || this._skillInv()) return;
    this._burnDps = Math.max(this._burnDps, dps);
    this._burnTimer = Math.max(this._burnTimer, duration);
  }

  update(time, delta, player) {
    if (this.dead) return;
    if (this._entering) { this._updateEntrance(); this._drawPhaseBar(); return; }
    const dt = delta / 1000;
    if (this._hitCd > 0) this._hitCd -= dt;
    if (this._invuln > 0) this._invuln -= dt;
    this._updateBurn(dt);
    if (this.dead) return;
    this._updateScorch(this.scene.time.now);
    if (this.dead) return;
    this._checkPhase();
    this._drawPhaseBar();
    this._updateWalk(dt);
    this._updateAnim(dt, this.scene.time.now);
    this._updateFx(this.scene.time.now);
    this._updateGlints(dt, this.scene.time.now);
    if (player && player.sprite) {
      this.sprite.setFlipX(player.sprite.x >= this.sprite.x);
      this._dashDir = (player.sprite.x >= this.sprite.x) ? 1 : -1;
    }
    this._updateProjectiles(dt);
    this._updateRain(dt, this.scene.time.now);
    if (this._state === 'idle') {
      this._stateTimer += delta;
      if (this._stateTimer >= this._idleDuration) {
        const pat = this._nextPattern();
        if (pat) this._startTelegraph(pat);
        else this._stateTimer = 0;
      }
    } else if (this._state === 'telegraph') {
      if (!this._telegraphed) { this._doTelegraph(this._activePattern); this._telegraphed = true; }
      this._stateTimer += delta;
      if (this._stateTimer >= this._telegraphMs) {
        this._clearTelegraph();
        this._execute(this._activePattern);
      }
    } else if (this._state === 'dash') {
      this._updateDash(dt);
    } else if (this._state === 'jump') {
      this._updateJump(dt);
    } else if (this._state === 'wave') {
      this._updateWave(dt);
    } else if (this._state === 'laser') {
      this._updateLaser(dt);
    } else if (this._state === 'rain') {
      this._updateRainState(delta);
    } else if (this._state === 'cooldown') {
      this._stateTimer += delta;
      const cdm = this._activePattern ? this._activePattern.cooldown_ms : null;
      const cd = cdm != null ? cdm : 1000;   // 0 is a real value (the level-5 boss has none: only the fixed 0.8 s idle between skills)
      if (this._stateTimer >= cd) {
        this._state = 'idle';
        this._stateTimer = 0;
      }
    }
    if (player && !player.dead && this.sprite.active && this._state !== 'jump') {   // no touch damage during the jump flight: the landing shockwave (and its attack seal) is that skill's hit
      if (Phaser.Geom.Intersects.RectangleToRectangle(bodyRect(this.sprite), bodyRect(player.sprite))) {
        const dmg = this._dashContact ? this.contactDamage * 1.5 : this.contactDamage;
        player.takeDamage(dmg, this.sprite.x);
      }
    }
  }
}
