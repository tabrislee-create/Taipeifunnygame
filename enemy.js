class Enemy {
    constructor(scene, def, x, y, level) {
        this.scene = scene;
        this.def = def;
        this.id = def.id;
        this.behavior = def.behavior;
        this.params = def.params || {};
        const d = difficulty(level);
        this.dmgMult = d.dmg_mult;
        this.maxHp = (def.params && def.params.fixed_hp) ? def.hp : Math.round(def.hp * d.hp_mult);
        this.hp = this.maxHp;
        this.dead = false;

        // A Patrol enemy with an 'enemy_<id>_hop' spritesheet (8 cells, see slime_game.aseprite) hops instead of walking
        this.hop = def.behavior === 'Patrol' && scene.textures.exists('enemy_' + def.id + '_hop');
        const texKey = 'enemy_' + def.id + (this.hop ? '_hop' : '');
        const texFrame = scene.textures.get(texKey).get(); // first frame: whole image, or cell 0 of a spritesheet
        let dispH = def.display_h || ENEMY_SIZE_H[def.size] || 48;
        let spriteKey = texKey;
        if (def.params && def.params.variants) {
            const v = def.params.variants;
            const fixed = def.params.variant_fixed;
            const shade = fixed ? fixed.shade : Phaser.Math.Between(0, v.brightness.length - 1);
            const sizeIdx = fixed ? fixed.size : Phaser.Math.Between(0, v.size_mult.length - 1);
            const factor = v.brightness[shade];
            const mult = v.size_mult[sizeIdx];
            this.variant = { shade: shade, size: sizeIdx, factor: factor, mult: mult };
            spriteKey = this._variantTexture(scene, texKey, shade, factor);
            dispH *= mult;
        }
        const texH = texFrame.height;
        const scale = dispH / texH;
        const dispW = texFrame.width * scale;

        this.sprite = scene.physics.add.sprite(x, y, spriteKey);
        this.sprite.setScale(scale);
        this.sprite.baseScaleX = scale; // FX.squash restores to these; without them rapid hits compound and the sprite stays distorted
        this.sprite.baseScaleY = scale;
        this.sprite.setDepth(2);
        if (def.params && def.params.rim_color && this.sprite.postFX && scene.renderer.type === Phaser.WEBGL) this.sprite.postFX.addGlow(def.params.rim_color, 1.6, 0, false, 0.1, 6);   // faint pale rim so a black body shows against a night backdrop (user 2026-10-14)
        if (def.params && def.params.edge_glow && this.sprite.postFX && scene.renderer.type === Phaser.WEBGL) {
            const eg = def.params.edge_glow;
            this._edgeGlow = this.sprite.postFX.addGlow(eg.color, eg.min, 0, false, 0.1, 10);
        }
        this.sprite.setFlipX(true);
        this.sprite.ref = this;
        scene.enemies.add(this.sprite);
        if (def.params && def.params.flame_glow) {
            const fg = def.params.flame_glow;
            this._flame = scene.add.circle(fg.x, fg.y, fg.radius, fg.color, 0.6).setBlendMode(Phaser.BlendModes.ADD).setDepth(2.1);
        }

        // Body size/offset are in source-texture pixels (Phaser multiplies by sprite scale), bottom-aligned like makeSprite
        const texW = texFrame.width;
        const bwPx = texW * 0.6;
        const bhPx = texH * 0.85;
        this.sprite.body.setSize(bwPx, bhPx);
        // def.sink (display px, optional): the art hangs this far below the hitbox (same mechanism as bosses.json 'sink'); user 2026-11-13 foot-zero calibration
        this.sprite.body.setOffset((texW - bwPx) / 2, texH - bhPx - (def.sink || 0) / scale);

        this.spawnX = x;
        this.spawnY = y;
        if (this.isFlyer()) {
            this.sprite.body.setAllowGravity(false);
            this.sprite.setCollideWorldBounds(true);
        } else {
            this.sprite.setCollideWorldBounds(true);
        }

        this.speed = def.speed || 60;
        this.contactDamage = def.damage * this.dmgMult;

        const now = scene.time.now;
        this._bornAt = now;   // loop/req.md §4: how long this enemy has been alive feeds the steam column's grow bonus
        this._nextAtk = 0;
        this._chargeState = 'idle';
        this._chargeEnd = 0;
        this._restEnd = 0;
        this._blinkOn = false;
        this._fireAt = now + rand(300, 1200);
        this._jumpAt = now + rand(300, 1200);
        this._landAt = 0;
        this._diveState = 'hover';
        this._diveEnd = 0;
        this._fuseStart = 0;
        this._exploded = false;

        if (this.behavior === 'Charge') {
            this._chargeCd = this.params.cooldown || 2.5;
            this._chargeSpeed = this.params.charge_speed || (this.speed * 4);
            this._chargeDur = (this.params.charge_duration || 1) * 1000;
        }
        if (this.behavior === 'Chase') {
            this._aggro = this.params.aggro_range || 250;
            this._atkRange = this.params.attack_range || 60;
            this._recoilMs = this.params.hit_recoil_ms || 0;
            this._recoilUntil = 0;
            this._atkCd = (this.params.attack_cooldown || 1.5) * 1000;
            this._lungeEnd = 0;
        }
        if (this.behavior === 'Ranged_Shooter') {
            this._fireRate = (this.params.fire_rate || 2) * 1000;
            this._projSpeed = this.params.projectile_speed || 220;
            this._projDmg = (this.params.projectile_damage || def.damage) * this.dmgMult;
        }
        // hike_sprig (loop/req.md §2): a telegraphed water drop fired while it drifts. State machine in updateShoot.
        if (this.params.shoot) {
            this._shootState = 'idle';
            this._shootCdReadyAt = now + rand(400, 900);
            this._shootWindupEnd = 0;
            this._shootHoldEnd = 0;
            this._shotAt = 0;
            this._shotsFired = 0;
            this._shots = [];
        }
        if (this.behavior === 'Jumper') {
            this._jumpH = this.params.jump_height || 120;
            this._jumpDist = this.params.jump_distance || 160;
            this._landDmg = (this.params.land_damage || def.damage) * this.dmgMult;
        }
        if (this.isFlyer()) this.initFlyer();
        if (this.behavior === 'Exploder') {
            this._fuseTime = (this.params.fuse_time || 1.5) * 1000;
            this._expRadius = this.params.explosion_radius || 90;
            this._expDmg = (this.params.explosion_damage || def.damage) * this.dmgMult;
        }

        if (this.behavior === 'Patrol') {
            this.dir = Math.random() < 0.5 ? 1 : -1;
            this._range = this.params.patrol_range || 120;
            if (this.hop) this.initHop();
        } else if (this.behavior === 'Roller') {
            this.dir = Math.random() < 0.5 ? 1 : -1;
            this._range = this.params.roll_range || 200;
            this._rollState = 'roll';
            this._rollEnd = 0;
            this._dashReadyAt = 0;
        } else {
            this.dir = x > (scene.player ? scene.player.sprite.x : x) ? -1 : 1;
        }

        if (this.behavior === 'Charge' || this.isFlyer()) {
            this._telegraph = scene.add.graphics().setDepth(2).setVisible(false);
            this._telegraph.lineStyle(3, 0xff4444, 0.9);
        }

        this._burnDps = 0;
        this._burnEnd = 0;
        this._burnTick = 0;
        this._igniteEnd = 0;   // Vendor's normal attack: red 1 s, 5 HP at 0.5 s and 1.0 s, never stacks
        this._igniteStep = 0;
        this._scorchEnd = 0;   // Vendor's skill: red for its duration, fixed damage every interval, never stacks; independent of ignite and of applyBurn
        this._scorchStep = 0;
        this._scorchCfg = null;
    }

    isFlyer() { return this.behavior === 'Flyer_Sine' || this.behavior === 'Flyer_Dive'; }

    update(time, delta, player) {
        if (this.dead) return;
        if (this._edgeGlow) {
            const eg = this.params.edge_glow;
            let strength = eg.min + (eg.max - eg.min) * (0.5 + 0.5 * Math.sin(time / 1000 * Math.PI * 2 * eg.hz));
            if (this._glowBoostUntil && time < this._glowBoostUntil) {
                const remaining = this._glowBoostUntil - time;
                const decayFactor = Math.max(0, remaining / (this._glowBoostLen || 300));
                strength += (this._glowBoostAmp || 8) * decayFactor;
            }
            this._edgeGlow.outerStrength = strength;
        }
        if (this._flame) {
            const fg = this.params.flame_glow;
            const s = this.sprite;
            this._flame.x = s.x + ((s.flipX ? 1 - fg.x : fg.x) - 0.5) * s.displayWidth;
            this._flame.y = s.y + (fg.y - 0.5) * s.displayHeight;
            const breath = 0.5 + 0.5 * Math.sin(time / 1000 * Math.PI * 2 * fg.hz);
            this._flame.alpha = fg.min + (fg.max - fg.min) * breath;
            this._flame.scale = 0.85 + 0.3 * breath;
        }
        const dt = delta / 1000;
        const s = this.sprite;
        const px = player ? player.sprite.x : s.x;
        const py = player ? player.sprite.y : s.y;

        if (this._splitGraceUntil) {       // just split off a dying parent (user 2026-10-14): flickers and cannot hurt the player for the first 1.5 s
            if (time < this._splitGraceUntil) s.setAlpha(Math.floor(time / 90) % 2 ? 0.25 : 0.9);
            else { this._splitGraceUntil = 0; s.setAlpha(1); }
        }

        if (this._resetUntil) {            // just reset after falling into a pit: half transparent, frozen, harmless
            if (time < this._resetUntil) { s.body.setVelocity(0, 0); return; }
            this._resetUntil = 0; s.setAlpha(1);
        }

        if (this._burnDps > 0) {
            if (time < this._burnEnd) {
                if (time >= this._burnTick) {
                    this.hp -= this._burnDps * 0.5;
                    FX.burnFlame(this.scene, s.x, s.y - 12);
                    this._burnTick = time + 500;
                    if (this.hp <= 0) { this.die(); return; }
                }
            } else {
                this._burnDps = 0;
            }
        }

        if (this._igniteEnd > 0) {
            const ig = this.constructor.IGNITE;
            const t0 = this._igniteEnd - ig.durationMs;
            while (this._igniteStep < ig.ticksMs.length && time >= t0 + ig.ticksMs[this._igniteStep]) {
                this._igniteStep++;
                this.hp -= ig.damage;
                FX.damageNumber(this.scene, s.x, s.y - 24, ig.damage, false, false);
                FX.burnFlame(this.scene, s.x, s.y - 12);
                if (this.hp <= 0) { this.die(); return; }
            }
            if (time >= this._igniteEnd) this._igniteEnd = 0;
        }
        if (this._scorchEnd > 0) {
            const sc = this._scorchCfg;
            const t0 = this._scorchEnd - sc.durationMs;
            while (this._scorchStep < sc.ticks && time >= t0 + (this._scorchStep + 1) * sc.intervalMs) {
                this._scorchStep++;
                this.hp -= sc.damage;
                FX.damageNumber(this.scene, s.x, s.y - 24, sc.damage, false, false);
                FX.burnFlame(this.scene, s.x, s.y - 12);
                if (this.hp <= 0) { this.die(); return; }
            }
            if (time >= this._scorchEnd) this._scorchEnd = 0;
        }
        // Poison DOT
        if (this._poisonEnd > 0) {
          if (time >= this._poisonEnd) {
            this._poisonEnd = 0;
            if (!this._igniteEnd && !this._scorchEnd && !this._dotRed) s.clearTint();
          } else if (time >= this._poisonNext) {
            this._poisonNext = time + this._poisonInterval;
            this.hp -= this._poisonDmg;
            FX.damageNumber(this.scene, s.x, s.y - 24, Math.round(this._poisonDmg), false, false);
            if (this.hp <= 0) { this.fell = true; this.die(); return; }
          }
          if (!this._igniteEnd && !this._scorchEnd) s.setTint(0x66ff66);
        }
        // both DOTs share the same red; clear the tint only when the last one has just ended
        if (this._igniteEnd > 0 || this._scorchEnd > 0) { s.setTint(0xff3030); this._dotRed = true; }
        else if (this._dotRed) { this._dotRed = false; s.clearTint(); }

        if (this.behavior === 'Charge' && this._chargeState === 'telegraph') {
            if (time < this._chargeEnd) {
                const blink = Math.floor(time / 100) % 2 === 0;
                if (blink !== this._blinkOn) {
                    this._blinkOn = blink;
                    if (blink) s.setTint(0xffffff); else s.clearTint();
                }
                this.drawTelegraph(s, px);
                s.body.setVelocityX(0);
            } else {
                s.clearTint();
                this._telegraph.setVisible(false);
                this._chargeState = 'charging';
                this._chargeEnd = time + this._chargeDur;
                s.body.setVelocityX(this.dir * this._chargeSpeed);
            }
        }

        // Thorn `up` state: collision + timer tick even when AI is paused (nudge/launch)
        if (this._thorn && this._thorn.state === 'up') this._updateThornUp(time);

        if (this._launchState && this._updateLaunch(time)) return;   // launched / stunned: no AI, no contact damage

        if (time >= (this._popUntil || 0)) switch (this.behavior) {
            case 'Patrol': if (this.hop) this.updateHop(time); else this.updatePatrol(time, dt); break;
            case 'Roller': this.updateRoller(time, dt, px); break;
            case 'Chase': this.updateChase(time, dt, px); this._wobbleWhileMoving(time); break;
            case 'Charge': this.updateCharge(time, dt, px); break;
            case 'Ranged_Shooter': this.updateRanged(time, dt, px, py); break;
            case 'Jumper': this.updateJumper(time, dt, px); break;
            case 'Flyer_Sine':
            case 'Flyer_Dive': this.updateFlyer(time, dt, px); break;
            case 'Exploder': this.updateExploder(time, dt, px); break;
        }

        // enemies never walk into a pit on their own: at the edge, stop and turn back (knockback is exempt)
        if (!this.isFlyer() && !this.hop && time > (this._knockUntil || 0) && (s.body.blocked.down || s.body.touching.down)) {
            const vx = s.body.velocity.x;
            if (Math.abs(vx) > 1 && !this.scene.hasGroundAt(s.x + Math.sign(vx) * 20)) {
                s.body.setVelocityX(0);
                this.dir = -Math.sign(vx);
                // 'rebound' enemies handle the edge inside updateCharge (the charge must survive it),
                // so only the ones without that field (boar_charge and friends) end the charge here.
                if (this._chargeState === 'charging' && !this.params.rebound) this._chargeEnd = 0;
                if (this._rollState === 'dash') this._rollEnd = 0;
            }
        }

        if (this.isFlyer()) {
            if (Math.abs(px - s.x) > 8) s.setFlipX(px > s.x); // face the player; no flicker when hovering near x
        } else if (this.hop) {
            s.setFlipX(this.dir > 0); // art faces left; hop pauses have zero velocity, so face the hop direction instead
        } else if (this.params.face_player) {
            if (Math.abs(px - s.x) > 8) s.setFlipX(px > s.x);   // stands still, so velocity can't say which way it faces: turn to the player (art faces left; no flicker near x)
        } else if (this.behavior !== 'Charge' || this._chargeState !== 'charging') {
            s.setFlipX(s.body.velocity.x > 1);
        }

        // no contact damage for a moment after the player stomped this enemy (player.js checkStomp sets _stompGrace)
        if (player && !player.dead && !(this._stompGrace > time) && !(this._splitGraceUntil > time) && Phaser.Geom.Intersects.RectangleToRectangle(bodyRect(s), bodyRect(player.sprite))) {
            if (player.examUntil > time || player.nanoUntil > time || player.stirUntil > time) { // Greenie's invincible skill: no damage, the enemy is shoved away instead
                if (time > (this._knockUntil || 0) && !this.isFlyer() && this.behavior !== 'Exploder') {
                    this._knockUntil = time + 400;
                    s.body.setVelocityX((Math.sign(s.x - player.sprite.x) || 1) * 260);
                }
            } else {
            const hurtBefore = player.invUntil;
            player.takeDamage(this.contactDamage, s.x);
            if (this._recoilMs > 0 && player.invUntil > hurtBefore) {
                this._recoilUntil = time + this._recoilMs;
                this._lungeEnd = 0;
            }
            }
        }
    }

    updatePatrol(time, dt) {
        if (this.params.thorn && this.updateThorn(time)) return;   // aiming: stand still (see updateThorn)
        const s = this.sprite;
        const lo = this.spawnX - this._range;
        const hi = this.spawnX + this._range;
        if (s.x <= lo) this.dir = 1;
        else if (s.x >= hi) this.dir = -1;
        const ahead = s.x + this.dir * 20;
        if (!this.scene.hasGroundAt(ahead)) { this.dir *= -1; s.body.setVelocityX(0); return; }
        s.body.setVelocityX(this.dir * this.speed);
        const wb = this.params.wobble;   // low-frequency rocking while it shuffles along (clay jar): angle_deg either side, hz cycles per second
        if (wb) s.setAngle(Math.sin(time / 1000 * Math.PI * 2 * (wb.hz || 1)) * (wb.angle_deg || 6));
    }

    _thornGlowOn() {   // steady glow on the bramble from aim start until its thorn has gone (same color as the thorn's glow, user 2026-11-10)
        if (this._thornGlow || !this.sprite.postFX || this.scene.renderer.type !== Phaser.WEBGL) return;
        this._thornGlow = this.sprite.postFX.addGlow(THORN_GLOW, 5, 0, false, 0.1, 12);
    }
    _thornMask(scene) {   // coarse alpha grid of the spike texture (computed once): cells {x,y} = top-left in texture px, step px square
        if (Enemy._thornMaskCells) return Enemy._thornMaskCells;
        const key = 'thorn_spike', src = scene.textures.get(key).getSourceImage(), step = 16, cells = [];
        for (let y = 0; y < src.height; y += step) for (let x = 0; x < src.width; x += step) {
            if (scene.textures.getPixelAlpha(Math.min(x + step / 2, src.width - 1) | 0, Math.min(y + step / 2, src.height - 1) | 0, key) >= 16) cells.push({ x: x, y: y });
        }
        Enemy._thornMaskCells = { cells: cells, step: step, w: src.width, h: src.height };
        return Enemy._thornMaskCells;
    }
    _thornTouches(T, br) {   // does the player's body rect overlap a visible cell of the spike (only the part that has grown so far is drawn, so only that part counts)
        const M = this._thornMask(this.scene), sx = T.obj.scaleX, sy = T.obj.scaleY, cx = M.w / 2;
        for (let i = 0; i < M.cells.length; i++) {
            const c = M.cells[i];
            const x0 = T.x + (c.x - cx) * sx, x1 = x0 + M.step * sx, y0 = T.gy - (M.h - c.y) * sy, y1 = y0 + M.step * sy;
            if (x1 > br.x && x0 < br.x + br.width && y1 > br.y && y0 < br.y + br.height) return true;
        }
        return false;
    }
    _thornClear() {   // destroy the thorn and its dirt mound
        const T = this._thorn; if (!T) return;
        if (T.obj && T.obj.active) T.obj.destroy();
        if (T.mound && T.mound.active) T.mound.destroy();
        T.obj = null; T.mound = null;
    }
    _thornGlowOff() {
        if (this._thornGlow && this.sprite.postFX) this.sprite.postFX.remove(this._thornGlow);
        this._thornGlow = null;
    }

    updateThorn(time) {
        const th = this.params.thorn, s = this.sprite, scene = this.scene, pl = scene.player, gy = s.body.bottom, w = th.width || 28, h = th.rise_px || 50;
        if (!this._thorn) this._thorn = { state: 'idle', cd: 0, until: 0, x: 0, gy: 0, obj: null, hit: false, rect: null };
        const T = this._thorn;

        if (T.state === 'idle') {
            if (!pl || pl.dead) return false;
            if (time < T.cd) return false;
            if (!(s.body.blocked.down || s.body.touching.down)) return false;
            if (Math.abs(pl.sprite.x - s.x) > (th.range || 150)) return false;

            T.x = pl.sprite.x;
            if (!scene.hasGroundAt(T.x) || (scene._pitAt && scene._pitAt(T.x))) {
                T.cd = time + 500;
                return false;
            }

            T.state = 'aim';
            this._thornGlowOn();
            T.gy = gy;   // lock ground Y at aim start (grok fix: airborne gy must not be used)
            T.until = time + (th.aim_ms || 1500);
            this.dir = (T.x >= s.x) ? 1 : -1;
            s.body.setVelocityX(0);
            if (scene.textures.exists('thorn_spike') && scene.textures.exists('thorn_mound')) {
                // the dirt mound IS the warning (user 2026-11-10): it pops up where the thorn will come out and stays until the thorn is gone
                const sc = h / scene.textures.get('thorn_spike').getSourceImage().height;
                T.fullSY = sc;
                T.mound = scene.add.image(T.x, T.gy, 'thorn_mound').setOrigin(0.5, 1).setDepth(4).setScale(0.02 * sc);
                if (T.mound.postFX && scene.renderer.type === Phaser.WEBGL) T.mound.postFX.addGlow(THORN_GLOW, 5, 0, false, 0.1, 12);
                scene.tweens.add({ targets: T.mound, scaleX: sc, scaleY: sc, duration: 200, ease: 'Back.easeOut' });
            } else {
                FX.telegraphCircle(scene, T.x, gy - 4, 24, th.aim_ms || 1500);   // fallback warning when the textures are missing
            }
            return true;
        }

        if (T.state === 'aim') {
            s.body.setVelocityX(0);
            s.setTint(Math.floor(time / 90) % 2 ? 0xffffff : 0x9be37a);
            if (time >= T.until) {
                // only spawn thorn when grounded (airborne after nudge/launch → wait)
                if (!(s.body.blocked.down || s.body.touching.down)) return true;
                s.clearTint();
                const glow = (o) => { if (o.postFX && scene.renderer.type === Phaser.WEBGL) o.postFX.addGlow(THORN_GLOW, 5, 0, false, 0.1, 12); };   // same color as the bramble's glow
                if (T.mound) {
                    // the mound has been up since the aim started; now the spike grows out of it (spike height = rise_px)
                    const sc = T.fullSY;
                    T.obj = scene.add.image(T.x, T.gy, 'thorn_spike').setOrigin(0.5, 1).setDepth(3).setScale(sc, sc * 0.02);
                    glow(T.obj);
                    scene.tweens.add({ targets: T.obj, scaleY: sc, duration: 200, ease: 'Quad.easeOut' });
                } else {   // fallback when the textures are missing: the old flat triangle
                    T.fullSY = 1;
                    T.obj = scene.add.triangle(T.x, T.gy, 0, h, w, h, w / 2, 0, 0x4a7a2a).setOrigin(0.5, 1).setDepth(3).setStrokeStyle(2, 0x24401a);
                    glow(T.obj);
                    T.obj.setScale(1, 0.05);
                    scene.tweens.add({ targets: T.obj, scaleY: 1, duration: 120, ease: 'Quad.easeOut' });
                }
                FX.hitSpark(scene, T.x, T.gy - 6);
                T.state = 'up';
                T.until = time + (th.stay_ms || 1000);
                T.hit = false;
            } else {
                return true;
            }
        }

        if (T.state === 'up') {
            this.sprite.body.setVelocityX(0);   // the bramble stands still while its thorn is up (user 2026-11-10)
            return true;   // the thorn itself is handled by _updateThornUp (called from update, runs even during AI pause)
        }

        return false;
    }

    _updateThornUp(time) {
        const th = this.params.thorn, scene = this.scene, pl = scene.player, T = this._thorn;
        if (!th || !T || T.state !== 'up') return;
        const w = th.width || 28, h = th.rise_px || 50;
        if (T.obj && T.obj.active) {
            const rect = new Phaser.Geom.Rectangle(T.x - w / 2, T.gy - h * T.obj.scaleY / (T.fullSY || 1), w, h * T.obj.scaleY / (T.fullSY || 1));
            if (pl && !pl.dead) {
                const touching = T.fullSY && T.fullSY !== 1 ? this._thornTouches(T, bodyRect(pl.sprite)) : Phaser.Geom.Intersects.RectangleToRectangle(rect, bodyRect(pl.sprite));   // textured thorn: the hit area IS the visible (grown part of the) spike silhouette
                if (touching) {
                    if (!T.hit) {
                        if (pl.takeDamage((th.damage || this.def.damage) * this.dmgMult, T.x)) {
                            T.hit = true;
                            FX.hitSpark(scene, pl.sprite.x, pl.sprite.y - 20);
                        }
                    }
                } else {
                    T.hit = false;
                }
            }
        }
        if (time >= T.until) {
            this._thornClear();
            T.state = 'idle';
            this._thornGlowOff();
            T.cd = time + (th.cd_ms || 3000);
        }
    }

    updateRoller(time, dt, px) {
        const s = this.sprite;
        const dash = this.params.dash || {};
        const windupMs = dash.windup_ms != null ? dash.windup_ms : 500;
        const dashSpeed = dash.speed != null ? dash.speed : 300;
        const durationMs = dash.duration_ms != null ? dash.duration_ms : 700;
        const restMs = dash.rest_ms != null ? dash.rest_ms : 3000;
        const triggerRange = dash.trigger_range != null ? dash.trigger_range : 220;

        if (this._rollState === 'roll') {
            // trigger check before rolling movement
            if (time >= this._dashReadyAt && (s.body.blocked.down || s.body.touching.down) && Math.abs(px - s.x) < triggerRange) {
                this.dir = px >= s.x ? 1 : -1;
                s.body.setVelocityX(0);
                this._rollState = 'windup';
                this._rollEnd = time + windupMs;
                return;
            }
            const lo = this.spawnX - this._range;
            const hi = this.spawnX + this._range;
            if (s.x <= lo) this.dir = 1;
            else if (s.x >= hi) this.dir = -1;
            const ahead = s.x + this.dir * 20;
            if (!this.scene.hasGroundAt(ahead)) { this.dir *= -1; s.body.setVelocityX(0); return; }
            s.body.setVelocityX(this.dir * this.speed);
            // roll the sprite based on actual horizontal velocity
            const radius = Math.max(8, s.displayHeight / 2);
            s.rotation += (s.body.velocity.x * dt) / radius;
            return;
        }

        if (this._rollState === 'windup') {
            s.body.setVelocityX(0);
            if (Math.floor(time / 100) % 2 === 0) s.setTint(0xff9a3c); else s.clearTint();
            if (time >= this._rollEnd) {
                s.clearTint();
                this._rollState = 'dash';
                this._rollEnd = time + durationMs;
            }
            return;
        }

        if (this._rollState === 'dash') {
            if (time < this._rollEnd && this.scene.hasGroundAt(s.x + this.dir * 24)) {
                s.body.setVelocityX(this.dir * dashSpeed);
                const radius = Math.max(8, s.displayHeight / 2);
                s.rotation += (s.body.velocity.x * dt) / radius;
                this._spawnDashGhost(time);
            } else {
                s.body.setVelocityX(0);
                this._rollState = 'rest';
                this._rollEnd = time + restMs;
            }
            return;
        }

        if (this._rollState === 'rest') {
            s.body.setVelocityX(0);
            if (time >= this._rollEnd) {
                this._rollState = 'roll';
                this._dashReadyAt = time + 1000;
            }
            return;
        }
    }

    _spawnDashGhost(time) {
        const cfg = this.params.dash && this.params.dash.afterimage;
        if (!cfg) return;
        const interval = cfg.interval_ms != null ? cfg.interval_ms : 50;
        const fadeMs = cfg.fade_ms != null ? cfg.fade_ms : 250;
        const max = cfg.max != null ? cfg.max : 6;
        const tint = cfg.tint != null ? cfg.tint : 0xffb070;
        const startAlpha = cfg.alpha != null ? cfg.alpha : 0.45;
        if (this._ghostNextAt == null) this._ghostNextAt = time;
        if (time < this._ghostNextAt) return;
        this._ghostNextAt = time + interval;
        if (!this._ghosts) this._ghosts = [];
        // prune any already-destroyed ghosts
        this._ghosts = this._ghosts.filter(g => g.active);
        if (this._ghosts.length >= max) return;
        const s = this.sprite;
        const ghost = this.scene.add.image(s.x, s.y, s.texture.key, s.frame.name);
        ghost.setOrigin(s.originX, s.originY);
        ghost.setScale(s.scaleX, s.scaleY);
        ghost.setFlipX(s.flipX);
        ghost.setFlipY(s.flipY);
        ghost.setRotation(s.rotation);
        ghost.setTint(tint);
        ghost.setAlpha(startAlpha);
        ghost.setDepth(s.depth - 0.1);
        this._ghosts.push(ghost);
        this.scene.tweens.add({
            targets: ghost,
            alpha: 0,
            scaleX: s.scaleX * 0.85,
            scaleY: s.scaleY * 0.85,
            duration: fadeMs,
            ease: 'Linear',
            onComplete: () => {
                if (ghost.active) ghost.destroy();
                if (this._ghosts) this._ghosts = this._ghosts.filter(g => g !== ghost);
            }
        });
    }

    // Hopping Patrol (blue slime): rest -> squash -> launch/air -> land -> land2 -> recover -> rest.
    // The arc and the forward motion come from physics (cells carry no baked lift).
    initHop() {
        const s = this.sprite, scene = this.scene;
        this._hopPhase = 'rest';
        this._hopT = scene.time.now + rand(100, 2000);   // wide random start so a group of slimes does not hop in step
        this._restMul = this.params.hop_rest_mul || rand(0.7, 1.6);                  // per-slime pace: some linger, some hop often
        // hop_height_px = apex height in px (vy^2 / 2g, g = 1000; + g*dt/2 for Arcade's 60 fps integration, which otherwise lands ~4 px short); otherwise hop_height_mult scales the 18 px base hop
        this._hopVy = this.params.hop_height_px ? Math.sqrt(2 * 1000 * this.params.hop_height_px) + 1000 / 120 : 190 * Math.sqrt(this.params.hop_height_mult || 1); // hop distance stays the same (vx is derived at launch)
        const sp = this.params.spit;
        if (sp) { this._spit = sp; this._spitAt = scene.time.now + rand(1500, 3500); this._spitWindupEnd = 0; }
        this._hopDist = (this.def.speed || 50) * 1.2;
        this._hopVx = this._hopDist / (2 * this._hopVy / 1000); // gravity is 1000 px/s^2 (main.js)
    }

    // Per-hop randomness (each slime rolls its own): direction may flip, distance 0.5x-1.3x, and some hops are skipped for a long pause.
    _hopVxFor(dist) { return dist / (2 * this._hopVy / 1000); }

    updateHop(time) {
        const s = this.sprite, b = s.body;
        const grounded = b.blocked.down || b.touching.down;
        switch (this._hopPhase) {
            case 'rest':
                s.setFrame(0);
                if (this._spit && grounded) this.updateSpit(time);
                if (grounded && time >= this._hopT && !this._spitWindupEnd) {
                    const lo = this.spawnX - this._range;
                    const hi = this.spawnX + this._range;
                    if (!this.params.hop_rest_mul && Math.random() < 0.12) { this._hopT = time + rand(600, 1800); break; }   // idle for a while instead of hopping
                    if (Math.random() < 0.3) this.dir *= -1;                                     // turn around at random, not only at the patrol ends
                    if (s.x <= lo) this.dir = 1;
                    else if (s.x >= hi) this.dir = -1;
                    this._curHopDist = this._hopDist * (this.params.hop_rest_mul ? 1 : rand(0.5, 1.3));   // hop_rest_mul (black slime): fixed distance
                    if (!this.scene.hasGroundAt(s.x + this.dir * (this._curHopDist + 15))) { this.dir *= -1; this._hopT = time + 300; break; }
                    this._hopPhase = 'squash'; this._hopT = time + 100; s.setFrame(1);
                }
                break;
            case 'squash':
                if (time >= this._hopT) {
                    b.setVelocity(this.dir * this._hopVxFor(this._curHopDist || this._hopDist), -this._hopVy);
                    this._hopPhase = 'air'; this._hopT = time; s.setFrame(2);
                }
                break;
            case 'air': {
                const t = time - this._hopT;
                if (t > 120 && grounded) {
                    b.setVelocityX(0);
                    this._hopPhase = 'land'; this._hopT = time + 70; s.setFrame(5);
                } else {
                    s.setFrame(t < 90 ? 2 : (b.velocity.y < 0 ? 3 : 4));
                }
                break;
            }
            case 'land':
                if (time >= this._hopT) { this._hopPhase = 'land2'; this._hopT = time + 100; s.setFrame(6); }
                break;
            case 'land2':
                if (time >= this._hopT) { this._hopPhase = 'recover'; this._hopT = time + 100; s.setFrame(7); }
                break;
            default: // recover
                if (time >= this._hopT) { this._hopPhase = 'rest'; this._hopT = time + rand(150, 700) * this._restMul; s.setFrame(0); }
        }
    }

    // params.wobble = { angle_deg, hz }: rock side to side while moving, stand upright when stopped (mirror enemies)
    _wobbleWhileMoving(time) {
        const wb = this.params.wobble;
        if (!wb) return;
        const s = this.sprite;
        s.setAngle(Math.abs(s.body.velocity.x) > 1 ? Math.sin(time / 1000 * Math.PI * 2 * (wb.hz || 1)) * (wb.angle_deg || 3) : 0);
    }

    updateChase(time, dt, px) {
        const s = this.sprite;
        const dx = px - s.x;
        if (time < this._recoilUntil) { s.body.setVelocityX(0); return; }
        if (time < this._lungeEnd) { s.body.setVelocityX(this.dir * this.speed * 3); return; }
        if (Math.abs(dx) > this._aggro) { s.body.setVelocityX(0); return; }
        this.dir = dx >= 0 ? 1 : -1;
        if (Math.abs(dx) > this._atkRange * 0.5) {
            const ahead = s.x + this.dir * 20;
            if (!this.scene.hasGroundAt(ahead)) { s.body.setVelocityX(0); return; }
            s.body.setVelocityX(this.dir * this.speed);
        } else {
            s.body.setVelocityX(0);
            if (Math.abs(dx) <= this._atkRange && time >= this._nextAtk) {
                this._nextAtk = time + this._atkCd;
                this._lungeEnd = time + 150;
            }
        }
    }

    updateCharge(time, dt, px) {
        const s = this.sprite;
        if (this._chargeState === 'idle') {
            s.body.setVelocityX(0);
            if (Math.abs(px - s.x) < 350 && time >= this._restEnd) {
                this.dir = px >= s.x ? 1 : -1;
                this._chargeState = 'telegraph';
                this._chargeEnd = time + 500;
                this._rebounded = false;      // one reversal per charge (loop/req.md §3)
            }
        } else if (this._chargeState === 'charging') {
            if (time < this._chargeEnd) {
                const ahead = s.x + this.dir * 24;
                // Walls (body.blocked) are ONLY a rebound trigger: the baseline has no wall check
                // at all - a boar_charge that runs into a wall keeps pushing until charge_duration
                // ends, and that behaviour must stay untouched (grok review 1, must-fix 1).
                const wall = this.params.rebound ? (this.dir < 0 ? s.body.blocked.left : (this.dir > 0 ? s.body.blocked.right : false)) : false;
                if (wall || !this.scene.hasGroundAt(ahead)) {
                    // 'rebound' (hike_bamblin, loop/req.md §3): hitting a wall or the end of the ground does
                    // not end the charge - it turns straight around and charges a full charge_duration once
                    // more, and only then goes to cooldown. Once per charge; a rebound segment that hits
                    // something behaves like an ordinary charge (QUESTIONS.md A4).
                    if (this.params.rebound && !this._rebounded) {
                        this._rebounded = true;
                        FX.hitSpark(this.scene, s.x - this.dir * 20, s.body.bottom - 12);
                        this.dir = -this.dir;
                        this._chargeEnd = time + this._chargeDur;
                        s.body.setVelocityX(this.dir * this._chargeSpeed);
                        return;
                    }
                    s.body.setVelocityX(0); this._chargeState = 'rest'; this._restEnd = time + this._chargeCd * 1000;
                } else s.body.setVelocityX(this.dir * this._chargeSpeed);
            } else {
                s.body.setVelocityX(0);
                this._chargeState = 'rest';
                this._restEnd = time + this._chargeCd * 1000;
            }
        } else {
            s.body.setVelocityX(0);
            // The shipped Charge behaviour ends in 'rest' for good (boar_charge charges once per
            // life; only a pit reset or a launch stun clears the state). 'rebound' owners
            // (loop/req.md §3) instead wait out the cooldown and charge again - and ONLY those,
            // everything without the field must keep behaving exactly like the baseline.
            if (this._chargeState === 'rest' && this.params.rebound && time >= this._restEnd) {
                this._chargeState = 'idle';
            }
        }
    }

    updateRanged(time, dt, px, py) {
        const s = this.sprite;
        if (this.params.drift && !this._fireWindupEnd) {
            const drift = this.params.drift;
            if (this._driftDir === undefined) this._driftDir = Math.random() < 0.5 ? -1 : 1;
            const lo = this.spawnX - drift.range;
            const hi = this.spawnX + drift.range;
            if (s.x < lo) this._driftDir = 1; else if (s.x > hi) this._driftDir = -1;   // outside the range: head back in (a plain flip each frame left it jittering in place)
            else if (!this.scene.hasGroundAt(s.x + this._driftDir * 20)) this._driftDir = -this._driftDir;
            s.body.setVelocityX(this._driftDir * drift.speed);
        } else {
            s.body.setVelocityX(0);
        }
        this.dir = px >= s.x ? 1 : -1;
        if (this.params.projectile_speed && Math.abs(px - s.x) < 520 && time >= this._fireAt) {
            if (this.params.windup_ms) {
                // start windup: stand still and blink white
                this._fireWindupEnd = time + this.params.windup_ms;
                this._fireAt = time + this._fireRate;
            } else {
                this._fireAt = time + this._fireRate;
                this._fireOnce(px, py);
            }
        }
        if (this._fireWindupEnd) {
            if (time < this._fireWindupEnd) {
                s.body.setVelocityX(0);
                if (Math.floor(time / 70) % 2 === 0) s.clearTint(); else s.setTint(0xffffff);
            } else {
                s.clearTint();
                this._fireWindupEnd = 0;
                this._fireOnce(px, py);
            }
        }
    }

    _fireOnce(px, py) {
        const volley = this.params.volley;
        if (!volley) {
            if (this.params.arc) this.fireArrow(px, py, 0);
            else this.fireProjectile(px, py);
            return;
        }
        const count = volley.count;
        const spread = volley.spread_deg || 0;
        const delays = volley.delays_ms;
        const interval = volley.interval_ms || 0;
        const cooldown = volley.cooldown_ms || 0;
        const lastDelay = delays ? (delays[count - 1] || 0) : (count - 1) * interval;
        if (cooldown) this._fireAt = this.scene.time.now + lastDelay + cooldown;   // next round (windup) may start only 'cooldown' ms after the LAST arrow is shot
        for (let i = 0; i < count; i++) {
            const off = (i - (count - 1) / 2) * spread * Math.PI / 180;
            const delay = delays ? (delays[i] || 0) : i * interval;
            if (i === 0) {
                if (this.params.arc) this.fireArrow(px, py, i);
                else this.fireProjectile(px, py, off);
            } else {
                this.scene.time.delayedCall(delay, () => {
                    // chunk 11 (grok review of chunk 8, must-fix 2): the boss's death does not stop the scene clock, so a
                    // volley that was already counting down (terracotta_archer fires at +1/+2/+3/+4 s) kept shooting
                    // through the defeat cutscene - and its fire arrows hurt the player there. `surrendered` is set by
                    // LevelScene._surrenderMinions(), `finished` by either cutscene path.
                    if (this.dead || this.surrendered || this.scene.finished) return;
                    if (this.params.arc) this.fireArrow(px, py, i);
                    else this.fireProjectile(px, py, off);
                });
            }
        }
    }

    // Red slime: random mid-range spit. Short white flash (windup) so it can be dodged, then one red blob that dies after `range` px.
    updateSpit(time) {
        const s = this.sprite, sp = this._spit, pl = this.scene.player;
        if (!pl || pl.dead) return;
        const px = pl.sprite.x, py = pl.sprite.y;
        if (this._spitWindupEnd) {
            if (time < this._spitWindupEnd) { s.setTint(Math.floor(time / 70) % 2 ? 0xffffff : 0xff5050); return; }
            this._spitWindupEnd = 0; s.clearTint();
            this._spitAt = time + rand(sp.min_ms || 2500, sp.max_ms || 5000);
            this.fireSpit(pl.sprite.x, pl.sprite.y - 10, sp);
            return;
        }
        if (time < this._spitAt) return;
        const dx = px - s.x;
        if (Math.abs(dx) > (sp.range || 420) || Math.abs(dx) < 60) { this._spitAt = time + 500; return; } // out of range / too close: try again soon
        this.dir = dx >= 0 ? 1 : -1;
        this._spitWindupEnd = time + 450;
        this._hopT = Math.max(this._hopT, time + 600);
    }

    // One red liquid blob: straight line toward where the player stood, dies after `range` px / on the ground / on hit. Own implementation (does not use fireProjectile).
    fireSpit(px, py, sp) {
        const s = this.sprite, scene = this.scene, self = this;
        const x0 = s.x + this.dir * 16, y0 = s.y - 8;
        const dx = px - x0, dy = py - y0, dist = Math.max(1, Math.hypot(dx, dy)), spd = sp.speed || 260;
        const vx = dx / dist * spd, vy = dy / dist * spd, range = sp.range || 420, dmg = (sp.damage || this.def.damage) * this.dmgMult;
        const blob = scene.add.circle(x0, y0, 9, 0xff2a2a, 0.95).setStrokeStyle(2, 0x8a0f0f).setDepth(3);
        (scene._enemyShots = scene._enemyShots || []).push(blob);   // vendor's flame cancels these (player.js cancelEnemyShots)
        const gy = scene.lvl.y_ground;
        const upd = function (t, dtMs) {
            if (!blob.active) { scene.events.off('update', upd); return; }
            blob.x += vx * dtMs / 1000; blob.y += vy * dtMs / 1000;
            const pl = scene.player;
            const ended = Math.abs(blob.x - x0) > range || blob.y >= gy - 2 || blob.x < -30 || blob.x > scene.physics.world.bounds.width + 30;
            if (pl && !pl.dead && Phaser.Geom.Intersects.RectangleToRectangle(blob.getBounds(), bodyRect(pl.sprite))) { pl.takeDamage(dmg, blob.x); FX.hitSpark(scene, blob.x, blob.y); blob.destroy(); scene.events.off('update', upd); return; }
            if (ended) { FX.hitSpark(scene, blob.x, Math.min(blob.y, gy - 6)); blob.destroy(); scene.events.off('update', upd); }
        };
        scene.events.on('update', upd);
    }

    fireProjectile(px, py, angleOffsetRad = 0) {
        const s = this.sprite;
        const dx = px - s.x;
        const dy = (py - 10) - s.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        let vx = dx / dist * this._projSpeed;
        let vy = dy / dist * this._projSpeed;
        if (angleOffsetRad) {
            const c = Math.cos(angleOffsetRad), sn = Math.sin(angleOffsetRad);
            const rx = vx * c - vy * sn;
            const ry = vx * sn + vy * c;
            vx = rx; vy = ry;
        }
        const scene = this.scene;
        if (!scene.textures.exists('enemy_proj')) {   // generate once so straight projectiles do not show missing-texture box
            const g = scene.make.graphics({ x: 0, y: 0, add: false });
            g.fillStyle(0xff6a3a, 1);
            g.fillCircle(6, 6, 6);
            g.lineStyle(2, 0x8a2a0a, 1);
            g.strokeCircle(6, 6, 6);
            g.generateTexture('enemy_proj', 12, 12);
            g.destroy();
        }
        const proj = scene.physics.add.sprite(s.x + this.dir * 14, s.y - 6, 'enemy_proj');
        proj.setDepth(3);
        proj.body.setCircle(6);
        proj.body.setAllowGravity(false);
        proj.body.setVelocity(vx, vy);
        (this.scene._enemyShots = this.scene._enemyShots || []).push(proj);   // vendor's flame cancels these (player.js cancelEnemyShots)
        const self = this;
        const updateProj = function () {
            if (!proj.active) { scene.events.off('update', updateProj); return; }
            if (self.dead) return;
            const p = proj.x;
            const q = proj.y;
            if (p < -30 || p > scene.physics.world.bounds.width + 30 || q > 620) { proj.destroy(); return; }
            if (scene.hasGroundAt(p) && q >= scene.lvl.y_ground - 4) { FX.hitSpark(scene, p, q); if (self.params.ember_pool) self._spawnEmber(p); proj.destroy(); return; }
            const pl = scene.player;
            if (pl && !pl.dead && Phaser.Geom.Intersects.RectangleToRectangle(proj.getBounds(), bodyRect(pl.sprite))) {
                pl.takeDamage(self._projDmg, s.x);
                if (self.params.ember_pool) self._spawnEmber(p);
                FX.hitSpark(scene, p, q);
                proj.destroy();
            }
        };
        scene.events.on('update', updateProj);
        this.scene.time.delayedCall(3000, function () { if (proj.active) proj.destroy(); });
    }

    fireArrow(px, py, index) {
        const arc = this.params.arc, s = this.sprite;
        const scene = this.scene;
        const sx = s.x + this.dir * 14, sy = s.y - 6;
        // Random landing distance so each arrow spreads
        let tx = px + (Math.random() * 2 - 1) * arc.spread * Math.abs(px - sx);
        const maxR = arc.max_range;
        if (tx - sx > maxR) tx = sx + maxR;
        if (sx - tx > maxR) tx = sx - maxR;
        const ty = py;
        const dist = Math.abs(tx - sx);
        const T = Phaser.Math.Clamp(dist / this._projSpeed, arc.min_flight_ms / 1000, arc.max_flight_ms / 1000);
        const vx = (tx - sx) / T;
        let vy = ((ty - sy) - 0.5 * arc.gravity * T * T) / T;
        const fa = this.params.fire_arrow;
        const fire = !!(fa && (fa.indices ? fa.indices.indexOf(index + 1) !== -1 : (index + 1) % fa.every === 0));   // indices: 1-based arrows of the volley that are fire arrows (user 2026-10-28: the 3rd and 5th)
        const arrow = this.params.landing_zone
            ? scene.add.circle(sx, sy, 8, 0x7a5c3e, 0.95).setStrokeStyle(2, 0x3a2c1e)   // hike_cinderite's mud ball is round, not a shaft (loop/req.md §4)
            : scene.add.rectangle(sx, sy, 20, 3, fire ? 0xff7a1a : 0x6b4423);
        arrow.setDepth(3);
        const tip = this.params.landing_zone ? null : scene.add.rectangle(sx + 10, sy, 4, 3, 0xd9c9a3);
        if (tip) tip.setDepth(3);
        let glow = null, glowCore = null;
        if (fire) {   // a fire arrow is plainly burning in flight: a glowing orb round the head plus big, long-lived flames behind it
            glow = scene.add.circle(sx, sy, 13, 0xff7a1a, 0.4).setDepth(2.8);
            glowCore = scene.add.circle(sx, sy, 6, 0xffd23a, 0.85).setDepth(2.95);
            arrow.once('destroy', function () { if (glow) glow.destroy(); if (glowCore) glowCore.destroy(); });
        }
        (scene._enemyShots = scene._enemyShots || []).push(arrow);
        const self = this;
        let trailAcc = 0;
        const updateArrow = function (time, delta) {
            if (!arrow.active) { scene.events.off('update', updateArrow); return; }
            if (!scene.sys.isActive()) return;
            // chunk 11 (grok review of chunk 8, must-fix 2): this listener is on scene.events, so LevelScene.update's
            // early return on `finished` does not stop it - an arrow that was already in the air kept flying and
            // kept spawning burn zones during the defeat cutscene. Tear the shot down the moment the level is over.
            if (scene.finished) {
                scene.events.off('update', updateArrow);
                arrow.destroy();   // the arrow's own 'destroy' handler takes the glow sprites with it
                if (tip && tip.active) tip.destroy();
                return;
            }
            const dt = Math.min(delta, 50) / 1000;
            arrow.x += vx * dt;
            vy += arc.gravity * dt;
            arrow.y += vy * dt;
            arrow.rotation = Math.atan2(vy, vx);
            if (tip) {
                tip.x = arrow.x + Math.cos(arrow.rotation) * 10;
                tip.y = arrow.y + Math.sin(arrow.rotation) * 10;
                tip.rotation = arrow.rotation;
            }
            if (fire) {
                if (glow) { glow.x = arrow.x; glow.y = arrow.y; glow.setScale(0.9 + 0.25 * Math.sin(time / 45)); }
                if (glowCore) { glowCore.x = arrow.x; glowCore.y = arrow.y; }
                trailAcc += delta;
                while (trailAcc >= 22) {
                    trailAcc -= 22;
                    const r = 6 + Math.random() * 5;
                    const flame = scene.add.circle(arrow.x - Math.cos(arrow.rotation) * 6, arrow.y - Math.sin(arrow.rotation) * 6, r, Math.random() < 0.5 ? 0xffb347 : 0xff5a1a, 0.9);
                    flame.setDepth(2.9);
                    scene.tweens.add({
                        targets: flame,
                        radius: 0,
                        alpha: 0,
                        y: flame.y - 10 - Math.random() * 10,   // flames lick upward as they trail off
                        duration: 420,
                        onComplete: function () { flame.destroy(); }
                    });
                }
            }
            const x = arrow.x, y = arrow.y;
            if (x < -30 || x > scene.physics.world.bounds.width + 30 || y > 620) {
                arrow.destroy(); if (tip) tip.destroy(); return;
            }
            if (scene.hasGroundAt(x) && y >= scene.lvl.y_ground - 4) {
                FX.hitSpark(scene, x, y);
                if (fire) self._fireZone(x, scene.lvl.y_ground, self.params.fire_arrow);
                if (self.params.landing_zone) self._spawnSteam(x);   // the mud ball opens its steam column where it lands
                arrow.destroy(); if (tip) tip.destroy(); return;
            }
            const pl = scene.player;
            if (pl && !pl.dead && Phaser.Geom.Intersects.RectangleToRectangle(arrow.getBounds(), bodyRect(pl.sprite))) {
                if (fire) {
                    pl.tickDamage(self._projDmg, 0xff9040);
                    self._fireZone(x, scene.lvl.y_ground, self.params.fire_arrow);
                } else {
                    pl.takeDamage(self._projDmg, s.x);
                }
                if (self.params.landing_zone) self._spawnSteam(x);   // hit the player: the column still opens under the impact point
                FX.hitSpark(scene, x, y);
                arrow.destroy(); if (tip) tip.destroy(); return;
            }
        };
        scene.events.on('update', updateArrow);
        scene.time.delayedCall(4000, function () {
            if (arrow.active) arrow.destroy();
            if (tip && tip.active) tip.destroy();
        });
    }

    updateJumper(time, dt, px) {
        const s = this.sprite;
        if (this._landAt && time >= this._landAt) {
            this._landAt = 0;
            FX.explosionRing(this.scene, s.x, s.y + 14, 46);
            const pl = this.scene.player;
            if (pl && !pl.dead && Math.abs(pl.sprite.x - s.x) < 60 && pl.sprite.y > this.spawnY - 70) {
                pl.takeDamage(this._landDmg, s.x);
            }
        }
        if (s.body.onFloor()) {
            s.body.setVelocityX(0);
            if (Math.abs(px - s.x) < 400 && time >= this._jumpAt) {
                this._jumpAt = time + 1200;
                const vy = -Math.sqrt(2 * 1000 * this._jumpH);
                const flight = 2 * Math.sqrt(2 * this._jumpH / 1000);
                const dirx = px >= s.x ? 1 : -1;
                s.body.setVelocity(dirx * (this._jumpDist / flight), vy);
            }
        }
    }

    initFlyer() {
        const scene = this.scene, p = this.params;
        const gy = (scene.lvl && scene.lvl.y_ground) || 400;
        const harpy = this.behavior === 'Flyer_Dive';
        this._baseY = harpy ? gy - (p.hover_height || 120) : this.spawnY;
        this._amp = harpy ? 10 : (p.amplitude || 40) * 0.6;
        this._freq = p.frequency || 1.5;
        this._diveSpeed = p.dive_speed || this.speed * 4;
        this._diveCd = (p.dive_cooldown || 2.2) * 1000;
        this._telegraphMs = harpy ? 450 : 350;
        this._diveState = 'approach';
        this._diveReadyAt = scene.time.now + rand(600, 1500);
        this._lane = (Math.random() < 0.5 ? -1 : 1) * rand(110, 200);
        this._phase = Math.random() * Math.PI * 2;
        this._tx = this.spawnX;
        this._ty = this.spawnY;
        this._groundBottom = gy - 4;
    }

    // Swoop attack: cruise at altitude beside the player (own lane, so flyers do not stack), flash, dive through the player's body, climb back.
    updateFlyer(time, dt, px) {
        const s = this.sprite, b = s.body, scene = this.scene, pl = scene.player;
        const py = pl ? pl.sprite.body.center.y : s.y;
        // hike_sprig (loop/req.md §2): while a shot is being telegraphed or held the flyer stands dead
        // still in the air and the dive state machine is not advanced (QUESTIONS.md A2).
        if (this.params.shoot && this.updateShoot(time, px, pl)) return;
        if (this._diveState === 'approach') {
            const dx = px - s.x;
            let tx;
            if (Math.abs(dx) < 600) tx = px + this._lane;
            else tx = this.spawnX + 100 * Math.sin(time / 1000 * 0.5 + this._phase);
            let vx = Phaser.Math.Clamp((tx - s.x) * 3, -this.speed, this.speed);
            const kids = scene.enemies.getChildren();
            for (let i = 0; i < kids.length; i++) {
                const o = kids[i];
                if (o === s || !o.ref || o.ref.dead || typeof o.ref.isFlyer !== 'function' || !o.ref.isFlyer()) continue; // bosses share the group but are not flyers
                const d = s.x - o.x;
                if (Math.abs(d) < 70 && Math.abs(s.y - o.y) < 60) vx += (d === 0 ? (this._lane > 0 ? 1 : -1) : Math.sign(d)) * this.speed * 0.8;
            }
            const ty = this._baseY + this._amp * Math.sin(time / 1000 * this._freq * 2 + this._phase);
            b.setVelocity(vx, Phaser.Math.Clamp((ty - s.y) * 4, -220, 220));
            if (time >= this._diveReadyAt && Math.abs(dx) < 320 && Math.abs(s.x - tx) < 50) {
                this._diveState = 'telegraph';
                this._diveEnd = time + this._telegraphMs;
            }
        } else if (this._diveState === 'telegraph') {
            b.setVelocity(0, 0);
            if (time < this._diveEnd - 120) { this._tx = px; this._ty = py; } // aim freezes 120ms before the dive so it can be dodged
            if (Math.floor(time / 80) % 2 === 0) s.setTint(0xffffff); else s.clearTint();
            this.drawTelegraph(s, px);
            if (time >= this._diveEnd) {
                s.clearTint();
                this._telegraph.setVisible(false);
                this._diveState = 'diving';
                this._diveStart = time;
                const ang = Math.atan2(this._ty - s.y, this._tx - s.x);
                b.setVelocity(Math.cos(ang) * this._diveSpeed, Math.sin(ang) * this._diveSpeed);
            }
        } else if (this._diveState === 'diving') {
            const hitPlayer = pl && !pl.dead && Phaser.Geom.Intersects.RectangleToRectangle(bodyRect(s), bodyRect(pl.sprite));
            const reached = Phaser.Math.Distance.Between(s.x, s.y, this._tx, this._ty) < 16;
            if (reached || hitPlayer || b.bottom >= this._groundBottom || time - this._diveStart > 1200) {
                this._diveState = 'approach';
                this._diveReadyAt = time + this._diveCd * rand(0.8, 1.3);
                this._lane = (s.x >= px ? 1 : -1) * rand(110, 200); // climb away on the side it ended up on
            }
        }
    }

    updateExploder(time, dt, px) {
        const s = this.sprite;
        const dx = px - s.x;
        if (Math.abs(dx) < 500) {
            this.dir = dx >= 0 ? 1 : -1;
            const ahead = s.x + this.dir * 20;
            if (this.scene.hasGroundAt(ahead)) s.body.setVelocityX(this.dir * this.speed);
            else s.body.setVelocityX(0);
        } else {
            s.body.setVelocityX(0);
        }
        if (Math.abs(dx) < 100 && this._fuseStart === 0) {
            this._fuseStart = time;
            s.setTint(0xff5533);
        }
        if (this._fuseStart > 0) {
            const blink = Math.floor(time / 120) % 2 === 0;
            if (blink) s.setTint(0xffffff); else s.setTint(0xff5533);
            if (time - this._fuseStart >= this._fuseTime) { this.explode(); return; }
        }
    }

    explode() {
        if (this._exploded) return;
        this._exploded = true;
        const s = this.sprite;
        FX.explosionRing(this.scene, s.x, s.y, this._expRadius);
        FX.screenShake(this.scene, 6, 220);
        const pl = this.scene.player;
        if (pl && !pl.dead && Math.hypot(pl.sprite.x - s.x, pl.sprite.y - s.y) <= this._expRadius) {
            pl.takeDamage(this._expDmg, s.x);
        }
        this.die();
    }

    // Baked brightness variant: one canvas per shade, cached by key
    _variantTexture(scene, baseKey, shade, factor) {
        const newKey = baseKey + '_b' + shade;
        if (scene.textures.exists(newKey)) return newKey;
        const img = scene.textures.get(baseKey).getSourceImage();
        const canvas = scene.textures.createCanvas(newKey, img.width, img.height);
        const ctx = canvas.getContext();
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
            px[i] = Math.min(255, Math.round(px[i] * factor));
            px[i + 1] = Math.min(255, Math.round(px[i + 1] * factor));
            px[i + 2] = Math.min(255, Math.round(px[i + 2] * factor));
        }
        ctx.putImageData(data, 0, 0);
        canvas.refresh();
        return newKey;
    }

    // Absorbing a normal attack (params.absorb): a bright, longer green flash of the whole mirror than flashReflect's
    flashAbsorb() {
        const now = this.scene.time.now;
        this._glowBoostUntil = now + 500; this._glowBoostLen = 500; this._glowBoostAmp = 18;
        this.sprite.setTintFill(0x9dffc4);
        this.scene.time.delayedCall(170, () => {
            if (this.sprite && this.sprite.active) this.sprite.clearTint();
        });
    }

    flashReflect() {
        const now = this.scene.time.now;
        this._glowBoostUntil = now + 300;
        if (this.params.edge_glow) {
            this.sprite.setTintFill(this.params.edge_glow.flash_color);
            this.scene.time.delayedCall(220, () => {
                if (this.sprite && this.sprite.active) this.sprite.clearTint();
            });
        }
    }

    // Mirror enemy: absorb FX + hit counting + beam firing (called from takeHit and player.js)
    onMirrorHit() {
        if (this.dead || !this.sprite.active) return;
        const mb = this.params.mirror_beam;
        if (!mb) return;
        const now = this.scene.time.now;
        // Absorb FX (throttled 150ms so multi-hit skills don't spam)
        if (now - (this._absorbFxAt || 0) > 150) {
            this._absorbFxAt = now;
            this.flashAbsorb();
            FX.mirrorAbsorb(this.scene, this.sprite.x, this.sprite.y - 10);
            if (typeof Extras !== 'undefined' && Extras._float) Extras._float(this.scene, this.sprite.x, this.sprite.y - 50, '吸收!', '#b8ffd0', 20);
        }
        // Dedup: ignore hits within dedupe_ms window (same attack/swing counts as one)
        if (now - (this._mirrorLastHitAt || 0) < (mb.dedupe_ms || 400)) return;
        this._mirrorLastHitAt = now;
        this._mirrorHitCount = (this._mirrorHitCount || 0) + 1;
        if (this._mirrorHitCount >= (mb.hits || 3)) {
            this._mirrorHitCount = 0;
            this._fireMirrorBeam();
        }
    }

    _fireMirrorBeam() {
        if (this.dead || !this.sprite.active) return;
        const mb = this.params.mirror_beam;
        if (!mb) return;
        const pl = this.scene.player;
        if (!pl || pl.dead) return;
        const x = this.sprite.x, y = this.sprite.y;
        const damage = mb.damage || 15;
        if (mb.shape === 'bar') {
            // Small mirror: bar beam toward player, angle in upper semicircle [0..PI]
            const thick = this.sprite.displayWidth || 48;
            const len = mb.range || 100;
            const dx = pl.sprite.x - x;
            const dy = y - pl.sprite.y;
            let angle = Math.atan2(dy, dx);
            // spec: never aim below the ground; if the player is below the mirror, clamp to the nearer horizontal edge (toward the player, not away)
            if (angle < 0) angle = (dx >= 0) ? 0 : Math.PI;
            else angle = Math.min(Math.PI, angle);
            const endX = x + Math.cos(angle) * len;
            const endY = y - Math.sin(angle) * len;
            this._mirrorBar = FX.mirrorBarBeam(this.scene, x, y, angle, len, thick);
            // Hit detection: line-rectangle intersection (one shot, the damage is decided here, not per frame)
            const line = new Phaser.Geom.Line(x, y, endX, endY);
            const br = bodyRect(pl.sprite);
            if (Phaser.Geom.Intersects.LineToRectangle(line, br)) {
                pl.takeDamage(damage, x, true);
            }
        } else if (mb.shape === 'arc') {
            // Big mirror: expanding upper-semicircle ring of thickness `thick`. The wave front only moves outward,
            // so every point is crossed once: each frame test the band [prevR - thick, currentR] (a gap-free window
            // even on long frames) against the closest point of the player's body that lies above the mirror centre.
            const maxR = mb.range || 180;
            const thick = mb.thick || 20;
            const ms = 600;
            let hasHit = false;
            let prevR = 0;
            const self = this;
            this._mirrorWave = FX.mirrorArcWave(this.scene, x, y, maxR, thick, ms, function (currentR) {
                const inner = prevR - thick;          // band window for this frame (prevR is read before it moves on)
                prevR = currentR;
                if (self.dead || !self.sprite.active) { self._stopMirrorWave(); return; }   // a dead mirror must not keep expanding or hurting
                if (hasHit || pl.dead || !pl.sprite.active) return;
                const br = bodyRect(pl.sprite);
                if (br.top >= y) return;              // the whole body is below the mirror's centre line: the arc (upper 180 deg) cannot reach it
                const clipB = Math.min(br.bottom, y); // the body clipped to the upper half (br.top < y above keeps it non-degenerate)
                // A clipped body rect is convex, so the distances of its points fill the whole interval [dNear, dFar]; the wave band
                // (upper half annulus) shares exactly those distances -> they meet iff the two intervals overlap. Only asking the
                // closest point would miss someone standing under the mirror (closest distance 0) whose head is in the ring.
                const dNear = Math.hypot(Math.min(Math.max(br.left, x), br.right) - x, clipB - y);
                const dFar = Math.hypot(Math.max(Math.abs(br.left - x), Math.abs(br.right - x)), Math.max(Math.abs(br.top - y), Math.abs(clipB - y)));
                if (dNear <= currentR && dFar >= inner) {
                    hasHit = true;
                    pl.takeDamage(damage, x, true);
                }
            });
        }
    }

    // Clear what is still flying (mirror died / wave over): see FX.mirrorArcWave / FX.mirrorBarBeam
    _stopMirrorWave() {
        const w = this._mirrorWave;
        this._mirrorWave = null;
        if (w && w.active) w.destroy();
        const b = this._mirrorBar;
        this._mirrorBar = null;
        if (b && b.active) b.destroy();
    }

    takeHit(damage, srcX, isCrit, info) {
        if (this.dead) return;
        if (this._splitGraceUntil > this.scene.time.now) return;   // freshly split black slime: invulnerable while it flickers (user 2026-10-14)
        if (this.params && this.params.fixed_hp) damage = Math.max(1, damage);
        // Mirror enemies: immune to non-stomp hits; absorb FX + counting + beam firing
        if (this.params.absorb && this.params.mirror_beam && !(info && info.stomp)) {
            this.onMirrorHit();
            return;
        }
        this.hp -= damage;
        FX.hitEnemy(this.scene, this.sprite, isCrit, this.sprite.x, this.sprite.y);
        FX.damageNumber(this.scene, this.sprite.x, this.sprite.y - 24, Math.round(damage), isCrit, false);
        if (!this.isFlyer() && this.behavior !== 'Exploder' && !(info && info.noKnockback)) {   // mid-range shots never knock back
            this._knockUntil = this.scene.time.now + 400;
            const dir = Math.sign(this.sprite.x - srcX) || 1;
            this.sprite.body.setVelocityX(dir * (isCrit ? 360 : 260));   // was 140 (user 2026-10-13: stronger knock-back, to test)
            const s = this.sprite, self = this;
            this.scene.time.delayedCall(150, function () {
                if (!s.active || self._popUntil > self.scene.time.now) return;
                // a hopping slime hit mid-air keeps flying forward; zeroing here froze the hop in the air
                if (self.hop && self._hopPhase === 'air') s.body.setVelocityX(self.dir * self._hopVxFor(self._curHopDist || self._hopDist));
                else s.body.setVelocityX(0);
            });
        }
        if (this.hp <= 0) this.die();
    }

    // Auntie's basic attack: small pop along (vx, vy) = the normal of her swing loop at the hit point.  Ground enemies only (flyers / exploders / bosses have no nudge);
    // sets the same _knockUntil window as takeHit so the AI does not overwrite the velocity, and lets gravity bring it down.
    nudge(vx, vy) {
        if (this.dead || this._launchState || this.isFlyer() || this.behavior === 'Exploder') return;
        const s = this.sprite;
        if (!s.active || !s.body) return;
        this._knockUntil = this.scene.time.now + 400;
        this._popUntil = this.scene.time.now + 700;   // AI movement is paused meanwhile (Patrol etc. rewrite velocity.x every frame and would cancel the pop)
        s.body.setVelocity(vx, vy);
    }

    // Auntie's skill (take profit): knocked up and away from `srcX` on a 45 degree path (apex `heightPx`, so it lands 4 x heightPx away), and once it lands it is stunned for `stunMs`.  Bosses have no launch().  Not re-launched
    // while already airborne / stunned.  Flyers get gravity back until they land, then resume their hover.
    launch(now, cfg, srcX) {
        if (this.dead || this._launchState) return;
        const s = this.sprite, b = s.body;
        this._launchState = 'air'; this._launchStart = now; this._stunMs = cfg.stunMs;
        b.setAllowGravity(true);
        const vy = Math.sqrt(2 * 1000 * cfg.heightPx) + 1000 / 120;   // gravity is 1000 px/s^2 (main.js)
        b.setVelocity((Math.sign(s.x - srcX) || 1) * vy, -vy);        // vx = vy -> 45 degrees, away from the caster
        if (this._telegraph) this._telegraph.setVisible(false);
        s.clearTint();
        if (this.hop) s.setFrame(3);
    }

    // true = the enemy is busy (airborne or stunned) and update() must skip its normal behaviour
    _updateLaunch(time) {
        const s = this.sprite, b = s.body;
        if (this._launchState === 'air') {
            if (time - this._launchStart > 120 && (b.blocked.down || b.touching.down)) {
                this._launchState = 'stun';
                this._stunEnd = time + this._stunMs;
                b.setVelocity(0, 0);
                if (this.hop) s.setFrame(0);
                if (this._stunMs > 0 && FX.stunDizzy) FX.stunDizzy(this.scene, this, this._stunMs);   // stars circling the head while stunned (not for a launch with stunMs 0: the SIM attack)
            } else {
                if (this.hop) s.setFrame(b.velocity.y < 0 ? 3 : 4);
                return true;
            }
        }
        if (time < this._stunEnd) { b.setVelocityX(0); return true; }
        // stun over: put the normal behaviour back in a clean state
        this._launchState = null;
        if (this.isFlyer()) {
            b.setAllowGravity(false); this._diveState = 'approach'; this._diveReadyAt = time + 800;
            // hike_sprig: a launch interrupts the shoot machine (update() skips the AI) - windup/hold
            // must not resume from mid-air with a stuck swell and an instantly fired drop, and the
            // cooldown restarts from the recovery (grok review 1, suggestion 4).
            if (this._shootState === 'windup' || this._shootState === 'hold') {
                this._shootState = 'idle';
                this._shootCdReadyAt = time + ((this.params.shoot && this.params.shoot.cd_ms != null) ? this.params.shoot.cd_ms : 3200);
                s.setScale(s.baseScaleX, s.baseScaleY);
            }
        }
        if (this.hop) { this._hopPhase = 'rest'; this._hopT = time + 300; s.setFrame(0); }
        if (this.behavior === 'Charge') { this._chargeState = 'idle'; this._chargeEnd = 0; }
        if (this.behavior === 'Roller') { this._rollState = 'roll'; this._rollEnd = 0; this._dashReadyAt = time + 1000; s.clearTint(); }
        if (this.behavior === 'Jumper') this._landAt = 0;
        return false;
    }

    // Vendor's skill (stir fry): cfg = { durationMs, intervalMs, damage }. Already scorched -> ignored (no stacking, no refresh).
    scorch(now, cfg) {
        if (this.dead || this._scorchEnd > 0) return;
        if (this.params.absorb) return;   // bronze mirror: immune to skills, so the skill's burn ticks must not write hp either (user spec: 免疫普通攻擊與技能)
        this._scorchCfg = { durationMs: cfg.durationMs, intervalMs: cfg.intervalMs, damage: cfg.damage, ticks: Math.floor(cfg.durationMs / cfg.intervalMs + 1e-6) };
        this._scorchEnd = now + cfg.durationMs;
        this._scorchStep = 0;
    }

    // Vendor's normal attack. Already burning -> ignored (no stacking, no refresh).
    ignite(now) {
        if (this.dead || this._igniteEnd > 0) return;
        this._igniteEnd = now + this.constructor.IGNITE.durationMs;
        this._igniteStep = 0;
    }

    pitDamage(amount) {
      if (this.dead) return;
      this.hp -= amount;
      FX.damageNumber(this.scene, this.sprite.x, this.sprite.y - 24, Math.round(amount), false, false);
      if (!this._dotRed) {
        this.sprite.setTint(0xff7070);
        this.scene.time.delayedCall(120, () => {
          if (this.sprite && this.sprite.active && !this._dotRed) this.sprite.clearTint();
        });
      }
      if (this.hp <= 0) {
        this.fell = true;
        this.die();
      }
    }

    applyPoison(dmg, intervalMs, durationMs) {
      if (this.dead) return;
      const now = this.scene.time.now;
      this._poisonDmg = dmg;
      this._poisonInterval = intervalMs;
      const newEnd = now + durationMs;
      if (!this._poisonEnd || this._poisonEnd < now) {
        this._poisonNext = now + intervalMs;
      }
      this._poisonEnd = Math.max(this._poisonEnd || 0, newEnd);
    }

    applyBurn(dps, duration) {
        if (this.params.absorb) return;   // bronze mirror: an on-hit item burn comes from a skill hit (hooks.js) and skills do no damage (user spec). Side effect: a fire pit would not burn a mirror either - pit kinds only exist on levels 1-3, mirrors on 7-10, so nothing co-exists today.
        const now = this.scene.time.now;
        const end = now + duration * 1000;
        if (end > this._burnEnd) { this._burnEnd = end; }
        if (dps > this._burnDps) { this._burnDps = dps; }
        if (this._burnTick < now) { this._burnTick = now + 500; }
    }

    // Knocked into a spiked pit: lose HP, go back to the spawn point, 1.5 s semi-transparent and frozen (no contact damage).
    pitReset() {
        if (this.dead) return;
        const s = this.sprite, now = this.scene.time.now;
        this.hp -= 20;
        FX.damageNumber(this.scene, s.x, this.scene.lvl.y_ground - 30, 20, false, false);
        if (this.hp <= 0) { this.fell = true; this.die(); return; }
        s.body.reset(this.spawnX, this.spawnY);
        s.setAlpha(0.5); s.clearTint();
        this._resetUntil = now + 1500;
        this._knockUntil = 0;
        this._chargeState = 'idle'; this._lungeEnd = 0;
        if (this._telegraph) this._telegraph.setVisible(false);
        if (this._thorn) { this._thornClear(); this._thorn.state = 'idle'; this._thornGlowOff(); }  // pit reset clears thorn (grok r2)
        if (this.hop) { this._hopPhase = 'rest'; this._hopT = now + 1500; s.setFrame(0); }
    }

    // Green slime: leaves a green puddle; touching it hurts for `duration_ms` (default 3 s), fading out over the last 0.6 s.
    // Killed in the air: a green blob falls to the floor first (harmless), splashes, and only then does the puddle start (damage + timer).
    // The puddle looks alive: it breathes, a lighter blob rolls back and forth inside, and bubbles rise from it and pop.
    spawnGoo(x, bottom) {
        const scene = this.scene, g = this.params.death_goo, dur = g.duration_ms || 3000, dmg = (g.damage || this.def.damage) * this.dmgMult;
        const floor = scene.lvl.y_ground, W = g.width || 100;
        const pal = Enemy.PALETTES[g.palette];
        const self = this;
        if (bottom < floor - 3) {
            const drop = scene.add.ellipse(x, bottom - 8, 26, 30, (pal ? pal.fill : 0x4cd964), 0.9).setStrokeStyle(2, (pal ? pal.stroke : 0x1f8f3a)).setDepth(1.9);
            let vy = 0;
            const fall = function (t, dtMs) {
                if (!drop.active) { scene.events.off('update', fall); return; }
                const dt = Math.min(dtMs, 50) / 1000;
                vy += 1000 * dt; drop.y += vy * dt;
                drop.setScale(0.85, 1 + Math.min(0.5, vy / 900));            // stretches as it speeds up
                if (drop.y + 15 >= floor) {
                    scene.events.off('update', fall); drop.destroy();
                    for (let k = 0; k < 6; k++) {                              // splash droplets
                        const d = scene.add.circle(x, floor - 6, rand(3, 5), (pal ? pal.fill : 0x4cd964), 0.9).setDepth(1.95);
                        scene.tweens.add({ targets: d, x: x + rand(-40, 40), y: floor - rand(14, 34), alpha: 0, duration: 320, ease: 'Quad.easeOut', onComplete: function () { d.destroy(); } });
                    }
                    self._makeGoo(x, floor, W, dur, dmg, true, pal, g.visual !== false, g.center_dy);
                }
            };
            scene.events.on('update', fall);
        } else this._makeGoo(x, bottom, W, dur, dmg, false, pal, g.visual !== false, g.center_dy);
    }

    // centerDy (px, optional; death_goo.center_dy): how far the puddle's centre line sits above `bottom` (the ground line). Default 7 = the old look for slimes;
    // the jar uses 0 so its damage range is centred on the ground line (user 2026-11-13, foot-zero calibration).
    _makeGoo(x, bottom, W, dur, dmg, splat, colors, visual, centerDy) {
        const scene = this.scene;
        const cdy = (typeof centerDy === 'number') ? centerDy : 7;
        const cFill = colors ? colors.fill : 0x4cd964;
        const cStroke = colors ? colors.stroke : 0x1f8f3a;
        const cRoll = colors ? colors.roll : 0xb6ff9a;
        const cBubble = colors ? colors.bubble : 0xc8ffb0;
        const drawVisual = visual !== false;
        const goo = scene.add.ellipse(x, bottom - cdy, W, 18, cFill, 0.8).setStrokeStyle(2, cStroke).setDepth(1.9);
        if (!drawVisual) goo.setVisible(false);
        const roll = scene.add.ellipse(x, bottom - cdy - 1, W * 0.32, 8, cRoll, 0.55).setDepth(1.91);   // lighter blob that rolls around inside
        if (!drawVisual) roll.setVisible(false);
        const bubbles = [];
        const t0 = scene.time.now;
        let lastHit = -1e9, nextBubble = t0 + 80; // damage ticks at most once per 0.5 s while the player stands in the puddle
        const cleanup = function () { goo.destroy(); roll.destroy(); bubbles.forEach(function (b) { b.o.destroy(); }); bubbles.length = 0; scene.events.off('update', upd); };
        const upd = function () {
            if (!goo.active) { cleanup(); return; }
            const now = scene.time.now, left = t0 + dur - now, age = now - t0;
            if (left <= 0) { cleanup(); return; }
            const fade = left < 600 ? left / 600 : 1;
            const grow = splat ? Math.min(1, 0.35 + age / 180 * 0.65) : 1;      // splash: flattens out wide over ~0.2 s
            if (drawVisual) {
                goo.setAlpha(0.8 * fade * (left < 600 ? 1 : 0.9 + 0.1 * Math.sin(now / 120)));
                goo.setScale(grow * (1 + 0.04 * Math.sin(now / 150)), grow * (1 + 0.12 * Math.sin(now / 110 + 1)));
                roll.setPosition(x + Math.sin(now / 330) * W * 0.26, bottom - cdy - 1 + Math.sin(now / 210) * 1.5);
                roll.setScale(1 + 0.25 * Math.sin(now / 190), 1 - 0.3 * Math.sin(now / 190)); roll.setAlpha(0.55 * fade);
                if (now >= nextBubble && left > 700) {
                    nextBubble = now + rand(90, 220);
                    const r = rand(3, 7), bx = x + rand(-W * 0.4, W * 0.4);
                    const o = scene.add.circle(bx, bottom - cdy - 2, r, cBubble, 0.5).setStrokeStyle(1.5, cStroke).setDepth(1.92);
                    bubbles.push({ o: o, born: now, life: rand(450, 800), x0: bx, y0: bottom - cdy - 2, r: r, rise: rand(14, 30) });
                }
                for (let k = bubbles.length - 1; k >= 0; k--) {
                    const b = bubbles[k], a = (now - b.born) / b.life;
                    if (a >= 1) { b.o.destroy(); bubbles.splice(k, 1); continue; }
                    b.o.setPosition(b.x0 + Math.sin(a * 6 + b.r) * 3, b.y0 - b.rise * a);
                    b.o.setScale(a < 0.8 ? 1 + a * 0.5 : 1.5 + (a - 0.8) * 5);             // swells, then pops (grows + fades) at the end
                    b.o.setAlpha(a < 0.8 ? 0.55 * fade : 0.55 * fade * (1 - (a - 0.8) / 0.2));
                }
            }
            const pl = scene.player;
            if (pl && !pl.dead && Phaser.Geom.Intersects.RectangleToRectangle(goo.getBounds(), bodyRect(pl.sprite)) && now - lastHit >= 500) { lastHit = now; pl.takeDamage(dmg, goo.x); }
        };
        scene.events.on('update', upd);
    }

    _spawnEmber(x) {
        if (!this.params.ember_pool) return;
        if (!this.sprite || !this.sprite.body) return;
        const ep = this.params.ember_pool;
        this._makeGoo(x, this.sprite.body.bottom, ep.width || 90, ep.duration_ms || 2500, (ep.damage || 4) * this.dmgMult, true, Enemy.EMBER_COLORS);
    }

    _deathBurst(x, y) {
        const od = this.params.on_death;
        const radius = od.burst_radius || 120;
        const windup = od.windup_ms || 400;
        const scene = this.scene;
        const circle = scene.add.circle(x, y, radius, 0xff2200, 0.28).setStrokeStyle(2, 0xff2200).setDepth(3);
        scene.time.delayedCall(windup, function () {
            if (circle && circle.destroy) circle.destroy();
            if (!scene || !scene.sys || !scene.sys.isActive()) return;
            FX.explosionRing(scene, x, y, radius);
            const pl = scene.player;
            if (pl && !pl.dead && pl.sprite && Phaser.Math.Distance.Between(x, y, pl.sprite.x, pl.sprite.y) <= radius) {
                pl.takeDamage((od.damage || 8) * this.dmgMult, x);
            }
        }, [], this);
    }

    _shatterFx(x, bottomY) {
        const scene = this.scene;
        const fx = this.params.shatter_fx;
        const count = fx.count || 10;
        const stayMs = fx.stay_ms || 3000;
        const f = this.variant ? this.variant.factor : 1;
        const clamp = function (v) { return Math.max(0, Math.min(255, Math.round(v))); };
        const baseColor = (clamp(0xc8 * f) << 16) | (clamp(0x93 * f) << 8) | clamp(0x5a * f);
        const outlineColor = (clamp(0x6b * f) << 16) | (clamp(0x44 * f) << 8) | clamp(0x23 * f);
        // restY: where the shards' centres come to rest. Default = 3 px above the ground line (old look); shatter_fx.rest_dy 0 centres the pile on the ground line (user 2026-11-13, foot-zero calibration).
        const floorY = scene.lvl.y_ground;
        const restY = floorY - (typeof fx.rest_dy === 'number' ? fx.rest_dy : 3);
        const shards = [];
        for (let i = 0; i < count; i++) {
            const size = rand(5, 12);
            const pts = [];
            const n = Math.random() < 0.5 ? 3 : 4;
            for (let k = 0; k < n; k++) {
                const a = (k / n) * Math.PI * 2 + rand(-0.3, 0.3);
                const r = size * rand(0.6, 1.0);
                pts.push(Math.cos(a) * r, Math.sin(a) * r);
            }
            const jitter = 1 + rand(-0.15, 0.15);
            const col = (clamp(((baseColor >> 16) & 0xff) * jitter) << 16) | (clamp(((baseColor >> 8) & 0xff) * jitter) << 8) | clamp((baseColor & 0xff) * jitter);
            const shard = scene.add.polygon(x + rand(-10, 10), bottomY - rand(4, 24), pts, col);
            shard.setStrokeStyle(1.5, outlineColor);
            shard.setDepth(1.95);
            shard._ownColor = col;
            shard._vx = rand(-170, 170);
            shard._vy = rand(-340, -160);
            shard._spin = rand(-8, 8);
            shard._resting = false;
            shard._bounced = false;
            shard._landedAt = 0;
            shard._phase = rand(0, 90);
            shards.push(shard);
        }
        let firstLandAt = 0;
        let done = false;
        const listener = function (time, delta) {
            if (done) return;
            if (!scene.sys.isActive()) {
                done = true;
                for (const s of shards) s.destroy();
                scene.events.off('update', listener);
                return;
            }
            const dt = Math.min(delta, 50) / 1000;
            for (const s of shards) {
                if (s._resting) continue;
                s._vy += 950 * dt;
                s.x += s._vx * dt;
                s.y += s._vy * dt;
                s.rotation += s._spin * dt;
                if (s.y >= restY) {
                    s.y = restY;
                    if (!s._bounced) {
                        s._bounced = true;
                        s._vy = -90;
                        s._vx = 0;
                        s._spin = 0;
                    } else {
                        s._vx = 0;
                        s._vy = 0;
                        s._spin = 0;
                        s._resting = true;
                        s._landedAt = time;
                        if (!firstLandAt) firstLandAt = time;
                    }
                }
            }
            if (firstLandAt) {
                const elapsed = time - firstLandAt;
                const fadeStart = stayMs - 600;
                for (const s of shards) {
                    if (!s._resting) continue;
                    if (elapsed >= stayMs) {
                        done = true;
                        for (const sh of shards) sh.destroy();
                        scene.events.off('update', listener);
                        return;
                    }
                    if (elapsed >= fadeStart) {
                        const a = 1 - (elapsed - fadeStart) / 600;
                        s.setFillStyle(s._ownColor, Math.max(0, a));
                    } else {
                        const blink = ((time + s._phase) % 180) < 90;
                        if (blink) s.setFillStyle(0xfff0c8, 1);
                        else s.setFillStyle(s._ownColor, 0.35);
                    }
                }
            }
        };
        scene.events.on('update', listener);
    }

    _fireZone(x, floorY, fa) {
        const scene = this.scene;
        const patch = scene.add.ellipse(x, floorY - 6, fa.width, 14, 0xff7a1a, 0.7);
        patch.setStrokeStyle(2, 0xa8320c);
        patch.setDepth(1.9);
        const tongues = [];
        for (let i = 0; i < 5; i++) {
            const tx = x + (Math.random() * 2 - 1) * (fa.width * 0.35);
            const h = 8 + Math.random() * 8;
            const t = scene.add.ellipse(tx, floorY - 6 - h / 2, 6, h, Math.random() < 0.5 ? 0xffb347 : 0xff5a1a, 0.85);
            t.setDepth(2);
            tongues.push(t);
        }
        const start = scene.time.now;
        let lastTick = 0;
        const onUpdate = function (time) {
            // chunk 11 (grok review of chunk 8, must-fix 2): `finished` joins the inactive-scene teardown - a burn zone
            // that was already burning would otherwise keep ticking damage during the defeat cutscene.
            if (!scene.sys.isActive() || scene.finished) {
                scene.events.off('update', onUpdate);
                patch.destroy();
                tongues.forEach(function (t) { t.destroy(); });
                return;
            }
            const elapsed = time - start;
            if (elapsed >= fa.burn_ms) {
                scene.events.off('update', onUpdate);
                patch.destroy();
                tongues.forEach(function (t) { t.destroy(); });
                return;
            }
            const fade = elapsed > fa.burn_ms - 250 ? (fa.burn_ms - elapsed) / 250 : 1;
            patch.setAlpha(0.7 * fade);
            tongues.forEach(function (t, i) {
                const flick = 0.7 + Math.random() * 0.5;
                t.setAlpha(0.85 * fade * flick);
                t.setScale(0.8 + Math.random() * 0.4, flick);
            });
            const pl = scene.player;
            if (pl && !pl.dead && time - lastTick >= 250) {
                const pb = bodyRect(pl.sprite);
                if (Phaser.Geom.Intersects.RectangleToRectangle(pb, patch.getBounds())) {
                    lastTick = time;
                    pl.tickDamage(fa.tick_dmg, 0xff9040);
                }
            }
        };
        scene.events.on('update', onUpdate);
    }

    // ---------- hike_sprig: a telegraphed water drop while drifting (loop/req.md §2) ----------
    // idle -> windup (stand dead still, swell + white/aqua blink for windup_ms) -> one drop straight at
    // where the player stands at the moment of the shot -> hold (still standing there for hold_ms) ->
    // back to drifting, and cd_ms only starts counting when it drifts on (QUESTIONS.md A3). A shot is
    // never cut into the existing dive telegraph / dive: it only starts from 'approach' (QUESTIONS.md A2).
    // Returns true while it owns the frame (updateFlyer then does not run the dive machine).
    updateShoot(time, px, pl) {
        const p = this.params.shoot, s = this.sprite, b = s.body;
        if (this._shootState === 'windup') {
            b.setVelocity(0, 0);
            const k = 1 + 0.18 * (0.5 + 0.5 * Math.sin(time / 90));   // swell: readable without new art
            s.setScale(s.baseScaleX * k, s.baseScaleY * k);
            s.setTint(Math.floor(time / 90) % 2 ? 0xffffff : 0x8fd6ff);
            if (time >= this._shootWindupEnd) {
                s.clearTint();
                s.setScale(s.baseScaleX, s.baseScaleY);
                this._fireWaterShot();
                this._shootState = 'hold';
                this._shootHoldEnd = time + (p.hold_ms != null ? p.hold_ms : 900);
            }
            return true;
        }
        if (this._shootState === 'hold') {
            b.setVelocity(0, 0);   // gravity stays off until it drifts on again (see the windup entry)
            if (time >= this._shootHoldEnd) {
                this._shootState = 'idle';
                this._shootCdReadyAt = time + (p.cd_ms != null ? p.cd_ms : 3200);
                b.setAllowGravity(true);
            }
            return true;
        }
        if (this._shootState === 'idle') {
            if (!pl || pl.dead) return false;
            if (time < this._shootCdReadyAt) return false;
            if (Math.abs(px - s.x) > (p.range != null ? p.range : 380)) return false;
            if (this._diveState !== 'approach') return false;
            this._shootState = 'windup';
            this._shootWindupEnd = time + (p.windup_ms != null ? p.windup_ms : 600);
            // stand dead still: level.js spawns enemies through physics.add.group(), and adding the
            // sprite to the group re-enables the gravity that the constructor turned off for
            // flyers (measured: setVelocity(0,0) alone sinks the sprig ~25 px/s, the physics step
            // rewrites vy to +g*dt after it). So windup/hold switch gravity off and 'idle' gets
            // it back; baseline flyers overwrite velocity every frame and never notice.
            b.setVelocity(0, 0);
            b.setAllowGravity(false);
            return true;
        }
        return false;
    }

    // One water drop: same shape as fireProjectile (straight line, no gravity, pushed to scene._enemyShots
    // so the Vendor's flame can cancel it, dies on the ground / world edge / on hit) and the same damage
    // call (player.takeDamage); only the look and the numbers come from params.shoot, and unlike a
    // shooter's projectile it is dropped when the sprig itself dies (loop/req.md §2 'clean up the drops').
    _fireWaterShot() {
        const p = this.params.shoot, s = this.sprite, scene = this.scene;
        const pl = scene.player;
        const x0 = s.x, y0 = s.y + 6;
        const tx = pl ? pl.sprite.x : x0;
        const ty = pl && pl.sprite.body && pl.sprite.body.center ? pl.sprite.body.center.y : (pl ? pl.sprite.y : y0);
        const dx = tx - x0, dy = ty - y0, dist = Math.max(1, Math.hypot(dx, dy));
        const spd = p.projectile_speed || 220, dmg = (p.projectile_damage || this.def.damage) * this.dmgMult;
        const vx = dx / dist * spd, vy = dy / dist * spd;
        const drop = scene.add.circle(x0, y0, 7, 0x59c7f0, 0.92).setStrokeStyle(2, 0x1c6a8a).setDepth(3);
        drop._vx = vx; drop._vy = vy;   // the test reads these to check 'straight line at 220 px/s'
        (scene._enemyShots = scene._enemyShots || []).push(drop);
        if (!this._shots) this._shots = [];
        this._shots.push(drop);
        this._shotsFired = (this._shotsFired || 0) + 1;
        this._shotAt = scene.time.now;
        const gy = scene.lvl.y_ground, W = scene.physics.world.bounds.width;
        const upd = function (t, dtMs) {
            if (!drop.active) { scene.events.off('update', upd); return; }
            const dt = Math.min(dtMs, 50) / 1000;
            drop.x += vx * dt; drop.y += vy * dt;
            const q = scene.player;
            if (q && !q.dead && Phaser.Geom.Intersects.RectangleToRectangle(drop.getBounds(), bodyRect(q.sprite))) {
                q.takeDamage(dmg, drop.x);
                FX.hitSpark(scene, drop.x, drop.y);
                drop.destroy(); scene.events.off('update', upd); return;
            }
            if (scene.hasGroundAt(drop.x) && drop.y >= gy - 4) { FX.hitSpark(scene, drop.x, gy - 6); drop.destroy(); scene.events.off('update', upd); return; }
            // top bound + lifetime like fireProjectile (grok review 1, suggestion 3): a drop fired
            // upwards (player mid-jump above the sprig) would otherwise sail on forever with its
            // listener running every frame
            if (drop.x < -30 || drop.x > W + 30 || drop.y > 620 || drop.y < -30) { drop.destroy(); scene.events.off('update', upd); return; }
        };
        scene.events.on('update', upd);
        scene.time.delayedCall(3000, function () { if (drop.active) { drop.destroy(); } });   // the handler's !active guard removes itself
    }

    // ---------- hike_cinderite: steam column where the mud ball lands (loop/req.md §4) ----------
    // warn_ms of ground warning (a white ring plus one rising wisp, both program-drawn), then a width x
    // height column that burns an overlapping player landing_zone.damage every tick_ms. Life is
    // duration_ms plus 'how long this enemy has been alive' x grow_ms_per_s, capped at grow_cap_ms. At
    // most max_zones at a time, oldest first. A column that already rose outlives the enemy (like
    // death_goo); one still warning is taken with it, so nobody is hurt by invisible steam.
    _spawnSteam(x) {
        const cfg = this.params.landing_zone, scene = this.scene, self = this;
        if (!cfg) return;
        if (!this._steamZones) this._steamZones = [];
        const gy = scene.lvl.y_ground, now = scene.time.now;
        const aliveS = (now - (this._bornAt || now)) / 1000;
        const life = (cfg.duration_ms || 3000) + Math.min(cfg.grow_cap_ms || 0, aliveS * (cfg.grow_ms_per_s || 0));
        const z = { state: 'warn', x: x, gy: gy, w: cfg.width || 70, h: cfg.height || 90,
                    dmg: (cfg.damage || 6) * this.dmgMult, tickMs: cfg.tick_ms || 500,
                    bornAt: now, warnEndAt: now + (cfg.warn_ms || 500), life: life,
                    endAt: now + (cfg.warn_ms || 500) + life, lastTick: -1e9, done: false, objs: [] };
        const ring = scene.add.ellipse(x, gy - 5, z.w, 14, 0xffffff, 0.22).setStrokeStyle(2, 0xffffff, 0.75).setDepth(1.9);
        const wisp = scene.add.circle(x, gy - 14, 6, 0xf2f7f9, 0.5).setDepth(1.95);
        z.objs.push(ring, wisp);
        this._steamZones.push(z);
        const max = cfg.max_zones || 3;
        let live = this._steamZones.filter(q => !q.done);
        while (live.length > max) { this._removeSteam(live[0]); live = this._steamZones.filter(q => !q.done); }   // oldest first
        const rect = new Phaser.Geom.Rectangle(x - z.w / 2, gy - z.h, z.w, z.h);
        const onUpdate = function (time) {
            if (!scene.sys.isActive()) { self._removeSteam(z); return; }
            if (z.done) return;
            if (time >= z.endAt) { self._removeSteam(z); return; }
            if (z.state === 'warn') {
                const ph = ((time - z.bornAt) % 500) / 500;
                ring.setAlpha(0.22 + 0.18 * Math.sin(time / 90));
                wisp.y = gy - 14 - ph * 26;                       // the first wisp of steam, rising and thinning
                wisp.setAlpha(0.5 - 0.35 * ph);
                if (time < z.warnEndAt) return;
                z.state = 'up';
                for (const o of z.objs) { if (o.active) o.destroy(); }
                z.objs = [];
                z.bodyObj = scene.add.rectangle(x, gy - z.h / 2, z.w, z.h, 0xdfeaf0, 0.34).setDepth(2.05);
                z.coreObj = scene.add.rectangle(x, gy - z.h / 2, z.w * 0.42, z.h, 0xffffff, 0.3).setDepth(2.06);
                z.baseObj = scene.add.ellipse(x, gy - 5, z.w * 1.15, 14, 0xf2f7f9, 0.5).setDepth(2.07);
                z.objs.push(z.bodyObj, z.coreObj, z.baseObj);
                z.riseAt = time;
                FX.hitSpark(scene, x, gy - 8);
            }
            const rise = Math.min(1, (time - z.riseAt) / 220);      // the column rises from the ground
            if (z.bodyObj && z.bodyObj.active) {
                const sway = 1 + 0.06 * Math.sin(time / 150);
                z.bodyObj.setAlpha((0.30 + 0.10 * Math.sin(time / 120)) * rise);
                z.bodyObj.setScale(sway, rise);
                z.coreObj.setAlpha((0.26 + 0.12 * Math.sin(time / 90 + 1)) * rise);
                z.coreObj.setScale(1, rise);
                z.baseObj.setAlpha(0.5 * rise);
            }
            const pl = scene.player;
            if (pl && !pl.dead && time - z.lastTick >= z.tickMs && Phaser.Geom.Intersects.RectangleToRectangle(rect, bodyRect(pl.sprite))) {
                z.lastTick = time;
                pl.tickDamage(Math.max(1, Math.round(z.dmg)), 0xbfe0ee);   // interval damage: not eaten by the 0.8 s invulnerability, no knock-back (QUESTIONS.md B5)
            }
        };
        scene.events.on('update', onUpdate);
        z.off = function () { scene.events.off('update', onUpdate); };
        z.onShutdown = function () { self._removeSteam(z); };   // clear steam update listener when the reused scene restarts
        scene.events.once('shutdown', z.onShutdown);
    }

    _removeSteam(z) {
        if (!z || z.done) return;
        z.done = true;
        if (z.off) z.off();
        if (z.onShutdown) this.scene.events.off('shutdown', z.onShutdown);
        for (const o of z.objs) { if (o && o.active) o.destroy(); }
        z.objs = [];
        if (this._steamZones) {
            const i = this._steamZones.indexOf(z);
            if (i >= 0) this._steamZones.splice(i, 1);
        }
    }

    die() {
        if (this.dead) return;
        if (this._flame) { this._flame.destroy(); this._flame = null; }
        // hike_sprig: a drop already in the air and the windup go away with the sprig (loop/req.md §2)
        if (this._shots) {
            for (const d of this._shots) { if (d.active) d.destroy(); }
            this._shots = [];
        }
        if (this._shootState) {
            this._shootState = 'gone';
            this.sprite.clearTint();
            this.sprite.setScale(this.sprite.baseScaleX, this.sprite.baseScaleY);
        }
        // hike_cinderite: steam that already rose stays on the ground to the end of its life (like
        // death_goo); one still in its warning is destroyed, so it cannot hurt anyone invisibly.
        if (this._steamZones) {
            for (const z of this._steamZones.slice()) { if (z.state === 'warn') this._removeSteam(z); }
        }
        if (this._ghosts) {
            for (const g of this._ghosts) { if (g.active) g.destroy(); }
            this._ghosts = [];
        }
        if (this._chargeGlow && this.sprite.postFX) this.sprite.postFX.remove(this._chargeGlow);
        this._chargeGlow = null;
        this._stopMirrorWave();   // a wave still in the air dies with the mirror (spec: no firing / no expanding after death)
        this.dead = true;
        const s = this.sprite;
        const x = s.x, y = s.y;
        FX.killEnemy(this.scene, x, y);
        if (this.params.death_goo && !this.fell && s.body && this.scene.hasGroundAt(x) && !(this.scene._pitAt && this.scene._pitAt(x))) this.spawnGoo(x, s.body.bottom);
        if (this.params.on_death && !this.fell && this.params.on_death.burst_radius) this._deathBurst(x, y);
        if (this.params.split_count && !this.fell && !this._isSplitChild && this.scene.addEnemy) this._splitInto(x, y);   // before 'enemy-dead' so the level never sees "0 enemies left" in between
        if (this._telegraph) this._telegraph.destroy();
        this._thornGlowOff(); this._thornClear();   // a dead bramble takes its thorn with it
        const df = this.params.death_fade;
        if (df) {
            // Data-driven gray-then-fade death (hiking minions only; no such param = old behaviour).
            // Gray tint + pure alpha fade, no scale change. The tint is re-applied every frame because
            // the killing blow's FX.hitEnemy -> flashSprite schedules a clearTint ~100 ms after death that
            // would otherwise wipe the gray part-way through the fade. onComplete guards s.active so a
            // level end / restart / killAll that destroys the group first can never touch a dead sprite.
            const ms = df.ms != null ? df.ms : 600, gray = df.tint != null ? df.tint : 0x9a9a9a;
            if (s.body) s.body.setVelocity(0, 0);   // spec: stop moving while graying out (this branch only)
            s.setTint(gray);
            this.scene.tweens.add({
                targets: s, alpha: 0, duration: ms,
                onUpdate: function () { if (s.active) s.setTint(gray); },
                onComplete: function () { if (s.active) s.destroy(); }
            });
        } else if (this.params.shatter_fx) {
            this._shatterFx(x, s.body ? s.body.bottom : y + 20);
            s.destroy();
        } else {
            this.scene.tweens.add({ targets: s, alpha: 0, scale: s.scale * 1.2, duration: 200, onComplete: function () { s.destroy(); } });
        }
        this.scene.events.emit('enemy-dead', { x: x, y: y, ref: this });
    }

    // Black slime (user 2026-10-14): the medium one splits into params.split_count small ones of the same kind (split_hp each) that flicker and are harmless for the first 1.5 s.
    _splitInto(x, y) {
        const n = this.params.split_count, now = this.scene.time.now;
        const childDef = Object.assign({}, this.def, { size: 'small', hp: this.params.split_hp || this.def.hp, params: Object.assign({}, this.params, { split_count: 0 }) });
        for (let i = 0; i < n; i++) {
            const ox = (i - (n - 1) / 2) * 44;
            this.scene.addEnemy(childDef, x + ox, y + 40);
            const kids = this.scene.enemies.getChildren(), c = kids[kids.length - 1] && kids[kids.length - 1].ref;
            if (!c || c.def !== childDef) continue;
            c._isSplitChild = true; c._splitGraceUntil = now + 1500;
            if (ox !== 0) c.dir = ox > 0 ? 1 : -1;
        }
    }

    drawTelegraph(s, px) {
        const g = this._telegraph;
        g.clear();
        g.lineStyle(3, 0xff4444, 0.9);
        if (this.behavior === 'Charge') {
            g.strokeRect(s.x - 14, s.y - 20, 28, 40);
        } else {
            g.lineBetween(s.x, s.y, this._tx, this._ty);
            g.strokeCircle(this._tx, this._ty, 14);
        }
        g.setVisible(true);
    }
}

Enemy.IGNITE = { durationMs: 1000, ticksMs: [500, 1000], damage: 5 };   // vendor normal attack burn
Enemy.EMBER_COLORS = { fill: 0xff7a1a, stroke: 0xa8320c, roll: 0xffd27a, bubble: 0xffb347 };
Enemy.PALETTES = { clay: { fill: 0xc8935a, stroke: 0x6b4423, roll: 0xe8cfa0, bubble: 0xd9b88a }, ember: Enemy.EMBER_COLORS };

function rand(a, b) { return a + Math.random() * (b - a); }

const THORN_GLOW = 0x9be37a;   // bramble + its thorn glow color (same as the aim flash tint)
const ENEMY_SIZE_H = { small: 48, small_x15: 72, small_x2: 96, medium: 72, large: 120 };
