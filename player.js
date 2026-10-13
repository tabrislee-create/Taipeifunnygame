const MELEE_RANGE_MULT = 1.3;  // melee reach = attack_range +30% (user 2026-10-09)
const MID_RANGE_MULT = 2.5;    // mid-range (projectile) weapons reach 2.5x the melee reach
const SPAWN_HEIGHT = 70;       // level start / pit respawn: the body's bottom edge starts this many px above the ground line (user 2026-10-09)
const SPAWN_HOVER_MS = 300;    // hovers (blinking, semi-transparent) this long before dropping, so the blink is visible; controls stay locked until landing

var PLAYER_WALK_FRAMES = { greenie: 4, geek: 4, vendor: 4, auntie: 4 };  // characters with frame-by-frame walk art (player_<id>_w1..wN.png)
// In-game display height per character (px); default 84.  Standard (user 2026-10-10, 3rd round): Geek's character is 115.5 px tall; Greenie = Geek / 1.1 = 105.0 px.
// Greenie's texture is filled top to bottom (224/224), so its display height is 105.0.  Geek's texture only fills 208/224 of its height (room for the laptop glow),
// so 115.5 / (208/224) = 124.4.  (Earlier rounds: Greenie 92.4 / Geek 115.5 = 1 : 1.25.)
const FOOT_SINK = 2;   // px the sprite is drawn below its physics body (see _applyVisual)
var PLAYER_DISPLAY_H = { greenie: 105.0, geek: 124.4, vendor: 115.5, auntie: 105.0 };  // vendor: texture filled top to bottom (224/224), so display height = body height = 115.5 (male standard, user 2026-10-10); auntie: also filled 224/224, female standard 105.0 (2026-10-11)
var PLAYER_WALK_FRAME_MS = +(new URLSearchParams(location.search).get('walkms')) || 175;  // per-frame time (ms) (4 frames = 0.7 s per cycle, user 2026-10-10) of the frame-by-frame walk; ?walkms=260 overrides it for trying speeds

class Player {
  constructor(scene, x, y) {
    this.scene = scene;
    this.sprite = makeSprite(scene, x, y, 'player_' + RUN.char, PLAYER_DISPLAY_H[RUN.char] || 84, 0x44aa44);
    this.sprite.ref = this;
    this._idleTex = 'player_' + RUN.char;
    const wn = PLAYER_WALK_FRAMES[RUN.char] || 0;
    this._walkTex = (wn && scene.textures.exists(this._idleTex + '_w1')) ? Array.from({ length: wn }, (_, i) => this._idleTex + '_w' + (i + 1)) : null;
    this.sprite.setCollideWorldBounds(true); // without this the player walked off the left edge (x<0, no ground) and fell into the pit damage
    this._facing = 1;
    this.stats = null;
    this.maxHp = 100;
    this.shieldHp = shopEffect('shield');
    this.shieldUntil = 0;
    this.invUntil = 0;
    this.spawning = false;
    this.dead = false;
    this.rageUntil = 0;
    this.examUntil = 0;
    this.nanoUntil = 0;
    this.stirUntil = 0;   // Vendor stir fry: invincible + rooted until this time
    this.stunUntil = 0; this.atkBlockUntil = 0; this._dot = null;   // boss debuffs (user 2026-10-13): stun = no input at all, attack block = the attack key is dead, DOT = damage over time
    this.streakUntil = 0;
    this.dashUntil = 0;
    this._atkCd = 0;
    this.skillReadyAt = 0;
    this._knockUntil = 0;
    this._lastGround = { x: x, y: y };
    this._wasGrounded = false;
    this._prevAtk = false;
    this._prevSkill = false;
    this._hookCd = {};
    this._projectiles = [];
    this._breathPhase = 0;
    // Breathing keeps the FEET fixed (user 2026-10-10): the sprite scales around its centre, so after Arcade has moved it for the frame (postupdate) it is lifted by
    // half of the extra height, and put back before the next physics step (preupdate); the body and the collisions never see the lift (setOrigin / body.offset tricks
    // moved the body and made the player fall).  Idle only; every other state keeps its look.
    this._wantDy = 0; this._liftDy = 0; this._idleW = 0;
    this._unlift = () => { if (this._liftDy && this.sprite && this.sprite.active) this.sprite.y += this._liftDy; this._liftDy = 0; };
    this._lift = () => { if (this._wantDy && this.sprite && this.sprite.active) { this.sprite.y -= this._wantDy; this._liftDy = this._wantDy; } };
    scene.events.on('preupdate', this._unlift);
    scene.events.on('postupdate', this._lift);
    scene.events.once('shutdown', () => { scene.events.off('preupdate', this._unlift); scene.events.off('postupdate', this._lift); });
    this._mx = 1; this._my = 1; this._deg = 0; this._walkPhase = 0; this._ov = null;
    this._lastGroundedAt = 0;
    this._jumpUsed = false;
    this._jumpCut = false;
    this._prevUp = false;
    this._prevLeft = false; this._prevRight = false; this._lastDir = 1;
    this._faceVis = 1;
    this._jumpBufferAt = -9999;
    this._lastDustAt = 0;
    this._lastAfterAt = 0;
    this.refreshStats();
  }

  refreshStats() {
    this.stats = calcStats();
    this.maxHp = this.stats.max_hp;
  }

  get facing() { return this._facing; }
  set facing(v) { this._facing = v; if (this.sprite) this.sprite.flipX = v < 0; }

  // Level start and pit respawn: appear a little above the ground, blink semi-transparent, drop, and only start playing once landed.
  beginSpawn(x, groundY) {
    const scene = this.scene, now = scene.time.now, s = this.sprite, b = s.body;
    scene.tweens.killTweensOf(s);               // a pit hit leaves a hurt-flash alpha tween running
    b.reset(x, s.y);                                         // sync the body first: right after the constructor its bottom is stale
    b.reset(x, groundY - (b.bottom - s.y) - SPAWN_HEIGHT);   // body bottom (not sprite centre) is what sits SPAWN_HEIGHT above the ground
    b.allowGravity = false;
    this.spawning = true; this._spawnAt = now; this._spawnDropAt = 0;
    this.invUntil = 1e12; this._knockUntil = 0; this.dashUntil = 0; this._jumpUsed = false;
    this.stunUntil = 0; this.atkBlockUntil = 0; this._dot = null;
    this._ov = null; s.clearTint();
  }

  _updateSpawn(now) {
    const s = this.sprite, b = s.body;
    b.setVelocityX(0);
    s.setAlpha(Math.floor((now - this._spawnAt) / 90) % 2 ? 0.25 : 0.65);
    if (!this._spawnDropAt) {
      if (now - this._spawnAt < SPAWN_HOVER_MS) return;
      this._spawnDropAt = now; b.allowGravity = true; return;
    }
    if (now - this._spawnDropAt > 60 && (b.blocked.down || b.touching.down)) {   // 60ms: ignore a stale blocked.down left over from before the reset
      this.spawning = false; this.invUntil = now; s.setAlpha(1);
      this.playAnim('land');
    }
  }

  update(time, delta, cursors) {
    if (this.dead) { if (this._stG) this._stG.clear(); return; }
    const scene = this.scene;
    const now = scene.time.now;
    this._statusFx(now);
    if (this.spawning) { this._updateSpawn(now); return; }
    this._updateDot(now);
    if (this.dead) return;
    const s = this.sprite;
    const b = s.body;
    const st = this.stats;
    const dt = delta / 1000;

    if (this.shieldUntil && now > this.shieldUntil) this.shieldHp = 0;

    const grounded = b.blocked.down || b.touching.down;
    if (grounded) {
      if (!this._onWorldFloor()) this._lastGround = { x: s.x, y: s.y };   // the world's bottom edge also sets blocked.down; it is not a place to respawn on
      this._lastGroundedAt = now;
      this._jumpUsed = false;
      this._jumpCut = false;
    }

    let left = cursors.left.isDown;
    let right = cursors.right.isDown;
    let up = cursors.up.isDown;  // controls object: up already covers W/UP/SPACE (contract)
    let atk = cursors.attack.isDown;
    let skl = cursors.skill.isDown;
    if (now < this.stirUntil) { left = right = up = atk = skl = false; }   // Vendor's stir fry: rooted, can do nothing for its whole duration
    if (now < this.stunUntil) { left = right = up = atk = skl = false; }   // stunned by a boss orb
    if (now < this.atkBlockUntil) atk = false;   // normal attack sealed (boss 黃色跳壓)

    const knock = now < this._knockUntil;
    const dash = now < this.dashUntil;

    // Last-pressed direction wins when both are held; velocity ramps so a reversal takes ~0.12s instead of snapping
    if (left && !this._prevLeft) this._lastDir = -1;
    if (right && !this._prevRight) this._lastDir = 1;
    this._prevLeft = left; this._prevRight = right;
    if (!knock && !dash) {
      let dirIn = 0;
      if (left && right) dirIn = this._lastDir;
      else if (left) dirIn = -1;
      else if (right) dirIn = 1;
      if (dirIn !== 0 && dirIn !== this._facing) {
        this.facing = dirIn;
        if (!this._ov || (this._ov.kind === 'turn' && now - this._ov.t0 > 40)) this.playAnim('turn'); // works on the ground and in the air; a quick re-turn restarts it
      }
      let moveSpeed = st.move_speed;
      if (now < this.examUntil) {
        const ch = GAME_DATA.characters[RUN.char];
        const params = ch && ch.skill ? ch.skill.params : {};
        const pct = (params.move_speed_percent !== undefined) ? params.move_speed_percent : 0.2;
        moveSpeed *= (1 + pct);
      }
      if (now < this.nanoUntil) {
        const ch = GAME_DATA.characters[RUN.char];
        const params = ch && ch.skill ? ch.skill.params : {};
        moveSpeed *= (1 + (params.speed_bonus !== undefined ? params.speed_bonus : 0.2));
      }
      if (scene.flood) moveSpeed *= 0.5;   // flood (user 2026-10-13): half walking speed
      moveSpeed *= (this.terrainSlow || 1);   // slow terrain (the level sets it each frame: pebble pit floor)
      const target = dirIn * moveSpeed + (grounded ? 0 : (scene.windX || 0)); // typhoon: gusts push the player only while airborne
      const accel = 3600 * dt * (grounded ? (scene.wetGrip || 1) : 1); // same on the ground and in the air: Mario-style free air control, a full reversal takes ~0.12s; wet street (scene.wetGrip < 1, set by weather.js): the ground accel / braking is weaker = slide
      const cur = b.velocity.x;
      b.setVelocityX(Math.abs(target - cur) <= accel ? target : cur + Math.sign(target - cur) * accel);
    }

    const upEdge = up && !this._prevUp;
    if (upEdge) this._jumpBufferAt = now;
    const canJump = (grounded || (now - this._lastGroundedAt <= 100)) && !this._jumpUsed && !knock && !dash;
    if (canJump && (upEdge || (now - this._jumpBufferAt <= 100))) {
      const jv = st.jump_velocity * (580 / 600) * (scene.flood ? Math.SQRT1_2 : 1);   // flood: half the jump height (height ~ v^2)
      b.setVelocityY(jv);
      this._jumpUsed = true;
      this._jumpCut = false;
      this._jumpBufferAt = -9999;
      Hooks.onJump(this);
    }
    if (!up && b.velocity.y < 0 && this._jumpUsed && !this._jumpCut) {
      b.setVelocityY(b.velocity.y * 0.5);
      this._jumpCut = true;
    }
    this._prevUp = up;

    if (b.velocity.y < 0) b.setGravityY(200);
    else b.setGravityY(800);

    if (grounded && !this._wasGrounded) {
      this.playAnim('land');
      for (let i = 0; i < 4; i++) this.spawnDust(s.x + (i % 2 ? 1 : -1) * (6 + i * 4), b.bottom);
    }
    this._wasGrounded = grounded;

    const moving = (left || right) && !knock && !dash;

    if (atk && !this._prevAtk && now >= this._atkCd) this.attack(now);
    if (this._flameUntil && now < this._flameUntil) this.cancelEnemyShots();
    this._prevAtk = atk;

    if (skl && !this._prevSkill && now >= this.skillReadyAt) Skills.cast(this);
    this._prevSkill = skl;

    this._applyVisual(now, dt, grounded, moving);

    Hooks.periodic(this, now);   // periodic hooks compare against interval * 1000, i.e. scene time in ms (passing dt never fired: grok review 2026-10-11)

    this.updateProjectiles(now);

    this.checkStomp(now);

    // Fell out of the level: centre below 620, or lying on the world's bottom edge (a tall character such as the geek rests there with its centre at ~605-620,
    // so "y > 620" alone left it stuck past the right end of the ground on levels 21-24 / 26-29, grok review 2026-10-11)
    if ((s.y > 620 || this._onWorldFloor()) && now >= this.examUntil && now >= this.nanoUntil) {
      this.takeDamage(20, s.x, true);
      if (!this.dead) {
        const gx = Math.max(40, this._lastGround.x - 100);
        b.reset(gx, this._lastGround.y - 20);   // moves sprite and body together (same as beginSpawn)
        b.setVelocity(0, 0);
        this.invUntil = now + 1000;
      }
    }
  }

  _applyVisual(now, dt, grounded, moving) {
    const s = this.sprite;
    const b = s.body;
    const bx0 = s.baseScaleX;
    const by0 = s.baseScaleY;
    const k = 1 - Math.exp(-dt * 18);
    // frame-by-frame walk: swap the texture (all frames have the same size, so the physics body is unaffected)
    if (this._walkTex) {
      const wkey = (grounded && moving && now >= this._knockUntil) ? this._walkTex[Math.floor(now / PLAYER_WALK_FRAME_MS) % this._walkTex.length] : this._idleTex;
      if (s.texture.key !== wkey) s.setTexture(wkey);
    }
    let tx = 1, ty = 1, tdeg = 0;

    if (now < this._knockUntil) {
      tx = 1; ty = 1; tdeg = -8;
    } else if (grounded) {
      if (moving) {
        this._walkPhase += dt * 2 * Math.PI * (2.2 + 1.6 * Math.abs(b.velocity.x) / 220);
        ty = 1 - 0.05 * Math.abs(Math.sin(this._walkPhase));
        tx = 1 + (1 - ty) * 0.5;
        tdeg = 6 + 3 * Math.sin(this._walkPhase * 2);
        if (this._walkTex) { tx = 1; ty = 1; tdeg = 0; }   // frame-by-frame walk art: no extra code bounce/lean on top (it lifted the feet ~1.3 px off the ground)
        if (now - this._lastDustAt > 250) {
          this._lastDustAt = now;
          this.spawnDust(s.x - this.facing * 10, b.bottom);
        }
      } else {
        this._breathPhase += dt * Math.PI * 2 / 3;   // 3 s cycle (user 2026-10-10; was 4 s, originally 2 s)
        // breathing: user asked for a barely visible one ("微微就好", head travel -75% from the previous 0..8% version): +0..2% taller, 0..0.6% narrower; the feet are
        // held fixed by the lift in postupdate (see constructor)
        const br = 1 + Math.sin(this._breathPhase);
        ty = 1 + 0.01 * br;
        tx = 1 - 0.003 * br; tdeg = 0;
      }
    } else {
      const vy = b.velocity.y;
      if (vy < -50) { tx = 0.9; ty = 1.1; }
      else if (vy > 50) { tx = 1.06; ty = 0.94; }
      else { tx = 1; ty = 1; }
      tdeg = 4 * Phaser.Math.Clamp(b.velocity.x / 220, -1, 1) * this.facing; // lean with the horizontal speed, eases through zero on a mid-air turn
    }

    this._mx += (tx - this._mx) * k;
    this._my += (ty - this._my) * k;
    this._deg += (tdeg - this._deg) * k;

    let mx2 = 1, my2 = 1, deg2 = 0;
    if (this._ov) {
      const p = (now - this._ov.t0) / this._ov.dur;
      if (p >= 1) {
        this._ov = null;
        s.clearTint();
        s.setAlpha(1);
      } else {
        const kind = this._ov.kind;
        if (kind === 'turn') {
          mx2 = 1 - 0.22 * Math.sin(Math.PI * p);
        } else if (kind === 'land') {
          my2 = 1 - 0.14 * Math.sin(Math.PI * p);
          mx2 = 1 + 0.10 * Math.sin(Math.PI * p);
        } else if (kind === 'attack') {
          if (p < 0.35) { const q = p / 0.35; deg2 = -12 * q; mx2 = 1 - 0.06 * q; my2 = 1 + 0.06 * q; }
          else if (p < 0.6) { const u = (p - 0.35) / 0.25; deg2 = -12 + 28 * u; mx2 = 1.12; my2 = 0.92; }
          else { const u = (p - 0.6) / 0.4; deg2 = 16 * (1 - u); mx2 = 1 + 0.12 * (1 - u); my2 = 0.92 + 0.08 * u; }
        } else if (kind === 'blood_rage') {
          if (p < 0.35) { const q = p / 0.35; my2 = 1 + 0.18 * Math.sin(Math.PI * q); mx2 = 1 - 0.14 * Math.sin(Math.PI * q); }
          else if (p < 0.65) { my2 = 0.82; mx2 = 1.2; }
          else { const u = (p - 0.65) / 0.35; my2 = 0.82 + 0.18 * u; mx2 = 1.2 - 0.2 * u; }
          s.setTint(0xff6655);
        } else if (kind === 'shadow_strike') {
          const q = Math.min(1, p);
          mx2 = 1.4 - 0.4 * q; my2 = 0.6 + 0.4 * q;
          s.setAlpha(0.25 + 0.75 * q);
        }
      }
    }

    if (now < this.dashUntil) {
      deg2 = 18; mx2 = 1.25; my2 = 0.85;
      if (now - this._lastAfterAt > 40) {
        this._lastAfterAt = now;
        const ai = this.scene.add.image(s.x, s.y, s.texture.key);
        ai.setScale(s.scaleX, s.scaleY);
        ai.setFlipX(s.flipX);
        ai.setAngle(s.angle);
        ai.setDepth(s.depth - 1);
        ai.setTint(0x66ccff);
        ai.setAlpha(0.45);
        this.scene.tweens.add({ targets: ai, alpha: 0, duration: 250, onComplete: () => ai.destroy() });
      }
    }

    let mx = this._mx * mx2;
    let my = this._my * my2;
    if (mx < 0.5) mx = 0.5; else if (mx > 1.5) mx = 1.5;
    if (my < 0.5) my = 0.5; else if (my > 1.5) my = 1.5;
    s.scaleX = bx0 * mx;
    s.scaleY = by0 * my;
    const idleNow = grounded && !moving && !this._ov && now >= this._knockUntil && now >= this.dashUntil;
    this._idleW += ((idleNow ? 1 : 0) - this._idleW) * k;
    // extra height / 2 = how far the bottom edge would sink when scaling around the centre (breathing, idle only); minus FOOT_SINK: every state is drawn this many px
    // lower so the soles overlap the ground surface instead of hovering 1-2 px above it (measured with a pixel diff, user 2026-10-10: "feet above the ground")
    this._wantDy = this._idleW * s.height * by0 * (my - 1) / 2 - FOOT_SINK;
    // facing sign is smoothed so the lean eases through zero on a turn instead of snapping from +x to -x
    this._faceVis += (this.facing - this._faceVis) * k;
    s.angle = (this._deg + deg2) * this._faceVis;
  }

  playAnim(kind) {
    const durs = { turn: 130, land: 160, attack: 240, hunt: 220, blood_rage: 420, shadow_strike: 280 };
    if (this._ov) { this.sprite.clearTint(); this.sprite.setAlpha(1); }
    this._ov = { kind: kind, t0: this.scene.time.now, dur: durs[kind] || 200 };
  }

  spawnDust(x, y) {
    const scene = this.scene;
    const d = scene.add.circle(x, y, 3, 0x999999, 0.5);
    d.setDepth(4);
    scene.tweens.add({ targets: d, y: y - 8, scaleX: 1.6, scaleY: 1.6, alpha: 0, duration: 300, onComplete: () => d.destroy() });
  }

  attack(now) {
    const scene = this.scene;
    const s = this.sprite;
    const st = this.stats;
    let atkCd = st.attack_cooldown;
    if (now < this.examUntil) {
      const ch = GAME_DATA.characters[RUN.char];
      const params = ch && ch.skill ? ch.skill.params : {};
      const pct = (params.attack_speed_percent !== undefined) ? params.attack_speed_percent : 0.2;
      atkCd /= (1 + pct);
    }
    this._atkCd = now + atkCd * 1000;
    this.playAnim('attack');
    if (RUN.simUses > 0) { this._simAttack(); return; }   // SIM reward: replaces the normal attack for 30 uses

    const weapon = RUN.inv.weapon ? GAME_DATA.equipment[RUN.inv.weapon] : null;
    const isProj = weapon && weapon.attack_shape === 'projectile';

    // 2026-10-09 (user): melee range = attack_range +30%, knocks back normal enemies (enemy.takeHit), bosses never;
    // mid-range weapons (projectile) reach 2.5x the melee range and fire at the nearest enemy in front / up to straight above.
    if (isProj) {
      this.spawnProjectile(weapon, st.attack_range * MELEE_RANGE_MULT * MID_RANGE_MULT);
    } else {
      const range = st.attack_range * MELEE_RANGE_MULT;
      const halfW = s.body.halfWidth;
      const cx = s.x + this.facing * (halfW + range / 2);
      const vend = RUN.char === 'vendor';
      let rect;
      if (RUN.char === 'auntie') {
        rect = FX.auntieHitRect(s.x, s.y, this.facing, range, halfW);   // same loop as the bag effect (effects.js bagSlash)
      } else if (vend) {
        const top = s.body.bottom - FX.VENDOR_ATK.reachTop;
        const bottom = s.body.bottom + FX.VENDOR_ATK.belowFeet;
        const w = FX.vendorHitWidth(range);
        const cx = s.x + this.facing * (halfW + w / 2);
        const rh = bottom - top;
        rect = new Phaser.Geom.Rectangle(cx - w / 2, top, w, rh);
      } else {
        const rh = 84;
        const rtop = s.y - 42;
        rect = new Phaser.Geom.Rectangle(cx - range / 2, rtop, range, rh);
      }
      const fx = FX.slashArc(scene, s.x + this.facing * halfW, s.y, this.facing, range, s.body.bottom); // x = inner edge of the hit rectangle, last arg = feet (geek aims its bottom stream at ground level); geek returns { markHit } (glyphs turn red)
      if (vend) this._flameUntil = now + FX.VENDOR_ATK.swingMs;   // while the wok flame is out, enemy shots touching its hit area are cancelled
      const kids = scene.enemies.getChildren();
      for (let i = 0; i < kids.length; i++) {
        const es = kids[i];
        if (es.ref && !es.ref.dead && Phaser.Geom.Intersects.RectangleToRectangle(rect, bodyRect(es))) {
          const er = bodyRect(es);   // taken before the hit: a killing blow can destroy the sprite at once (es.body undefined -> TypeError stopped the game loop, vendor L5 boss 10-11)
          this.hitEnemy(es.ref);
          if (vend && es.ref.ignite) es.ref.ignite(now);   // vendor: set on fire (red 1 s, 2 ticks of 5 HP, no stacking)
          if (fx && fx.markHit) fx.markHit(er);
        }
      }
    }
  }

  // Vendor flame: destroy enemy shots (spit blobs, projectiles) that touch the flame's hit area. Same rectangle as the attack.
  cancelEnemyShots() {
    const shots = this.scene._enemyShots;
    if (!shots || !shots.length) return;
    const s = this.sprite, range = this.stats.attack_range * MELEE_RANGE_MULT;
    const w = FX.vendorHitWidth(range), halfW = s.body.halfWidth;
    const top = s.body.bottom - FX.VENDOR_ATK.reachTop, bottom = s.body.bottom + FX.VENDOR_ATK.belowFeet;
    const cx = s.x + this.facing * (halfW + w / 2);
    const rect = new Phaser.Geom.Rectangle(cx - w / 2, top, w, bottom - top);
    for (let i = shots.length - 1; i >= 0; i--) {
      const o = shots[i];
      if (!o || !o.active) { shots.splice(i, 1); continue; }
      if (Phaser.Geom.Intersects.RectangleToRectangle(rect, o.getBounds())) {
        FX.hitSpark(this.scene, o.x, o.y);
        o.destroy();
        shots.splice(i, 1);
      }
    }
  }

  hitEnemy(ref, opts) {
    const st = this.stats;
    const now = this.scene.time.now;
    const critBonus = (now < this.nanoUntil) ? ((GAME_DATA.characters[RUN.char].skill.params || {}).crit_bonus || 0) : 0;
    const isCrit = Math.random() < (st.crit_chance + critBonus);
    let dmg = st.attack_damage * (isCrit ? st.crit_multiplier : 1);
    if (now < this.rageUntil) dmg *= 1.5;
    if (now < this.examUntil) {
      const ch = GAME_DATA.characters[RUN.char];
      const params = ch && ch.skill ? ch.skill.params : {};
      const pct = (params.attack_damage_percent !== undefined) ? params.attack_damage_percent : 0.5;
      dmg *= (1 + pct);
    }
    if (now < this.streakUntil) dmg *= 1.1;
    dmg = Math.round(dmg);
    ref.takeHit(dmg, this.sprite.x, isCrit, opts || {});
    this.afterHit(ref, dmg, isCrit);
  }

  // SIM attack (user 2026-10-12): the antenna and then four signal bars light up in front of the player one after another (FX.simSignal); every enemy touched by a piece
  // takes a normal hit once and is knocked up and away on a 45 degree path exactly like Auntie's take-profit skill (enemy.launch) - but not stunned (stunMs 0).  Bosses cannot be launched.
  _simAttack() {
    const scene = this.scene, s = this.sprite, self = this, hit = [];
    RUN.simUses -= 1;
    const L = FX.simLayout(s, this.facing);
    FX.simSignal(scene, L);
    if (typeof Extras !== 'undefined' && Extras._float) Extras._float(scene, s.x, s.y - 70, RUN.simUses > 0 ? 'SIM ' + RUN.simUses : 'SIM 用完', '#7fdcff', 20);
    const t0 = scene.time.now, launchCfg = { heightPx: 110, stunMs: 0 };
    const check = function () {
      if (self.dead || !s.active) { iv.remove(); return; }
      const el = scene.time.now - t0, kids = scene.enemies.getChildren();
      for (let a = 0; a < L.items.length; a++) {
        const it = L.items[a];
        if (el < it.startMs || el > it.endMs) continue;
        const rect = new Phaser.Geom.Rectangle(it.x, it.y, it.w, it.h);
        for (let k = 0; k < kids.length; k++) {
          const es = kids[k], ref = es.ref;
          if (!ref || ref.dead || hit.indexOf(ref) !== -1 || !es.body) continue;
          if (!Phaser.Geom.Intersects.RectangleToRectangle(rect, bodyRect(es))) continue;
          hit.push(ref);
          self.hitEnemy(ref, { noKnockback: true });
          if (!ref.dead && ref.launch) ref.launch(scene.time.now, launchCfg, s.x);
        }
      }
      if (el > L.endMs) iv.remove();
    };
    const iv = scene.time.addEvent({ delay: 30, loop: true, callback: check });
    check();
  }

  checkStomp(now) {
    const s = this.sprite, b = s.body;
    const prevBottom = this._prevBottom === undefined ? b.bottom : this._prevBottom;   // feet last frame: independent of frame rate / closing speed
    this._prevBottom = b.bottom;
    const mine = bodyRect(s);
    const kids = this.scene.enemies.getChildren();
    for (let i = 0; i < kids.length; i++) {
      const es = kids[i], ref = es.ref;
      if (!ref || ref.dead) continue;
      if (ref.behavior === 'Exploder') continue;
      if (ref.def && GAME_DATA.bosses[ref.def.id]) continue; // bosses are not stompable
      if (ref._stompGrace && ref._stompGrace > now) continue;
      if (!Phaser.Geom.Intersects.RectangleToRectangle(mine, bodyRect(es))) continue;
      if ((b.velocity.y - es.body.velocity.y) <= 60) continue;    // closing from above (relative speed: a rising slime counts)
      const lim = es.body.top + es.body.height * 0.5;
      if (b.bottom > lim && prevBottom > lim) continue;            // feet in the upper half now, or were above it last frame
      ref._stompGrace = now + 300;                          // enemy.js skips its contact damage while this is in the future
      this.hitEnemy(ref);                                   // same damage / crit / hooks as a sword hit
      b.setVelocityY(-420);                                 // bounce (overwritten if multiple enemies hit in same frame)
    }
  }

  afterHit(ref, dmg, isCrit) {
    const scene = this.scene;
    const st = this.stats;
    Hooks.onHit(this, ref, dmg, isCrit);
    if (st.lifesteal > 0) this.heal(dmg * st.lifesteal);
    const flatHeal = shopEffect('lifesteal_flat'); if (flatHeal > 0) this.heal(flatHeal);
  }

  // Nearest living enemy within `range` (center to center) that is in front of the player, from straight ahead up to
  // straight above (90 deg); ground and airborne enemies are sorted together by distance. Enemies a little below the
  // player's center (ground enemies shorter than the player) still count as "ahead".
  midRangeTarget(range) {
    const s = this.sprite, kids = this.scene.enemies.getChildren();
    let best = null, bestD = Infinity;
    for (let i = 0; i < kids.length; i++) {
      const es = kids[i];
      if (!es.ref || es.ref.dead || !es.body) continue;
      const dx = (es.body.center.x - s.x) * this.facing, dy = es.body.center.y - s.y;   // dx > 0 = in front, dy < 0 = above
      if (dx < -4 || dy > 42) continue;                  // -4: straight above counts even if the centers differ by a pixel
      const d = Math.hypot(dx, dy);
      if (d <= range && d < bestD) { best = es; bestD = d; }
    }
    return best;
  }

  spawnProjectile(weapon, range) {
    const scene = this.scene;
    const s = this.sprite;
    const st = this.stats;
    const p = weapon.projectile;
    const circle = scene.add.circle(s.x, s.y, 6, 0xffee88);
    scene.physics.add.existing(circle);
    circle.body.setAllowGravity(false);
    const tgt = this.midRangeTarget(range);
    if (tgt) {                                            // aimed at the nearest enemy in range
      const a = Math.atan2(tgt.body.center.y - s.y, tgt.body.center.x - s.x);
      circle.body.setVelocity(Math.cos(a) * p.speed, Math.sin(a) * p.speed);
    } else {
      circle.body.setVelocity(this.facing * p.speed, 0);  // nothing in range: straight ahead
    }
    const dmg = Math.round(st.attack_damage * p.damage_mult);
    this._projectiles.push({
      obj: circle,
      startX: s.x,
      startY: s.y,
      maxDist: tgt ? Math.hypot(tgt.body.center.x - s.x, tgt.body.center.y - s.y) + 40 : range,   // aimed: reach the target (+slack if it moves); else stop at the reach
      pierce: 1,                                          // one enemy per shot, no piercing (weapon data's pierce is ignored)
      dmg: dmg,
      hit: []
    });
  }

  updateProjectiles(now) {
    const scene = this.scene;
    const kids = scene.enemies.getChildren();
    for (let i = this._projectiles.length - 1; i >= 0; i--) {
      const pr = this._projectiles[i];
      const o = pr.obj;
      if (!o.active) { this._projectiles.splice(i, 1); continue; }
      if (Math.hypot(o.x - pr.startX, o.y - pr.startY) > pr.maxDist) { o.destroy(); this._projectiles.splice(i, 1); continue; }
      for (let j = 0; j < kids.length; j++) {
        const es = kids[j];
        if (es.ref && !es.ref.dead && pr.hit.indexOf(es.ref) === -1 &&
            Phaser.Geom.Intersects.RectangleToRectangle(o.getBounds(), bodyRect(es))) {
          pr.hit.push(es.ref);
          es.ref.takeHit(pr.dmg, o.x, false, { noKnockback: true });   // mid-range: no knockback
          this.afterHit(es.ref, pr.dmg, false);
          if (pr.hit.length >= pr.pierce) { o.destroy(); this._projectiles.splice(i, 1); break; }
        }
      }
    }
  }

  // true while the body rests on the physics world's bottom edge (below every ground segment: the player fell out of the level)
  _onWorldFloor() {
    const b = this.sprite.body;
    return !!b && b.bottom >= this.scene.physics.world.bounds.bottom - 1;
  }

  takeDamage(amount, srcX, ignoreDefense) {
    if (window.GAME_DEBUG && GAME_DEBUG.godMode) return false;
    const scene = this.scene;
    const now = scene.time.now;
    if (this.dead || now < this.invUntil || now < this.examUntil || now < this.nanoUntil || now < this.stirUntil) return false;   // true = the hit landed (the boss effects stun / attack block depend on it)
    const st = this.stats;
    let dmg = ignoreDefense ? amount : Math.max(1, Math.round(amount * (1 - st.defense_pct)));
    if (this.shieldHp > 0) {
      const absorbed = Math.min(this.shieldHp, dmg);
      this.shieldHp -= absorbed;
      dmg -= absorbed;
      FX.shieldHit(scene, this.sprite);
    }
    if (dmg > 0) {
      RUN.hp -= dmg;
      RUN.levelStats.hits++;
      FX.hurtPlayer(scene, this.sprite);
      FX.damageNumber(scene, this.sprite.x, this.sprite.y - 30, dmg, false, true);
    }
    this.invUntil = now + 800;
    const dir = this.sprite.x < srcX ? -1 : 1;
    this.sprite.body.setVelocity(dir * 550, -200);
    this._knockUntil = now + 350;
    scene.tweens.add({ targets: this.sprite, alpha: 0.3, duration: 100, yoyo: true, repeat: 3 });
    Hooks.onDamaged(this);
    if (RUN.hp <= 0) {
      this.dead = true;
      scene.events.emit('player-dead');
    }
    return true;
  }

  // Boss effects (user 2026-10-13). applyDot: damage every intervalMs for durationMs, refreshed (not stacked) by contact; ignores the 0.8 s hit invulnerability and causes no knock-back, but not the skills' invulnerability.
  // Status icons over the head (user 2026-10-13): three stars circling while stunned, a red "no entry" sign while the normal attack is sealed (blinks in its last 0.4 s).
  _statusFx(now) {
    const stun = now < this.stunUntil && !this.spawning, seal = now < this.atkBlockUntil && !this.spawning;
    if (!stun && !seal) { if (this._stG) this._stG.clear(); return; }
    if (!this._stG) this._stG = this.scene.add.graphics().setDepth(60);
    const g = this._stG, s = this.sprite, top = s.body.top;
    g.clear();
    if (stun) {
      for (let i = 0; i < 3; i++) {
        const a = now / 140 + i * 2.094, x = s.x + Math.cos(a) * 22, y = top - 12 + Math.sin(a) * 7, R = 7.5 + 1.5 * Math.sin(a), pts = [];
        for (let k = 0; k < 8; k++) { const r = k % 2 === 0 ? R : R * 0.4, an = k * Math.PI / 4 - Math.PI / 2; pts.push({ x: x + Math.cos(an) * r, y: y + Math.sin(an) * r }); }
        g.fillStyle(0xffe14a, 1); g.fillPoints(pts, true);
        g.lineStyle(1, 0x8a6a00, 1); g.strokePoints(pts, true);
      }
    }
    if (seal && !(this.atkBlockUntil - now < 400 && Math.floor(now / 80) % 2)) {
      const cx = s.x, cy = top - (stun ? 42 : 26), r = 11, d = r * 0.71;
      g.fillStyle(0xffffff, 0.92); g.fillCircle(cx, cy, r);
      g.lineStyle(4, 0xe02020, 1); g.strokeCircle(cx, cy, r - 2);
      g.lineBetween(cx - d + 1, cy - d + 1, cx + d - 1, cy + d - 1);
    }
  }
  applyStun(ms) { this.stunUntil = Math.max(this.stunUntil, this.scene.time.now + ms); }
  blockAttack(ms) { this.atkBlockUntil = Math.max(this.atkBlockUntil, this.scene.time.now + ms); }
  applyDot(durationMs, dmg, intervalMs) {
    const now = this.scene.time.now;
    if (!this._dot) this._dot = { next: now + intervalMs };
    this._dot.until = now + durationMs; this._dot.dmg = dmg; this._dot.iv = intervalMs;
  }
  _updateDot(now) {
    const d = this._dot; if (!d) return;
    if (this.dead) { this._dot = null; return; }
    while (this._dot && now >= d.next && d.next <= d.until + 1) {
      d.next += d.iv;
      if (window.GAME_DEBUG && GAME_DEBUG.godMode) continue;
      if (now < this.examUntil || now < this.nanoUntil || now < this.stirUntil) continue;
      let dmg = Math.max(1, Math.round(d.dmg * (1 - this.stats.defense_pct)));
      if (this.shieldHp > 0) { const ab = Math.min(this.shieldHp, dmg); this.shieldHp -= ab; dmg -= ab; FX.shieldHit(this.scene, this.sprite); }
      if (dmg > 0) {
        RUN.hp -= dmg;
        FX.damageNumber(this.scene, this.sprite.x, this.sprite.y - 30, dmg, false, true);
        if (RUN.hp <= 0) { this.dead = true; this._dot = null; this.scene.events.emit('player-dead'); return; }
      }
    }
    if (this._dot && now >= d.until) this._dot = null;
  }

  // Small damage over time (pebble pit floor): no knockback, hit-stop or invulnerability window, only a light red flash and the number.
  tickDamage(amount, colorHex) {
    if (window.GAME_DEBUG && GAME_DEBUG.godMode) return;
    const scene = this.scene, now = scene.time.now;
    if (this.dead || now < this.examUntil || now < this.nanoUntil || now < this.stirUntil) return;
    RUN.hp -= amount;
    FX.damageNumber(scene, this.sprite.x, this.sprite.y - 30, amount, false, true);
    const tint = colorHex !== undefined ? colorHex : 0xff7070;
    this.sprite.setTint(tint); scene.time.delayedCall(120, () => { if (this.sprite && this.sprite.active) this.sprite.clearTint(); });
    if (RUN.hp <= 0) { this.dead = true; scene.events.emit('player-dead'); }
  }

  heal(amount) {
    if (this.dead) return;
    const scene = this.scene;
    const before = RUN.hp;
    RUN.hp = Math.min(this.stats.max_hp, RUN.hp + amount);
    if (RUN.hp > before) FX.healPlayer(scene, this.sprite);
  }

  onKill(x, y) {
    Hooks.onKill(this, x, y);
  }
}
