class Enemy {
    constructor(scene, def, x, y, level) {
        this.scene = scene;
        this.def = def;
        this.id = def.id;
        this.behavior = def.behavior;
        this.params = def.params || {};
        const d = difficulty(level);
        this.dmgMult = d.dmg_mult;
        this.maxHp = Math.round(def.hp * d.hp_mult);
        this.hp = this.maxHp;
        this.dead = false;

        // A Patrol enemy with an 'enemy_<id>_hop' spritesheet (8 cells, see slime_game.aseprite) hops instead of walking
        this.hop = def.behavior === 'Patrol' && scene.textures.exists('enemy_' + def.id + '_hop');
        const texKey = 'enemy_' + def.id + (this.hop ? '_hop' : '');
        const texFrame = scene.textures.get(texKey).get(); // first frame: whole image, or cell 0 of a spritesheet
        const dispH = ENEMY_SIZE_H[def.size] || 48;
        const texH = texFrame.height;
        const scale = dispH / texH;
        const dispW = texFrame.width * scale;

        this.sprite = scene.physics.add.sprite(x, y, texKey);
        this.sprite.setScale(scale);
        this.sprite.baseScaleX = scale; // FX.squash restores to these; without them rapid hits compound and the sprite stays distorted
        this.sprite.baseScaleY = scale;
        this.sprite.setDepth(2);
        this.sprite.setFlipX(true);
        this.sprite.ref = this;
        scene.enemies.add(this.sprite);

        // Body size/offset are in source-texture pixels (Phaser multiplies by sprite scale), bottom-aligned like makeSprite
        const texW = texFrame.width;
        const bwPx = texW * 0.6;
        const bhPx = texH * 0.85;
        this.sprite.body.setSize(bwPx, bhPx);
        this.sprite.body.setOffset((texW - bwPx) / 2, texH - bhPx);

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
        const dt = delta / 1000;
        const s = this.sprite;
        const px = player ? player.sprite.x : s.x;
        const py = player ? player.sprite.y : s.y;

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

        if (this._launchState && this._updateLaunch(time)) return;   // launched / stunned: no AI, no contact damage

        if (time >= (this._popUntil || 0)) switch (this.behavior) {
            case 'Patrol': if (this.hop) this.updateHop(time); else this.updatePatrol(time, dt); break;
            case 'Chase': this.updateChase(time, dt, px); break;
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
                if (this._chargeState === 'charging') this._chargeEnd = 0;
            }
        }

        if (this.isFlyer()) {
            if (Math.abs(px - s.x) > 8) s.setFlipX(px > s.x); // face the player; no flicker when hovering near x
        } else if (this.hop) {
            s.setFlipX(this.dir > 0); // art faces left; hop pauses have zero velocity, so face the hop direction instead
        } else if (this.behavior !== 'Charge' || this._chargeState !== 'charging') {
            s.setFlipX(s.body.velocity.x > 1);
        }

        // no contact damage for a moment after the player stomped this enemy (player.js checkStomp sets _stompGrace)
        if (player && !player.dead && !(this._stompGrace > time) && Phaser.Geom.Intersects.RectangleToRectangle(bodyRect(s), bodyRect(player.sprite))) {
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
        const s = this.sprite;
        const lo = this.spawnX - this._range;
        const hi = this.spawnX + this._range;
        if (s.x <= lo) this.dir = 1;
        else if (s.x >= hi) this.dir = -1;
        const ahead = s.x + this.dir * 20;
        if (!this.scene.hasGroundAt(ahead)) { this.dir *= -1; s.body.setVelocityX(0); return; }
        s.body.setVelocityX(this.dir * this.speed);
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
            }
        } else if (this._chargeState === 'charging') {
            if (time < this._chargeEnd) {
                const ahead = s.x + this.dir * 24;
                if (!this.scene.hasGroundAt(ahead)) { s.body.setVelocityX(0); this._chargeState = 'rest'; this._restEnd = time + this._chargeCd * 1000; }
                else s.body.setVelocityX(this.dir * this._chargeSpeed);
            } else {
                s.body.setVelocityX(0);
                this._chargeState = 'rest';
                this._restEnd = time + this._chargeCd * 1000;
            }
        } else {
            s.body.setVelocityX(0);
        }
    }

    updateRanged(time, dt, px, py) {
        const s = this.sprite;
        s.body.setVelocityX(0);
        this.dir = px >= s.x ? 1 : -1;
        if (Math.abs(px - s.x) < 520 && time >= this._fireAt) {
            this._fireAt = time + this._fireRate;
            this.fireProjectile(px, py);
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

    fireProjectile(px, py) {
        const s = this.sprite;
        const dx = px - s.x;
        const dy = (py - 10) - s.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const vx = dx / dist * this._projSpeed;
        const vy = dy / dist * this._projSpeed;
        const proj = this.scene.physics.add.sprite(s.x + this.dir * 14, s.y - 6, 'enemy_proj');
        proj.setDepth(3);
        proj.body.setCircle(6, -6, -6);
        proj.body.setAllowGravity(false);
        proj.body.setVelocity(vx, vy);
        (this.scene._enemyShots = this.scene._enemyShots || []).push(proj);   // vendor's flame cancels these (player.js cancelEnemyShots)
        const self = this;
        const scene = this.scene;
        const updateProj = function () {
            if (!proj.active) { scene.events.off('update', updateProj); return; }
            if (self.dead) return;
            const p = proj.x;
            const q = proj.y;
            if (p < -30 || p > scene.physics.world.bounds.width + 30 || q > 620) { proj.destroy(); return; }
            if (scene.hasGroundAt(p)) { FX.hitSpark(scene, p, q); proj.destroy(); return; }
            const pl = scene.player;
            if (pl && !pl.dead && Phaser.Geom.Intersects.RectangleToRectangle(proj.getBounds(), bodyRect(pl.sprite))) {
                pl.takeDamage(self._projDmg, s.x);
                FX.hitSpark(scene, p, q);
                proj.destroy();
            }
        };
        scene.events.on('update', updateProj);
        this.scene.time.delayedCall(3000, function () { if (proj.active) proj.destroy(); });
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
        FX.screenShake(this.scene, 0.006, 220);
        const pl = this.scene.player;
        if (pl && !pl.dead && Math.hypot(pl.sprite.x - s.x, pl.sprite.y - s.y) <= this._expRadius) {
            pl.takeDamage(this._expDmg, s.x);
        }
        this.die();
    }

    takeHit(damage, srcX, isCrit, info) {
        if (this.dead) return;
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
        if (this.isFlyer()) { b.setAllowGravity(false); this._diveState = 'approach'; this._diveReadyAt = time + 800; }
        if (this.hop) { this._hopPhase = 'rest'; this._hopT = time + 300; s.setFrame(0); }
        if (this.behavior === 'Charge') { this._chargeState = 'idle'; this._chargeEnd = 0; }
        if (this.behavior === 'Jumper') this._landAt = 0;
        return false;
    }

    // Vendor's skill (stir fry): cfg = { durationMs, intervalMs, damage }. Already scorched -> ignored (no stacking, no refresh).
    scorch(now, cfg) {
        if (this.dead || this._scorchEnd > 0) return;
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
        if (this.hop) { this._hopPhase = 'rest'; this._hopT = now + 1500; s.setFrame(0); }
    }

    // Green slime: leaves a green puddle; touching it hurts for `duration_ms` (default 3 s), fading out over the last 0.6 s.
    // Killed in the air: a green blob falls to the floor first (harmless), splashes, and only then does the puddle start (damage + timer).
    // The puddle looks alive: it breathes, a lighter blob rolls back and forth inside, and bubbles rise from it and pop.
    spawnGoo(x, bottom) {
        const scene = this.scene, g = this.params.death_goo, dur = g.duration_ms || 3000, dmg = (g.damage || this.def.damage) * this.dmgMult;
        const floor = scene.lvl.y_ground, W = g.width || 100;
        const self = this;
        if (bottom < floor - 3) {
            const drop = scene.add.ellipse(x, bottom - 8, 26, 30, 0x4cd964, 0.9).setStrokeStyle(2, 0x1f8f3a).setDepth(1.9);
            let vy = 0;
            const fall = function (t, dtMs) {
                if (!drop.active) { scene.events.off('update', fall); return; }
                const dt = Math.min(dtMs, 50) / 1000;
                vy += 1000 * dt; drop.y += vy * dt;
                drop.setScale(0.85, 1 + Math.min(0.5, vy / 900));            // stretches as it speeds up
                if (drop.y + 15 >= floor) {
                    scene.events.off('update', fall); drop.destroy();
                    for (let k = 0; k < 6; k++) {                              // splash droplets
                        const d = scene.add.circle(x, floor - 6, rand(3, 5), 0x4cd964, 0.9).setDepth(1.95);
                        scene.tweens.add({ targets: d, x: x + rand(-40, 40), y: floor - rand(14, 34), alpha: 0, duration: 320, ease: 'Quad.easeOut', onComplete: function () { d.destroy(); } });
                    }
                    self._makeGoo(x, floor, W, dur, dmg, true);
                }
            };
            scene.events.on('update', fall);
        } else this._makeGoo(x, bottom, W, dur, dmg, false);
    }

    _makeGoo(x, bottom, W, dur, dmg, splat) {
        const scene = this.scene;
        const goo = scene.add.ellipse(x, bottom - 7, W, 18, 0x4cd964, 0.8).setStrokeStyle(2, 0x1f8f3a).setDepth(1.9);
        const roll = scene.add.ellipse(x, bottom - 8, W * 0.32, 8, 0xb6ff9a, 0.55).setDepth(1.91);   // lighter blob that rolls around inside
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
            goo.setAlpha(0.8 * fade * (left < 600 ? 1 : 0.9 + 0.1 * Math.sin(now / 120)));
            goo.setScale(grow * (1 + 0.04 * Math.sin(now / 150)), grow * (1 + 0.12 * Math.sin(now / 110 + 1)));
            roll.setPosition(x + Math.sin(now / 330) * W * 0.26, bottom - 8 + Math.sin(now / 210) * 1.5);
            roll.setScale(1 + 0.25 * Math.sin(now / 190), 1 - 0.3 * Math.sin(now / 190)); roll.setAlpha(0.55 * fade);
            if (now >= nextBubble && left > 700) {
                nextBubble = now + rand(90, 220);
                const r = rand(3, 7), bx = x + rand(-W * 0.4, W * 0.4);
                const o = scene.add.circle(bx, bottom - 9, r, 0xc8ffb0, 0.5).setStrokeStyle(1.5, 0x1f8f3a).setDepth(1.92);
                bubbles.push({ o: o, born: now, life: rand(450, 800), x0: bx, y0: bottom - 9, r: r, rise: rand(14, 30) });
            }
            for (let k = bubbles.length - 1; k >= 0; k--) {
                const b = bubbles[k], a = (now - b.born) / b.life;
                if (a >= 1) { b.o.destroy(); bubbles.splice(k, 1); continue; }
                b.o.setPosition(b.x0 + Math.sin(a * 6 + b.r) * 3, b.y0 - b.rise * a);
                b.o.setScale(a < 0.8 ? 1 + a * 0.5 : 1.5 + (a - 0.8) * 5);             // swells, then pops (grows + fades) at the end
                b.o.setAlpha(a < 0.8 ? 0.55 * fade : 0.55 * fade * (1 - (a - 0.8) / 0.2));
            }
            const pl = scene.player;
            if (pl && !pl.dead && Phaser.Geom.Intersects.RectangleToRectangle(goo.getBounds(), bodyRect(pl.sprite)) && now - lastHit >= 500) { lastHit = now; pl.takeDamage(dmg, goo.x); }
        };
        scene.events.on('update', upd);
    }

    die() {
        if (this.dead) return;
        this.dead = true;
        const s = this.sprite;
        const x = s.x, y = s.y;
        FX.killEnemy(this.scene, x, y);
        if (this.params.death_goo && !this.fell && s.body && this.scene.hasGroundAt(x) && !(this.scene._pitAt && this.scene._pitAt(x))) this.spawnGoo(x, s.body.bottom);
        if (this._telegraph) this._telegraph.destroy();
        this.scene.tweens.add({ targets: s, alpha: 0, scale: s.scale * 1.2, duration: 200, onComplete: function () { s.destroy(); } });
        this.scene.events.emit('enemy-dead', { x: x, y: y, ref: this });
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

function rand(a, b) { return a + Math.random() * (b - a); }

const ENEMY_SIZE_H = { small: 48, small_x15: 72, medium: 72, large: 120 };
