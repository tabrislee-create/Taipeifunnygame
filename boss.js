const RAIN_COLS = [0x3aa0ff, 0x40d060, 0xffd830, 0xff3a3a, 0xff4fd8, 0xff9a20];   // rainbow_sky_rain strip colours
const RAIN_G = 900;   // strip gravity (px/s^2)
// 窯火燃身護身的火焰盾牌 (user 2026-11-13): tongue layers, [width x, height x, colour, alpha] of params.flame_h - wide dark orange outside,
// narrow pale-yellow core (same warm multi-layer gradient idea as the kiln pool's KF_LAY in effects.js, drawn here so that function stays untouched).
const GUARD_FLAME = [[0.66, 1.0, 0xff3a00, 0.5], [0.48, 0.84, 0xff8a10, 0.72], [0.32, 0.64, 0xffc83a, 0.82], [0.17, 0.42, 0xfff4c0, 0.95]];

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
    this._smokeImgs = [];
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
    this._swings = [];
    this._waveObj = null;
    this._rain = null; this._rainStripes = []; this._rainPuddles = []; this._rainGlow = []; this._rainG = null;   // rainbow_sky_rain state
    this._guard = null; this._guardG = null;   // guard_shield (窯火燃身護身, user 2026-11-13): the 5 s window and its single Graphics
    this._glints = []; this._pools = []; this._glintAcc = 0;       // code-drawn light effects (no flares baked into the art)
    this._afx = 1; this._afy = 1; this._hitSquashUntil = 0; this._flashUntil = 0; this._landSquashT = -1e9;   // procedural squash & stretch
    this._dormant = !!def.wake;
    this._wakeOpenMs = (def.wake && def.wake.open_ms) || 600;
    this._stones = []; this._stoneJobs = [];   // stone_toss / stone_rain: live stones and pending launches
    this._boulders = []; this._boulderJobs = []; this._boulderGlow = false; this._boulderInv = false; this._boulderHalo = null;   // boulder_roll state
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
      this._clearStones();
      this._clearBoulders();
      this._rainGlowOff();
      this._clearGuard();   // 護身 (user 2026-11-13): the new phase resets the state to idle, so the flame shield must go with it
      this._useCount = new Map();   // pattern max_uses is counted per phase (user 2026-10-13: the minion summon, twice in phase 1 and in phase 2)
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
    for (const im of this._smokeImgs) im.destroy(); this._smokeImgs = [];
    this._laserActive = false;
  }

  _groundY() {
    const sc = this.scene, lvl = sc.lvl;
    if (sc.surfaceYAt && this.sprite) return sc.surfaceYAt(this.sprite.x);   // stepped rocks (level 15 boss stage)
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
  // max_uses (this skill at most N times per phase, the opening seq use counts), immediate (the first seq skill starts at once when the phase begins), once (only ever used inside the seq), trigger 'on_hit' (not in the rotation: starts when the player's normal attack hits, see _onNormalHit).
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
    if (!this._useCount) this._useCount = new Map();
    const stamp = (p) => { this._skillCd.set(p.id || p.primitive, now + (p.cd_ms || 0)); if (p.max_uses) this._useCount.set(p, (this._useCount.get(p) || 0) + 1); return p; };
    if (this._seq && this._seq.length) return stamp(this._seq.shift());
    if (now < this._freezeUntil) return null;
    const ready = pats.filter((p) => !p.trigger && !p.once && now >= (this._skillCd.get(p.id || p.primitive) || 0) && !(p.max_uses && (this._useCount.get(p) || 0) >= p.max_uses));
    return ready.length ? stamp(ready[Math.floor(Math.random() * ready.length)]) : null;
  }

  // 藍色衝撞 (phase 1): started by any player hit (normal attack or skill, not burn) on the boss, only while the boss is not busy with another skill or frozen after a landing; own cooldown.
  _onNormalHit(info) {   // any player hit counts, normal attack or skill (user 2026-10-13); burn damage does not go through takeHit
    if (this._seq && this._seq.length) return;   // the opening skill (summon) comes first
    if (this._state !== 'idle' && this._state !== 'cooldown') return;
    const now = this.scene.time.now;
    if (now < this._freezeUntil) return;
    const pats = this._activePatterns(), pat = pats.find((p) => p.trigger === 'on_hit');
    if (!pat) return;
    if (!this._skillCd) this._skillCd = new Map();
    // a skill that is due (opening sequence pending, or a free-choice skill whose cooldown is over) goes first: otherwise hitting the boss non-stop would starve the summon
    if ((this._seq && this._seq.length) || pats.some((p) => !p.trigger && !p.once && now >= (this._skillCd.get(p.id || p.primitive) || 0) && !(p.max_uses && ((this._useCount && this._useCount.get(p)) || 0) >= p.max_uses))) return;   // a skill already at max_uses is no longer "due" (else the crescent stayed blocked for good)
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
    if (pr === 'dash' && p.fx === 'shockwave') {
      // no warning
    } else if (pr === 'dash') {
      const dir = (this._dashDir >= 0) ? 1 : -1;
      const dist = p.distance || 200;
      const x0 = s.x;
      const x1 = dir > 0 ? Math.min(b.right, x0 + dist) : Math.max(this._minX(), x0 - dist);
      const cx = (x0 + x1) / 2;
      const w = Math.abs(x1 - x0);
      this._telegraphObjs.push(FX.telegraphRect(scene, cx, gy - 30, w, 60, tm));
    } else if (pr === 'projectile_fan' || pr === 'stone_toss' || pr === 'stone_rain') {
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
      this._aoeXs = this._poolXs(p, this._aoeX);   // params.count pools at once (kiln pool: 2, user 2026-10-28): the first where the player stood, the others beside it
      for (const ax of this._aoeXs) {
        if (this.def.aoe_telegraph === 'kiln') {
          this._telegraphObjs.push(FX.telegraphKiln(scene, ax, gy - 10, p.radius || 150, tm));
        } else {
          this._telegraphObjs.push(FX.telegraphCircle(scene, ax, gy - 10, p.radius || 150, tm));
        }
      }
    } else if (pr === 'rainbow_homing_projectile') {
      this._telegraphObjs.push(FX.telegraphCircle(scene, s.x, s.y - this._dispH * 0.6, 40, tm));
    } else if (pr === 'rainbow_sky_rain') {
      this._telegraphObjs.push(FX.telegraphCircle(scene, s.x, s.y - this._dispH * 1.0 - 20, 70, tm));
      this._rainGlowOn();   // the colour outline starts with the charge (user 2026-11-13: the charge + rain window is no longer invulnerable, it just takes damage_taken_mult of the raw hit — see _dmgTakenMult)
      if (scene.textures.exists('bossskill_rain')) { this._rainTextImg = scene.add.image(s.x, s.y, 'bossskill_rain').setDepth(97).setAlpha(0); this._rainTextImg.setDisplaySize(260, 260 * this._rainTextImg.height / this._rainTextImg.width); this._telegraphObjs.push(this._rainTextImg); }   // brush-calligraphy skill name over the head for the whole charge
    } else if (pr === 'guard_shield') {   // 窯火燃身 (user 2026-11-13): no dash path to warn - the ring of fire gathers on the body, so the warning circle goes there too (the old 'dash' branch's red floor rectangle would have promised a charge that never comes)
      this._telegraphObjs.push(FX.telegraphCircle(scene, s.x, s.y - this._dispH * 0.6, 40, tm));
    } else if (pr === 'summon_adds') {
      this._slotCache = this._summonSlots(p);   // the minions appear exactly where the warning circles are
      for (const sl of this._slotCache) this._telegraphObjs.push(FX.telegraphCircle(scene, sl.x, gy - 20, 30, tm));
    } else if (pr === 'boulder_roll') {   // 2 s yellow-glow pause, invulnerable from the start of the warning
      this._boulderGlow = true; this._boulderInv = true;
      const halo = scene.add.circle(s.x, s.y - this._dispH * 0.5, this._dispH * 0.7, 0xffe45a, 0.3).setDepth(4);
      scene.tweens.add({ targets: halo, alpha: 0.08, duration: 250, yoyo: true, repeat: -1 });
      this._boulderHalo = halo;
    } else if (pr === 'laser_sweep') {
      const fcT = (this.def.fx_colors || {}), bmT = fcT.beam;
      if (!bmT) {
        const dir = (this._dashDir >= 0) ? 1 : -1;
        const x0 = s.x;
        const x1 = dir > 0 ? b.right : b.left;
        const cx = (x0 + x1) / 2;
        const w = Math.abs(x1 - x0);
        this._telegraphObjs.push(FX.telegraphRect(scene, cx, gy - 18, w, 36, tm));
      }
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
    if (pr === 'dash' && p.fx === 'shockwave') {   // 藍色衝撞 (user 2026-10-13): no body dash, no warning; a blue shockwave travels along the floor toward the player and hits like the green puddle (normal hit + knock-back)
      this._spawnSwing(p, dir);
      this._state = 'cooldown';
      this._stateTimer = 0;
    } else if (pr === 'dash') {
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
      const xs = this._aoeXs && this._aoeXs.length ? this._aoeXs : [this._aoeX != null ? this._aoeX : s.x];
      this._aoeXs = null;
      for (const ax of xs) this._spawnPool(ax, p);
    } else if (pr === 'rainbow_homing_projectile') {
      this._state = 'cooldown';
      this._stateTimer = 0;
      this._fireHoming(p);
    } else if (pr === 'rainbow_sky_rain') {
      this._startRain(p);
    } else if (pr === 'guard_shield') {   // 窯火燃身 (user 2026-11-13): stand still behind a flame shield for params.duration_ms, taking params.damage_taken_mult of all damage
      this._startGuard(p);
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
      this._laserStage = 1; this._laserScale = 1; this._laserRest = 0;   // two stages (user 2026-10-28): jet, 0.5 s rest, then a jet with x2 reach / thickness and x2 duration
      this._laserBaseDuration = this._laserDuration;
      this._spawnLaserRects(1);
    } else if (pr === 'boulder_roll') { this._state = 'cooldown'; this._stateTimer = 0; this._queueBoulders(p);
    } else if (pr === 'stone_toss') {
      this._state = 'cooldown';
      this._stateTimer = 0;
      this._queueStones('toss', p);
    } else if (pr === 'stone_rain') {
      this._state = 'cooldown';
      this._stateTimer = 0;
      this._queueStones('rain', p);
    } else {
      this._state = 'cooldown';
      this._stateTimer = 0;
    }
  }

  // The jet's hit area (and, without fx colours, its plain visual); K scales length and thickness (stage 2 = 2).
  _spawnLaserRects(K) {
    const scene = this.scene, s = this.sprite, dir = this._laserDir, gy = this._groundY(), b = this._worldBounds();
    const fc = (this.def.fx_colors || {}), bm = fc.beam;
    if (bm) {
      const mx = s.x + dir * this._dispW * 0.5;
      const my = s.y - this._dispH * 0.6;
      const rect = scene.add.rectangle(mx + dir * 80 * K, my, 160 * K, 40 * K, bm.fill, 0.55);
      rect.setDepth(7);
      rect.setAlpha(0);
      this._laserRect = rect;
      const band = scene.add.rectangle(mx + dir * 80 * K, my, 160 * K, 40 * K, bm.band, 0.25);
      band.setDepth(8);
      band.setAlpha(0);
      this._laserBand = band;
    } else {
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
    }
  }

  _groundYAt(x) { const sc = this.scene; return sc.surfaceYAt ? sc.surfaceYAt(x) : this._groundY(); }   // surface height at x (stepped rocks on level 15's boss stage; flat elsewhere)

  _boulderEnd() {
    this._boulderGlow = false; this._boulderInv = false;
    if (this._boulderHalo) {
      // the halo breathes with a repeat:-1 tween (see _doTelegraph boulder_roll): stop it before
      // destroying the object, same as FX.telegraphCircle's pulse (user 2026-11-10 review round 1)
      this.scene.tweens.killTweensOf(this._boulderHalo);
      this._boulderHalo.destroy(); this._boulderHalo = null;
    }
  }

  _queueBoulders(p) {
    const now = this.scene.time.now, n = p.count || 3, gap = p.interval_ms || 1500, dir = this._dashDir >= 0 ? 1 : -1;
    for (let i = 0; i < n; i++) this._boulderJobs.push({ at: now + i * gap, p, dir });
    if (p.inv_through_rolls === false) this._boulderEnd();
  }

  _boulderTexture(d) {
    const key = 'fx_boulder_' + d;
    if (!this.scene.textures.exists(key)) {
      const g = this.scene.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0x8a8478);
      g.fillCircle(d / 2, d / 2, d / 2 - 3);
      g.lineStyle(5, 0x4a463e);
      g.strokeCircle(d / 2, d / 2, d / 2 - 3);
      
      const blotches = [[0.30, 0.35], [0.65, 0.28], [0.55, 0.62], [0.25, 0.68], [0.72, 0.55], [0.45, 0.45]];
      const radii = [0.10, 0.08, 0.09, 0.07, 0.08, 0.09];
      
      g.fillStyle(0x6e685c);
      for (let i = 0; i < blotches.length; i++) {
        const bx = d * blotches[i][0], by = d * blotches[i][1], br = d * radii[i];
        g.fillCircle(bx, by, br);
      }

      g.lineStyle(3, 0x4a463e);
      for (let i = 0; i < blotches.length; i++) {
        const bx = d * blotches[i][0], by = d * blotches[i][1];
        // Draw a short crack line from the blotch center outwards
        const angle = (i * Math.PI) / 3; 
        g.lineBetween(bx, by, bx + Math.cos(angle) * d * 0.15, by + Math.sin(angle) * d * 0.15);
      }

      g.generateTexture(key, d, d);
      g.destroy();
    }
    return key;
  }

  _launchBoulder(job) {
    const scene = this.scene, s = this.sprite, p = job.p, d = p.diameter || 200, r = d / 2, dir = job.dir;
    const x = s.x + dir * (this._dispW * 0.5 + r);
    const bk = 'rock_boulder_' + (1 + Math.floor(Math.random() * 4));
    const img = scene.add.image(x, this._groundYAt(x) - r, scene.textures.exists(bk) ? bk : this._boulderTexture(d)).setDepth(6);
    if (scene.textures.exists(bk)) img.setDisplaySize(d, d);
    img._dir = dir; 
    img._speed = p.speed || 300; 
    img._r = r; 
    img._dmg = (p.damage || 20) * this._am; 
    img._hit = false; 
    img._kx = p.knock_x || 650; 
    img._ky = p.knock_y || -380;
    this._boulders.push(img);
    FX.screenShake(scene, 6, 200);
  }

  _updateBoulders(dt) {
    const scene = this.scene;
    
    // Launch due jobs in schedule order (same shape as _updateStones: scan forward, collect,
    // then launch). A frame longer than the 1.5 s interval still means the catch-up boulders
    // spawn on top of each other (they always spawn at the boss's current x) - only the launch
    // order is fixed here.
    let launchedCount = 0;
    const due = [];
    for (let i = 0; i < this._boulderJobs.length; i++) {
      if (scene.time.now >= this._boulderJobs[i].at) {
        due.push(this._boulderJobs.splice(i, 1)[0]);
        i--;
      }
    }
    for (let i = 0; i < due.length; i++) { this._launchBoulder(due[i]); launchedCount++; }
    
    // If we launched something and no jobs remain, end the invulnerability/glow phase
    if (launchedCount > 0 && this._boulderJobs.length === 0 && this._boulderGlow) {
      this._boulderEnd();
    }

    // Keep halo centered on boss
    if (this._boulderHalo) {
      this._boulderHalo.setPosition(this.sprite.x, this.sprite.y - this._dispH * 0.5);
    }

    const bounds = this._worldBounds();
    const player = scene.player;

    // Update boulders
    for (let i = this._boulders.length - 1; i >= 0; i--) {
      const b = this._boulders[i];
      
      // Move and roll
      b.x += b._dir * b._speed * dt;
      { const want = this._groundYAt(b.x) - b._r;   // climbs a step at once (hugs the surface), drops off an edge by falling
        if (b.y < want - 1) { b._vy = (b._vy || 0) + 1600 * dt; b.y = Math.min(want, b.y + b._vy * dt); if (b.y >= want) b._vy = 0; } else { b.y = want; b._vy = 0; } }
      b.rotation += b._dir * b._speed * dt / b._r;

      // Collision with player
      if (player && !player.dead && !b._hit) {
        const circle = new Phaser.Geom.Circle(b.x, b.y, b._r * 0.95);
        const rect = bodyRect(player.sprite);
        
        if (Phaser.Geom.Intersects.CircleToRectangle(circle, rect)) {
          if (player.takeDamage(b._dmg, b.x)) {
            b._hit = true;
            player.sprite.body.setVelocity(b._dir * b._kx, b._ky);
            player._knockUntil = scene.time.now + 600;
            FX.hitSpark(scene, player.sprite.x, player.sprite.y - 30);
          }
        }
      }

      // Remove if off-screen
      const outOfBounds = b._dir > 0 ? b.x > bounds.right + b._r : b.x < bounds.left - b._r;
      if (outOfBounds) {
        b.destroy();
        this._boulders.splice(i, 1);
      }
    }
  }

  _clearBoulders() {
    for (const b of this._boulders) b.destroy();
    this._boulders = [];
    this._boulderJobs = [];
    this._boulderEnd();
  }

  _queueStones(kind, p) {
    const now = this.scene.time.now;
    const n = p.count || (kind === 'toss' ? 3 : 10);
    const gap = p.interval_ms || (kind === 'toss' ? 400 : 250);
    for (let i = 0; i < n; i++) this._stoneJobs.push({ at: now + i * gap, kind, p });
  }

  // small thrown stone: random one of 4 textures sized to the hit diameter (2r); falls back to the drawn circle
  _stoneShape(x, y, r) {
    const scene = this.scene, k = 'rock_stone_' + (1 + Math.floor(Math.random() * 4));
    let st;
    if (scene.textures.exists(k)) {
      st = scene.add.image(x, y, k).setDisplaySize(r * 3.6, r * 3.6);
      st._r = r;
      st.setRotation(Math.random() * Math.PI * 2);
    } else {
      st = scene.add.circle(x, y, r, 0x8a8478, 1);
      st.setStrokeStyle(3, 0x4a463e);
    }
    st.setDepth(6);
    return st;
  }

  _launchStone(job) {
    const scene = this.scene;
    const s = this.sprite;
    const p = job.p;
    let st;
    if (job.kind === 'toss') {
      const player = scene.player;
      let dirToPlayer = 1;
      if (!player || !player.sprite || player.dead) {
        dirToPlayer = this._dashDir >= 0 ? 1 : -1; // boss facing fallback (scaleX is always positive: facing is flipX / _dashDir)
      } else {
        dirToPlayer = (player.sprite.x >= s.x) ? 1 : -1;
      }
      const x0 = s.x + dirToPlayer * 40;
      const y0 = s.y - this._dispH * 0.8;
      let tx, ty;
      if (!player || !player.sprite || player.dead) {
        tx = x0 + dirToPlayer * 300;
        ty = y0; // roughly horizontal throw if no target
      } else {
        const body = player.sprite.body;
        tx = body.center.x;
        ty = body.center.y;
      }
      const g = p.gravity || 448;
      const speed = p.speed || 300;
      const T = Math.max(0.55, Math.min(1.5, Math.abs(tx - x0) / speed));
      const vx = (tx - x0) / T;
      const vy = (ty - y0 - 0.5 * g * T * T) / T;
      
      st = this._stoneShape(x0, y0, p.radius || 14);
      st._kind = 'toss';
      st._vx = vx;
      st._vy = vy;
      st._g = g;
      st._dmg = (p.damage || 12) * this._am;
      st._hit = false;
    } else { // rain
      const cam = scene.cameras.main.worldView;
      const b = this._worldBounds();
      const minX = Math.max(b.left + 40, cam.left + 30);
      const maxX = Math.min(b.right - 40, cam.right - 30);
      const x = minX + Math.random() * (maxX - minX);
      const yStart = cam.top - 40;
      const vy = 150;
      const g = 900;
      const gy = this._groundYAt(x);   // the surface where this stone will land (rock top or flat ground)
      
      // Calculate fall time for warning duration
      // h = v*t + 0.5*g*t^2 => 0.5*g*t^2 + v*t - h = 0
      // t = (-v + sqrt(v^2 + 2*g*h)) / g
      const h = gy - yStart;
      const fallTime = (-vy + Math.sqrt(vy * vy + 2 * g * h)) / g;
      
      FX.telegraphCircle(scene, x, gy - 6, 26, Math.round(fallTime * 1000));

      st = this._stoneShape(x, yStart, p.radius || 12);
      st._kind = 'rain';
      st._vx = 0;
      st._vy = vy;
      st._g = g;
      st._dmg = (p.damage || 10) * this._am;
      st._hit = false;
    }
    this._stones.push(st);
  }

  _updateStones(dt) {
    const now = this.scene.time.now;
    
    // Process due jobs in order
    const dueJobs = [];
    for (let i = 0; i < this._stoneJobs.length; i++) {
      if (now >= this._stoneJobs[i].at) {
        dueJobs.push(this._stoneJobs.splice(i, 1)[0]);
        i--; // Adjust index after splice
      }
    }
    for (const job of dueJobs) {
      this._launchStone(job);
    }

    const player = this.scene.player;
    const b = this._worldBounds();
    
    for (let i = this._stones.length - 1; i >= 0; i--) {
      const st = this._stones[i];
      st._vy += st._g * dt;
      st.x += st._vx * dt;
      st.y += st._vy * dt;
      if (st.type === 'Image') st.rotation += (st._vx >= 0 ? 1 : -1) * 6 * dt;

      let remove = false;
      
      // Check collision with player
      if (!st._hit && player && !player.dead) {
        const stoneBounds = st._r ? new Phaser.Geom.Rectangle(st.x - st._r, st.y - st._r, st._r * 2, st._r * 2) : st.getBounds(); // hit box stays 2r even though the picture is drawn larger
        const playerRect = bodyRect(player.sprite);
        if (Phaser.Geom.Intersects.RectangleToRectangle(stoneBounds, playerRect)) {
          player.takeDamage(st._dmg, st.x);
          st._hit = true;
          remove = true; // Stone breaks on contact
        }
      }

      // Check ground collision / out of bounds
      if (!remove) {
        const gy = this._groundYAt(st.x), sr = st._r || st.radius || 12;
        // Ground / rock hit: rain always hits, toss only if falling (vy > 0) or already inside a rock (flew into its side), to avoid immediate removal at launch
        if (st.y + sr >= gy && (st._kind === 'rain' || st._vy > 0 || st.y + sr >= gy + 6)) {
          remove = true;
        } else if (st.x < b.left - 100 || st.x > b.right + 100 || st.y > this.scene.lvl.y_ground + 200) {
          remove = true;
        }
      }

      if (remove) {
        FX.hitSpark(this.scene, st.x, st.y);
        st.destroy();
        this._stones.splice(i, 1);
      }
    }
  }

  _clearStones() {
    for (const st of this._stones) st.destroy();
    this._stones = [];
    this._stoneJobs = [];
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

  // x positions of the pools of one cast: params.count (default 1); the extra ones sit params.spacing (default 2.3 radii, so they do not overlap) to one side of the first, on the other side when that runs off the arena.
  _poolXs(p, x0) {
    const n = Math.max(1, p.count || 1), r = p.radius || 150, gap = p.spacing || r * 2.3, b = this._worldBounds(), lo = b.left + 40, hi = b.right - 40, xs = [x0];
    let side = Math.random() < 0.5 ? -1 : 1;
    if (x0 + gap > hi && x0 - gap >= lo) side = -1; else if (x0 - gap < lo && x0 + gap <= hi) side = 1;
    for (let i = 1; i < n; i++) xs.push(Math.max(lo, Math.min(hi, x0 + side * gap * i)));
    return xs;
  }

  // Green puddle / kiln pool: hurts once per tick_interval while the player stands in it, fades out at the end.
  _spawnPool(x, p) {
    const scene = this.scene, self = this, r = p.radius || 150, dur = p.duration || 3000, tick = p.tick_interval || 500, dmg = (p.damage_per_tick || 5) * this._am;
    const isKiln = this.def.aoe_telegraph === 'kiln';
    const pl = (this.def.fx_colors || {}).pool;
    const py = this._groundY() - 10;
    // g3g: kiln bosses have no visible ellipse (the flames + smoke replace it); other green_terrain_aoe bosses keep theirs.
    let pool;
    if (isKiln) {
      pool = { active: true, destroy: function () { this.active = false; }, setAlpha: function () {} };
    } else {
      pool = scene.add.ellipse(x, py, r * 2, 28, pl ? pl.fill : 0x4cd964, 0.8).setStrokeStyle(2, pl ? pl.stroke : 0x1f8f3a).setDepth(1.9);
    }
    // 20 groups of flame tongues over the pool (g3g: telegraph no longer produces a field, flames grow from the ground)
    const flames = FX.kilnPoolFlames(scene, x, py, r, dur, null);
    const t0 = scene.time.now;
    let gone = false;
    const kill = function () {   // one way out: the duration, the boss dying, or the level ending
      if (gone) return;
      gone = true;
      scene.events.off('update', upd);
      if (pool.active) pool.destroy();
      if (flames.active) flames.destroy();   // its 33 ms redraw dies with the container
    };
    const upd = function () {
      if (gone) return;
      if (!pool.active || !flames.active) { kill(); return; }   // _die() already destroyed them
      const now = scene.time.now, left = t0 + dur - now;
      if (left <= 0) { kill(); return; }
      pool.setAlpha(left < 600 ? 0.8 * left / 600 : 0.72 + 0.08 * Math.sin(now / 120));
      const plr = scene.player;
      // The flat ellipse is only the ground-perspective look; the game is 2D, so the range is the X axis the
      // character stands on - the same test a pit trap uses (level.js _pitAt: the sprite's x against l/r, no y).
      if (plr && !plr.dead && plr.sprite && Math.abs(plr.sprite.x - x) <= r) {
        plr.applyDot(2000, dmg, tick);
        if (p.stun && !(now < plr.examUntil || now < plr.nanoUntil || now < plr.stirUntil)) plr.applyStun(160);   // burned in the pool (user 2026-10-28): no move, no attack, no skill while it burns; free again when it ends or they are not being burned (invincible)
      }   // standing in it (re)starts a 2 s damage-over-time, one tick per tick_interval (user 2026-10-13)
    };
    scene.events.on('update', upd);
    this._pools.push(pool);
    this._pools.push(flames);
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
    const b = this._worldBounds(); let lo = this._minX(), hi = b.right - this._dispW * 0.3;
    const br = scene._bossRange; if (br) { lo = Math.max(lo, br.l + this._dispW * 0.3); hi = Math.min(hi, br.r - this._dispW * 0.3); }   // stays on the top rock
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
    else if (st === 'guard') { fx = 1.05 + 0.02 * Math.sin(now / 200); fy = 0.96 - 0.02 * Math.sin(now / 200); }   // 護身: a slow breath behind the fire ring
    else if (st === 'wave' || st === 'laser') { fx = 1.05; fy = 0.93; }
    else if (this._moving) { const k = Math.sin(now / 110); fx = 1.06 + 0.06 * k; fy = 0.95 - 0.06 * k; }   // slithering wobble
    const land = (now - this._landSquashT) / 320;
    if (land >= 0 && land < 1) { const k = 1 - land; fx = Math.max(fx, 1 + 0.2 * k); fy = Math.min(fy, 1 - 0.22 * k); }
    const a = Math.min(1, dt * 14);
    this._afx += (fx - this._afx) * a; this._afy += (fy - this._afy) * a;
    if (now >= this._hitSquashUntil) s.setScale(s.baseScaleX * this._afx, s.baseScaleY * this._afy);
    const rageP = this._activePattern && this._activePattern.params && this._activePattern.params.fx === 'rage' && (st === 'telegraph' || st === 'dash' || st === 'guard');   // 'guard' (user 2026-11-13): 窯火燃身 no longer dashes, the orange flicker keeps the shield readable; 'dash' stays for any boss that still dashes with fx 'rage'
    if (this._scorchEnd > 0) {   // scorched: solid red instead of the hue drift
      s.setTint(0xff3030);
    } else if (st === 'rain' || this._rainCharge()) {   // rainbow_sky_rain (charge + fire): fast hue cycle
      const c = Phaser.Display.Color.HSVToRGB((now / 260) % 1, 0.4, 1);
      s.setTint(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
    } else if (this._boulderGlow) {   // boulder_roll: flickering yellow glow
      s.setTint(Math.floor(now / 120) % 2 ? 0xffe45a : 0xfff3a0);
    } else if (rageP) {   // 狂暴連衝: flickers orange
      s.setTint(Math.floor(now / 70) % 2 ? 0xff8a1a : 0xffc890);
    } else if (now >= this._flashUntil) {   // slow pastel hue drift = light flowing through the body
      if (Array.isArray(this.def.phase_tints)) {
        s.setTint(this.def.phase_tints[Math.min(this._phaseIndex, this.def.phase_tints.length - 1)]);
      } else {
        const h = (now / 5200) % 1, c = Phaser.Display.Color.HSVToRGB(h, 0.16, 1);
        s.setTint(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
      }
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
    const b = this._worldBounds(), types = (p.sequence && p.sequence.length) ? p.sequence : Array.from({ length: p.count || 1 }, () => p.enemy_type), out = [];
    // random x inside the current camera view (user 2026-10-13), kept inside the arena
    const v = this.scene.cameras.main.worldView, lo = Math.max(this._minX() + 20, v.left + 40), hi = Math.max(lo, Math.min(b.right - 40, v.right - 40));
    for (let i = 0; i < types.length; i++) out.push({ type: types[i], x: lo + Math.random() * (hi - lo) });
    return out;
  }

  // The minions come out one after another (params.interval_ms apart, default 350), each with a small spark.
  _summon(p) {
    const scene = this.scene, gy = this._groundY(), gap = p.interval_ms || 350, self = this;
    const slots = this._slotCache || this._summonSlots(p);
    this._slotCache = null;
    slots.forEach(function (sl, i) {
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
      ti.setPosition(s.x, Math.max(78 + ti.displayHeight / 2, s.y - this._dispH - 66 - ti.displayHeight / 2));
    }
    if (st === 'telegraph' && pr === 'rainbow_sky_rain') {   // colour orb gathering over the head
      const p = Math.min(1, this._stateTimer / (this._telegraphMs || 1)), hx = s.x, hy = s.y - this._dispH - 20, R = 10 + 46 * p;
      for (let i = 0; i < 6; i++) { const a = now / 300 + i * Math.PI / 3; g.fillStyle(RAIN_COLS[i], 0.55); g.fillCircle(hx + Math.cos(a) * R * 0.5, hy + Math.sin(a) * R * 0.3, R * 0.55); }
      g.fillStyle(0xffffff, 0.2 + 0.5 * p); g.fillCircle(hx, hy, R * 0.4);
    }
    const fcB = (this.def.fx_colors || {}), bmB = fcB.beam;
    if (bmB && st === 'telegraph' && pr === 'laser_sweep') {   // kiln-fire glow gathering outside the chest
      const dir = this._dashDir >= 0 ? 1 : -1;
      const mx = s.x + dir * this._dispW * 0.5;
      const my = s.y - this._dispH * 0.6;
      const T = this._telegraphMs || 1;
      const t = this._stateTimer;
      let R, a, p;
      if (t < T - 500) {
        p = t / (T - 500);
        R = 8 + 30 * p;
        a = 1;
      } else {
        p = 1;
        R = 38;
        a = Math.max(0, 1 - (t - (T - 500)) / 500);
      }
      const cx = mx + dir * R;
      const fl = 1 + 0.08 * Math.sin(now / 70);
      g.fillStyle(bmB.glow, 0.25 * a * fl); g.fillCircle(cx, my, R * 1.35);
      g.fillStyle(bmB.fill, 0.45 * a * fl); g.fillCircle(cx, my, R * 0.85);
      g.fillStyle(bmB.core, (0.35 + 0.5 * Math.min(1, p)) * a * fl); g.fillCircle(cx, my, R * 0.45);
    }
    if (bmB && st === 'laser' && !(this._laserRest > 0)) {   // irregular kiln-fire column from the chest (not drawn in the rest between the two stages)
      const dir = this._laserDir >= 0 ? 1 : -1;
      const mx = s.x + dir * this._dispW * 0.5;
      const my = s.y - this._dispH * 0.6;
      const K = this._laserScale || 1;   // stage 2 = 2: twice as long and as thick
      const el = this._laserTimer, D = this._laserDuration, L = 160 * K;
      const grow = Math.min(1, el / 150);
      const fade = (el >= D - 250) ? Math.max(0, (D - el) / 250) : 1;
      const N = 64;
      const Leff = L * grow * (0.95 + 0.05 * Math.sin(now / 80));
      const base = (u) => {
        let b = 4 + 15 * Math.sin(Math.min(1, u / 0.75) * Math.PI / 2);
        if (u > 0.8) b *= 1 - 0.75 * Math.pow((u - 0.8) / 0.2, 2);
        return b * K;
      };
      const jag = (i, phase) => 0.55 * Math.sin(now / 70 + i * 0.55 + phase) + 0.3 * Math.sin(now / 45 + i * 1.1 + phase * 1.7) + 0.15 * Math.sin(now / 28 + i * 2.3 + phase * 0.6);
      const ax = (u) => mx + dir * u * Leff;
      const ay = (u) => my + Math.sin(now / 130 + u * 5) * 2;
      const hwTop = (i, u) => Math.max(0.5, base(u) * (1 + 0.28 * jag(i, 0)));
      const hwBot = (i, u) => Math.max(0.5, base(u) * (1 + 0.28 * jag(i, 3.1)));
      const mix = (c1, c2, t) => {
        const r = Math.round((c1 >> 16 & 255) + ((c2 >> 16 & 255) - (c1 >> 16 & 255)) * t);
        const gg = Math.round((c1 >> 8 & 255) + ((c2 >> 8 & 255) - (c1 >> 8 & 255)) * t);
        const b = Math.round((c1 & 255) + ((c2 & 255) - (c1 & 255)) * t);
        return (r << 16) | (gg << 8) | b;
      };
      const layer = (u0, u1, scale, color, alpha) => {
        const pts = [];
        const i0 = Math.round(u0 * (N - 1)), i1 = Math.round(u1 * (N - 1));
        const span = (u1 - u0) || 1;
        for (let i = i0; i <= i1; i++) {
          const u = i / (N - 1);
          const t = (u - u0) / span;
          const env = Math.pow(Math.min(1, t / 0.18), 0.6) * Math.pow(Math.min(1, (1 - t) / 0.18), 0.6);
          pts.push({ x: ax(u), y: ay(u) - hwTop(i, u) * scale * env });
        }
        for (let i = i1; i >= i0; i--) {
          const u = i / (N - 1);
          const t = (u - u0) / span;
          const env = Math.pow(Math.min(1, t / 0.18), 0.6) * Math.pow(Math.min(1, (1 - t) / 0.18), 0.6);
          pts.push({ x: ax(u), y: ay(u) + hwBot(i, u) * scale * env });
        }
        g.fillStyle(color, alpha);
        g.fillPoints(pts, true);
      };
      if (!this.scene.textures.exists('fx_smoke3')) {   // big soft cloud puff texture
        const sg = this.scene.make.graphics({ x: 0, y: 0, add: false });
        for (let i = 0; i < 16; i++) {
          const r = 32 - i * 1.9;
          sg.fillStyle(0xffffff, 0.12);
          sg.fillCircle(32, 32, r);
        }
        sg.generateTexture('fx_smoke3', 64, 64); sg.destroy();
      }
      const SM = 36;
      if (this._smokeImgs.length === 0) {
        for (let j = 0; j < SM; j++) {
          const im = this.scene.add.image(0, 0, 'fx_smoke3');
          im.setVisible(false);
          im.setDepth(j % 2 === 0 ? 5.4 : 5.6);   // even behind the column, odd in front
          this._smokeImgs.push(im);
        }
      }
      const hs = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
      const mixc = (c1, c2, t) => ((Math.round((c1 >> 16 & 255) + ((c2 >> 16 & 255) - (c1 >> 16 & 255)) * t) << 16) | (Math.round((c1 >> 8 & 255) + ((c2 >> 8 & 255) - (c1 >> 8 & 255)) * t) << 8) | Math.round((c1 & 255) + ((c2 & 255) - (c1 & 255)) * t));
      for (let j = 0; j < SM; j++) {
        const im = this._smokeImgs[j];
        const r1 = hs(j, 1), r2 = hs(j, 2), r3 = hs(j, 3);
        const delay = r2 * 250;
        const P = 900 + (j % 7) * 40;
        const t = el - delay;
        if (t < 0 || t >= P) { im.setVisible(false); continue; }   // one-shot puff, no loop
        const ph = t / P;
        im.setVisible(true);
        const u = 0.3 + 0.7 * r1;
        const x0 = ax(u);
        const y0 = ay(u) + (r2 - 0.5) * 12;
        const rise = 30 + 40 * r3;
        const py = y0 - rise * (1 - Math.pow(1 - ph, 1.4));
        const px = x0 + dir * (6 + 14 * r2) * ph + Math.sin(ph * 4 + j) * 4;
        const sz = (0.38 + 0.52 * ph) * (0.75 + 0.5 * r3);   // round billowing cloud, not stretched
        im.setScale(sz, sz * 0.9);
        const a = 0.8 * Math.min(1, ph * 5) * Math.pow(1 - ph, 0.9) * fade * Math.min(1, grow);
        im.setAlpha(a);
        im.setTint(mixc(0x2e241c, 0xa08c78, ph));
        im.setPosition(px, py);
      }
      layer(0, 1, 1.45, bmB.fill, 0.1 * fade); // faint outer halo
      layer(0, 1, 1.0, bmB.fill, 0.32 * fade);
      layer(0.03, 0.97, 0.82, bmB.fill, 0.38 * fade);
      layer(0.06, 0.93, 0.66, mix(bmB.fill, bmB.glow, 0.5), 0.45 * fade);
      layer(0.09, 0.9, 0.52, bmB.glow, 0.55 * fade);
      layer(0.12, 0.86, 0.4, bmB.glow, 0.65 * fade);
      layer(0.16, 0.8, 0.28, mix(bmB.glow, bmB.core, 0.5), 0.78 * fade);
      layer(0.2, 0.72, 0.16, bmB.core, 0.92 * fade);
      if (grow >= 1) {
        const ayTip = ay(1);
        for (let i = 0; i < 5; i++) {
          const ph = (now / 200 + i * 0.37) % 1;
          const x = mx + dir * (Leff + 4 + 6 * i);
          const y = ayTip + Math.sin(now / 110 + i * 2.1) * 7;
          g.fillStyle(i % 2 ? bmB.core : bmB.fill, (1 - ph) * 0.8 * fade);
          g.fillCircle(x, y, 2);
        }
      }
      g.fillStyle(bmB.core, 0.7 * fade); g.fillCircle(mx, my, 7);
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

  // Rainbow sky (pattern rainbow_sky_rain, user 2026-10-13): after the 2 s charge the boss stands still for params.duration_ms, lobbing params.count coloured strips from its head,
  // alternating left / right, landing 100-620 px away (8 shuffled distance bins per side; strips 3 and 7 of each side are aimed at the player when they stand on that side).
  // A strip hurts once (params.damage) if it touches the player in flight or splashes within 45 px of where it lands; the puddle it leaves is visual only.
  // Damage taken during the skill: user 2026-11-13 — the 2 s charge + duration rain window is no longer invulnerable; every damage path is multiplied by params.damage_taken_mult (0.5) while it is up.
  _rainCharge() { return this._state === 'telegraph' && !!this._activePattern && this._activePattern.primitive === 'rainbow_sky_rain'; }
  _skillInv() { return this._dormant || this._boulderInv || this._state === 'jump'; }   // also the whole flight of 黃色跳壓 (user 2026-10-13); 漫天幻彩 is no longer here (user 2026-11-13, see _dmgTakenMult)
  // 漫天幻彩 (user 2026-11-13): while the 2 s charge or the duration rain is up, every hp-damaging path is multiplied by params.damage_taken_mult (data-driven; 1 if missing).
  // 窯火燃身護身 (user 2026-11-13): the same one mechanism - same params field name, same takeHit / burn / scorch call sites, no second system.
  // Unlike 漫天幻彩 the 1.2 s telegraph is NOT covered (the user's spec: the reduction starts when the shield comes up), so only state 'guard' counts here.
  _dmgTakenMult() {
    if (!(this._state === 'rain' || this._rainCharge() || this._state === 'guard')) return 1;
    const p = this._activePattern && this._activePattern.params;
    const m = p && p.damage_taken_mult;
    return (typeof m === 'number' && isFinite(m)) ? m : 1;
  }
  _applyTakenMult(dmg) { const m = this._dmgTakenMult(); return m === 1 ? dmg : Math.max(1, Math.round(dmg * m)); }   // integer, never drops a real hit to 0

  _checkWake(player) {
    if (!this._dormant) return;
    if (!player || player.dead || !player.sprite) return;
    const w = this.def.wake;
    const s = this.sprite;
    const ps = player.sprite;
    if (Math.abs(ps.x - s.x) <= (w.distance || 400) && Math.abs(ps.body.bottom - s.body.bottom) <= (w.y_tol || 120)) {
      this._dormant = false;
      if (this.scene.textures.exists(this.id + '_open')) s.setTexture(this.id + '_open');
      this._freezeUntil = this.scene.time.now + this._wakeOpenMs;
      this._stateTimer = 0;
      FX.hitSpark(this.scene, s.x, s.y - this._dispH * 0.75);
      this.scene.cameras.main.shake(250, 0.004);
    }
  }

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

  // ==== 窯火燃身 turned into 護身 (user 2026-11-13, level 10 將軍俑) ====
  // Old skill: dash + fx 'rage' (a charge). New: after the 1.2 s telegraph the boss stands still for params.duration_ms (5 s) behind a ring of fire
  // and every damage path is multiplied by params.damage_taken_mult (0.5) - the mechanism is the level-5 漫天幻彩 one (_dmgTakenMult / _applyTakenMult),
  // so takeHit, the burn tick and Vendor's scorch all keep working without a second implementation. It is NOT invulnerable (deliberately not in _skillInv()).
  // The boss cannot start another skill while it stands: the update() state machine runs exactly one branch, and _updateWalk walks in idle/cooldown only.
  _startGuard(p) {
    this._state = 'guard';
    this._stateTimer = 0;
    this._guard = { t: 0, dur: p.duration_ms || 5000, p: p, fin: 300, fout: 500 };   // fin: the shield grows in over 0.3 s; fout: it blinks and fades over the last 0.5 s
    if (!this._guardG) this._guardG = this.scene.add.graphics().setDepth(5.6);   // in front of the body (sprite 5, _fxG 5.5), behind the laser rects (7-8) and the kiln-pool flames (50)
  }

  _updateGuardState(delta) {
    const gd = this._guard;
    if (!gd) { this._state = 'cooldown'; this._stateTimer = 0; return; }   // cleared from outside (phase change / death): fall into the normal cooldown flow instead of sticking in 'guard'
    gd.t += delta;
    if (gd.t >= gd.dur) {   // 護身 over: the same ending path as the rain state - cooldown (params cooldown_ms) -> idle -> next skill
      this._clearGuard();
      this._state = 'cooldown';
      this._stateTimer = 0;
    }
  }

  _clearGuard() {   // the one and only cleanup: the shield has no tweens and no timers, just this Graphics
    this._guard = null;
    if (this._guardG) { this._guardG.destroy(); this._guardG = null; }
  }

  // The flame shield, redrawn every frame into the single _guardG: params.flames (12) tongues on an ellipse around the body, the ring turning slowly,
  // each tongue flickering on its own phase, plus a faint outer halo (soft dots between the tongues). Follows the sprite position, its squash & stretch
  // (scaleX / baseScaleX) and the display size, so it scales with bigger bosses. Nothing is created per frame.
  _drawGuardShield(now) {
    const gd = this._guard, g = this._guardG, s = this.sprite;
    if (!gd || !g || !s || !s.active) return;
    g.clear();
    const p = gd.p;
    let a = Math.min(1, gd.t / gd.fin);
    let grow = 0.35 + 0.65 * a;   // grows in with the fade
    const left = gd.dur - gd.t;
    if (left < gd.fout) { const k = Math.max(0, left / gd.fout); a *= k * (Math.floor(now / 90) % 2 ? 0.45 : 1); grow *= 0.92 + 0.08 * k; }   // last 0.5 s: blink + fade out
    if (a <= 0.01) return;
    const cy = s.y - this._dispH * 0.56;   // the ring sits on the torso, not the geometric centre
    const kx = s.baseScaleX ? s.scaleX / s.baseScaleX : 1, ky = s.baseScaleY ? s.scaleY / s.baseScaleY : 1;
    const rx = this._dispW * (p.ring_rx || 0.62) * kx * grow, ry = this._dispH * (p.ring_ry || 0.34) * ky * grow;
    const hf = this._dispH * (p.flame_h || 0.26) * grow;
    const n = Math.max(6, Math.round(p.flames || 12));
    const rot = now / 1100;   // ~0.9 rad/s, one turn in ~7 s
    for (let i = 0; i < 18; i++) {   // the halo: two soft circles each, low alpha, so the ring reads as one faint glow
      const ang = rot * 0.6 + i * Math.PI / 9, c = Math.cos(ang), sn = Math.sin(ang);
      const rr = hf * (1.45 + 0.18 * Math.sin(now / 130 + i));
      const hx = s.x + c * rx, hy = cy + sn * ry;
      g.fillStyle(0xff6a10, 0.045 * a); g.fillCircle(hx, hy, rr);
      g.fillStyle(0xffb03a, 0.05 * a); g.fillCircle(hx, hy, rr * 0.55);
    }
    for (let i = 0; i < n; i++) {
      const ang = rot + i * (2 * Math.PI / n);
      const c = Math.cos(ang), sn = Math.sin(ang);
      const bx = s.x + c * rx, by = cy + sn * ry;
      const px = -sn, py = c;   // tangent direction: the flame licks sideways as the ring turns
      const fl = (0.86 + 0.1 * Math.sin(now / 70 + i * 1.7) + 0.06 * Math.sin(now / 33 + i * 0.9)) * (1 - 0.4 * Math.max(0, sn));   // tongues pointing down are shorter: they must not plough into the floor
      const lean = 0.16 * Math.sin(now / 260 + i * 1.3);
      for (let li = 0; li < GUARD_FLAME.length; li++) {
        const L = GUARD_FLAME[li], hh = hf * fl * L[1], hw = hf * L[0] * 0.5;
        if (hh < 1) continue;
        const mx = bx + c * hh * 0.5, my = by + sn * hh * 0.5;
        g.fillStyle(L[2], L[3] * a);
        g.fillPoints([
          { x: bx + px * hw, y: by + py * hw },
          { x: mx + px * hw * 0.5 - px * lean * hh, y: my + py * hw * 0.5 - py * lean * hh },
          { x: bx + c * hh + px * lean * hh * 2, y: by + sn * hh + py * lean * hh * 2 },
          { x: mx - px * hw * 0.5 - px * lean * hh, y: my - py * hw * 0.5 - py * lean * hh },
          { x: bx - px * hw, y: by - py * hw }
        ], true);
      }
    }
  }

  // 藍色衝撞 (user 2026-10-13): a big dark-blue crescent with a pale-blue halo starts straight above the boss's head (90 degrees) and swings down toward the player like a chop; no warning, the swing itself is the cue.
  // Hit once if its arc touches the player (normal hit + knock-back, like the green puddle). Backing off during the swing avoids it.
  _spawnSwing(p, dir) {
    // Shape (user's red-line sketch, 2026-10-13): a slim sickle riding the swing path, convex edge leading along the direction of travel, both tips trailing back, sharp points.
    // Gradient: layers share the outer arc and the tips and get thinner and lighter, so it runs from deep navy on the concave side to a near-white razor edge on the convex side.
    const fc = (this.def.fx_colors || {}), sw = fc.swing;
    const scene = this.scene, s = this.sprite, A0 = 75, SZ = 0.7, R = this._dispH * SZ / (2 * Math.sin(A0 * Math.PI / 180)), key = 'bluecrescent5_' + Math.round(this._dispH) + (sw ? '_' + this.def.id : '');   // tip-to-tip height = 0.7 x the boss's height (user 2026-10-13, was 0.85)
    const tw = Math.ceil(R * 2.6), th = Math.ceil(this._dispH * 1.5), ox = R * 1.2;
    if (!scene.textures.exists(key)) {
      const g = scene.add.graphics(), cy = th / 2;
      this._crescent(g, ox, cy, R * 1.1, 1, A0, 1.5, sw ? sw.glow[0] : 0xa8dcff, 0.18);
      this._crescent(g, ox, cy, R * 1.05, 1, A0, 1.5, sw ? sw.glow[1] : 0x7cc4ff, 0.3);
      const L = [[1.5, 0x061a66], [1.4, 0x0b2a8c], [1.3, 0x1647c4], [1.2, 0x2f78e6], [1.13, 0x6fb8ff], [1.07, 0xd8f2ff]];
      for (let i = 0; i < L.length; i++) this._crescent(g, ox, cy, R, 1, A0, L[i][0], sw ? sw.layers[i] : L[i][1], 1);
      // white cross glints on the blade (convex edge): one big near the middle, one small toward the upper tip
      const glint = (ang, len, wd) => {
        const gx = ox + R * Math.cos(ang * Math.PI / 180), gy = cy + R * Math.sin(ang * Math.PI / 180);
        g.fillStyle(0xffffff, 0.25); g.fillCircle(gx, gy, wd * 2.6);
        g.fillStyle(0xffffff, 1);
        g.fillPoints([{ x: gx - len, y: gy }, { x: gx, y: gy - wd }, { x: gx + len, y: gy }, { x: gx, y: gy + wd }], true);
        g.fillPoints([{ x: gx, y: gy - len }, { x: gx + wd, y: gy }, { x: gx, y: gy + len }, { x: gx - wd, y: gy }], true);
        g.fillCircle(gx, gy, wd * 1.2);
      };
      glint(-18, R * 0.34, R * 0.045);
      glint(-55, R * 0.2, R * 0.03);
      g.generateTexture(key, tw, th); g.destroy();
    }
    const img = scene.add.image(0, 0, key).setOrigin(ox / tw, 0.5).setDepth(6);
    this._swings.push({ img: img, dir: dir, t0: scene.time.now, px: s.x, py: s.y - this._dispH * 0.42, D: this._dispH * 1.25, R: R, ms: p.swing_ms || 1750, hit: false, dmg: this.contactDamage * 0.75 });   // halved from x1.5 (user 2026-10-13)
  }

  _updateSwings() {
    const scene = this.scene, player = scene.player, now = scene.time.now;
    for (let i = this._swings.length - 1; i >= 0; i--) {
      const w = this._swings[i], k = Math.min(1, (now - w.t0) / w.ms), e = k * k * (3 - 2 * k) * 0.35 + k * 0.65;   // slow start at the top, speeds up into the chop
      const th = (-90 + 110 * e) * Math.PI / 180, phi = w.dir > 0 ? th : Math.PI - th;
      const al = w.dir > 0 ? Math.atan2(Math.cos(phi), -Math.sin(phi)) : Math.atan2(-Math.cos(phi), Math.sin(phi));   // direction of travel along the path = where the convex edge points
      const bx = w.px + Math.cos(phi) * w.D, by = w.py + Math.sin(phi) * w.D;
      const cx = bx - Math.cos(al) * w.R * 0.62, cy = by - Math.sin(al) * w.R * 0.62;   // arc centre of the sickle (body centre sits on the path)
      w.img.setPosition(cx, cy).setRotation(al).setAlpha(now - w.t0 > w.ms ? Math.max(0, 1 - (now - w.t0 - w.ms) / 150) : 1);
      if (!w.last || now - w.last >= 45) {   // afterimage: a fading copy of the sickle left behind every 45 ms along the path
        w.last = now;
        const gh = scene.add.image(cx, cy, w.img.texture.key).setOrigin(w.img.originX, w.img.originY).setRotation(al).setDepth(5.9).setAlpha(0.4).setTint((this.def.fx_colors && this.def.fx_colors.swing) ? this.def.fx_colors.swing.trail : 0x7cc4ff);
        scene.tweens.add({ targets: gh, alpha: 0, duration: 320, onComplete: () => gh.destroy() });
      }
      if (!w.hit && k >= 0.05 && now - w.t0 <= w.ms + 60 && player && !player.dead) {
        const rc = bodyRect(player.sprite);
        for (let a = -75; a <= 75; a += 15) for (const rr of [0.75, 0.95]) {
          const ang = al + a * Math.PI / 180;
          if (Phaser.Geom.Rectangle.Contains(rc, cx + Math.cos(ang) * w.R * rr, cy + Math.sin(ang) * w.R * rr)) { w.hit = true; break; }
        }
        if (w.hit && player.takeDamage(w.dmg, w.px)) {
          // Cut away along the blade's normal at the contact point (arc centre -> player): in the air the player flies off along that normal, on the ground the force is taken as purely horizontal (user 2026-10-13)
          const pb = player.sprite.body, ex = pb.center.x - cx, ey = pb.center.y - cy, len = Math.hypot(ex, ey) || 1;
          let nx = ex / len, ny = ey / len;
          const SP = 550, grounded = pb.blocked.down || pb.touching.down;
          if (grounded) { const sx = Math.sign(nx) || Math.sign(Math.cos(al)) || 1; pb.setVelocity(sx * SP, 0); }
          else pb.setVelocity(nx * SP, ny * SP);
          player._knockUntil = now + 350;
          this._pushGuard = { until: now + 450, side: Math.sign(pb.center.x - this.sprite.x) || 1 };   // the knock-back must not carry the player through the boss
        }
      }
      if (now - w.t0 > w.ms + 150) { w.img.destroy(); this._swings.splice(i, 1); }
    }
  }

  // After a crescent hit the player is pushed along, but stops at the boss's body instead of passing through it.
  _applyPushGuard() {
    const g = this._pushGuard, pl = this.scene.player;
    if (!g || !pl || pl.dead) return;
    if (this.scene.time.now > g.until) { this._pushGuard = null; return; }
    const pb = pl.sprite.body, bb = this.sprite.body;
    if (g.side > 0) { if (pb.left < bb.right) { pl.sprite.x += bb.right - pb.left; if (pb.velocity.x < 0) pb.setVelocityX(0); } }
    else if (pb.right > bb.left) { pl.sprite.x -= pb.right - bb.left; if (pb.velocity.x > 0) pb.setVelocityX(0); }
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
    if (!(this._laserRest > 0)) { this._laserTimer += dt * 1000; this._laserHitTimer += dt * 1000; }
    if (player && !player.dead && this._laserRect && this._laserHitTimer >= 500) {
      if (Phaser.Geom.Intersects.RectangleToRectangle(this._laserRect.getBounds(), bodyRect(player.sprite))) {
        player.takeDamage(this._laserDamage, this.sprite.x);
        this._laserHitTimer = 0;
      }
    }
    if (this._laserRest > 0) {   // the 0.5 s breather between the two stages: no jet, nothing hurts
      this._laserRest -= dt * 1000;
      if (this._laserRest <= 0) {
        this._laserRest = 0; this._laserStage = 2; this._laserScale = 2;
        this._laserDuration = this._laserBaseDuration * 2; this._laserTimer = 0; this._laserHitTimer = 0;
        this._laserActive = true;
        this._spawnLaserRects(2);
      }
      return;
    }
    if (this._laserTimer >= this._laserDuration) {
      this._clearLaser();
      if (this._laserStage === 1) { this._laserRest = 500; return; }
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
      const tickDmg = this._applyTakenMult(sc.damage);   // 漫天幻彩 charge/rain: halved (user 2026-11-13)
      this.hp -= tickDmg;
      FX.damageNumber(this.scene, this.sprite.x, this.sprite.y - this._dispH, tickDmg, false, false);
      FX.burnFlame(this.scene, this.sprite.x, this.sprite.y - this._dispH * 0.5);
      if (this.hp <= 0) { this.hp = 0; this._die(); return; }
    }
    if (now >= this._scorchEnd) this._scorchEnd = 0;
  }

  _updateBurn(dt) {
    if (this._skillInv()) return;
    if (this._burnDps > 0 && this._burnTimer > 0) {
      this._burnTimer -= dt;
      this._burnAcc += this._burnDps * dt * this._dmgTakenMult();   // 漫天幻彩 charge/rain: the burn accumulates at half rate (user 2026-11-13); after the skill ends mult returns to 1, remaining duration ticks at full dps
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
    this._clearGuard();   // 護身 (user 2026-11-13): the flame shield must not outlive the boss (the defeat cutscene starts from _die)
    for (const proj of this._projectiles) proj.destroy();
    this._projectiles = [];
    this._clearStones();
    this._clearBoulders();
    for (const w of this._swings) w.img.destroy();
    this._swings = [];
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
    // chunk 8 (user 2026-11-13): remember where the body fell - the defeat cutscene of level 10 sprays its
    // pottery shards here and the sprite is destroyed right below, so nothing else can read the position.
    this._deathPos = { x: x, y: y, h: this._dispH };
    if (this.def.id === 'boss_slime_king') this._leaveGreyCorpse();   // level 5 boss (user 2026-10-14): stays on the field, the iridescent colours drained to grey
    else this.sprite.destroy();
  }

  _leaveGreyCorpse() {
    const s = this.sprite;
    if (this.scene.enemies) this.scene.enemies.remove(s, false, false);   // no longer a target / contact hazard, but not destroyed
    s.setScale(s.baseScaleX, s.baseScaleY); s.clearTint(); s.setAlpha(1);
    if (s.postFX && this.scene.renderer.type === Phaser.WEBGL) s.postFX.addColorMatrix().grayscale(1);
    else s.setTint(0x8c8c8c);   // canvas fallback: darkened
    const gap = this._groundY() - s.body.bottom;
    s.body.setVelocity(0, 0); s.body.enable = false;
    if (gap > 2) this.scene.tweens.add({ targets: s, y: s.y + gap, duration: 220, ease: 'Quad.easeIn' });   // died in mid-air: settle onto the ground
  }

  takeHit(damage, srcX, isCrit, info) {
    if (this.dead || this._entering) return;
    if (this._invuln > 0 || this._skillInv()) return;   // skill-level invulnerability (rock golem boulder/dormant, 黃色跳壓). 漫天幻彩 no longer blocks hits here — it takes _applyTakenMult(damage) below (user 2026-11-13).
    damage = this._applyTakenMult(damage);
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
    if (this._dormant) { this._checkWake(player); return; }   // eyes closed: no walking, no skills, no contact damage until woken
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
    this._updateStones(dt);
    this._updateBoulders(dt);
    this._updateSwings();
    this._applyPushGuard();
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
    } else if (this._state === 'guard') {
      this._updateGuardState(delta);   // 窯火燃身護身 (user 2026-11-13): stands still, cannot start another skill while this branch runs
    } else if (this._state === 'cooldown') {
      this._stateTimer += delta;
      const cdm = this._activePattern ? this._activePattern.cooldown_ms : null;
      const cd = cdm != null ? cdm : 1000;   // 0 is a real value (the level-5 boss has none: only the fixed 0.8 s idle between skills)
      if (this._stateTimer >= cd) {
        this._state = 'idle';
        this._stateTimer = 0;
      }
    }
    this._drawGuardShield(this.scene.time.now);   // 護身 (user 2026-11-13): after the state machine, so the shield vanishes on the very frame 護身 ends (or on death / phase change, which clear it)
    if (player && !player.dead && this.sprite.active && this._state !== 'jump') {   // no touch damage during the jump flight: the landing shockwave (and its attack seal) is that skill's hit
      if (Phaser.Geom.Intersects.RectangleToRectangle(bodyRect(this.sprite), bodyRect(player.sprite))) {
        const dmg = this._dashContact ? this.contactDamage * 1.5 : this.contactDamage;
        player.takeDamage(dmg, this.sprite.x);
      }
    }
  }
}
