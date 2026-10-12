var FX = (function () {
  var FONT = 'Microsoft JhengHei, PingFang TC, sans-serif';
  var DEPTH = 50;

  function alive(s) { return s && s.active !== false; }
  function baseX(s) { return s.baseScaleX != null ? s.baseScaleX : (s.scaleX || 1); }
  function baseY(s) { return s.baseScaleY != null ? s.baseScaleY : (s.scaleY || 1); }
  function destroyOn(t) { t.onComplete = function () { if (t.targets) { for (var i = 0; i < t.targets.length; i++) { var o = t.targets[i]; if (o && o.destroy) o.destroy(); } } }; return t; }
  function kill(o) { if (o && o.destroy) o.destroy(); }
  function fullFlash(scene, color, from, to, ms, depth) {
    var r = scene.add.rectangle(0, 0, scene.scale.width, scene.scale.height, color, from).setOrigin(0, 0).setScrollFactor(0).setDepth(depth == null ? 90 : depth);
    scene.tweens.add({ targets: r, alpha: to, duration: ms, onComplete: function () { kill(r); } });
  }
  function radial(scene, x, y, color, speed, life, size) {
    var a = Math.random() * Math.PI * 2;
    var c = scene.add.circle(x, y, size || 3, color, 1).setDepth(DEPTH);
    scene.tweens.add({ targets: c, x: x + Math.cos(a) * speed * (life / 1000), y: y + Math.sin(a) * speed * (life / 1000), alpha: 0, duration: life, onComplete: function () { kill(c); } });
  }
  function radialBurst(scene, x, y, color, count, speed, life, size) {
    for (var i = 0; i < count; i++) {
      var a = (i / count) * Math.PI * 2;
      var c = scene.add.circle(x, y, size || 3, color, 1).setDepth(DEPTH);
      scene.tweens.add({ targets: c, x: x + Math.cos(a) * speed * (life / 1000), y: y + Math.sin(a) * speed * (life / 1000), alpha: 0, duration: life, onComplete: function () { kill(c); } });
    }
  }
  function sparks(scene, x, y, color, count, speed, life) {
    for (var i = 0; i < count; i++) radial(scene, x, y, color, speed, life, 2 + Math.random() * 2);
  }

  function hitSpark(scene, x, y) {
    var g = scene.add.graphics().setDepth(DEPTH);
    g.fillStyle(0xffffff, 1); g.fillCircle(x, y, 6);
    scene.tweens.add({ targets: g, alpha: 0, duration: 150, onComplete: function () { kill(g); } });
    sparks(scene, x, y, 0xffff00, 4, 120, 200);
  }

  // Geek's basic attack (user 2026-10-10): three code streams in a fan, fired one after another: top, then middle, then bottom.  The fan's centre is
  // pulled BACK behind the character (not at the laptop) so the streams spread wider.  A stream stays on screen after it is fired: the top one fades out
  // when the bottom one starts, the middle one when the bottom one is fully fired, the bottom one a moment later (attacks every ~0.35 s, so they overlap).
  // The bottom stream is aimed at a small enemy standing on the ground (groundY).  Glyphs are blue and turn red on streams that pass through a hit enemy.
  // Same hit rectangle as before: x = its inner edge, y = player centre, range = its width, groundY = body bottom.
  // Returns { markHit(rect) } for player.js, which calls it for every enemy hit (glyphs read the flag when they spawn, one frame later).
  function codeSlash(scene, x, y, facing, range, groundY) {
    var f = facing >= 0 ? 1 : -1;
    var BACK = 32;                                                      // fan centre this far behind the inner edge of the hit rectangle (about at the character's back)
    var ox = x - f * BACK, oy = y - 8;
    var xe = x + f * (range - 4);                                       // far end of every stream (same x), so the reach equals the hit rectangle
    var N = 6, GLYPH_GAP = 18, RAY_DUR = N * GLYPH_GAP, FADE = 180, LINGER = 110;
    var ge = (typeof groundY === 'number' ? groundY : y + 62) - 16;     // far-end height of the bottom stream: about the centre of a small slime on the ground
    var te = y - 40;                                                    // far-end height of the top stream (inside the 84 px tall hit rectangle)
    var ends = [te, (te + ge) / 2, ge];
    var starts = [0, RAY_DUR, 2 * RAY_DUR];
    var fades = [starts[2], starts[2] + RAY_DUR, starts[2] + RAY_DUR + LINGER];   // when each stream starts to fade out
    var GLYPHS = ['{', '0', ';', '1', '/', '}', '<', '1', '>', '=', '0', '('];
    var BLUE = ['#7dffd8', '#58b4ff', '#9fe8ff', '#58b4ff'], RED = ['#ff8a8a', '#ff4d4d', '#ffb3b3', '#ff4d4d'];
    var rays = ends.map(function (ye, i) { return { ye: ye, start: starts[i], fade: fades[i], next: 0, hit: false }; });
    function pt(r, t) {                                                 // t 0..1: from just in front of the character out to the far end
      var gx = x + f * (6 + (range - 10) * t);
      return { x: gx, y: oy + (r.ye - oy) * (f * (gx - ox)) / (f * (xe - ox)) };
    }
    var total = fades[2] + FADE;
    function glyph(r, k, ri, now) {
      var q = pt(r, (k + 1) / N), cols = r.hit ? RED : BLUE;
      var t = scene.add.text(q.x, q.y, GLYPHS[(ri * N + k) % GLYPHS.length], { fontFamily: 'Consolas, "Courier New", monospace', fontSize: Math.round(1.2 * (15 + (k % 3) * 2)) + 'px', fontStyle: 'bold',
        color: cols[k % cols.length], stroke: r.hit ? '#5c0b0b' : '#0b2a5c', strokeThickness: 3 }).setOrigin(0.5).setDepth(DEPTH + 1);
      scene.tweens.add({ targets: t, alpha: 0, delay: Math.max(0, r.fade - now), duration: FADE, onComplete: function () { kill(t); } });
    }
    function update(ms) {
      rays.forEach(function (r, ri) {
        while (r.next < N && ms >= r.start + r.next * GLYPH_GAP) { glyph(r, r.next, ri, r.start + r.next * GLYPH_GAP); r.next++; }
      });
    }
    scene.tweens.addCounter({ from: 0, to: RAY_DUR * 3, duration: RAY_DUR * 3, onUpdate: function (tw) { update(tw.getValue()); }, onComplete: function () { update(RAY_DUR * 3 + 1); } });
    return {
      // rect = the hit enemy's body rectangle.  Every stream that passes through it turns red; if none does, the one nearest to its centre does.
      markHit: function (rect) {
        var any = false, cy = rect.y + rect.height / 2;
        rays.forEach(function (r) {
          for (var i = 0; i <= 24; i++) {
            var q = pt(r, i / 24);
            if (q.x >= rect.x && q.x <= rect.x + rect.width && q.y >= rect.y && q.y <= rect.y + rect.height) { r.hit = true; any = true; break; }
          }
        });
        if (!any) {
          var best = rays[0], bd = 1e9;
          rays.forEach(function (r) { var d = Math.abs(pt(r, 0.7).y - cy); if (d < bd) { bd = d; best = r; } });
          best.hit = true;
        }
      }
    };
  }

  // Vendor Attack Constants (Single Source of Truth)
  // Used by both effects.js (visuals) and player.js (hitbox)
  var VENDOR_ATK = {
    wokW: 48,        // Wok body width (px)
    wokH: 24,        // Wok body height/depth (px) - deepened for round bottom
    handleLen: 20,   // Handle length (px)
    swingDeg: 20,    // Swing amplitude in degrees (up/down from horizontal)
    swingMs: 333,    // Swing duration in ms (250 / 0.75)
    reachTop: 150,   // Max height from ground for ingredients and hitbox top (px)
    belowFeet: 4,    // Hitbox bottom extends this many px below feet (px)
    reachMax: 60,    // Max forward reach of the wok swing (px)
    flameFront: 16,  // Flame extends this many px beyond the wok's front edge (px)
    flameTongues: 6, // Number of flame tongues
    flameFlickerMs: 100, // Base flicker speed (ms)
    flameCols: [0xff4500, 0xff8c00, 0xffd700], // Outer, Middle, Inner colors
    flameAlphas: [0.4, 0.6, 0.8],              // Outer, Middle, Inner alphas
    // New constants for wok-rim upward flames
    flameUpTongues: 6,
    flameUpRise: 60,
    flameUpParams: [
      { w: 1.4, h: 1.0, ph: 0.0, dx: -9 },
      { w: 1.6, h: 0.6, ph: 1.3, dx: -3 },
      { w: 1.2, h: 1.3, ph: 2.7, dx: 2 },
      { w: 1.5, h: 0.9, ph: 4.1, dx: 7 },
      { w: 1.1, h: 1.1, ph: 5.5, dx: 12 },
      { w: 1.3, h: 0.5, ph: 0.8, dx: 15 }
    ],
    // Ground flame parameters: dx (offset from wok center), w (width scale), h (height scale relative to ground-to-rim), ph (phase), sway (sway amount), minH (optional: min height factor for front flames)
    flameGroundParams: [
      { dx: -28, w: 1.2, h: 0.35, ph: 0.0, sway: 3 },
      { dx: -22, w: 1.1, h: 0.4,  ph: 1.5, sway: 2 },
      { dx: -14, w: 1.5, h: 0.75, ph: 1.2, sway: 4 },
      { dx: -6,  w: 1.3, h: 0.9,  ph: 2.5, sway: 5 },
      { dx: 2,   w: 1.6, h: 1.1,  ph: 3.8, sway: 6 },
      { dx: 10,  w: 1.4, h: 1.2,  ph: 5.1, sway: 7 },
      { dx: 18,  w: 1.7, h: 1.15, ph: 0.7, sway: 6, minH: 0.75 },
      { dx: 26,  w: 1.5, h: 1.05, ph: 2.1, sway: 5, minH: 0.75 },
      { dx: 30,  w: 1.4, h: 1.1,  ph: 1.1, sway: 5, minH: 0.75 },
      { dx: 34,  w: 1.5, h: 1.0,  ph: 3.5, sway: 4, minH: 0.75 },
      { dx: 37,  w: 1.3, h: 1.2,  ph: 4.2, sway: 4, minH: 0.75 },
      { dx: 40,  w: 1.5, h: 1.15, ph: 4.9, sway: 3, minH: 0.75 },
      { dx: 43,  w: 1.4, h: 0.9,  ph: 2.8, sway: 3, minH: 0.75 }
    ],
    // Colors for the burning wok
    colWok: 0xff4500,    // Wok body (OrangeRed)
    colWokA: 0.7,        // Wok body alpha
    colHandle: 0x8b0000, // Handle (DarkRed)
    colHandleA: 0.8,     // Handle alpha
    glowCol: 0xff4500,
    glowLayers: [{ scale: 1.35, alpha: 0.08 }, { scale: 1.20, alpha: 0.15 }, { scale: 1.10, alpha: 0.25 }],
    ingSizeMin: 9,
    ingSizeMax: 14,
    ingCount: 10,
    ingVanishEarly: 2,
    ingFeather: [{ scale: 1.25, alpha: 0.25 }, { scale: 1.5, alpha: 0.12 }],
    // Ingredient colors (Dark Green, Brick Red, Yellow, Dark Brown)
    ingColors: [0x1f6b3a, 0xb5472f, 0xffd700, 0x4a2c17],
    // Steam parameters: dx (horizontal offset from wok center), ph (phase), period (ms), scale (size multiplier), rise (max rise height px)
    steamLingerMs: 900,
    steamParams: [
      { dx: -26, ph: 0.0, period: 500, scale: 0.6, rise: 55 },
      { dx: -22, ph: 0.1, period: 550, scale: 0.7, rise: 65 },
      { dx: -18, ph: 0.2, period: 600, scale: 0.8, rise: 75 },
      { dx: -14, ph: 0.3, period: 650, scale: 0.9, rise: 85 },
      { dx: -10, ph: 0.4, period: 700, scale: 1.0, rise: 95 },
      { dx: -6,  ph: 0.5, period: 750, scale: 1.1, rise: 105 },
      { dx: -2,  ph: 0.6, period: 800, scale: 1.2, rise: 110 },
      { dx: 2,   ph: 0.7, period: 850, scale: 1.1, rise: 100 },
      { dx: 6,   ph: 0.8, period: 900, scale: 1.0, rise: 90 },
      { dx: 10,  ph: 0.9, period: 880, scale: 0.9, rise: 80 },
      { dx: 14,  ph: 0.15, period: 820, scale: 0.8, rise: 70 },
      { dx: 18,  ph: 0.25, period: 780, scale: 0.7, rise: 60 },
      { dx: 22,  ph: 0.35, period: 720, scale: 0.6, rise: 55 },
      { dx: 26,  ph: 0.45, period: 680, scale: 0.65, rise: 58 }
    ]
  };

  // "Stir fry" skill fire around the feet (FX.stirFry).  back = tall row behind the character, front = shorter row in front of the legs.
  // half = half-width of a row (px), hMin/hMax = tongue height at the row edge / centre, layers = outer..core (w, h relative to the tongue).
  var STIR_FIRE = {
    back: { n: 21, half: 116, hMin: 68, hMax: 130, wMin: 20, wMax: 28 },
    front: { n: 15, half: 100, hMin: 35, hMax: 62, wMin: 16, wMax: 22, alpha: 0.85 },
    layers: [
      { w: 1.35, h: 1.12, col: 0xff2a00, a: 0.22 },
      { w: 1.0, h: 1.0, col: 0xff5a00, a: 0.78 },
      { w: 0.72, h: 0.8, col: 0xff9500, a: 0.8 },
      { w: 0.45, h: 0.55, col: 0xffd23a, a: 0.85 },
      { w: 0.22, h: 0.28, col: 0xfff4c0, a: 0.9 }
    ],
    sway: 8, lean: 7,
    sparkCount: 28, sparkRise: 160,
    smokeEveryMs: 60, smokeLife: [1300, 1800], smokeRise: 145, smokeGrow: 24, smokeAlpha: 0.38
  };

  function wokSlash(scene, x, y, facing, range, groundY) {
    var f = facing >= 0 ? 1 : -1;
    var W = VENDOR_ATK.wokW, H = VENDOR_ATK.wokH, HL = VENDOR_ATK.handleLen;
    var ampRad = VENDOR_ATK.swingDeg * Math.PI / 180;
    var reach = Math.min(range * 0.8, VENDOR_ATK.reachMax); // How far the wok swings forward
    var yBase = y + 5; // Wok held slightly below player center

    function drawWok(g, alpha) {
      g.clear();
      
      // Wok Body: Round bottom (semi-ellipse), open top
      // Points for the bowl shape: Continuous arc from left rim to right rim
      var points = [];
      var steps = 20;
      for (var i = 0; i <= steps; i++) {
        var a = Math.PI - (i / steps) * Math.PI; // PI to 0
        points.push({ x: (W/2) * Math.cos(a), y: -H/2 + H * Math.sin(a) });
      }
      

      
      // Draw Glow Layers (Outer to Inner)
      var glowPts = points;
      for (var k = 0; k < VENDOR_ATK.glowLayers.length; k++) {
        var layer = VENDOR_ATK.glowLayers[k];
        var pts = [];
        var w = W * layer.scale;
        var h = H * layer.scale;
        for (var j = 0; j <= steps; j++) {
          var ag = Math.PI - (j / steps) * Math.PI;
          pts.push({ x: (w/2) * Math.cos(ag), y: -h/2 + h * Math.sin(ag) });
        }
        g.fillStyle(VENDOR_ATK.glowCol, layer.alpha * alpha);
        g.fillPoints(pts, true);
      }

      // Draw Wok Body (Burning Red/Orange, Semi-transparent)
      g.fillStyle(VENDOR_ATK.colWok, VENDOR_ATK.colWokA * alpha);
      g.fillPoints(points, true);
      
      // Draw Handle (Burning Dark Red, connected to wok body)
      // Handle extends from outside left (-W/2 - HL) to inside left (-W/2 + 3)
      // Y is near the rim (-H/2), slightly angled up at the outer end
      var hxStart = -W/2 - HL;
      var hxEnd = -W/2 + 3;
      var hyRim = -H/2;
      var hyOuter = hyRim - 4; // Slightly higher at the outer end
      
      // Handle Glow (soft edge)
      g.fillStyle(VENDOR_ATK.colHandle, VENDOR_ATK.colHandleA * 0.5 * alpha);
      g.fillPoints([
        { x: hxStart - 2, y: hyOuter - 2 },
        { x: hxEnd + 2, y: hyRim - 2 },
        { x: hxEnd + 2, y: hyRim + 4 },
        { x: hxStart - 2, y: hyOuter + 4 }
      ], true);
      
      // Handle Main
      g.fillStyle(VENDOR_ATK.colHandle, VENDOR_ATK.colHandleA * alpha);
      g.fillPoints([
        { x: hxStart, y: hyOuter },
        { x: hxEnd, y: hyRim },
        { x: hxEnd, y: hyRim + 2 },
        { x: hxStart, y: hyOuter + 2 }
      ], true);
    }

    var g = scene.add.graphics().setDepth(DEPTH + 1);
    drawWok(g, 1);
    
    // Flame Graphics (behind the wok)
    var flameG = scene.add.graphics().setDepth(DEPTH);
    // Steam Graphics (on top of flames)
    var steamG = scene.add.graphics().setDepth(DEPTH + 1);
    
    // Variable to track current wok position for ingredient collision
    var currentWokPos = { x: x, y: yBase };
    // Variables to track last wok position for steam linger
    var stLastX = x;
    var stLastY = yBase - VENDOR_ATK.wokH / 2;

    // Ingredient Particles
    var ingredients = [];
    var ING_COUNT = VENDOR_ATK.ingCount;
    for (var i = 0; i < ING_COUNT; i++) {
      var shapeType = i % 4;
      var color = VENDOR_ATK.ingColors[shapeType];
      var size = VENDOR_ATK.ingSizeMin + Math.random() * (VENDOR_ATK.ingSizeMax - VENDOR_ATK.ingSizeMin);
      var ing = scene.add.graphics().setDepth(DEPTH + 2);
      
      // Helper to draw shape geometry only (no fillStyle)
      function drawShape(g, type, s, col) {
        if (type === 0) { // Green Long Rect (5:1)
          var w = s, h = s / 5;
          g.fillRoundedRect(-w/2, -h/2, w, h, 1);
        } else if (type === 1) { // Red Square
          g.fillRoundedRect(-s/2, -s/2, s, s, 2);
        } else if (type === 2) { // Yellow Fan (60 deg, radius = s)
          var pts = [{x:0, y:0}];
          var r = s;
          var startA = -Math.PI / 6; // -30 deg
          var endA = Math.PI / 6;    // +30 deg
          var steps = 10;
          for (var j = 0; j <= steps; j++) {
            var a = startA + (endA - startA) * (j / steps);
            pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
          }
          g.fillPoints(pts, true);
        } else if (type === 3) { // Brown Circle (diameter = s)
          g.fillCircle(0, 0, s / 2);
        }
      }

      // Draw Feather Layers (Outer to Inner)
      for (var k = 0; k < VENDOR_ATK.ingFeather.length; k++) {
        var layer = VENDOR_ATK.ingFeather[k];
        ing.fillStyle(color, layer.alpha);
        drawShape(ing, shapeType, size * layer.scale, color);
      }
      // Draw Main Body
      ing.fillStyle(color, 1);
      drawShape(ing, shapeType, size, color);
      
      // Physics for parabolic motion
      // Start position: near the wok center
      var startX = x + f * (10 + reach * 0.5);
      var startY = yBase;
      ing.setPosition(startX, startY);
      
      // Calculate velocity to reach reachTop (150px above groundY)
      var targetY = groundY - VENDOR_ATK.reachTop;
      var driftX = (Math.random() - 0.5) * 40; // Horizontal spread
      
      ingredients.push({
        obj: ing,
        startX: startX,
        startY: startY,
        targetY: targetY,
        driftX: driftX,
        delay: Math.random() * 60, // Stagger start
        falling: false
      });
    }

    function pose(o, p) {
      // p: 0 -> 1
      // Motion: Swing forward and back, oscillating angle +/- swingDeg
      var progress = Math.sin(p * Math.PI); // 0 -> 1 -> 0
      var dist = reach * progress;
      
      // Angle oscillation: sin(p * PI * 2) * amp
      var angle = Math.sin(p * Math.PI * 2) * ampRad;
      
      o.x = x + f * (10 + dist);
      o.y = yBase;
      o.scaleX = f; // Mirror the wok so handle is always towards body
      o.rotation = angle;
      
      // Update global wok position for collision detection
      currentWokPos.x = o.x;
      currentWokPos.y = o.y;
    }
    
    var nextGhost = 0.15;
    function ghost(p) {
      var o = scene.add.graphics().setDepth(DEPTH);
      drawWok(o, 0.4);
      pose(o, p);
      scene.tweens.add({ targets: o, alpha: 0, duration: 150, onComplete: function () { kill(o); } });
    }
    
    function drawSteam(cx, rimY, fade) {
      if (!steamG || !steamG.active) return;
      steamG.clear();
      var steamTime = scene.time.now;
      var steamParams = VENDOR_ATK.steamParams;

      for (var si = 0; si < steamParams.length; si++) {
        var sp = steamParams[si];
        // Life cycle: 0..1
        var stLife = (steamTime / sp.period + sp.ph) % 1;
        
        // Alpha: fade in/out, peak around 0.3, plus fade out as it rises
        var stAlphaCurve = Math.sin(stLife * Math.PI);
        var stFadeOut = 1 - 0.5 * stLife;
        var stAlpha = fade * stAlphaCurve * stFadeOut * 0.42; // Max alpha ~0.42
        
        if (stAlpha > 0.01) {
          // Position: rise up, sway sideways
          var stRise = sp.rise * stLife; // Rise up to sp.rise px
          var stSway = Math.sin(steamTime / 200 + sp.ph * 10) * 5 * f + Math.sin(steamTime / 130 + sp.ph * 5) * 3 * f;
          
          var stX = cx + f * sp.dx + stSway;
          var stY = rimY - stRise;
          
          // Size: grow as it rises
          var stR = (7 + 16 * stLife) * sp.scale;
          
          // Draw soft cloud: 3 layers of circles
          // Outer layer (largest, lowest alpha)
          steamG.fillStyle(0xffffff, stAlpha * 0.5);
          steamG.fillCircle(stX, stY, stR * 1.2);
          
          // Middle layer
          steamG.fillStyle(0xffffff, stAlpha * 0.6);
          steamG.fillCircle(stX, stY, stR * 0.8);
          
          // Inner layer (smallest, highest alpha)
          steamG.fillStyle(0xffffff, stAlpha * 0.7);
          steamG.fillCircle(stX, stY, stR * 0.5);
        }
      }
    }

    function place(p) {
      pose(g, p);
      g.alpha = p < 0.1 ? p / 0.1 : (p > 0.9 ? (1 - p) / 0.1 : 1);
      
      // Draw Flame
      flameG.clear();
      var wokX = g.x;
      var wokBottomY = g.y + VENDOR_ATK.wokH / 2;
      var rimY = g.y - VENDOR_ATK.wokH / 2;
      var reachH = groundY - rimY;
      var time = scene.time.now;
      var alphaFade = p < 0.1 ? p / 0.1 : (p > 0.9 ? (1 - p) / 0.1 : 1);

      if (reachH > 0) {
        var gParams = VENDOR_ATK.flameGroundParams;
        for (var gi = 0; gi < gParams.length; gi++) {
          var gp = gParams[gi];
          // Life cycle: 0..1
          var gLife = (time / 150 + gp.ph) % 1;
          // Height modulation: sin(life * PI) gives 0->1->0.
          // If minH is present (front flames), use a higher base to prevent gaps.
          var lifeH;
          if (gp.minH != null) {
            lifeH = gp.minH + (1.2 - gp.minH) * Math.sin(gLife * Math.PI);
          } else {
            lifeH = 0.4 + 0.8 * Math.sin(gLife * Math.PI);
          }
          var gH = reachH * gp.h * lifeH;
          
          // Alpha modulation
          var lifeA = Math.sin(gLife * Math.PI);
          var gAlpha;
          if (gp.minH != null) {
            gAlpha = alphaFade * (0.65 + 0.35 * lifeA);
          } else {
            gAlpha = alphaFade * (0.4 + 0.6 * lifeA);
          }

          // Base position
          var gCx = wokX + f * gp.dx;
          var gBaseY = groundY;
          var gTopY = gBaseY - gH;
          
          // Sway: asymmetric, bends towards facing direction
          var gSway = gp.sway * Math.sin(time / 100 + gp.ph) * f;
          var gSwayMid = gp.sway * 0.5 * Math.sin(time / 70 + gp.ph + 1.0) * f;

          // Helper to generate curved flame points
          // side: 1 for right, -1 for left
          // wScale: width scale, hScale: height scale
          function makeGroundFlamePts(side, wScale, hScale) {
            var pts = [];
            var w = 14 * gp.w * wScale;
            var h = gH * hScale;
            
            // Root
            pts.push({ x: gCx + side * w * 0.5, y: gBaseY });
            // Lower mid
            pts.push({ x: gCx + side * w * 0.45 + gSwayMid * 0.2, y: gBaseY - h * 0.25 });
            // Mid
            pts.push({ x: gCx + side * w * 0.3 + gSwayMid * 0.5, y: gBaseY - h * 0.5 });
            // Upper mid
            pts.push({ x: gCx + side * w * 0.15 + gSway * 0.3, y: gBaseY - h * 0.75 });
            // Top tip
            pts.push({ x: gCx + gSway, y: gBaseY - h });
            
            return pts;
          }

          // Generate full contour
          var gPtsR = makeGroundFlamePts(1, 1, 1);
          var gPtsL = makeGroundFlamePts(-1, 1, 1).reverse();
          var gFullPts = gPtsR.concat(gPtsL.slice(1));

          // Feather Layer (Outer)
          var gFeatherR = makeGroundFlamePts(1, 1.4, 1.1);
          var gFeatherL = makeGroundFlamePts(-1, 1.4, 1.1).reverse();
          var gFeatherPts = gFeatherR.concat(gFeatherL.slice(1));
          
          flameG.fillStyle(VENDOR_ATK.flameCols[0], 0.15 * gAlpha);
          flameG.fillPoints(gFeatherPts, true);

          // Main Layer
          flameG.fillStyle(VENDOR_ATK.flameCols[1], 0.5 * gAlpha);
          flameG.fillPoints(gFullPts, true);

          // Inner Layer (Shorter, narrower)
          var gInnerR = makeGroundFlamePts(1, 0.5, 0.6);
          var gInnerL = makeGroundFlamePts(-1, 0.5, 0.6).reverse();
          var gInnerPts = gInnerR.concat(gInnerL.slice(1));
          
          flameG.fillStyle(VENDOR_ATK.flameCols[2], 0.7 * gAlpha);
          flameG.fillPoints(gInnerPts, true);
        }
      }

      // Draw Rim Flames (upward from wok front edge, overlaid on top of ground flames)
      var rimX = wokX + f * (VENDOR_ATK.wokW / 2);
      var rimY = g.y - VENDOR_ATK.wokH / 2;
      var rimTime = scene.time.now;
      
      for (var ri = 0; ri < VENDOR_ATK.flameUpTongues; ri++) {
        var rp = VENDOR_ATK.flameUpParams[ri % VENDOR_ATK.flameUpParams.length];
        
        // Life cycle: 0..1, controls height and alpha for "rising" effect
        var life = (rimTime / 180 + rp.ph) % 1;
        
        // Height modulation: base height * life curve (0.55 low, 1.3 high)
        // Life curve: sin(life * PI) gives 0->1->0. We map it to 0.55..1.3
        var lifeH = 0.55 + 0.75 * Math.sin(life * Math.PI);
        var rh = VENDOR_ATK.flameUpRise * rp.h * lifeH;
        
        // Alpha modulation: fade in/out with life
        var lifeA = Math.sin(life * Math.PI);
        var rAlpha = alphaFade * (0.3 + 0.7 * lifeA);
        
        // Base position with dx offset
        var rx = rimX + rp.dx;
        
        // Width: root is wide (12-22px range approx), tapers up
        var rw = 12 * rp.w; 
        
        // Sway: asymmetric, bends towards facing direction
        // Two frequencies for organic movement
        var swayTop = (4 * Math.sin(rimTime / 110 + rp.ph) + 4 * Math.sin(rimTime / 70 + rp.ph * 1.7)) * f;
        var swayMid = 2 * Math.sin(rimTime / 90 + rp.ph + 1.0) * f;
        
        // Helper to generate flame points
        // side: 1 for right side, -1 for left side
        // widthScale: 1.0 for main, >1 for feather, <1 for inner
        // heightScale: 1.0 for main, <1 for inner
        function makeFlamePts(side, widthScale, heightScale) {
          var pts = [];
          var h = rh * heightScale;
          var w = rw * widthScale;
          
          // Root (bottom)
          pts.push({ x: rx + side * w * 0.5, y: rimY });
          
          // Lower mid (wide)
          pts.push({ x: rx + side * w * 0.45 + swayMid * 0.2, y: rimY - h * 0.25 });
          
          // Mid (tapering)
          pts.push({ x: rx + side * w * 0.3 + swayMid * 0.5, y: rimY - h * 0.5 });
          
          // Upper mid (curving)
          pts.push({ x: rx + side * w * 0.15 + swayTop * 0.3, y: rimY - h * 0.75 });
          
          // Top (tip)
          pts.push({ x: rx + swayTop, y: rimY - h });
          
          // Mirror back down (left side if side was right, etc)
          // We generate a closed loop. 
          // If side is 1 (right), we go up right side, then down left side.
          // If side is -1 (left), we go up left side, then down right side.
          // Actually, simpler: generate right side points, then reverse left side points.
          return pts;
        }

        // Generate full contour points
        // Right side up
        var ptsRight = makeFlamePts(1, 1, 1);
        // Left side down (mirror x relative to rx, but sway applies to both)
        var ptsLeft = makeFlamePts(-1, 1, 1).reverse();
        
        // Combine: Right side (excluding top tip duplicate if any, but our function includes tip)
        // ptsRight ends at tip. ptsLeft starts at tip (reversed).
        // So we take ptsRight, then ptsLeft.slice(1) to avoid duplicate tip.
        var fullPts = ptsRight.concat(ptsLeft.slice(1));
        
        // Feather Layer (Outer)
        var featherScaleW = 1.4;
        var featherScaleH = 1.1;
        var ptsFeather = [];
        // Re-generate for feather
        var fPtsR = makeFlamePts(1, featherScaleW, featherScaleH);
        var fPtsL = makeFlamePts(-1, featherScaleW, featherScaleH).reverse();
        ptsFeather = fPtsR.concat(fPtsL.slice(1));
        
        flameG.fillStyle(VENDOR_ATK.flameCols[0], 0.15 * rAlpha);
        flameG.fillPoints(ptsFeather, true);

        // Main Layer
        flameG.fillStyle(VENDOR_ATK.flameCols[1], 0.5 * rAlpha);
        flameG.fillPoints(fullPts, true);

        // Inner Layer (Shorter, narrower)
        var innerScaleW = 0.5;
        var innerScaleH = 0.6;
        var ptsInner = [];
        var iPtsR = makeFlamePts(1, innerScaleW, innerScaleH);
        var iPtsL = makeFlamePts(-1, innerScaleW, innerScaleH).reverse();
        ptsInner = iPtsR.concat(iPtsL.slice(1));
        
        flameG.fillStyle(VENDOR_ATK.flameCols[2], 0.7 * rAlpha);
        flameG.fillPoints(ptsInner, true);
      }

      // Draw Steam (rising from wok mouth, on top of flames)
      // Steam fade logic: fade in at start, stay 1 during swing, let linger handle fade out
      var stFade = p < 0.1 ? p / 0.1 : 1;
      drawSteam(g.x, g.y - VENDOR_ATK.wokH / 2, stFade);
      stLastX = g.x;
      stLastY = g.y - VENDOR_ATK.wokH / 2;
      
      while (p >= nextGhost && nextGhost < 0.9) { ghost(nextGhost); nextGhost += 0.15; }
    }
    
    place(0);
    
    // Launch ingredients
    ingredients.forEach(function(ing) {
      scene.tweens.add({
        targets: ing.obj,
        y: ing.targetY,
        x: ing.startX + ing.driftX,
        duration: VENDOR_ATK.swingMs * 0.4,
        ease: 'Quad.easeOut',
        delay: ing.delay,
        onComplete: function() {
          // Fall back down
          ing.falling = true;
          scene.tweens.add({
            targets: ing.obj,
            y: groundY,
            duration: VENDOR_ATK.swingMs * 0.6,
            ease: 'Quad.easeIn',
            onUpdate: function() {
              if (ing.falling && ing.obj.active) {
                // Move ingredient horizontally towards the wok center
                ing.obj.x += (currentWokPos.x - ing.obj.x) * 0.25;
                
                // Check collision with wok mouth
                var dx = Math.abs(ing.obj.x - currentWokPos.x);
                var wokMouthY = currentWokPos.y - VENDOR_ATK.wokH / 2;
                
                // If ingredient is at or below wok mouth level (minus early vanish) and within horizontal range
                if (ing.obj.y >= wokMouthY - VENDOR_ATK.ingVanishEarly && dx < VENDOR_ATK.wokW / 2) {
                  kill(ing.obj);
                  ing.falling = false; // Stop checking
                }
              }
            },
            onComplete: function() {
              if (ing.obj.active) kill(ing.obj);
            }
          });
        }
      });
    });

    scene.tweens.addCounter({ from: 0, to: 1, duration: VENDOR_ATK.swingMs, onUpdate: function (tw) { place(tw.getValue()); }, onComplete: function () { 
      kill(g); 
      kill(flameG);
      // Start steam linger
      scene.tweens.addCounter({
        from: 0,
        to: 1,
        duration: VENDOR_ATK.steamLingerMs,
        onUpdate: function (tw) {
          if (!steamG || !steamG.active) return;
          var fade = 1 - tw.getValue();
          drawSteam(stLastX, stLastY, fade);
        },
        onComplete: function () {
          kill(steamG);
        }
      });
    } });
    
    // Safety: kill any remaining ingredients after a generous timeout
    scene.time.delayedCall(VENDOR_ATK.swingMs * 2, function () {
      ingredients.forEach(function(ing) {
        if (ing.obj && ing.obj.active) kill(ing.obj);
      });
    });

    return {
      markHit: function (rect) {
        // Placeholder for future ingredient coloring
      }
    };
  }

  // Auntie Attack Constants: she throws her shopping bag from her hand along an ellipse (user's sketch 2026-10-11):
  // low-behind (hand) -> along the ground -> forward -> up and back over toward her head.  The bag's handle faces the inside of the loop.
  // Visual only; the hit rectangle is unchanged (player.js).  Sizes are 2x the first version (user 2026-10-11).
  var AUNTIE_ATK = {
    swingMs: 360,
    handDx: 12,         // bag's resting position in her hand: this many px behind her centre (against facing) ...
    handDy: 34,         // ... and this many px below it
    ellCx: 36,          // ellipse centre relative to her centre (px forward / px down) ...
    ellCy: -2,
    ellA: 46,           // ... horizontal / vertical semi-axes (px)
    ellB: 36,
    startDeg: 110,      // ellipse parameter (degrees, screen space, 90 = bottom, 0 = front, -90 = top): start just before the bottom ...
    endDeg: -100,       // ... sweep through the front and the top, stop in front of (not on) her head heading back (user 2026-10-11: end earlier)
    baseRange: 78,      // melee range (attack_range 60 x 1.3) at which the ellipse above is drawn; the whole loop scales with range, capped at scMax
    scMax: 2,
    mergeU: 0.35,       // the hand -> ellipse offset fades out over this fraction of the swing
    bandW: 9,           // thickness of each colour band at full extension
    bands: [0xff3b30, 0x2fd24f, 0x2f7bff],   // outer -> inner: red / green / blue (bag stripes)
    bandA: 0.7,         // band alpha at the head (semi-transparent, like the wok)
    tailA: 0.3,         // band alpha at the tail (the hand)
    glowLayers: [{ grow: 28, alpha: 0.07 }, { grow: 18, alpha: 0.12 }, { grow: 8, alpha: 0.2 }],
    bagW: 52, bagH: 36
  };

  function auntieScale(range) { return Math.min(AUNTIE_ATK.scMax, range / AUNTIE_ATK.baseRange); }

  // Hit rectangle that matches the bag's loop (facing-local: x forward from her centre, y down from her centre): from her front edge
  // (inner = halfW) to the bag's forward extent, vertically over the full loop plus the bag's half thickness.  Returns world coordinates.
  function auntieHitRect(px, py, facing, range, halfW) {
    var A = AUNTIE_ATK, sc = auntieScale(range), f = facing >= 0 ? 1 : -1, bh = A.bagH / 2;
    var fwd = (A.ellCx + A.ellA) * sc + bh;
    var top = (A.ellCy - A.ellB) * sc - bh, bottom = A.handDy + bh;
    var w = Math.max(fwd - halfW, 0);
    return new Phaser.Geom.Rectangle(f > 0 ? px + halfW : px - halfW - w, py + top, w, bottom - top);
  }

  function bagSlash(scene, x, y, facing, range, groundY) {
    var f = facing >= 0 ? 1 : -1;
    var A = AUNTIE_ATK, DEG = Math.PI / 180;
    var pl = scene.player && scene.player.sprite;
    var px = pl ? pl.x : x;                                   // her centre (x is the front edge of her body)
    var py = y;
    var hx = -A.handDx, hy = A.handDy;                        // hand, in facing-local coordinates (+x = forward, +y = down)
    var sc = auntieScale(range), eCx = A.ellCx * sc, eCy = A.ellCy * sc, eA = A.ellA * sc, eB = A.ellB * sc;   // loop scaled by attack range

    function smooth(v) { v = Math.min(1, Math.max(0, v)); return v * v * (3 - 2 * v); }
    // Path point at progress u (0..1) in facing-local coordinates, plus the unit vector pointing to the inside of the loop.
    function path(u) {
      var t = (A.startDeg + (A.endDeg - A.startDeg) * u) * DEG;
      var t0 = A.startDeg * DEG;
      var ex = eCx + eA * Math.cos(t), ey = eCy + eB * Math.sin(t);
      var off = 1 - smooth(u / A.mergeU);                     // starts at the hand, merges into the ellipse
      var ox = (hx - (eCx + eA * Math.cos(t0))) * off, oy = (hy - (eCy + eB * Math.sin(t0))) * off;
      var nx = eCx - ex, ny = eCy - ey, nl = Math.sqrt(nx * nx + ny * ny) || 1;
      return { x: ex + ox, y: ey + oy, nx: nx / nl, ny: ny / nl };
    }
    function W(lx, ly) { return { x: px + f * lx, y: py + ly }; }   // facing-local -> world
    function k(u) { return 0.3 + 0.7 * Math.min(1, u / 0.5); }      // band thickness factor: thin at the hand, full after the first half
    function band(g, bi, uTail, uHead, aHead, aTail, grow) {
      var steps = 48;
      function edge(u, lo, hi) {
        var p = path(u), th = A.bandW * k(u);
        var c = (1 - bi) * th;                                // centre offset toward the outside (red outermost)
        return [W(p.x - p.nx * (c + th / 2 + grow), p.y - p.ny * (c + th / 2 + grow)), W(p.x - p.nx * (c - th / 2 - grow), p.y - p.ny * (c - th / 2 - grow))];
      }
      for (var i = 0; i < steps; i++) {
        var t0 = i / steps, t1 = (i + 1) / steps;
        var u0 = uTail + (uHead - uTail) * t0, u1 = Math.min(1, uTail + (uHead - uTail) * t1 + 0.004);
        var e0 = edge(u0), e1 = edge(u1);
        g.fillStyle(A.bands[bi], (aTail + (aHead - aTail) * t1 * t1));
        g.fillPoints([e0[0], e0[1], e1[1], e1[0]], true);
      }
    }
    function drawBag(g, u, alpha) {
      var p = path(u), c = W(p.x, p.y);
      var rot = Math.atan2(f * p.nx, -p.ny);                  // bag's local "up" (handle side) points to the inside of the loop
      var BW = A.bagW, BH = A.bagH, i, q;
      function T(px2, py2) { var cs = Math.cos(rot), sn = Math.sin(rot); return { x: c.x + px2 * cs - py2 * sn, y: c.y + px2 * sn + py2 * cs }; }
      function poly(pts, col, al) { g.fillStyle(col, al); g.fillPoints(pts.map(function (z) { return T(z[0], z[1]); }), true); }
      for (q = 0; q < A.glowLayers.length; q++) {
        var gl = A.glowLayers[q], gw = BW / 2 + gl.grow, gh = BH / 2 + gl.grow;
        poly([[-gw, -gh], [gw, -gh], [gw, gh], [-gw, gh]], 0xffffff, gl.alpha * alpha);
      }
      g.lineStyle(4, 0xffe27a, 0.8 * alpha);
      var h0 = T(-BW * 0.28, -BH / 2), h1 = T(-BW * 0.14, -BH / 2 - 18), h2 = T(BW * 0.14, -BH / 2 - 18), h3 = T(BW * 0.28, -BH / 2);
      g.beginPath(); g.moveTo(h0.x, h0.y); g.lineTo(h1.x, h1.y); g.lineTo(h2.x, h2.y); g.lineTo(h3.x, h3.y); g.strokePath();
      var sh = BH / 3;
      for (i = 0; i < 3; i++) {
        poly([[-BW / 2, -BH / 2 + i * sh], [BW / 2, -BH / 2 + i * sh], [BW / 2, -BH / 2 + (i + 1) * sh], [-BW / 2, -BH / 2 + (i + 1) * sh]], A.bands[i], Math.min(1, (A.bandA + 0.2) * alpha));
      }
      for (i = 1; i <= 2; i++) poly([[-BW / 2, -BH / 2 + i * sh - 1], [BW / 2, -BH / 2 + i * sh - 1], [BW / 2, -BH / 2 + i * sh + 1], [-BW / 2, -BH / 2 + i * sh + 1]], 0xffffff, 0.8 * alpha);
    }

    var glowG = scene.add.graphics().setDepth(DEPTH).setBlendMode(Phaser.BlendModes.ADD);
    var g = scene.add.graphics().setDepth(DEPTH + 1);

    function place(p) {
      var head = 1 - Math.pow(1 - p, 2);                      // ease-out: fast start, settles at the end
      var fade = p < 0.8 ? 1 : (1 - p) / 0.2;                 // whole streak fades out at the end
      g.clear(); glowG.clear();
      if (head < 0.01) { drawBag(g, 0, fade); return; }
      for (var b = 0; b < A.bands.length; b++) {
        for (var q = 0; q < A.glowLayers.length; q++) {
          var gl = A.glowLayers[q];
          band(glowG, b, 0, head, gl.alpha * 2.2 * fade, gl.alpha * 0.6 * fade, gl.grow * 0.5);
        }
        band(g, b, 0, head, A.bandA * fade, A.tailA * fade, 0);
      }
      drawBag(g, head, fade);
    }

    place(0);
    scene.tweens.addCounter({ from: 0, to: 1, duration: A.swingMs, onUpdate: function (tw) { place(tw.getValue()); }, onComplete: function () { kill(g); kill(glowG); } });
    return { markHit: function () {} };
  }

  function slashArc(scene, x, y, facing, range, groundY) {
    if (typeof RUN !== 'undefined' && RUN.char === 'geek') return codeSlash(scene, x, y, facing, range, groundY);
    if (typeof RUN !== 'undefined' && RUN.char === 'vendor') return wokSlash(scene, x, y, facing, range, groundY);
    if (typeof RUN !== 'undefined' && RUN.char === 'auntie') return bagSlash(scene, x, y, facing, range, groundY);
    // One sheet of paper (Greenie's book-page colour) with a soft green edge glow; swings up from the bottom of the old crescent
    // and leaves fading afterimages along the way.  Close-range basic attack: small sheet, short swing.
    var f = facing >= 0 ? 1 : -1;
    var H = 26, PW = 20, PH = 26, reach = Math.min(range * 0.5, 40), GLOW = 0xa8ffc8;
    function drawPage(g, glow) {
      var k;
      if (glow) {
        for (k = 3; k >= 1; k--) {
          g.lineStyle(k * 2.5, GLOW, 0.14 + (4 - k) * 0.1);
          g.strokeRoundedRect(-PW / 2 - 1, -PH / 2 - 1, PW + 2, PH + 2, 3);
        }
      }
      g.fillStyle(0xdfe3e2, 1);
      g.lineStyle(1.5, glow ? 0xc8ffdc : 0x6f7a75, 1);
      g.fillRoundedRect(-PW / 2, -PH / 2, PW, PH, 2);
      g.strokeRoundedRect(-PW / 2, -PH / 2, PW, PH, 2);
      g.lineStyle(1.5, 0x6f7a75, 1);
      var ys = [-4, 1, 6], xr = [5, 5, 1], i;
      for (i = 0; i < 3; i++) { g.beginPath(); g.lineTo(-5, ys[i]); g.lineTo(xr[i], ys[i]); g.strokePath(); }
    }
    var g = scene.add.graphics().setDepth(DEPTH + 1);
    drawPage(g, true);
    function pose(o, p) {
      o.x = x + f * (8 + reach * Math.sin(Math.PI * p));   // 0 -> reach -> 0 : outward bulge of the arc
      o.y = y + H * Math.cos(Math.PI * p);                  // bottom (+H) -> top (-H)
      o.rotation = f * (0.5 - p) * 0.9;                     // stays upright, leans forward then back (about +-26 deg)
    }
    var nextGhost = 0.1;
    function ghost(p) {
      var o = scene.add.graphics().setDepth(DEPTH);
      drawPage(o, false); pose(o, p); o.alpha = 0.4;
      scene.tweens.add({ targets: o, alpha: 0, duration: 170, onComplete: function () { kill(o); } });
    }
    function place(p) {
      pose(g, p);
      g.alpha = p < 0.15 ? p / 0.15 : (p > 0.75 ? Math.max(0, (1 - p) / 0.25) : 1);
      while (p >= nextGhost && nextGhost < 0.9) { ghost(nextGhost); nextGhost += 0.1; }
    }
    place(0);
    scene.tweens.addCounter({ from: 0, to: 1, duration: 230, onUpdate: function (tw) { place(tw.getValue()); }, onComplete: function () { kill(g); } });
  }

  // Geek's "nano process" skill (user 2026-10-10): on cast a blue ring bursts out, then a big silicon wafer (fx_wafer, from the user's photo) fades in
  // BEHIND the character as one large slowly turning disc with a pulsing blue rim, for the whole invincibility; everything fades out over the last 0.5 s.
  // Visual only: the dash and the invincibility itself belong to Skills.nano_process (not written yet).  p = Player, durationMs = invincibility length.
  function nanoProcess(scene, p, durationMs) {
    var sp = p && p.sprite;
    if (!sp || !scene.textures.exists('fx_wafer')) return;
    var BLUE = 0x58b4ff, D = 150, ALPHA = 0.6;
    var r1 = scene.add.graphics().setDepth(DEPTH);
    scene.tweens.add({ targets: r1, alpha: 0, duration: 450, onUpdate: function (tw) {
      var pr = tw.progress; r1.clear(); r1.lineStyle(5 - 3 * pr, BLUE, 1 - pr); r1.strokeCircle(sp.x, sp.y - 6, 14 + pr * 80);
      r1.lineStyle(2, 0xffffff, 0.8 * (1 - pr)); r1.strokeCircle(sp.x, sp.y - 6, 8 + pr * 50);
    }, onComplete: function () { kill(r1); } });
    if (sp.setTint) { sp.setTintFill(0xbfe3ff); scene.time.delayedCall(90, function () { if (alive(sp)) sp.clearTint(); }); }
    var banner = scene.add.text(GAME_W / 2, 92, '奈米製程！無敵', { fontFamily: FONT, fontSize: '22px', color: '#d6ecff', stroke: '#1f4f8f', strokeThickness: 5 }).setOrigin(0.5).setScrollFactor(0).setDepth(90).setAlpha(0);
    scene.tweens.add({ targets: banner, alpha: 1, y: 100, duration: 200 });
    scene.tweens.add({ targets: banner, alpha: 0, delay: 1500, duration: 500, onComplete: function () { kill(banner); } });
    var wafer = scene.add.image(sp.x, sp.y - 6, 'fx_wafer').setDisplaySize(D, D).setDepth(sp.depth - 2).setAlpha(0);
    var rim = scene.add.graphics().setDepth(sp.depth - 2);
    var t0 = scene.time.now, done = false;
    function stop() {
      if (done) return; done = true;
      scene.events.off('update', tick); scene.events.off('shutdown', stop);
      kill(wafer); kill(rim); kill(banner);
    }
    function tick() {
      if (!alive(sp) || !wafer.active) { stop(); return; }
      var t = scene.time.now - t0, left = durationMs - t;
      if (left <= 0) { stop(); return; }
      var fade = Math.min(left < 500 ? left / 500 : 1, Math.min(1, t / 450));   // fade in over 0.45 s, out over the last 0.5 s
      var pulse = 0.5 + 0.5 * Math.sin(t / 130);
      var cx = sp.x, cy = sp.y - 6;
      wafer.setPosition(cx, cy); wafer.rotation = t / 3000; wafer.setAlpha(ALPHA * fade); wafer.setDepth(sp.depth - 2);
      rim.clear(); rim.setDepth(sp.depth - 2);
      for (var k = 3; k >= 1; k--) { rim.lineStyle(k * 3, BLUE, (0.10 + 0.06 * pulse + (4 - k) * 0.08) * fade); rim.strokeCircle(cx, cy, D / 2 + 1); }
    }
    scene.events.on('update', tick);
    scene.events.once('shutdown', stop);
  }

  // Geek's "nano process" cast burst (user 2026-10-10): one bright yellow flash that spreads in all directions up to `radius` (the skill's hit radius, 160 px):
  // a pale-yellow disc, a bold ring with a white inner ring, and 14 rays, all fading as they reach the edge.  Drawn once at the cast position.
  function nanoBurst(scene, x, y, radius) {
    var R = radius || 160, N = 14, DUR = 550;
    var g = scene.add.graphics().setDepth(DEPTH + 3);
    var tw = scene.tweens.addCounter({ from: 0, to: 1, duration: DUR, onUpdate: function (t) {
      var p = t.getValue(), e = 1 - Math.pow(1 - p, 3), r = R * e, fade = 1 - p;
      g.clear();
      g.fillStyle(0xffe14d, 0.34 * fade); g.fillCircle(x, y, r);
      g.fillStyle(0xffffff, 0.9 * fade * fade); g.fillCircle(x, y, 12 + 26 * fade);
      for (var i = 0; i < N; i++) {
        var a = (i / N) * Math.PI * 2 + 0.2;
        g.lineStyle(3, 0xffffaa, 0.9 * fade); g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.35, y + Math.sin(a) * r * 0.35); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.strokePath();
      }
      g.lineStyle(2 + 5 * fade, 0xfff27a, Math.min(1, 0.4 + fade)); g.strokeCircle(x, y, r);
      g.lineStyle(3, 0xffffff, fade); g.strokeCircle(x, y, r * 0.72);
    }, onComplete: function () { kill(g); } });
    scene.events.once('shutdown', function () { if (tw && tw.stop) tw.stop(); kill(g); });
  }

  // Vendor's "stir fry" skill (user 2026-10-10): cast burst (fire shockwave), then a ring of flames around the feet, a pulsing invincibility aura,
  // a countdown above the head, and a screen banner. All visuals fade out in the last 0.5s.
  // Auntie's "take profit" skill (user 2026-10-12): 4 red K-bars rise from the ground in front of her, each followed by a gold coin that bounces up and floats.
  // layout.bars[i] = { cx, top, bottom, w, h, startMs, endMs }; layout.coins[i] = { cx, top, apexY, size, startMs, endMs }.
  // All positions are world coordinates from hooks.js; do not recalculate or follow the player.
  function takeProfit(scene, p, layout) {
    if (!layout || !layout.bars || !layout.coins) return;
    var bars = layout.bars;
    var coins = layout.coins;
    var i;

    // Helper to check if scene is still active
    function isActive() {
      return scene.sys.isActive() && scene.sys.settings.active;
    }

    // 1. Draw K-bars
    for (i = 0; i < bars.length; i++) {
      (function (bar) {
        scene.time.delayedCall(bar.startMs, function () {
          if (!isActive()) return;
          
          var g = scene.add.graphics().setDepth(35);
          var glowG = scene.add.graphics().setDepth(34);
          var targetH = bar.h;
          var w = bar.w;
          
          // Draw function for the bar at a specific height
          function drawBar(height) {
            g.clear();
            glowG.clear();
            if (height <= 0) return;
            
            var topY = bar.bottom - height;
            var leftX = bar.cx - w / 2;
            
            // Glow layers (outer to inner)
            var glowLayers = [
              { grow: 14, alpha: 0.18 },
              { grow: 9, alpha: 0.30 },
              { grow: 4, alpha: 0.50 }
            ];
            for (var k = 0; k < glowLayers.length; k++) {
              var gl = glowLayers[k];
              var gw = w + gl.grow * 2;
              var gh = height + gl.grow * 2;
              var gx = leftX - gl.grow;
              var gy = topY - gl.grow;
              glowG.fillStyle(0xff5a4a, gl.alpha);
              glowG.fillRect(gx, gy, gw, gh);
            }
            
            // Main red body
            g.fillStyle(0xe53935, 1);
            g.fillRect(leftX, topY, w, height);
            
            // Dark red border
            g.lineStyle(2, 0xb71c1c, 1);
            g.strokeRect(leftX, topY, w, height);
            
          }

          // Initial state: height 0
          drawBar(0);

          // Grow animation
          var growObj = { h: 0 };
          scene.tweens.add({
            targets: growObj,
            h: targetH,
            duration: 120,
            ease: 'Cubic.easeOut',
            onUpdate: function (tw, target) {
              if (!isActive() || !g.active) return;
              drawBar(target.h);
            },
            onComplete: function () {
              if (!isActive() || !g.active) return;
              drawBar(targetH); // Ensure final state
            }
          });

          // Fade out animation: starts at (endMs - startMs - 150) after creation, ends at endMs
          scene.tweens.add({
            targets: [g, glowG],
            alpha: 0,
            duration: 150,
            delay: bar.endMs - bar.startMs - 150,
            onComplete: function () {
              if (g.active) g.destroy();
              if (glowG.active) glowG.destroy();
            }
          });
        });
      })(bars[i]);
    }

    // 2. Draw Coins
    for (i = 0; i < coins.length; i++) {
      (function (coin) {
        scene.time.delayedCall(coin.startMs, function () {
          if (!isActive()) return;

          var g = scene.add.graphics().setDepth(36);
          var r = coin.size / 2;
          var cx = coin.cx;
          var startY = coin.top;
          var apexY = coin.apexY;
          var floatTween = null; // Declare floatTween here to access in fade out
          
          // Draw function for the coin
          function drawCoin(x, y, scale) {
            g.clear();
            if (scale <= 0) return;
            
            var rad = r * scale;
            
            // Main gold body
            g.fillStyle(0xffd24a, 1);
            g.fillCircle(x, y, rad);
            
            // Dark gold border
            g.lineStyle(2, 0xb8860b, 1);
            g.strokeCircle(x, y, rad);
            
            // Inner light ring for 3D effect
            g.lineStyle(1, 0xfff1a8, 0.8);
            g.strokeCircle(x, y, rad * 0.6);
          }

          // Initial state: small at top
          drawCoin(cx, startY, 0.1);

          // White flash at spawn
          var flash = scene.add.graphics().setDepth(36);
          flash.fillStyle(0xffffff, 0.8);
          flash.fillCircle(cx, startY, 14);
          scene.tweens.add({
            targets: flash,
            alpha: 0,
            duration: 100,
            onComplete: function () {
              if (flash.active) flash.destroy();
            }
          });

          // Bounce animation
          var bounceObj = { y: startY, s: 0.1 };
          scene.tweens.add({
            targets: bounceObj,
            y: apexY,
            s: 1,
            duration: 150,
            ease: 'Back.easeOut',
            onUpdate: function (tw, target) {
              if (!isActive() || !g.active) return;
              drawCoin(cx, target.y, target.s);
            },
            onComplete: function () {
              if (!isActive() || !g.active) return;
              
              // Floating animation
              var floatObj = { y: apexY };
              floatTween = scene.tweens.add({
                targets: floatObj,
                y: apexY - 3,
                duration: 800,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
                onUpdate: function (tw, target) {
                  if (!isActive() || !g.active) return;
                  drawCoin(cx, target.y, 1);
                }
              });
            }
          });

          // Fade out animation: starts at (endMs - startMs - 150) after creation, ends at endMs
          scene.tweens.add({
            targets: g,
            alpha: 0,
            duration: 150,
            delay: coin.endMs - coin.startMs - 150,
            onComplete: function () {
              if (floatTween) floatTween.stop();
              if (g.active) g.destroy();
            }
          });
        });
      })(coins[i]);
    }
  }

  function stirFry(scene, p, durationMs, radius) {
    var sp = p && p.sprite;
    if (!sp) return;
    var R = radius || 100;
    var DUR = durationMs || 4000;
    var FONT = 'Microsoft JhengHei, PingFang TC, sans-serif';
    var DEPTH = 50;

    // 1. Cast Burst (0.5s)
    var burstG = scene.add.graphics().setDepth(DEPTH + 5);
    var burstTw = scene.tweens.addCounter({
      from: 0, to: 1, duration: 500,
      onUpdate: function (tw) {
        var pr = tw.getValue();
        var e = 1 - Math.pow(1 - pr, 3); // ease out cubic
        var r = R * e;
        var fade = 1 - pr;
        burstG.clear();
        // Red-orange disc
        burstG.fillStyle(0xff4500, 0.3 * fade);
        burstG.fillCircle(sp.x, sp.y, r);
        // Thick ring
        burstG.lineStyle(6, 0xff8c00, 0.8 * fade);
        burstG.strokeCircle(sp.x, sp.y, r);
        // Inner white ring
        burstG.lineStyle(2, 0xffffff, 0.9 * fade);
        burstG.strokeCircle(sp.x, sp.y, r * 0.7);
        // 12-14 radial flames
        var N = 13;
        for (var i = 0; i < N; i++) {
          var a = (i / N) * Math.PI * 2 + 0.1;
          var len = r * (0.8 + 0.2 * Math.sin(i * 2.5));
          burstG.lineStyle(3, 0xffd700, 0.9 * fade);
          burstG.beginPath();
          burstG.moveTo(sp.x + Math.cos(a) * r * 0.3, sp.y + Math.sin(a) * r * 0.3);
          burstG.lineTo(sp.x + Math.cos(a) * len, sp.y + Math.sin(a) * len);
          burstG.strokePath();
        }
      },
      onComplete: function () { kill(burstG); }
    });

    // Character flash
    if (sp.setTintFill) {
      sp.setTintFill(0xffe0b0);
      scene.time.delayedCall(90, function () { if (alive(sp)) sp.clearTint(); });
    }

    // 2. Duration Effects
    // Foot fire (user 2026-10-11: "much bigger, lasting to the very end, flickering / drifting flames and smoke"): two rows of flame tongues rooted at
    // the feet (back row tall, behind the character; front row shorter, in front of the legs), never dying out, at full strength until the last 0.2 s.
    // Each tongue's sway grows towards its tip and travels upward (drifting look); a slow shared lean acts as wind.  Sparks rise out of the fire;
    // grey smoke puffs rise from the flame tops for the whole duration, and the ones already in the air drift on and fade after the skill ends.
    var auraG = scene.add.graphics().setDepth(sp.depth - 1);
    var smokeG = scene.add.graphics().setDepth(sp.depth - 3);
    var flameBackG = scene.add.graphics().setDepth(sp.depth - 2);
    var flameFrontG = scene.add.graphics().setDepth(sp.depth + 1);
    var cdText = scene.add.text(sp.x, sp.y - 60, '', {
      fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: '#ffd966', stroke: '#7a1f00', strokeThickness: 6
    }).setOrigin(0.5).setDepth(sp.depth + 10).setAlpha(0);

    var banner = scene.add.text(GAME_W / 2, 92, '大火快炒！無敵・定身 4 秒', {
      fontFamily: FONT, fontSize: '22px', color: '#ffe2b0', stroke: '#8a2a00', strokeThickness: 5
    }).setOrigin(0.5).setScrollFactor(0).setDepth(90).setAlpha(0);

    scene.tweens.add({ targets: banner, alpha: 1, y: 100, duration: 200 });
    scene.tweens.add({ targets: banner, alpha: 0, delay: 1500, duration: 500, onComplete: function () { kill(banner); } });

    var t0 = scene.time.now;
    var done = false, ended = false;
    var SF = STIR_FIRE;
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function makeRow(n, half, hMin, hMax, wMin, wMax) {
      var row = [];
      for (var i = 0; i < n; i++) {
        var xn = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;                         // -1..1 across the row
        row.push({ dx: xn * half + rnd(-4, 4), h: (hMin + (hMax - hMin) * Math.cos(xn * Math.PI / 2)) * rnd(0.88, 1.08),
          w: rnd(wMin, wMax), ph: rnd(0, Math.PI * 2), sp: rnd(0.85, 1.2) });
      }
      return row;
    }
    var backRow = makeRow(SF.back.n, SF.back.half, SF.back.hMin, SF.back.hMax, SF.back.wMin, SF.back.wMax);
    var frontRow = makeRow(SF.front.n, SF.front.half, SF.front.hMin, SF.front.hMax, SF.front.wMin, SF.front.wMax);
    var sparks = [];
    for (var si = 0; si < SF.sparkCount; si++) sparks.push({ dx: rnd(-SF.back.half, SF.back.half), per: rnd(550, 1000), ph: rnd(0, 1), sz: rnd(1.5, 3) });
    var smoke = [], nextPuff = 0;

    // one flame tongue rooted at (x0, y0): contour from root to tip, sway grows with height and travels upward
    function tongue(g, x0, y0, w, h, ts, ph, lean, a) {
      var k = 0.86 + 0.09 * Math.sin(ts * 9.3 + ph) + 0.06 * Math.sin(ts * 15.1 + ph * 2.3);   // flicker, never below ~0.7
      var H = h * k;
      for (var li = 0; li < SF.layers.length; li++) {
        var L = SF.layers[li], hh = H * L.h, ww = w * L.w, right = [], left = [];
        for (var s = 0; s <= 6; s++) {
          var u = s / 6;
          var dx = lean * u * u + SF.sway * Math.pow(u, 1.4) * Math.sin(ts * 6.2 + ph - u * 3.2) + 2.5 * u * Math.sin(ts * 11 + ph * 1.7);
          var hw = ww / 2 * Math.pow(1 - u, 0.85) * (u < 0.18 ? 0.8 + u * 1.1 : 1);
          right.push({ x: x0 + dx + hw, y: y0 - hh * u });
          left.unshift({ x: x0 + dx - hw, y: y0 - hh * u });
        }
        g.fillStyle(L.col, L.a * a);
        g.fillPoints(right.concat(left.slice(1)), true);
      }
    }

    function stop() {
      if (done) return;
      done = true;
      scene.events.off('update', tick);
      scene.events.off('shutdown', stop);
      kill(auraG); kill(flameBackG); kill(flameFrontG); kill(smokeG);
      kill(cdText);
      kill(banner);
      if (burstTw && burstTw.stop) burstTw.stop();
      kill(burstG);
      if (alive(sp)) sp.clearTint();
    }
    function endSkill() {                       // skill time is over: fire, aura and countdown go; smoke already in the air drifts on
      if (ended) return;
      ended = true;
      kill(auraG); kill(flameBackG); kill(flameFrontG); kill(cdText);
    }

    function tick() {
      if (!alive(sp) || !smokeG.active) { stop(); return; }
      var now = scene.time.now, t = now - t0, left = DUR - t, ts = t / 1000;
      var cx = sp.x, cy = sp.y;
      var footY = sp.body ? sp.body.bottom : cy + sp.displayHeight / 2;
      var lean = SF.lean * Math.sin(ts * 1.3) + SF.lean * 0.4 * Math.sin(ts * 3.1 + 1);

      if (!ended && left <= 0) endSkill();
      if (!ended) {
        // Fade logic for aura / countdown (unchanged): 0.3s in, 0.5s out with flicker
        var fade = 1;
        if (t < 300) fade = t / 300;
        else if (left < 500) fade = left / 500;
        if (left < 500) fade *= 0.6 + 0.4 * Math.sin(t / 50);
        // fire: quick 0.15 s rise, full strength until the last 0.2 s
        var ff = Math.min(1, t / 150, left / 200);

        auraG.clear();
        var pulse = 0.5 + 0.5 * Math.sin(t / 150);
        auraG.fillStyle(0xff4500, (0.10 + 0.12 * pulse) * fade);
        auraG.fillCircle(cx, cy, 36);

        flameBackG.clear();
        // ground glow under the fire
        var gp = 0.85 + 0.15 * Math.sin(ts * 7);
        flameBackG.fillStyle(0xff4a00, 0.22 * ff * gp); flameBackG.fillEllipse(cx, footY, SF.back.half * 2.9, 34);
        flameBackG.fillStyle(0xffb030, 0.30 * ff * gp); flameBackG.fillEllipse(cx, footY, SF.back.half * 1.9, 18);
        for (var b = 0; b < backRow.length; b++) {
          var f = backRow[b];
          tongue(flameBackG, cx + f.dx, footY + 2, f.w, f.h, ts * f.sp, f.ph, lean, ff);
        }
        // sparks rising out of the fire
        for (var k = 0; k < sparks.length; k++) {
          var s2 = sparks[k], life = (t / s2.per + s2.ph) % 1;
          var sx = cx + s2.dx + lean * life + 6 * Math.sin(ts * 5 + s2.ph * 9) * life, sy = footY - 20 - SF.sparkRise * life;
          flameBackG.fillStyle(life < 0.5 ? 0xfff0a0 : 0xffa030, ff * (1 - life) * 0.95);
          flameBackG.fillCircle(sx, sy, s2.sz * (1 - 0.5 * life));
        }
        flameFrontG.clear();
        for (var fi = 0; fi < frontRow.length; fi++) {
          var q = frontRow[fi];
          tongue(flameFrontG, cx + q.dx, footY + 6, q.w, q.h, ts * q.sp, q.ph, lean, ff * SF.front.alpha);
        }

        // new smoke puffs from the flame tops while the skill lasts
        while (nextPuff <= t && left > 150) {
          smoke.push({ x: cx + rnd(-SF.back.half * 0.8, SF.back.half * 0.8), y: footY - SF.back.hMax * rnd(0.6, 0.95), t0: now,
            life: rnd(SF.smokeLife[0], SF.smokeLife[1]), drift: rnd(-10, 10), r0: rnd(6, 10), ph: rnd(0, 6) });
          nextPuff += SF.smokeEveryMs;
        }

        var secs = Math.ceil(left / 1000);
        cdText.setPosition(cx, cy - 60);
        cdText.setText(String(secs));
        cdText.setAlpha(fade);
      }

      // smoke: rises, grows, drifts with the wind, fades; keeps going after the skill until the last puff is gone
      smokeG.clear();
      for (var m = smoke.length - 1; m >= 0; m--) {
        var pf = smoke[m], u = (now - pf.t0) / pf.life;
        if (u >= 1) { smoke.splice(m, 1); continue; }
        var px = pf.x + (pf.drift + lean * 1.5) * u * pf.life / 1000 + 5 * Math.sin(now / 300 + pf.ph) * u;
        var py = pf.y - SF.smokeRise * (1 - Math.pow(1 - u, 1.6));
        var pr = pf.r0 + SF.smokeGrow * u;
        var pa = SF.smokeAlpha * Math.min(1, u * 5) * (1 - u);
        smokeG.fillStyle(0x6e6762, pa * 0.55); smokeG.fillCircle(px, py, pr * 1.3);
        smokeG.fillStyle(0x4d4743, pa); smokeG.fillCircle(px, py, pr);
      }
      if (ended && smoke.length === 0) stop();
    }

    scene.events.on('update', tick);
    scene.events.once('shutdown', stop);
  }

  // Greenie's "exam max" buff: a green ring bursts out on cast, then a soft pulsing green aura and three small book pages orbit the player
  // for the whole buff; everything fades out over the last 0.5 s.  p = Player (p.sprite follows the character).
  function examMax(scene, p, durationMs) {
    var sp = p && p.sprite;
    if (!sp) return;
    var GREEN = 0x7dffa8, PAGE = 0xdfe3e2, EDGE = 0x6f7a75;
    // cast burst: two expanding rings + a short green flash on the character
    var r1 = scene.add.graphics().setDepth(DEPTH);
    scene.tweens.add({ targets: r1, alpha: 0, duration: 450, onUpdate: function (tw, tg) {
      var pr = tw.progress; r1.clear(); r1.lineStyle(5 - 3 * pr, GREEN, 1 - pr); r1.strokeCircle(sp.x, sp.y - 6, 14 + pr * 70);
      r1.lineStyle(2, 0xffffff, 0.8 * (1 - pr)); r1.strokeCircle(sp.x, sp.y - 6, 8 + pr * 46);
    }, onComplete: function () { kill(r1); } });
    if (sp.setTint) { sp.setTintFill(0xbdffd0); scene.time.delayedCall(90, function () { if (alive(sp)) sp.clearTint(); }); }
    // on-screen skill banner (top centre) + faint countdown above the head
    var banner = scene.add.text(GAME_W / 2, 92, '學測滿級！無敵＋攻擊 +50%・移速 +20%・攻速 +20%', { fontFamily: FONT, fontSize: '22px', color: '#c8ffd9', stroke: '#1f6b3c', strokeThickness: 5 }).setOrigin(0.5).setScrollFactor(0).setDepth(90).setAlpha(0);
    scene.tweens.add({ targets: banner, alpha: 1, y: 100, duration: 200 });
    scene.tweens.add({ targets: banner, alpha: 0, delay: 1500, duration: 500, onComplete: function () { kill(banner); } });
    var cd = scene.add.text(sp.x, sp.y - 60, '', { fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: '#fff36b', stroke: '#0b3d1f', strokeThickness: 6 }).setOrigin(0.5).setDepth(sp.depth + 2).setAlpha(0.9);
    // aura + orbiting pages
    var aura = scene.add.graphics().setDepth(sp.depth - 1);
    var pages = [];
    for (var i = 0; i < 3; i++) {
      var g = scene.add.graphics().setDepth(sp.depth + 1);
      g.fillStyle(PAGE, 1); g.lineStyle(1.5, GREEN, 0.9);
      g.fillRoundedRect(-5, -7, 10, 14, 1.5); g.strokeRoundedRect(-5, -7, 10, 14, 1.5);
      g.lineStyle(1, EDGE, 1);
      for (var k = 0; k < 3; k++) { g.beginPath(); g.lineTo(-3, -3 + k * 3.2); g.lineTo(k === 2 ? 0 : 3, -3 + k * 3.2); g.strokePath(); }
      pages.push(g);
    }
    var t0 = scene.time.now, done = false;
    function stop() {
      if (done) return; done = true;
      scene.events.off('update', tick); scene.events.off('shutdown', stop);
      kill(aura); kill(banner); kill(cd); for (var j = 0; j < pages.length; j++) kill(pages[j]);
    }
    function tick() {
      if (!alive(sp) || !aura.active) { stop(); return; }
      var t = scene.time.now - t0, left = durationMs - t;
      if (left <= 0) { stop(); return; }
      var fade = left < 500 ? left / 500 : 1;
      cd.setPosition(sp.x, sp.y - 70); cd.setText((left / 1000).toFixed(1)); cd.setAlpha(0.9 * fade);
      var pulse = 0.5 + 0.5 * Math.sin(t / 110);
      aura.clear();
      aura.fillStyle(GREEN, (0.10 + 0.08 * pulse) * fade); aura.fillEllipse(sp.x, sp.y - 6, 74 + 6 * pulse, 104 + 6 * pulse);
      aura.lineStyle(2, GREEN, (0.35 + 0.25 * pulse) * fade); aura.strokeEllipse(sp.x, sp.y - 6, 74 + 6 * pulse, 104 + 6 * pulse);
      for (var j = 0; j < pages.length; j++) {
        var a = t / 260 + j * Math.PI * 2 / 3;
        pages[j].x = sp.x + Math.cos(a) * 34; pages[j].y = sp.y - 6 + Math.sin(a) * 18 - 14;
        pages[j].rotation = Math.cos(a) * 0.5; pages[j].alpha = fade * (0.55 + 0.45 * (Math.sin(a) + 1) / 2);
        pages[j].setDepth(Math.sin(a) > 0 ? sp.depth + 1 : sp.depth - 1);
      }
    }
    scene.events.on('update', tick);
    scene.events.once('shutdown', stop);
  }

  function damageNumber(scene, x, y, amount, isCrit, isPlayer) {
    var color = isPlayer ? '#ff5050' : (isCrit ? '#ffd24a' : '#ffffff');
    var size = isCrit ? 26 : 18;
    var t = scene.add.text(x, y, String(Math.round(amount)), { fontFamily: FONT, fontSize: size + 'px', color: color, stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5).setDepth(DEPTH);
    if (isCrit) t.setScale(1.6);
    scene.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: function () { kill(t); } });
  }

  function deathPoof(scene, x, y) {
    var g = scene.add.graphics().setDepth(DEPTH);
    g.fillStyle(0x888888, 0.8); g.fillCircle(x, y, 10);
    scene.tweens.add({ targets: g, alpha: 0, scaleX: 2.2, scaleY: 2.2, duration: 350, onComplete: function () { kill(g); } });
    sparks(scene, x, y, 0xaaaaaa, 6, 90, 350);
  }

  function explosionRing(scene, x, y, radius) {
    var g = scene.add.graphics().setDepth(DEPTH);
    g.lineStyle(5, 0xff8800, 1); g.strokeCircle(x, y, 8);
    scene.tweens.add({ targets: g, alpha: 0, duration: 400, onUpdate: function (tw, tg, p) { g.clear(); g.lineStyle(5, 0xff8800, 1 - p); g.strokeCircle(x, y, 8 + p * (radius || 60)); }, onComplete: function () { kill(g); } });
  }

  function healGlow(scene, x, y) {
    var g = scene.add.graphics().setDepth(DEPTH);
    g.fillStyle(0x60ff80, 0.5); g.fillCircle(x, y, 12);
    scene.tweens.add({ targets: g, alpha: 0, scaleX: 2, scaleY: 2, duration: 500, onComplete: function () { kill(g); } });
  }

  function dashTrail(scene, x, y, facing) {
    var g = scene.add.graphics().setDepth(DEPTH);
    g.fillStyle(0x88ccff, 0.5);
    g.fillRect(x - 14, y - 10, 28, 20);
    scene.tweens.add({ targets: g, alpha: 0, x: x - facing * 20, duration: 220, onComplete: function () { kill(g); } });
  }

  // Boss attack warnings (red circle that closes in / red box).  Fixed 2026-10-12: the old version drove them with a tween that had no property to animate, which this Phaser ends at once
  // (the graphics were destroyed in the same frame, so no warning was ever seen); now a counter tween drives them.  Both return the Graphics: destroy() on it cancels the warning.
  // telegraphRect: x is the CENTRE of the box (the boss passes a centre; it used to be drawn as if it were the left edge), y the top.
  // Taiwan Mobile SIM attack (user 2026-10-12): the antenna appears first (nearest the player), then the four signal bars one after another (each taller than the last), every piece a glowing
  // sky-blue thick outline (reference picture: antenna + four rising bars).  The same layout drives the picture and the hit boxes (player.js _simAttack), like Auntie's take-profit bars.
  var SIM = { firstGap: 6, w: 26, gap: 10, heights: [34, 52, 70, 90], antennaH: 64, stepMs: 85, lifeMs: 430 };
  function simLayout(s, facing) {
    var x0 = s.x + facing * (s.body.halfWidth + SIM.firstGap), ground = s.body.bottom, items = [];
    for (var i = 0; i < 5; i++) {
      var cx = x0 + facing * (SIM.w / 2 + i * (SIM.w + SIM.gap)), h = i === 0 ? SIM.antennaH : SIM.heights[i - 1];
      items.push({ i: i, kind: i === 0 ? 'antenna' : 'bar', cx: cx, x: cx - SIM.w / 2, y: ground - h, w: SIM.w, h: h, bottom: ground, startMs: i * SIM.stepMs, endMs: i * SIM.stepMs + SIM.lifeMs });
    }
    return { facing: facing, ground: ground, items: items, endMs: 4 * SIM.stepMs + SIM.lifeMs };
  }
  function simSignal(scene, L) {
    L.items.forEach(function (it) {
      scene.time.delayedCall(it.startMs, function () {
        var g = scene.add.graphics().setDepth(6); g.x = it.cx; g.y = it.bottom;   // drawn around the bottom centre so scaleY grows it upward
        var w = it.w, h = it.h;
        if (it.kind === 'bar') {
          g.fillStyle(0x66d4ff, 0.2); g.fillRoundedRect(-w / 2, -h, w, h, 4);
          [[12, 0.14], [7, 0.3], [4, 1]].forEach(function (ls, k) { g.lineStyle(ls[0], k === 2 ? 0x7fdcff : 0x4cc4ff, ls[1]); g.strokeRoundedRect(-w / 2, -h, w, h, 4); });
          g.lineStyle(1.5, 0xeafcff, 0.9); g.strokeRoundedRect(-w / 2 + 1, -h + 1, w - 2, h - 2, 3);
        } else {   // antenna: a pole that ends in a Y (a triangle outline on top)
          var py = -h * 0.6;
          [[12, 0.14, 0x4cc4ff], [7, 0.3, 0x4cc4ff], [4, 1, 0x7fdcff], [1.5, 0.9, 0xeafcff]].forEach(function (ls) {
            g.lineStyle(ls[0], ls[2], ls[1]);
            g.beginPath(); g.moveTo(0, 0); g.lineTo(0, py); g.strokePath();
            g.beginPath(); g.moveTo(-w / 2, -h); g.lineTo(0, py); g.lineTo(w / 2, -h); g.closePath(); g.strokePath();
          });
        }
        g.setScale(1, 0.25);
        scene.tweens.add({ targets: g, scaleY: 1, duration: 110, ease: 'Back.Out' });
        scene.tweens.add({ targets: g, alpha: 0, delay: SIM.lifeMs - 170, duration: 170, onComplete: function () { kill(g); } });
      });
    });
  }

  function telegraphCircle(scene, x, y, radius, ms) {
    var g = scene.add.graphics().setDepth(DEPTH);
    var pulse = scene.tweens.add({ targets: g, alpha: 0.7, duration: 120, yoyo: true, repeat: -1 });
    var draw = function (p) { g.clear(); g.fillStyle(0xff3030, 0.25); g.fillCircle(x, y, radius); g.lineStyle(3, 0xff3030, 0.8); g.strokeCircle(x, y, radius * p); };
    draw(0);
    var t = scene.tweens.addCounter({ from: 0, to: 1, duration: ms, onUpdate: function (tw) { if (g.active) draw(tw.getValue()); }, onComplete: function () { pulse.stop(); kill(g); } });
    g.once('destroy', function () { pulse.stop(); t.stop(); });
    return g;
  }

  function telegraphRect(scene, x, y, w, h, ms) {
    var g = scene.add.graphics().setDepth(DEPTH);
    var pulse = scene.tweens.add({ targets: g, alpha: 0.7, duration: 120, yoyo: true, repeat: -1 });
    var draw = function () { g.clear(); g.fillStyle(0xff3030, 0.25); g.fillRect(x - w / 2, y, w, h); g.lineStyle(3, 0xff3030, 0.8); g.strokeRect(x - w / 2, y, w, h); };
    draw();
    var t = scene.tweens.addCounter({ from: 0, to: 1, duration: ms, onComplete: function () { pulse.stop(); kill(g); } });
    g.once('destroy', function () { pulse.stop(); t.stop(); });
    return g;
  }

  function screenShake(scene, intensity, ms) {
    scene.cameras.main.shake(ms, intensity / 1000);
  }

  function levelClearFlash(scene, x, y) {
    var g = scene.add.graphics().setDepth(DEPTH);
    g.fillStyle(0xffffff, 0.9); g.fillCircle(x, y, 10);
    scene.tweens.add({ targets: g, alpha: 0, scaleX: 40, scaleY: 40, duration: 600, onComplete: function () { kill(g); } });
    fullFlash(scene, 0xffffff, 0.6, 0, 400, 90);
  }

  function shieldRing(scene, sprite, ms) {
    if (!alive(sprite)) return;
    var g = scene.add.graphics().setDepth(DEPTH);
    var tw = scene.tweens.add({ targets: g, alpha: 0.8, duration: 100, yoyo: true, repeat: -1 });
    var dur = ms || 1000;
    var t = scene.tweens.add({ targets: g, duration: dur, onUpdate: function () { g.clear(); g.lineStyle(3, 0x40a0ff, 0.8); g.strokeCircle(sprite.x, sprite.y, 30); }, onComplete: function () { tw.stop(); kill(g); } });
    return t;
  }

  function burnFlame(scene, x, y) {
    var c = scene.add.circle(x, y, 4, 0xff6600, 1).setDepth(DEPTH);
    scene.tweens.add({ targets: c, y: y - 18, alpha: 0, scaleX: 0.3, scaleY: 1.4, duration: 400, onComplete: function () { kill(c); } });
  }

  function hitStop(scene, ms) {
    if (scene._hitStop) return;
    scene._hitStop = true;
    scene.physics.world.pause();
    scene.tweens.timeScale = 0.05;
    window.setTimeout(function () {
      scene.physics.world.resume();
      scene.tweens.timeScale = 1;
      scene._hitStop = false;
    }, ms);
  }

  function slowMo(scene, factor, ms) {
    scene.time.timeScale = factor;
    scene.tweens.timeScale = factor;
    scene.physics.world.timeScale = 1 / factor;
    window.setTimeout(function () {
      scene.time.timeScale = 1;
      scene.tweens.timeScale = 1;
      scene.physics.world.timeScale = 1;
    }, ms);
  }

  function flashSprite(scene, sprite, colorHex, ms) {
    if (!alive(sprite)) return;
    sprite.setTintFill(colorHex);
    scene.time.delayedCall(ms, function () { if (alive(sprite)) sprite.clearTint(); });
  }

  function squash(scene, sprite, sx, sy, ms) {
    if (!alive(sprite)) return;
    var bx = baseX(sprite), by = baseY(sprite);
    sprite.setScale(bx * sx, by * sy);
    scene.tweens.add({ targets: sprite, scaleX: bx, scaleY: by, duration: ms, yoyo: true, onComplete: function () { if (alive(sprite)) sprite.setScale(bx, by); } });
  }

  function hitEnemy(scene, sprite, isCrit, x, y) {
    if (isCrit) {
      hitStop(scene, 120); screenShake(scene, 4, 150); flashSprite(scene, sprite, 0xffaa00, 150); squash(scene, sprite, 0.7, 1.3, 150);
      sparks(scene, x, y, 0xffaa00, 6, 150, 300);
    } else {
      hitStop(scene, 60); screenShake(scene, 2, 100); flashSprite(scene, sprite, 0xffffff, 100); squash(scene, sprite, 0.8, 1.2, 150);
      sparks(scene, x, y, 0xffff00, 3, 100, 200);
    }
  }

  function killEnemy(scene, x, y) {
    hitStop(scene, 100); screenShake(scene, 3, 100); slowMo(scene, 0.4, 250);
    sparks(scene, x, y, 0xaaaaaa, 8, 80, 400);
    deathPoof(scene, x, y);
  }

  function hurtPlayer(scene, sprite) {
    hitStop(scene, 150); screenShake(scene, 6, 200); flashSprite(scene, sprite, 0xff4040, 200);
    fullFlash(scene, 0xff0000, 0.35, 0, 250, 90);
    var x = alive(sprite) ? sprite.x : scene.cameras.main.midPoint.x;
    var y = alive(sprite) ? sprite.y : scene.cameras.main.midPoint.y;
    sparks(scene, x, y, 0xff0000, 5, 120, 300);
  }

  function healPlayer(scene, sprite) {
    if (alive(sprite)) {
      var steps = 3, i = 0;
      var step = function () {
        if (i >= steps) { if (alive(sprite)) sprite.clearTint(); return; }
        if (alive(sprite)) sprite.setTintFill(0x60ff80);
        scene.time.delayedCall(100, function () { if (alive(sprite)) sprite.clearTint(); scene.time.delayedCall(0, function () { i++; step(); }); });
      };
      step();
    }
    var x = alive(sprite) ? sprite.x : scene.cameras.main.midPoint.x;
    var y = alive(sprite) ? sprite.y : scene.cameras.main.midPoint.y;
    for (var k = 0; k < 3; k++) {
      var t = scene.add.text(x + (k - 1) * 14, y - 10, '+', { fontFamily: FONT, fontSize: '22px', color: '#60ff80', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5).setDepth(DEPTH);
      scene.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 500, onComplete: function () { kill(t); } });
    }
    healGlow(scene, x, y);
  }

  function shieldHit(scene, sprite) {
    hitStop(scene, 50); screenShake(scene, 2, 100); flashSprite(scene, sprite, 0x40a0ff, 150);
    var x = alive(sprite) ? sprite.x : scene.cameras.main.midPoint.x;
    var y = alive(sprite) ? sprite.y : scene.cameras.main.midPoint.y;
    sparks(scene, x, y, 0x40a0ff, 4, 110, 250);
  }

  function bossPhase(scene, bossSprite, label) {
    hitStop(scene, 200); screenShake(scene, 5, 300);
    fullFlash(scene, 0xff0000, 0.5, 0, 300, 90);
    var x = alive(bossSprite) ? bossSprite.x : scene.cameras.main.midPoint.x;
    var y = alive(bossSprite) ? bossSprite.y : scene.cameras.main.midPoint.y;
    radialBurst(scene, x, y, 0xff0000, 20, 160, 500, 4);
    var t = scene.add.text(scene.cameras.main.midPoint.x, scene.cameras.main.midPoint.y, label, { fontFamily: FONT, fontSize: '44px', color: '#ff4040', stroke: '#000000', strokeThickness: 6 }).setOrigin(0.5).setScrollFactor(0).setDepth(95).setScale(0.2).setAlpha(0);
    scene.tweens.add({ targets: t, scale: 1.2, alpha: 1, duration: 250, ease: 'Back.easeOut', onComplete: function () { scene.tweens.add({ targets: t, alpha: 0, duration: 650, delay: 100, onComplete: function () { kill(t); } }); } });
  }

  function lowHpBorder(scene, on) {
    if (!scene._vignette) {
      var key = '_fx_vignette';
      if (!scene.textures.exists(key)) {
        var cv = scene.textures.createCanvas(key, GAME_W, 540);
        var ctx = cv.getContext();
        var grad = ctx.createRadialGradient(GAME_W / 2, 270, 180, GAME_W / 2, 270, 560 * GAME_W / 960);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.85)');
        ctx.fillStyle = grad; ctx.fillRect(0, 0, GAME_W, 540);
        cv.refresh();
      }
      scene._vignette = scene.add.image(GAME_W / 2, 270, key).setOrigin(0.5).setScrollFactor(0).setDepth(94).setAlpha(0.2);
    }
    if (on) {
      if (scene._lowHp) return;
      var W = scene.scale.width, H = scene.scale.height, th = 12;
      var rects = [
        scene.add.rectangle(W / 2, th / 2, W, th, 0xff0000, 0.3).setOrigin(0.5).setScrollFactor(0).setDepth(95),
        scene.add.rectangle(W / 2, H - th / 2, W, th, 0xff0000, 0.3).setOrigin(0.5).setScrollFactor(0).setDepth(95),
        scene.add.rectangle(th / 2, H / 2, th, H, 0xff0000, 0.3).setOrigin(0.5).setScrollFactor(0).setDepth(95),
        scene.add.rectangle(W - th / 2, H / 2, th, H, 0xff0000, 0.3).setOrigin(0.5).setScrollFactor(0).setDepth(95)
      ];
      var tw = scene.tweens.add({ targets: rects, alpha: 0.45, duration: 500, yoyo: true, repeat: -1 });
      scene._lowHp = { rects: rects, tw: tw };
    } else {
      if (scene._lowHp) {
        scene._lowHp.tw.stop();
        for (var i = 0; i < scene._lowHp.rects.length; i++) kill(scene._lowHp.rects[i]);
        scene._lowHp = null;
      }
    }
  }

  function deathSequence(scene, player, onDone) {
    // Timeline (real time ms): 0 freeze+tint+slow-mo+zoom, 200 sprite shatters into 8 shards, 400 grayscale+vignette, 800 fade to black, 1200 onDone.
    var sprite = player && player.sprite ? player.sprite : player;
    var cam = scene.cameras.main;
    var later = function (ms, fn) { window.setTimeout(function () { try { fn(); } catch (e) { console.error(e); } }, ms); };
    if (alive(sprite)) {
      sprite.setTintFill(0x888888);
      if (sprite.body) { sprite.body.setVelocity(0, 0); sprite.body.setAllowGravity(false); }
    }
    slowMo(scene, 0.25, 400);
    cam.zoomTo(1.2, 300);
    screenShake(scene, 6, 300);
    later(200, function () {
      if (!alive(sprite)) return;
      var key = sprite.texture.key, fw = sprite.width / 2, fh = sprite.height / 4;
      for (var k = 0; k < 8; k++) {
        var cx = k % 2, cy = Math.floor(k / 2);
        var sh = scene.add.image(sprite.x, sprite.y, key).setScale(sprite.scaleX, sprite.scaleY).setDepth(60).setFlipX(sprite.flipX);
        sh.setCrop(cx * fw, cy * fh, fw, fh);
        sh.setTintFill(0x888888);
        var ox = ((cx - 0.5) * 2 + (Math.random() - 0.5)) * 60, oy = (cy - 1.5) * 25 + (Math.random() - 0.7) * 50;
        scene.tweens.add({ targets: sh, x: sprite.x + ox, y: sprite.y + oy + 60, angle: (Math.random() - 0.5) * 360, alpha: 0, duration: 700, ease: 'Quad.easeOut', onComplete: function () { this.targets[0].destroy(); } });
      }
      sprite.setVisible(false);
      radialBurst(scene, sprite.x, sprite.y, 0xff0000, 12, 150, 600, 3);
    });
    later(400, function () {
      if (cam.postFX && cam.postFX.addColorMatrix) { try { cam.postFX.addColorMatrix().grayscale(1); } catch (e) {} }
      fullFlash(scene, 0x000000, 0, 0.6, 400, 90);
    });
    later(800, function () { fullFlash(scene, 0x000000, 0.6, 1, 400, 91); });
    later(1200, function () { if (onDone) onDone(); });
  }

  function takeProfitAura(scene, p, durationMs) {
    var sp = p && p.sprite;
    if (!sp || !scene.sys.isActive()) return;

    var t0 = scene.time.now;
    var done = false;
    var silhouettes = [];
    var scales = [1.08, 1.16, 1.26];
    var alphas = [0.9, 0.5, 0.25];

    for (var i = 0; i < 3; i++) {
      var img = scene.add.image(sp.x, sp.y, sp.texture.key, sp.frame.name);
      img.setTintFill(0xffd24a);
      img.setDepth(sp.depth - 1);
      img.setAlpha(alphas[i]);
      img.setScale(sp.scaleX * scales[i], sp.scaleY * scales[i]);
      img.setFlipX(sp.flipX);
      silhouettes.push(img);
    }

    // Foot ring
    var ringG = scene.add.graphics().setDepth(sp.depth - 1);
    ringG.lineStyle(3, 0xffd24a, 1);
    ringG.strokeCircle(sp.x, sp.y + sp.displayHeight / 2, 20);
    scene.tweens.add({
      targets: ringG,
      alpha: 0,
      duration: 300,
      onUpdate: function (tw) {
        if (!scene.sys.isActive()) return;
        var p = tw.progress;
        ringG.clear();
        ringG.lineStyle(3, 0xffd24a, 1 - p);
        ringG.strokeCircle(sp.x, sp.y + sp.displayHeight / 2, 20 + p * 50);
      },
      onComplete: function () {
        if (ringG.active) ringG.destroy();
      }
    });

    function stop() {
      if (done) return;
      done = true;
      scene.events.off('update', tick);
      scene.events.off('shutdown', stop);
      for (var j = 0; j < silhouettes.length; j++) {
        if (silhouettes[j].active) silhouettes[j].destroy();
      }
      if (ringG.active) ringG.destroy();
    }

    function tick() {
      if (!scene.sys.isActive() || !alive(sp)) { stop(); return; }
      var t = scene.time.now - t0;
      var left = durationMs - t;
      if (left <= 0) { stop(); return; }

      var fade = 1;
      if (left < 250) fade = left / 250;
      var pulse = 0.85 + 0.15 * Math.sin(t / 400 * Math.PI * 2);

      for (var j = 0; j < silhouettes.length; j++) {
        var img = silhouettes[j];
        if (!img.active) continue;
        img.setPosition(sp.x, sp.y);
        img.setOrigin(sp.originX, sp.originY);
        img.setScale(sp.scaleX * scales[j], sp.scaleY * scales[j]);
        img.setFlipX(sp.flipX);
        img.setTexture(sp.texture.key, sp.frame.name);
        img.setAlpha(alphas[j] * pulse * fade);
      }
    }

    scene.events.on('update', tick);
    scene.events.once('shutdown', stop);
  }

  function goldPop(scene, p, amount) {
    var sp = p && p.sprite;
    if (!sp || !scene.sys.isActive()) return;

    // Create coin graphics
    var coinG = scene.add.graphics().setDepth(80);
    coinG.fillStyle(0xffd24a, 1);
    coinG.fillCircle(0, 0, 9);
    coinG.lineStyle(2, 0xb8860b, 1);
    coinG.strokeCircle(0, 0, 9);
    coinG.lineStyle(1, 0xfff1a8, 1);
    coinG.strokeCircle(0, 0, 5);

    // State for following logic
    var jumpOffset = 0; // How high the coin is currently bouncing above the head
    var startY = sp.y - sp.displayHeight / 2 - 8;
    
    // Initial position
    coinG.x = sp.x;
    coinG.y = startY;

    // Helper to clean up
    function cleanup() {
      scene.events.off('update', tick);
      if (coinG.active) coinG.destroy();
    }

    // Update loop to follow player
    function tick() {
      if (!scene.sys.isActive() || !sp.active) {
        cleanup();
        return;
      }
      var headY = sp.y - sp.displayHeight / 2 - 8;
      coinG.x = sp.x;
      coinG.y = headY - jumpOffset;
    }

    scene.events.on('update', tick);

    // Animation Sequence
    // 1. Bounce up 24px (140ms)
    scene.tweens.add({
      targets: coinG,
      y: startY - 24,
      duration: 140,
      ease: 'Quad.easeOut',
      onUpdate: function (tw) {
        // Calculate offset from base head position
        // The tween changes coinG.y. We need to know how much it moved relative to the *current* head position?
        // No, the requirement says: "set coin's y to head y minus current jump height".
        // The tween animates y from startY to startY-24.
        // So jumpOffset = startY - coinG.y.
        jumpOffset = startY - coinG.y;
      },
      onComplete: function () {
        if (!scene.sys.isActive()) { cleanup(); return; }
        // 2. Fall back to head (140ms)
        scene.tweens.add({
          targets: coinG,
          y: startY,
          duration: 140,
          ease: 'Quad.easeIn',
          onUpdate: function (tw) {
            jumpOffset = startY - coinG.y;
          },
          onComplete: function () {
            if (!scene.sys.isActive()) { cleanup(); return; }
            // 3. Bounce up 10px (90ms)
            scene.tweens.add({
              targets: coinG,
              y: startY - 10,
              duration: 90,
              ease: 'Quad.easeOut',
              onUpdate: function (tw) {
                jumpOffset = startY - coinG.y;
              },
              onComplete: function () {
                if (!scene.sys.isActive()) { cleanup(); return; }
                // 4. Fall back to head (90ms)
                scene.tweens.add({
                  targets: coinG,
                  y: startY,
                  duration: 90,
                  ease: 'Quad.easeIn',
                  onUpdate: function (tw) {
                    jumpOffset = startY - coinG.y;
                  },
                  onComplete: function () {
                    if (!scene.sys.isActive()) { cleanup(); return; }
                    // 5. Fade out (150ms)
                    scene.tweens.add({
                      targets: coinG,
                      alpha: 0,
                      duration: 150,
                      onComplete: function () {
                        cleanup();
                      }
                    });
                  }
                });
              }
            });
          }
        });
      }
    });
  }

  function stunDizzy(scene, ref, durationMs) {
    if (!scene || !ref || !ref.sprite || !ref.sprite.active) return;
    
    var g = scene.add.graphics().setDepth(40);
    var t0 = scene.time.now;
    var tween = null;

    function drawStar(g, x, y, rot, scale, alpha) {
      var outerR = 5 * scale;
      var innerR = 2.2 * scale;
      var pts = [];
      for (var i = 0; i < 10; i++) {
        var r = (i % 2 === 0) ? outerR : innerR;
        var a = rot + (i * Math.PI / 5);
        pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
      }
      g.fillStyle(0xffe066, alpha);
      g.lineStyle(1.5, 0xffb300, alpha);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (var j = 1; j < pts.length; j++) {
        g.lineTo(pts[j].x, pts[j].y);
      }
      g.closePath();
      g.fillPath();
      g.strokePath();
    }

    function stop() {
      if (tween && tween.stop) tween.stop();
      if (g && g.active) g.destroy();
    }

    tween = scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: durationMs,
      onUpdate: function (tw) {
        // Stop checks
        if (!scene.sys.isActive()) { stop(); return; }
        if (ref.dead || !ref.sprite || !ref.sprite.active) { stop(); return; }
        if (ref._launchState !== 'stun') { stop(); return; }

        var t = scene.time.now - t0;
        var left = durationMs - t;
        
        // Global fade out in last 150ms
        var globalAlpha = 1;
        if (left < 150) {
          globalAlpha = left / 150;
        }

        g.clear();
        g.setAlpha(globalAlpha);

        var cx = ref.sprite.x;
        var cy = ref.sprite.body.top - 8;
        
        // Orbit parameters
        var orbitSpeed = (Math.PI * 2) / 900; // rad per ms
        var selfRotSpeed = (Math.PI * 2) / 600; // rad per ms
        
        var stars = [];
        for (var i = 0; i < 3; i++) {
          var phase = i * (Math.PI * 2 / 3);
          var angle = t * orbitSpeed + phase;
          
          // Elliptical orbit: horizontal radius 18, vertical radius 6
          var sx = cx + 18 * Math.cos(angle);
          var sy = cy + 6 * Math.sin(angle);
          
          // Depth sorting: sin(angle) > 0 means bottom (front), sin(angle) < 0 means top (back)
          // We want to draw back stars first, then front stars.
          // So we sort by sin(angle) ascending.
          var depthVal = Math.sin(angle);
          
          // Scale and Alpha based on depth
          // Front (sin > 0): scale 1.2, alpha 1
          // Back (sin < 0): scale 0.8, alpha 0.7
          var isFront = depthVal >= 0;
          var scale = isFront ? 1.2 : 0.8;
          var alpha = isFront ? 1 : 0.7;
          
          var selfRot = t * selfRotSpeed;
          
          stars.push({ x: sx, y: sy, rot: selfRot, scale: scale, alpha: alpha, depth: depthVal });
        }
        
        // Sort by depth (back to front)
        stars.sort(function(a, b) { return a.depth - b.depth; });
        
        for (var k = 0; k < stars.length; k++) {
          var s = stars[k];
          drawStar(g, s.x, s.y, s.rot, s.scale, s.alpha);
        }
      },
      onComplete: function () {
        if (g && g.active) g.destroy();
      }
    });
  }

  return {
    hitSpark: hitSpark, slashArc: slashArc, examMax: examMax, nanoProcess: nanoProcess, nanoBurst: nanoBurst, damageNumber: damageNumber, deathPoof: deathPoof,
    explosionRing: explosionRing, healGlow: healGlow, dashTrail: dashTrail, telegraphCircle: telegraphCircle,
    telegraphRect: telegraphRect, simLayout: simLayout, simSignal: simSignal, screenShake: screenShake, levelClearFlash: levelClearFlash, shieldRing: shieldRing,
    burnFlame: burnFlame, hitStop: hitStop, slowMo: slowMo, flashSprite: flashSprite, squash: squash,
    hitEnemy: hitEnemy, killEnemy: killEnemy, hurtPlayer: hurtPlayer, healPlayer: healPlayer,
    shieldHit: shieldHit, bossPhase: bossPhase, lowHpBorder: lowHpBorder, deathSequence: deathSequence,
    stirFry: stirFry,
    takeProfit: takeProfit,
    takeProfitAura: takeProfitAura,
    goldPop: goldPop,
    stunDizzy: stunDizzy,
    STIR_FIRE: STIR_FIRE,
    VENDOR_ATK: VENDOR_ATK,
    AUNTIE_ATK: AUNTIE_ATK,
    auntieHitRect: auntieHitRect,
    vendorHitWidth: function (range) {
      var reach = Math.min(range * 0.8, VENDOR_ATK.reachMax);
      var flameReach = 10 + reach + VENDOR_ATK.wokW / 2 + VENDOR_ATK.flameFront;
      return Math.max(range, flameReach);
    }
  };
})();

// World-space rectangle of a physics body (the real hitbox, not the full art bounds)
function bodyRect(sprite) {
  var b = sprite.body;
  return new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height);
}

function makeSprite(scene, x, y, key, displayH, fallbackColor) {
  var texKey = key;
  if (!scene.textures.exists(key)) {
    var fbKey = '_fb_' + key;
    if (!scene.textures.exists(fbKey)) {
      var cv = scene.textures.createCanvas(fbKey, 32, 32);
      var ctx = cv.getContext();
      ctx.fillStyle = '#' + (fallbackColor || 0xff00ff).toString(16).padStart(6, '0');
      ctx.fillRect(0, 0, 32, 32);
      cv.refresh();
    }
    texKey = fbKey;
  }
  var tex = scene.textures.get(texKey);
  var src = tex.getSourceImage();
  var th = src.height || 32, tw = src.width || 32;
  var scale = displayH / th;
  var dispW = tw * scale;
  var sprite = scene.physics.add.sprite(x, y, texKey);
  sprite.setScale(scale);
  sprite.baseScaleX = scale;
  sprite.baseScaleY = scale;
  var bodyW = dispW * 0.6;
  var bodyH = displayH * 0.85;
  var bodyWpx = bodyW / scale;
  var bodyHpx = bodyH / scale;
  var offX = (tw - bodyWpx) / 2;
  var offY = th - bodyHpx;
  sprite.body.setSize(bodyWpx, bodyHpx);
  sprite.body.setOffset(offX, offY);
  return sprite;
}
