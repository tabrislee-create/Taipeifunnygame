// On-screen touch controls (hand-written). Shown on touch devices or when the URL has ?touch=1.
// TouchControls.create(scene) -> {left,right,up,attack,skill} booleans (true while the button is held); null when not a touch device.
var TouchControls = {
  // Geometry of the on-screen controls for a canvas GW px wide (height is always 540): the three round buttons at the bottom right (BX = GW - 90), the level-1 walk-pad hint at the bottom left.
  // The controls below are built from this and so is the how-to page (charpanel.js), so a spotlight can never drift away from the real button.  rect = bounding box with a small margin.
  layout(GW) {
    const BR = 56, BD = 2 * BR + 12, BX = GW - 90, BY = 440, JY = BY - BD * 0.866, M = 6;
    const hint = { cx: 150, cy: 410, w: 200, h: 100 };
    return {
      BR: BR, BD: BD, BX: BX, BY: BY,
      attack: { x: BX, y: BY, r: BR }, skill: { x: BX - BD, y: BY, r: BR }, jump: { x: BX - BD / 2, y: JY, r: BR },
      buttons: { x: BX - BD - BR - M, y: JY - BR - M, w: BD + 2 * BR + 2 * M, h: BY + BR + M - (JY - BR - M) },
      hint: hint, hintRect: { x: hint.cx - hint.w / 2 - M, y: hint.cy - hint.h / 2 - M, w: hint.w + 2 * M, h: hint.h + 2 * M }
    };
  },
  enabled() {
    return /[?&]touch=1/.test(location.search) || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  },
  create(scene) {
    if (!TouchControls.enabled()) return null;
    scene.input.addPointer(4);
    const st = { left: false, right: false, up: false, attack: false, skill: false };
    const objs = [];
    const ups = [];   // every button's release function, for st.reset()
    // Round button with a simple drawn icon (no text). draw(g, pass): pass 0 = dark outline, pass 1 = white fill; coordinates are relative to the button centre.
    const FILL_A = 0.18, STROKE_A = 0.45;
    const mk = (x, y, r, draw, onDown, hold, color) => {
      const c = scene.add.circle(x, y, r, color || 0x000000, FILL_A).setStrokeStyle(2, 0xffffff, STROKE_A)
        .setScrollFactor(0).setDepth(120).setInteractive();
      const ic = scene.add.graphics().setPosition(x, y).setScrollFactor(0).setDepth(121).setAlpha(0.85);
      draw(ic, 0); draw(ic, 1);
      const down = () => { if (hold) st[hold] = true; if (onDown) onDown(); c.setFillStyle(0xffffff, 0.3); };
      const up = () => { if (hold) st[hold] = false; c.setFillStyle(color || 0x000000, FILL_A); };
      ups.push(up);
      c.on('pointerdown', down); c.on('pointerup', up); c.on('pointerout', up); c.on('pointerupoutside', up);
      c.on('pointerover', (pointer) => { if (pointer && pointer.isDown) down(); });
      objs.push(c, ic);
      return [c, ic];
    };
    const ink = (g, pass, w) => g.lineStyle(pass === 0 ? w + 5 : w, pass === 0 ? 0x1a1a1a : 0xffffff, 1);
    const swordIcon = (g, pass) => {                         // attack: sword pointing up-right
      ink(g, pass, 7); g.lineBetween(-4, 4, 22, -22);        // blade
      ink(g, pass, 6); g.lineBetween(-17, -5, 5, 17);        // cross-guard
      ink(g, pass, 8); g.lineBetween(-8, 8, -19, 19);        // grip
    };
    const jumpIcon = (g, pass) => {                          // jump: double up chevron
      ink(g, pass, 8);
      g.strokePoints([{ x: -20, y: 2 }, { x: 0, y: -18 }, { x: 20, y: 2 }], false);
      g.strokePoints([{ x: -20, y: 22 }, { x: 0, y: 2 }, { x: 20, y: 22 }], false);
    };
    const starIcon = (g, pass) => {                          // skill: four-point sparkle
      const pts = [{ x: 0, y: -26 }, { x: 6, y: -6 }, { x: 26, y: 0 }, { x: 6, y: 6 }, { x: 0, y: 26 }, { x: -6, y: 6 }, { x: -26, y: 0 }, { x: -6, y: -6 }];
      if (pass === 0) { g.lineStyle(5, 0x1a1a1a, 1); g.strokePoints(pts, true); } else { g.fillStyle(0xffffff, 1); g.fillPoints(pts, true); }
    };
    const GW = (typeof GAME_W !== 'undefined' && GAME_W) ? GAME_W : 960;
    // Floating direction pad: a touch anywhere in the left half of the screen only shows a pill-shaped pad under the finger (no movement yet);
    // the character walks once the finger slides more than DEAD px (3: any small slide counts) to the left/right of the pad centre. The pad trails the finger by at most TRAIL px (14),
    // so reversing only takes a short slide, and coming back to the centre stops. Lifting the finger removes the pad and releases both directions.
    const L = TouchControls.layout(GW);
    const PAD_W = L.hint.w, PAD_H = L.hint.h, KNOB_R = 30, TRAIL = 14, DEAD = 3;   // the pad size comes from the layout, so the how-to page draws / spotlights exactly this
    const g = scene.add.graphics().setScrollFactor(0).setDepth(120).setVisible(false);
    let padPointerId = null, cx = 0, dir = 0, fingerX = 0, py = 0;
    const paintPad = (gr, x, y, kx, d) => {
      gr.clear();
      gr.fillStyle(0x000000, 0.28); gr.fillRoundedRect(x - PAD_W / 2, y - PAD_H / 2, PAD_W, PAD_H, PAD_H / 2);
      gr.lineStyle(2, 0xffffff, 0.45); gr.strokeRoundedRect(x - PAD_W / 2, y - PAD_H / 2, PAD_W, PAD_H, PAD_H / 2);
      for (const sgn of [-1, 1]) {
        const on = d === sgn, ax = x + sgn * (PAD_W / 2 - 30), h = 20;
        gr.fillStyle(0xffffff, on ? 0.95 : 0.35);
        gr.fillTriangle(ax + sgn * 14, y, ax - sgn * 10, y - h, ax - sgn * 10, y + h);
      }
      gr.fillStyle(0xffffff, 0.5); gr.fillCircle(kx, y, KNOB_R);
      gr.lineStyle(3, 0xffffff, 0.9); gr.strokeCircle(kx, y, KNOB_R);
    };
    const draw = () => {
      const x = Math.max(PAD_W / 2 + 8, Math.min(GW - PAD_W / 2 - 8, cx));
      const y = Math.max(PAD_H / 2 + 8, Math.min(540 - PAD_H / 2 - 8, py));
      const kx = Math.max(x - PAD_W / 2 + KNOB_R + 6, Math.min(x + PAD_W / 2 - KNOB_R - 6, x + (fingerX - cx)));
      paintPad(g, x, y, kx, dir);
    };
    // Level 1 only: a blinking copy of the pad sits at the bottom left as a "slide here to walk" hint. It hides while a finger is down on the real pad
    // and is removed for good the first time the character starts moving (levels 2+ get no hint).
    let hint = null;
    const stopHint = () => { if (hint) { scene.tweens.killTweensOf(hint); hint.destroy(); hint = null; } };
    if (typeof RUN !== 'undefined' && RUN.level === 1) {
      const hx = L.hint.cx, hy = L.hint.cy;   // just left of the player spawn (x=310, left edge ~291): pad right edge 250 leaves a ~40px gap; pad size is the real pad's, unchanged
      hint = scene.add.graphics().setScrollFactor(0).setDepth(119);
      paintPad(hint, hx, hy, hx, 0);
      scene.tweens.add({ targets: hint, alpha: { from: 1, to: 0.2 }, duration: 450, yoyo: true, repeat: -1 });
    }
    const apply = () => { st.left = dir < 0; st.right = dir > 0; if (hint) { if (dir !== 0) stopHint(); else hint.setVisible(padPointerId === null); } };
    const onDown = (pointer) => {
      if (padPointerId !== null || pointer.x >= GW / 2) return;
      if (scene.hud && scene.hud.avatarHit && scene.hud.avatarHit(pointer)) return;   // tap on the HUD avatar button: no walk pad
      padPointerId = pointer.id; cx = fingerX = pointer.x; py = pointer.y;
      dir = 0; // visual only until the finger slides
      apply(); g.setVisible(true); draw();
    };
    const onMove = (pointer) => {
      if (pointer.id !== padPointerId || !pointer.isDown) return;
      fingerX = pointer.x;
      if (fingerX - cx > TRAIL) cx = fingerX - TRAIL; else if (cx - fingerX > TRAIL) cx = fingerX + TRAIL;
      const dx = fingerX - cx;
      dir = dx > DEAD ? 1 : (dx < -DEAD ? -1 : 0);
      apply(); draw();
    };
    const release = (pointer) => {
      if (padPointerId !== null && pointer.id === padPointerId) {
        padPointerId = null; dir = 0; apply(); g.setVisible(false);
      }
    };
    scene.input.on('pointerdown', onDown);
    scene.input.on('pointermove', onMove);
    scene.input.on('pointerup', release);
    scene.input.on('pointerupoutside', release);
    objs.push(g);
    // Three equal buttons in an equilateral triangle at the bottom right: jump on top, skill bottom-left, attack bottom-right (nearest the thumb).
    const BR = L.BR, BD = L.BD, BX = L.BX, BY = L.BY;
    const [atC, atI] = mk(BX, BY, BR, swordIcon, null, 'attack', 0xcc3333);
    // SIM reward (player.js _simAttack): while it has uses left, the attack button shows "SIM" and the number of uses remaining (user 2026-10-12).
    const atT = scene.add.text(BX, BY, '', { fontFamily: 'Microsoft JhengHei, PingFang TC, sans-serif', fontSize: '30px', fontStyle: 'bold', color: '#7fdcff', stroke: '#003a5c', strokeThickness: 5, align: 'center' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(122).setVisible(false);
    objs.push(atT);
    const atTick = () => {
      const n = (typeof RUN !== 'undefined' && RUN.simUses) | 0;
      if (n > 0) { atT.setText('SIM\n' + n).setVisible(true); atI.setAlpha(0.3); }
      else if (atT.visible) { atT.setVisible(false); atI.setAlpha(0.85); }
    };
    scene.events.on('update', atTick);
    const [skC, skI] = mk(BX - BD, BY, BR, starIcon, null, 'skill', 0x8844cc);
    // Skill cooldown: the button greys out, ignores presses and shows the seconds left.
    const skT = scene.add.text(BX - BD, BY, '', { fontFamily: 'Microsoft JhengHei, PingFang TC, sans-serif', fontSize: '40px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 6 })
      .setOrigin(0.5).setScrollFactor(0).setDepth(122).setVisible(false);
    objs.push(skT);
    let skCooling = false;
    const skTick = () => {
      const p = scene.player;
      const left = p && p.skillReadyAt ? p.skillReadyAt - scene.time.now : 0;
      if (left > 0) {
        st.skill = false;
        skC.setFillStyle(0x666666, 0.65); skI.setAlpha(0.25);
        skT.setText(String(Math.ceil(left / 1000))).setVisible(true);
        skCooling = true;
      } else if (skCooling) {
        skCooling = false;
        skC.setFillStyle(0x8844cc, FILL_A); skI.setAlpha(0.85); skT.setVisible(false);
      }
    };
    scene.events.on('update', skTick);
    const [jpC] = mk(BX - BD / 2, BY - BD * 0.866, BR, jumpIcon, null, 'up', 0x3377cc);
    st.parts = { attack: atC, skill: skC, jump: jpC, hint: () => hint };   // the real objects (for the layout test, tests/howto_layout_check.py)
    // Drop every held state (character panel opened / closed: the level scene does not see the finger lift while it is paused).
    st.reset = () => {
      padPointerId = null; dir = 0; apply(); g.setVisible(false);
      ups.forEach((u) => u());
      st.left = st.right = st.up = st.attack = st.skill = false;
    };
    st.destroy = () => {
      scene.events.off('update', skTick);
      scene.events.off('update', atTick);
      scene.input.off('pointerdown', onDown); scene.input.off('pointermove', onMove);
      scene.input.off('pointerup', release); scene.input.off('pointerupoutside', release);
      stopHint();
      objs.forEach((o) => o.destroy());
    };
    return st;
  }
};
