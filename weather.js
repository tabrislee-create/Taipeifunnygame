var WX = (function () {
  // SKY_LOOK: Configuration for sky-cut levels (transparent backdrops)
  // top/bottom: sky gradient colors
  // sat/bri: ColorMatrix adjustments for backdrop (WebGL) or Tint approximation (Canvas)
  // tint: Fallback tint color for Canvas renderer (approximates brightness/saturation)
  // overlayAlphaMult: Multiplier for existing weather overlays (0.35 means 35% opacity)
  var SKY_LOOK = {
    default: { top: 0x2f8fe8, bottom: 0xa8ddff, sat: 0, bri: 1, tint: null, overlayAlphaMult: 1 },
    sunny: { top: 0x2f8fe8, bottom: 0xa8ddff, sat: -0.45, bri: 0.88, tint: null, overlayAlphaMult: 1 },
    cloudy: { top: 0x6f7f90, bottom: 0xb4bec8, sat: -0.35, bri: 0.85, tint: 0xaaaaaa, overlayAlphaMult: 0.35 },
    drizzle: { top: 0x3e4856, bottom: 0x808b96, sat: -0.5, bri: 0.72, tint: 0x888888, overlayAlphaMult: 0.35 },
    rain: { top: 0x3e4856, bottom: 0x808b96, sat: -0.5, bri: 0.72, tint: 0x888888, overlayAlphaMult: 0.35 },
    thunder: { top: 0x262e3a, bottom: 0x5a6470, sat: -0.5, bri: 0.62, tint: 0x666666, overlayAlphaMult: 0.35 },
    typhoon: { top: 0x262e3a, bottom: 0x5a6470, sat: -0.5, bri: 0.62, tint: 0x666666, overlayAlphaMult: 0.35 },
    dusk: { top: 0x5b4a8c, bottom: 0xff9a5a, sat: 0, bri: 0.9, tint: 0xffc49a, overlayAlphaMult: 0.35 },
    night: { top: 0x050a24, bottom: 0x1c2a5a, sat: -0.3, bri: 0.45, tint: 0x8a9cff, overlayAlphaMult: 0.35 },
    fog: { top: 0x6f7f90, bottom: 0xb4bec8, sat: -0.35, bri: 0.85, tint: 0xaaaaaa, overlayAlphaMult: 0.35 }
  };

  // Sunny colour of the sky-cut backdrop (building + trees only; the sky is separate). Colour 1 = the original look, 2 = softer, 3 = softest.
  // Per level (user 2026-10-12): level 1 = colour 3, level 2 = colour 1, level 4 = colour 1, level 5 = colour 1; a level not listed uses colour 3.
  var SKY_COLOR = { 1: { sat: 0.1, bri: 1.05 }, 2: { sat: -0.25, bri: 0.92 }, 3: { sat: -0.45, bri: 0.88 } };
  var SKY_COLOR_OF_LEVEL = { 1: 3, 2: 1, 4: 1, 5: 1 };

  function getSkyLook(weatherId) {
    if (!weatherId) {   // sunny: backdrop colour comes from the level's colour preset
      var c = SKY_COLOR[SKY_COLOR_OF_LEVEL[RUN.level] || 3];
      var look = {}; for (var k in SKY_LOOK.sunny) look[k] = SKY_LOOK.sunny[k];
      look.sat = c.sat; look.bri = c.bri;
      return look;
    }
    return SKY_LOOK[weatherId] || SKY_LOOK.cloudy; // fallback to cloudy for unknown/fog
  }

  // Sunny sky effects for sky-cut levels (2026-10-11, tested via screenshot injection first): drifting anime clouds + sun beams from the top right.
  // Clouds: pieces cut from cloud sets 02 / 05 / 09 (assets/sky_clouds/), random mix, three layers far -> near.
  // Light: variant A = beams, B = beams + rainbow beams + sparkles; one picked at random per run (?sky=A or ?sky=B forces it). Brightness is half of the first test (user: 調淡).
  var SKY_PIECES = [
    ['r02_k1',373,227],['r02_k2',329,192],['r02_k3',57,50],['r02_k4',167,86],['r02_k5',57,42],['r02_k6',218,116],['r02_k7',182,95],['r02_k8',156,69],
    ['r02_k9',216,117],['r02_k10',70,43],['r02_k11',48,43],['r05_k1',66,52],['r05_k2',88,65],['r05_k3',90,70],['r05_k4',124,84],['r05_k5',76,47],
    ['r05_k6',51,53],['r05_k7',97,60],['r05_k8',66,53],['r05_k9',61,47],['r05_k10',60,48],['r05_k11',259,100],['r05_k12',83,46],['r05_k13',89,58],
    ['r05_k14',70,45],['r05_k15',67,48],['r05_k16',53,43],['r05_k17',60,50],['r05_k18',91,48],['r05_k19',54,47],['r05_k20',87,48],['r05_k21',58,49],
    ['r05_k22',181,83],['r05_k23',181,75],['r05_k24',71,44],['r05_k25',61,40],['r05_k26',83,44],['r05_k27',98,39],['r05_k28',93,39],['r05_k29',77,43],
    ['r05_k30',73,36],['r09_k1',49,84],['r09_k2',343,230],['r09_k3',57,53],['r09_k4',69,51],['r09_k5',86,80],['r09_k6',54,74],['r09_k7',84,55],
    ['r09_k8',135,85],['r09_k9',71,55],['r09_k10',50,52],['r09_k11',56,77],['r09_k12',55,64],['r09_k13',73,65],['r09_k14',68,56],['r09_k15',64,48],
    ['r09_k16',65,48]
  ];
  function skyPieceList() { return SKY_PIECES; }

  function skyBeamTex(scene, key, rainbow) {   // soft gaussian across the width, quick rise then long fade along the length
    if (scene.textures.exists(key)) return;
    var tw = 64, th = 512, t = scene.textures.createCanvas(key, tw, th), c = t.getContext(), img = c.createImageData(tw, th), d = img.data;
    for (var y = 0; y < th; y++) {
      var v = y / th, along = Math.min(1, v / 0.12) * Math.pow(1 - v, 1.6);
      for (var x = 0; x < tw; x++) {
        var u = (x + 0.5) / tw - 0.5, across = Math.exp(-u * u / (2 * 0.17 * 0.17)), r = 255, g = 250, b = 235;
        if (rainbow) {   // spectrum across the width, red outside -> violet inside
          var h = (x / tw) * 280, k = function (n) { var q = (n + h / 30) % 12; return 255 * (0.5 - 0.5 * Math.max(-1, Math.min(q - 3, 9 - q, 1))); };
          r = 0.9 * k(0) + 25; g = 0.9 * k(8) + 25; b = 0.9 * k(4) + 25;
        }
        var i = (y * tw + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255 * along * across;
      }
    }
    c.putImageData(img, 0, 0); t.refresh();
  }
  function skyDotTex(scene) {
    if (scene.textures.exists('sky_dot')) return;
    var t = scene.textures.createCanvas('sky_dot', 32, 32), c = t.getContext(), gr = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,250,0.8)'); gr.addColorStop(1, 'rgba(255,255,240,0)');
    c.fillStyle = gr; c.fillRect(0, 0, 32, 32); t.refresh();
  }

  // Builds the clouds + beams; ctx.skyObjs are destroyed with the weather, ctx.skyFx(time, dt) is called every frame from start()'s onUpdate.
  function buildSkyFx(scene, ctx, cloudsOnly) {   // cloudsOnly: the title / select / reward screens (user 2026-10-12): drifting clouds, no sun beams
    var objs = ctx.skyObjs = [], beams = [], dots = [], clouds = [];
    var pool = SKY_PIECES.filter(function (p) { return scene.textures.exists('skc_' + p[0]); });
    var LAYERS = [   // far -> near: smaller, lower, slower, fainter, less parallax (the backdrop itself uses 0.03)
      { n: 6, wMin: 60,  wMax: 130, yMin: 170, yMax: 300, vx: 5,  alpha: 0.75, pf: 0.006, depth: -28.3 },
      { n: 5, wMin: 120, wMax: 220, yMin: 90,  yMax: 230, vx: 9,  alpha: 0.9,  pf: 0.012, depth: -28.2 },
      { n: 3, wMin: 200, wMax: 340, yMin: 10,  yMax: 150, vx: 14, alpha: 1.0,  pf: 0.02,  depth: -28.1 }
    ];
    function spawn(c, L, anywhere) {
      var ok = pool.filter(function (p) { return p[1] * 1.1 >= L.wMin; });
      if (!ok.length) ok = [pool.reduce(function (a, b) { return a[1] > b[1] ? a : b; })];
      var p = ok[(Math.random() * ok.length) | 0];
      var sc = Math.min(1.1, rand(L.wMin, L.wMax) / p[1]);
      if (c.o) { objs.splice(objs.indexOf(c.o), 1); c.o.destroy(); }
      c.o = scene.add.image(0, 0, 'skc_' + p[0]).setScrollFactor(0).setDepth(L.depth).setScale(sc).setAlpha(0);
      objs.push(c.o);
      if (Math.random() < 0.5) c.o.setFlipX(true);
      c.w = p[1] * sc; c.sc = sc; c.L = L;
      c.bx = anywhere ? rand(-c.w / 2, W + c.w / 2) : -c.w / 2 - rand(0, 200);
      c.o.y = rand(L.yMin, L.yMax);
      c.age = 0; c.life = rand(25, 45); c.ph = rand(0, 6.28);
    }
    if (pool.length) LAYERS.forEach(function (L) {
      for (var k = 0; k < L.n; k++) { var c = {}; spawn(c, L, true); c.age = rand(3, 10); clouds.push(c); }
    });

    var q = (typeof location !== 'undefined') ? /[?&]sky=([AB])/.exec(location.search) : null;
    var variant = q ? q[1] : (Math.random() < 0.5 ? 'A' : 'B');
    ctx.skyVariant = variant;
    var AX = W * 1.12, AY = -420;   // far-away apex up and right of the screen: beams almost parallel, slightly fanned
    function addBeam(key, ang, width, len, alpha) {
      var o = scene.add.image(AX, AY, key).setOrigin(0.5, 0).setScrollFactor(0).setDepth(57)
        .setBlendMode(key === 'sky_rainbow' ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD);   // rainbow: normal blend, ADD washes it out to white on the light sky
      o.setDisplaySize(width, len); o.rotation = ang;
      objs.push(o); beams.push({ o: o, a0: alpha, ang0: ang, ph: rand(0, 6.28), sp: rand(0.6, 1.4) });
    }
    if (!cloudsOnly) skyBeamTex(scene, 'sky_beam', false);
    if (!cloudsOnly) for (var i = 0; i < 14; i++) addBeam('sky_beam', rand(0.38, 0.78), rand(40, 240), rand(1250, 1500), rand(0.09, 0.21));
    if (variant === 'B' && !cloudsOnly) {
      skyBeamTex(scene, 'sky_rainbow', true);
      for (var j = 0; j < 4; j++) addBeam('sky_rainbow', rand(0.42, 0.72), rand(40, 90), rand(1200, 1450), rand(0.16, 0.24));
      skyDotTex(scene);
      for (var m = 0; m < 45; m++) {
        var d = scene.add.image(rand(W * 0.25, W), rand(0, H * 0.8), 'sky_dot').setScrollFactor(0).setDepth(57).setBlendMode(Phaser.BlendModes.ADD);
        d.setScale(rand(0.15, 0.6));
        if (Math.random() < 0.3) d.setTint([0xffd6f0, 0xd6e8ff, 0xfff0c0][(Math.random() * 3) | 0]);
        objs.push(d); dots.push({ o: d, a0: rand(0.25, 0.5), ph: rand(0, 6.28), sp: rand(1.5, 4), vx: rand(-14, -6), vy: rand(10, 22) });
      }
    }

    ctx.skyFx = function (time, dt) {
      var cam = scene.cameras.main, ts = time * 0.001, n;
      for (n = 0; n < clouds.length; n++) {
        var c = clouds[n], L = c.L;
        if (!c.o || !c.o.active) continue;   // the scene was left and its objects destroyed (title / select screens do not call destroy())
        c.age += dt; c.bx += L.vx * dt;
        var x = c.bx - cam.scrollX * L.pf, span = W + c.w;
        x = ((x + c.w / 2) % span + span) % span - c.w / 2;
        c.o.x = x;
        c.o.setAlpha(L.alpha * Math.max(0, Math.min(1, c.age / 3, (c.life - c.age) / 3)));   // 3 s fade in / out
        c.o.scaleY = c.sc * (1 + 0.015 * Math.sin(time * 0.0004 + c.ph));                    // slow, slight swell
        if (c.age >= c.life) spawn(c, L, true);
      }
      for (n = 0; n < beams.length; n++) {   // slow breathing brightness + a tiny sway
        var b = beams[n];
        b.o.setAlpha(b.a0 * (0.65 + 0.35 * Math.sin(ts * 0.5 * b.sp + b.ph)));
        b.o.rotation = b.ang0 + 0.012 * Math.sin(ts * 0.15 * b.sp + b.ph);
      }
      for (n = 0; n < dots.length; n++) {    // sparkles drift down-left along the light and twinkle
        var s = dots[n], o = s.o;
        o.x += s.vx * dt; o.y += s.vy * dt;
        if (o.y > H * 0.85 || o.x < W * 0.15) { o.x = rand(W * 0.35, W + 20); o.y = rand(-10, H * 0.3); }
        o.setAlpha(s.a0 * Math.max(0, Math.sin(ts * s.sp + s.ph)));
      }
    };
  }

  var FONT = 'Microsoft JhengHei, PingFang TC, sans-serif';
  var W = GAME_W, H = GAME_H;
  var GROUND_Y = 400;
  var MAX = 40;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrapX(o) {
    if (o.x < -40) o.x += W + 80;
    else if (o.x > W + 40) o.x -= W + 80;
  }
  function wrapY(o) {
    if (o.y < -40) o.y += H + 80;
    else if (o.y > H + 40) o.y -= H + 80;
  }
  // Helper to create a puffy cloud made of overlapping circles (smoke-like)
  // Returns { gfx, puffs, halfW }
  function makePuffyCloud(scene, depth, isDark) {
    var g = scene.add.graphics();
    g.setScrollFactor(0).setDepth(depth);
    
    var puffs = [];
    // Randomize size per cloud
    // White: width 110-150, height 35-50. Dark: width 160-240, height 50-75.
    var wMin = isDark ? 160 : 110;
    var wMax = isDark ? 240 : 150;
    var hMin = isDark ? 50 : 35;
    var hMax = isDark ? 75 : 50;
    
    var cloudW = rand(wMin, wMax);
    var cloudH = rand(hMin, hMax);
    var halfW = cloudW / 2;
    
    var count = 8; // Main body puffs
    var bottomCount = 3; // Bottom shadow puffs
    
    // Generate main body puffs: horizontal distribution, thicker in middle
    for (var i = 0; i < count; i++) {
      // Distribute ox from -halfW*0.75 to halfW*0.75
      // Use a distribution that puts more mass in the center
      var normX = (i / (count - 1)) * 2 - 1; // -1 to 1
      var ox = normX * halfW * 0.75 + rand(-5, 5);
      
      // Radius: larger in center, smaller at ends
      // cos(normX * PI/2) is 1 at center, 0 at ends
      var rFactor = Math.cos(normX * Math.PI / 2);
      var baseR = (cloudH / 2) * (0.6 + 0.4 * rFactor); 
      var r0 = baseR * rand(0.9, 1.1);
      
      // Y offset: middle puffs higher (negative), ends near 0
      var oy = -Math.abs(normX) * (cloudH * 0.1) + rand(-2, 2);
      
      puffs.push({
        ox: ox,
        oy: oy,
        r0: r0,
        phase: rand(0, 6.28),
        speed: rand(0.5, 1.5),
        isBottom: false
      });
    }
    
    // Generate bottom shadow puffs (darker, lower, spread horizontally)
    for (var j = 0; j < bottomCount; j++) {
      var bx = (j - (bottomCount - 1) / 2) * (halfW * 0.5) + rand(-5, 5);
      var br = (cloudH / 2) * rand(0.5, 0.7);
      puffs.push({
        ox: bx,
        oy: cloudH * 0.25 + rand(-2, 2), // Lower than center
        r0: br,
        phase: rand(0, 6.28),
        speed: rand(0.5, 1.5),
        isBottom: true
      });
    }
    
    // Calculate actual half-width for wrapping based on outermost puff
    var maxExtent = 0;
    for (var k = 0; k < puffs.length; k++) {
      var ext = Math.abs(puffs[k].ox) + puffs[k].r0 * 1.3 * 1.1;
      if (ext > maxExtent) maxExtent = ext;
    }
    
    return { gfx: g, puffs: puffs, halfW: maxExtent };
  }
  function makeRay(scene, x, y, w, h, alpha) {
    var g = scene.add.graphics();
    g.fillStyle(0xffffff, alpha);
    g.fillTriangle(x, y, x + w, y, x + w * 0.5, y + h);
    g.setScrollFactor(0).setDepth(-14);
    return g;
  }
  function makeStar(scene, x, y, size, color) {
    var g = scene.add.graphics();
    g.fillStyle(color, 1);
    // Star shape centered at x,y for easier positioning if needed, but original used absolute coords in triangles
    // We keep original logic but allow depth override via wrapper if needed. 
    // For skyCut, we will just set depth after creation.
    g.fillTriangle(x - size, y, x + size, y, x, y - size * 2.2);
    g.fillTriangle(x - size, y, x + size, y, x, y + size * 2.2);
    g.fillTriangle(x, y - size, x, y + size, x - size * 2.2, y);
    g.fillTriangle(x, y - size, x, y + size, x + size * 2.2, y);
    g.setScrollFactor(0).setDepth(-11);
    return g;
  }
  function makeMist(scene, w, h, alpha) {
    var g = scene.add.graphics();
    g.fillStyle(0xdddddd, alpha);
    g.fillEllipse(0, 0, w, h);
    g.setScrollFactor(0).setDepth(-12);
    return g;
  }
  function makeLava(scene) {
    var g = scene.add.graphics();
    g.fillStyle(0xff4500, 0.4);
    g.fillRect(0, H - 40, W, 40);
    g.setScrollFactor(0).setDepth(-13);
    return g;
  }
  function makeSplash(scene, x, y) {
    var g = scene.add.graphics();
    g.fillStyle(0xaaaaaa, 0.7);
    g.fillCircle(0, 0, 2);
    g.setScrollFactor(0).setDepth(61);
    scene.tweens.add({
      targets: g, alpha: 0, scaleX: 2.5, scaleY: 2.5, duration: 200,
      onComplete: function () { g.destroy(); }
    });
  }

  function buildTheme(scene, themeId, ctx) {
    var t = themeId;
    if (t === 'forest' || t === 'title') {
      var cols = [0x4a7c59, 0xa8c24a];
      for (var i = 0; i < (t === 'title' ? 20 : 0); i++) {   // forest levels: leaves only on cloudy days (addFalling); title screen keeps its own
        var leaf = scene.add.rectangle(rand(0, W), rand(0, H), 4, 4, pick(cols), 1);
        leaf.setScrollFactor(0).setDepth(-11);
        ctx.parts.push({ o: leaf, baseX: leaf.x, phase: rand(0, 6.28), fall: 50 });
      }
      ctx.wind = 0; ctx.windTarget = 0; ctx.windTimer = rand(6, 10);
      for (var c = 0; c < 3; c++) {
        var clData = makePuffyCloud(scene, -15, false);
        clData.gfx.x = rand(0, W); clData.gfx.y = rand(30, 160);
        ctx.clouds.push({ 
          o: clData.gfx, 
          vx: 10, 
          puffs: clData.puffs, 
          halfW: clData.halfW,
          isDark: false
        });
      }
    } else if (t === 'orchard') {
      for (var i2 = 0; i2 < 15; i2++) {
        var pet = scene.add.circle(rand(0, W), rand(0, H), 3, 0xffb6c1, 1);
        pet.setScrollFactor(0).setDepth(-11);
        ctx.parts.push({ o: pet, baseX: pet.x, phase: rand(0, 6.28), fall: 30 });
      }
      for (var c2 = 0; c2 < 2; c2++) {
        var clData2 = makePuffyCloud(scene, -15, false);
        clData2.gfx.x = rand(0, W); clData2.gfx.y = rand(30, 160);
        ctx.clouds.push({ 
          o: clData2.gfx, 
          vx: 5, 
          puffs: clData2.puffs, 
          halfW: clData2.halfW,
          isDark: false
        });
      }
    } else if (t === 'desert') {
      for (var i3 = 0; i3 < 25; i3++) {
        var dust = scene.add.circle(rand(0, W), rand(0, H), 2, 0xd2b48c, 1);
        dust.setScrollFactor(0).setDepth(-11);
        ctx.parts.push({ o: dust, baseX: dust.x, phase: rand(0, 6.28), fall: 0, drift: 20, wob: 1 });
      }
      ctx.gustTimer = rand(12, 20); ctx.gustActive = false; ctx.gustLeft = 0;
    } else if (t === 'cave') {
      for (var i4 = 0; i4 < 10; i4++) {
        var mote = scene.add.circle(rand(0, W), rand(0, H), 1, 0xaaaaaa, 1);
        mote.setScrollFactor(0).setDepth(-11);
        ctx.parts.push({ o: mote, baseX: mote.x, phase: rand(0, 6.28), rise: 10 });
      }
      for (var s = 0; s < 6; s++) {
        var star = makeStar(scene, rand(0, W), rand(0, H), 4, 0xffffff);
        star.setAlpha(0);
        scene.tweens.add({
          targets: star, alpha: 1, duration: 1500, yoyo: true, repeat: -1,
          delay: rand(0, 1500), ease: 'Sine.easeInOut'
        });
        ctx.glints.push(star);
      }
    } else if (t === 'swamp') {
      for (var i5 = 0; i5 < 15; i5++) {
        var bub = scene.add.circle(rand(0, W), rand(0, H), 3, 0x88ccff, 0.6);
        bub.setStrokeStyle(1, 0x88ccff, 1);
        bub.setScrollFactor(0).setDepth(-11);
        ctx.parts.push({ o: bub, baseX: bub.x, phase: rand(0, 6.28), rise: 20 });
      }
      for (var m = 0; m < 3; m++) {
        var mist = makeMist(scene, 300, 60, 0.2);
        mist.x = rand(0, W); mist.y = rand(200, 420);
        ctx.clouds.push({ o: mist, vx: 5 });
      }
    } else if (t === 'volcano') {
      for (var i6 = 0; i6 < 20; i6++) {
        var ember = scene.add.circle(rand(0, W), rand(0, H), 2, 0xff4500, 1);
        ember.setScrollFactor(0).setDepth(-11);
        ctx.parts.push({ o: ember, baseX: ember.x, phase: rand(0, 6.28), rise: 40, life: 2, age: rand(0, 2) });
      }
      ctx.lava = makeLava(scene);
    } else if (t === 'sky') {
      for (var i7 = 0; i7 < 10; i7++) {
        var skyData = makePuffyCloud(scene, -15, false);
        skyData.gfx.x = rand(0, W); skyData.gfx.y = rand(20, 260);
        ctx.clouds.push({ 
          o: skyData.gfx, 
          vx: 30, 
          puffs: skyData.puffs, 
          halfW: skyData.halfW,
          isDark: false
        });
      }
      for (var r2 = 0; r2 < 3; r2++) {
        ctx.rays.push(makeRay(scene, rand(0, W), -20, 120, 300, 0.12));
      }
    } else if (t === 'night_village') {
      for (var i8 = 0; i8 < 15; i8++) {
        var ff = scene.add.circle(rand(0, W), rand(0, H), 2, 0xffff00, 1);
        ff.setScrollFactor(0).setDepth(-11);
        ctx.parts.push({ o: ff, baseX: ff.x, phase: rand(0, 6.28), blink: 1, drift: 10 });
      }
    }
  }

  function buildWeather(scene, weatherId, ctx) {
    var look = getSkyLook(weatherId);
    var mult = scene.skyCut ? look.overlayAlphaMult : 1;

    if (weatherId === 'rain') {
      var alpha = 0.14 * mult;
      var tint = scene.add.rectangle(GAME_W / 2, 270, GAME_W, 540, 0x203050, alpha).setScrollFactor(0).setDepth(59);
      ctx.rain.push({ o: tint, vx: 0, vy: 0, static: true });
      for (var i = 0; i < 55; i++) {
        var drop = scene.add.rectangle(rand(0, W), rand(0, H), 2, 16, 0xdde8ff, 0.8);
        drop.setScrollFactor(0).setDepth(60).setRotation(0.1745);
        ctx.rain.push({ o: drop, vx: 52, vy: 300 });
      }
    } else if (weatherId === 'sandstorm') {
      for (var j = 0; j < 40; j++) {
        var sd = scene.add.circle(rand(0, W), rand(0, H), 2, 0xd2b48c, 0.8);
        sd.setScrollFactor(0).setDepth(60);
        ctx.parts.push({ o: sd, baseX: sd.x, phase: rand(0, 6.28), fall: 0, drift: 100, wob: 1 });
      }
      var ov = scene.add.rectangle(W / 2, H / 2, W, H, 0xd2b48c, 0.12);
      ov.setScrollFactor(0).setDepth(60);
      ctx.overlay = ov;
    } else if (weatherId === 'cloudy') {
      ctx.rain.push({ o: scene.add.rectangle(W / 2, H / 2, W, H, 0x5a6878, 0.26 * mult).setScrollFactor(0).setDepth(59), vx: 0, vy: 0, static: true });
      for (var ci = 0; ci < 4; ci++) {
        var gcData = makePuffyCloud(scene, -15, true);
        // Clouds are not modified in this round per requirement
        gcData.gfx.x = rand(0, W); gcData.gfx.y = rand(40, 170);
        ctx.clouds.push({ 
          o: gcData.gfx, 
          vx: rand(14, 24), 
          puffs: gcData.puffs, 
          halfW: gcData.halfW,
          isDark: true
        });
      }
    } else if (weatherId === 'drizzle') {
      ctx.noSplash = true; ctx.rainy = true;
      ctx.rain.push({ o: scene.add.rectangle(W / 2, H / 2, W, H, 0x203050, 0.08 * mult).setScrollFactor(0).setDepth(59), vx: 0, vy: 0, static: true });
      for (var di = 0; di < 25; di++) {
        // Rain drops remain same
        var dd = scene.add.rectangle(rand(0, W), rand(0, H), 2, 12, 0xdde8ff, 0.55);
        dd.setScrollFactor(0).setDepth(60).setRotation(0.163);
        ctx.rain.push({ o: dd, vx: 28, vy: 170 });
      }
    } else if (weatherId === 'thunder' || weatherId === 'typhoon') {
      var ty = weatherId === 'typhoon';
      ctx.rainy = true; ctx.typhoon = ty;
      var baseAlpha = ty ? 0.26 : 0.2;
      var finalAlpha = baseAlpha * mult;
      ctx.rain.push({ o: scene.add.rectangle(W / 2, H / 2, W, H, ty ? 0x1a2438 : 0x203050, finalAlpha).setScrollFactor(0).setDepth(59), vx: 0, vy: 0, static: true });
      for (var ti = 0; ti < (ty ? 75 : 70); ti++) {
        var td = scene.add.rectangle(rand(0, W), rand(0, H), 2, 16, 0xdde8ff, 0.8);
        td.setScrollFactor(0).setDepth(60).setRotation(0.1745);
        ctx.rain.push({ o: td, vx: 52, vy: ty ? 340 : 320 });
      }
      if (ty) {
        ctx.windTimer = 1.5;                       // first gust comes quickly
        for (var pi = 0; pi < 10; pi++) {          // paper scraps / leaves blown across the screen
          var db = scene.add.rectangle(rand(0, W), rand(60, 400), 9, 5, pick([0xf4f0e0, 0xe0cf9a, 0x9bbf72]), 0.9);
          db.setScrollFactor(0).setDepth(61); ctx.fx.push({ o: db, kind: 'debris', ph: rand(0, 6.28) });
        }
      } else {
        ctx.flash = scene.add.rectangle(W / 2, H / 2, W, H, 0xffffff, 0).setScrollFactor(0).setDepth(62);
        ctx.flashTimer = rand(5, 10);
      }
    } else if (weatherId === 'fog') {
      var fogAlpha = 0.1 * mult;
      ctx.rain.push({ o: scene.add.rectangle(W / 2, H / 2, W, H, 0xdfe6ea, fogAlpha).setScrollFactor(0).setDepth(59), vx: 0, vy: 0, static: true });
      for (var fi = 0; fi < 7; fi++) {
        var fw = rand(500, 700), fg = scene.add.graphics(); fg.fillStyle(0xe6ecef, 0.26); fg.fillEllipse(0, 0, fw, rand(120, 180)); fg.setScrollFactor(0).setDepth(-12);
        fg.x = rand(0, W); fg.y = rand(250, 470); ctx.fx.push({ o: fg, kind: 'fog', vx: rand(-10, 10) || 6, w: fw });
      }
    } else if (weatherId === 'dusk') {
      var dAlpha1 = 0.15 * mult;
      var dAlpha2 = 0.08 * mult;
      ctx.rain.push({ o: scene.add.rectangle(W / 2, H / 2, W, H, 0xff8a3c, dAlpha1).setScrollFactor(0).setDepth(59), vx: 0, vy: 0, static: true });
      ctx.rain.push({ o: scene.add.rectangle(W / 2, 100, W, 200, 0xff5a8a, dAlpha2).setScrollFactor(0).setDepth(59), vx: 0, vy: 0, static: true });
    } else if (weatherId === 'night') {
      var nAlpha = 0.42 * mult;
      ctx.rain.push({ o: scene.add.rectangle(W / 2, H / 2, W, H, 0x0a1038, nAlpha).setScrollFactor(0).setDepth(59), vx: 0, vy: 0, static: true });
      for (var si = 0; si < 22; si++) {
        var star = makeStar(scene, rand(0, W), rand(10, 230), rand(1.5, 2.5), 0xfff2b0);
        if (scene.skyCut) star.setDepth(-28); // Behind buildings
        ctx.glints.push(star);
      }
    } else if (weatherId === 'petals') {
      addFalling(scene, ctx, 'petal');
    }
  }

  // Falling petals (sunny days only) / leaves (cloudy days only). Reuses the 'petal' fx kind (fall + sway + spin).
  function addFalling(scene, ctx, what) {
    var cols = what === 'leaf' ? [0x4a7c59, 0xa8c24a, 0xc89b3c] : [RUN.level === 23 ? 0xffffff : 0xf6b8c8];   // level 23 = tung-blossom park: white petals
    var n = what === 'leaf' ? 22 : 30;
    for (var qi = 0; qi < n; qi++) {
      var pt = scene.add.rectangle(rand(0, W), rand(0, H), what === 'leaf' ? 7 : 6, 4, pick(cols), 0.95); pt.setScrollFactor(0).setDepth(60);
      ctx.fx.push({ o: pt, kind: 'petal', baseX: pt.x, ph: rand(0, 6.28), fall: rand(35, 60) });
    }
  }

  function updateTheme(ctx, dt, time) {
    var t = ctx.themeId;
    var i, p;
    if (t === 'forest' || t === 'title') {
      ctx.windTimer -= dt;
      if (ctx.windTimer <= 0) {
        ctx.windTarget = rand(-60, 90);
        ctx.windTimer = rand(6, 10);
        ctx.scene.tweens.add({ targets: ctx, wind: ctx.windTarget, duration: 1500, ease: 'Sine.easeInOut' });
      }
      for (i = 0; i < ctx.parts.length; i++) {
        p = ctx.parts[i];
        p.o.y += p.fall * dt;
        p.o.x = p.baseX + Math.sin(time * 0.001 * 2 * Math.PI * 2 + p.phase) * 10 + ctx.wind * (time * 0.001);
        wrapY(p.o);
        if (p.o.x < -40) p.baseX += W + 80;
        else if (p.o.x > W + 40) p.baseX -= W + 80;
      }
    } else if (t === 'orchard') {
      for (i = 0; i < ctx.parts.length; i++) {
        p = ctx.parts[i];
        p.o.y += p.fall * dt;
        p.o.x = p.baseX + Math.sin(time * 0.001 * 2 * Math.PI + p.phase) * 15;
        wrapY(p.o);
      }
    } else if (t === 'desert') {
      ctx.gustTimer -= dt;
      if (ctx.gustTimer <= 0 && !ctx.gustActive) { ctx.gustActive = true; ctx.gustLeft = 2; }
      if (ctx.gustActive) { ctx.gustLeft -= dt; if (ctx.gustLeft <= 0) { ctx.gustActive = false; ctx.gustTimer = rand(12, 20); } }
      var mult = ctx.gustActive ? 3 : 1;
      for (i = 0; i < ctx.parts.length; i++) {
        p = ctx.parts[i];
        p.o.x += p.drift * mult * dt;
        p.o.y += Math.sin(time * 0.001 * 2 + p.phase) * 10 * dt;
        wrapX(p.o); wrapY(p.o);
      }
    } else if (t === 'cave') {
      for (i = 0; i < ctx.parts.length; i++) {
        p = ctx.parts[i];
        p.o.y -= p.rise * dt;
        p.o.x = p.baseX + Math.sin(time * 0.001 + p.phase) * 6;
        wrapY(p.o);
      }
    } else if (t === 'swamp') {
      for (i = 0; i < ctx.parts.length; i++) {
        p = ctx.parts[i];
        p.o.y -= p.rise * dt;
        p.o.x = p.baseX + Math.sin(time * 0.001 + p.phase) * 8;
        wrapY(p.o);
      }
    } else if (t === 'volcano') {
      for (i = 0; i < ctx.parts.length; i++) {
        p = ctx.parts[i];
        p.age += dt;
        if (p.age >= p.life) { p.age = 0; p.o.y = H + 10; p.baseX = rand(0, W); }
        p.o.y -= p.rise * dt;
        p.o.x = p.baseX + Math.sin(time * 0.001 * 2 * Math.PI * 3 + p.phase) * 5;
        p.o.alpha = 1 - (p.age / p.life);
        if (p.o.y < -10) { p.age = 0; p.o.y = H + 10; p.baseX = rand(0, W); }
      }
      if (ctx.lava) ctx.lava.setAlpha(0.45 + 0.15 * Math.sin(time * 0.001 * 2 * Math.PI));
    } else if (t === 'night_village') {
      for (i = 0; i < ctx.parts.length; i++) {
        p = ctx.parts[i];
        p.o.alpha = 0.5 + 0.5 * Math.sin(time * 0.001 * 2 * Math.PI * 2 + p.phase);
        p.o.x += Math.cos(time * 0.001 + p.phase) * p.drift * dt;
        p.o.y += Math.sin(time * 0.001 * 0.7 + p.phase) * p.drift * dt;
        wrapX(p.o); wrapY(p.o);
      }
    }
    for (i = 0; i < ctx.clouds.length; i++) {
      var cl = ctx.clouds[i];
      cl.o.x += cl.vx * dt;
      
      // Determine wrap boundary: use halfW if available (puffy clouds), else default 80 (mist)
      var boundary = cl.halfW ? cl.halfW : 80;
      
      if (cl.o.x > W + boundary) cl.o.x = -boundary;
      else if (cl.o.x < -boundary) cl.o.x = W + boundary;
      
      // If it has puffs, redraw it with breathing animation
      if (cl.puffs) {
        cl.o.clear();
        var ts = time * 0.001;
        
        // Colors based on type
        var outerColor, innerColor, bottomColor;
        var outerAlpha, innerAlpha, bottomAlpha;
        
        if (cl.isDark) {
          // Dark Cloud (Cloudy Weather)
          outerColor = 0x8894a4; outerAlpha = 0.3;
          innerColor = 0x5a6878; innerAlpha = 0.5;
          bottomColor = 0x4a5868; bottomAlpha = 0.4; // Darker bottom
        } else {
          // White Cloud (Themes)
          outerColor = 0xdddddd; outerAlpha = 0.4; // Slightly grey outer
          innerColor = 0xffffff; innerAlpha = 0.6; // Pure white inner
          bottomColor = 0xcccccc; bottomAlpha = 0.5; // Light grey bottom
        }
        
        for (var pi = 0; pi < cl.puffs.length; pi++) {
          var puff = cl.puffs[pi];
          // Breathing effect: slow sine wave on radius
          var breath = 1 + 0.1 * Math.sin(ts * puff.speed + puff.phase);
          var r = puff.r0 * breath;
          
          // Draw Outer (larger, lighter)
          cl.o.fillStyle(outerColor, outerAlpha);
          cl.o.fillCircle(puff.ox, puff.oy, r * 1.3);
          
          // Draw Inner (smaller, darker/solid)
          cl.o.fillStyle(innerColor, innerAlpha);
          cl.o.fillCircle(puff.ox, puff.oy, r);
          
          // Draw Bottom Shadow if applicable
          if (puff.isBottom) {
            cl.o.fillStyle(bottomColor, bottomAlpha);
            cl.o.fillCircle(puff.ox, puff.oy, r * 0.9);
          }
        }
      }
    }
  }

  function updateWeather(ctx, dt, time) {
    var i, r;
    if (ctx.typhoon) {
      ctx.windTimer -= dt;
      if (ctx.windTimer <= 0) {                    // new gust: rain slants first (0.6s), the push on the player follows 0.7s later
        var gt = rand(40, 90) * (Math.random() < 0.5 ? -1 : 1);
        ctx.windTimer = rand(3, 6);
        ctx.scene.tweens.add({ targets: ctx, slant: gt, duration: 600, ease: 'Sine.easeInOut' });
        ctx.scene.tweens.add({ targets: ctx, windNow: gt, delay: 700, duration: 900, ease: 'Sine.easeInOut' });
      }
      ctx.scene.windX = ctx.windNow;               // read by player.js while airborne
    }
    if (ctx.flash) {
      ctx.flashTimer -= dt;
      if (ctx.flashTimer <= 0) { ctx.flashTimer = rand(8, 15); ctx.flash.setAlpha(0.55); ctx.scene.tweens.add({ targets: ctx.flash, alpha: 0, duration: 150 }); }
    }
    for (i = 0; i < ctx.fx.length; i++) {
      var f = ctx.fx[i];
      if (f.kind === 'debris') {
        f.o.x += (ctx.slant * 3.5 + 25) * dt; f.o.y += Math.sin(time * 0.003 + f.ph) * 40 * dt; f.o.rotation += dt * 6;
        if (f.o.x > W + 40) f.o.x = -40; else if (f.o.x < -40) f.o.x = W + 40;
      } else if (f.kind === 'fog') {
        f.o.x += f.vx * dt;
        if (f.o.x > W + f.w / 2) f.o.x = -f.w / 2; else if (f.o.x < -f.w / 2) f.o.x = W + f.w / 2;
      } else if (f.kind === 'petal') {
        f.o.y += f.fall * dt; f.o.x = f.baseX + Math.sin(time * 0.002 + f.ph) * 18; f.o.rotation += dt * 2;
        if (f.o.y > H + 10) { f.o.y = -10; f.baseX = rand(0, W); }
      }
    }
    if (ctx.rainy || ctx.weatherId === 'rain') {
      for (i = 0; i < ctx.rain.length; i++) {
        r = ctx.rain[i];
        if (r.static) continue;
        if (ctx.typhoon) { r.vx = ctx.slant * 2.2; r.o.setRotation(Math.atan(r.vx / r.vy)); }
        r.o.x += r.vx * dt;
        r.o.y += r.vy * dt;
        if (r.o.y >= GROUND_Y) {
          if (!ctx.noSplash && ctx.splashCount < 6) {
            ctx.splashCount++;
            makeSplash(ctx.scene, r.o.x, GROUND_Y);
            ctx.scene.time.delayedCall(200, function () { ctx.splashCount--; });
          }
          r.o.y = -10; r.o.x = rand(0, W);
        }
        if (r.o.x > W + 20) r.o.x = -20; else if (r.o.x < -20) r.o.x = W + 20;
      }
    }
  }

  function start(scene, themeId, weatherId) {
    var ctx = {
      scene: scene, themeId: themeId, weatherId: weatherId,
      parts: [], clouds: [], rain: [], glints: [], rays: [],
      wind: 0, windTarget: 0, windTimer: 0,
      gustTimer: 0, gustActive: false, gustLeft: 0,
      lava: null, overlay: null, splashCount: 0,
      fx: [], rainy: false, noSplash: false, typhoon: false, slant: 0, windNow: 0, flash: null, flashTimer: 0,
      last: 0, destroyed: false
    };
    
    // Sky Cut Logic
    if (scene.skyCut) {
      var look = getSkyLook(weatherId);
      
      // 1. Sky Gradient (Depth -29)
      var skyG = scene.add.graphics();
      skyG.fillGradientStyle(look.top, look.top, look.bottom, look.bottom, 1);
      skyG.fillRect(0, 0, W, H);
      skyG.setScrollFactor(0).setDepth(-29);
      ctx.sky = skyG;

      // 2. Backdrop Tinting (Depth -20 is backdrop)
      var bd = scene.backdrop;
      if (bd && bd.active) {
        if (scene.renderer.type === Phaser.WEBGL && bd.postFX) {
          var cm = bd.postFX.addColorMatrix();
          if (look.sat !== 0) cm.saturate(look.sat);
          if (look.bri !== 1) cm.brightness(look.bri, true); // multiply
        } else {
          // Canvas fallback: use tint to approximate brightness/saturation
          if (look.tint) bd.setTint(look.tint);
        }
      }

      // 3. Sunny: drifting clouds + sun beams (buildSkyFx); the theme's circle clouds are removed below, after buildTheme
      if (!weatherId || weatherId === 'petals') buildSkyFx(scene, ctx);
    }

    scene.windX = 0;
    buildTheme(scene, themeId, ctx);
    if (weatherId) buildWeather(scene, weatherId, ctx);
    if (!ctx.skyFx && themeId === 'title') buildSkyFx(scene, ctx, true);   // title / select / reward screens: the new drifting clouds instead of the old circle clouds
    if (ctx.skyFx) { for (var ci = 0; ci < ctx.clouds.length; ci++) ctx.clouds[ci].o.destroy(); ctx.clouds = []; }   // sunny sky-cut: the new clouds replace the circle clouds
    var auto = !(typeof navigator !== 'undefined' && navigator.webdriver) && !(typeof location !== 'undefined' && /[?&]weather=/.test(location.search));
    if (auto && !weatherId && Math.random() < 0.4) addFalling(scene, ctx, 'petal');          // sunny: sometimes petals
    else if (auto && weatherId === 'cloudy' && Math.random() < 0.5) addFalling(scene, ctx, 'leaf');   // cloudy: sometimes leaves

    var onUpdate = function (time, delta) {
      if (ctx.destroyed) return;
      var dt = (delta || 16) / 1000;
      if (dt > 0.05) dt = 0.05;
      updateTheme(ctx, dt, time);
      updateWeather(ctx, dt, time);
      if (ctx.skyFx) ctx.skyFx(time, dt);
    };
    scene.events.on('update', onUpdate);

    return {
      destroy: function () {
        if (ctx.destroyed) return;
        ctx.destroyed = true;
        scene.events.off('update', onUpdate);
        
        // Cleanup Sky Cut Objects
        if (scene.skyCut) {
          if (ctx.sky) ctx.sky.destroy();
          if (ctx.skyObjs) { for (var so = 0; so < ctx.skyObjs.length; so++) ctx.skyObjs[so].destroy(); ctx.skyObjs = []; ctx.skyFx = null; }
          
          var bd = scene.backdrop;
          if (bd && bd.active) {
            if (bd.postFX) bd.postFX.clear();
            bd.clearTint();
          }
        }

        var i;
        for (i = 0; i < ctx.parts.length; i++) ctx.parts[i].o.destroy();
        for (i = 0; i < ctx.clouds.length; i++) ctx.clouds[i].o.destroy();
        for (i = 0; i < ctx.rain.length; i++) ctx.rain[i].o.destroy();
        for (i = 0; i < ctx.glints.length; i++) ctx.glints[i].destroy();
        for (i = 0; i < ctx.rays.length; i++) ctx.rays[i].destroy();
        for (i = 0; i < ctx.fx.length; i++) ctx.fx[i].o.destroy();
        if (ctx.flash) ctx.flash.destroy();
        scene.windX = 0;
        if (ctx.lava) ctx.lava.destroy();
        if (ctx.overlay) ctx.overlay.destroy();
      }
    };
  }

  // Per-level random weather (2026-10-09 plan). sunny = no overlay (35%); typhoon 10% on outdoor levels; fog only on mountain levels.
  var OUTDOOR = [1, 2, 3, 13, 15, 17, 27, 29, 30], MOUNTAIN = [5, 9, 10, 11, 22, 23, 29];
  function pickWeather(level) {
    if (window.DEMO) return null;   // trial build: sunny only (the random light / cloud mix of the sunny sky effects stays)
    if (WX.devWeather !== undefined) return WX.devWeather === 'none' ? null : WX.devWeather;   // forced from the title screen's developer menu (cleared on the title screen)
    var q = (typeof location !== 'undefined' && location.search.match(/[?&]weather=([a-z]+)/));
    if (q) return q[1] === 'none' ? null : q[1];                       // ?weather=typhoon etc. to force one
    if (typeof navigator !== 'undefined' && navigator.webdriver) return null;   // automated tests stay deterministic unless ?weather= is given
    var out = OUTDOOR.indexOf(level) >= 0, pool = ['cloudy', 'drizzle', 'dusk'];
    if (out) pool = pool.concat(['rain', 'thunder']);
    if (MOUNTAIN.indexOf(level) >= 0) pool.push('fog');
    var r = Math.random();
    if (r < 0.35) return null;
    if (out) { if (r < 0.45) return 'typhoon'; r = (r - 0.45) / 0.55; } else r = (r - 0.35) / 0.65;
    return pool[Math.min(pool.length - 1, (r * pool.length) | 0)];
  }

  var NAMES = { cloudy: '陰天', drizzle: '細雨', rain: '大雨', thunder: '雷陣雨', fog: '大霧', dusk: '黃昏', night: '夜晚', typhoon: '颱風', petals: '花瓣飄落' };
  function weatherName(id) { return id ? (NAMES[id] || id) : '晴天'; }

  // --- Soft Cloud Sample (2026-10-11) ---
  // Ensures the 'wx_puff' texture exists. Uses Canvas 2D API on a CanvasTexture.
  function ensurePuffTexture(scene) {
    if (scene.textures.exists('wx_puff')) return;
    var tex = scene.textures.createCanvas('wx_puff', 128, 128);
    var c = tex.getContext();
    var grad = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    // Smooth radial gradient: center opaque, edge transparent
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.75)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.3)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grad;
    c.fillRect(0, 0, 128, 128);
    tex.refresh();
  }

  // --- Realistic Cloud Module (Cloud 1) ---
  
  // Color configuration per weather type
  var CLOUD_LOOK = {
    sunny:   { light: 0xffffff, dark: 0xb4c0d0, alphaMult: 1.0 },
    cloudy:  { light: 0xc6ccd4, dark: 0x6a7482, alphaMult: 1.0 },
    drizzle: { light: 0x9aa2ac, dark: 0x4a525c, alphaMult: 1.0 },
    rain:    { light: 0x9aa2ac, dark: 0x4a525c, alphaMult: 1.0 },
    thunder: { light: 0x7e8792, dark: 0x353c46, alphaMult: 1.0 },
    typhoon: { light: 0x7e8792, dark: 0x353c46, alphaMult: 1.0 },
    dusk:    { light: 0xffcfa8, dark: 0x6a5878, alphaMult: 1.0 },
    night:   { light: 0x5c6884, dark: 0x262d42, alphaMult: 0.6 },
    fog:     { light: 0xc6ccd4, dark: 0x6a7482, alphaMult: 1.0 }
  };

  // Shape configuration per cloud type
  var CLOUD_TYPES = {
    T01: { wMin: 200, wMax: 280, hMin: 90, hMax: 120, coreCount: 16, edgeCount: 12 },
    T02: { wMin: 300, wMax: 400, hMin: 60, hMax: 60, coreCount: 0, edgeCount: 0, subClouds: true },
    T03: { wMin: 160, wMax: 200, hMin: 170, hMax: 230, coreCount: 22, edgeCount: 14 },
    T07: { wMin: 450, wMax: 650, hMin: 60, hMax: 100, grainCount: 75 }
  };

  function ensureBillowTextures(scene) {
    for (var i = 0; i < 4; i++) {
      var key = 'wx_billow' + i;
      if (scene.textures.exists(key)) continue;
      var tex = scene.textures.createCanvas(key, 128, 128);
      var c = tex.getContext();
      c.clearRect(0, 0, 128, 128);
      var count = 20 + Math.floor(Math.random() * 11);
      for (var j = 0; j < count; j++) {
        var angle = Math.random() * Math.PI * 2;
        var dist = Math.random() * 50;
        var cx = 64 + Math.cos(angle) * dist;
        var cy = 64 + Math.sin(angle) * dist;
        var r = 10 + Math.random() * 15;
        var grad = c.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.7, 'rgba(255,255,255,0.9)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = grad;
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.fill();
      }
      tex.refresh();
    }
  }

  function ensureGrainTexture(scene) {
    if (scene.textures.exists('wx_grain')) return;
    var tex = scene.textures.createCanvas('wx_grain', 24, 24);
    var c = tex.getContext();
    var grad = c.createRadialGradient(12, 12, 0, 12, 12, 12);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grad;
    c.fillRect(0, 0, 24, 24);
    tex.refresh();
  }

  function makeCloud2(scene, x, y, opts) {
    opts = opts || {};
    var type = opts.type || 'T01';
    var weather = opts.weather || null;
    var depth = opts.depth !== undefined ? opts.depth : -25;
    var scale = opts.scale || 1;
    
    ensureBillowTextures(scene);
    if (type === 'T07') ensureGrainTexture(scene);
    
    var look = CLOUD_LOOK[weather] || CLOUD_LOOK.sunny;
    var config = CLOUD_TYPES[type] || CLOUD_TYPES.T01;
    
    var images = [];
    var puffs = [];
    var cloudX = x;
    var cloudY = y;
    var globalAlphaMul = 1.0;
    var actualW = 0;
    var actualH = 0;
    var topFunc = null; // For T01
    var layers = []; // For T03

    function createPuffPair(ox, oy, size, isCore, isBottom) {
      var texKey = 'wx_billow' + ((Math.random() * 4) | 0);
      var rot = Math.random() * Math.PI * 2;
      var imgDark = scene.add.image(cloudX + ox, cloudY + oy, texKey);
      imgDark.setScrollFactor(0).setDepth(depth).setRotation(rot).setTint(look.dark).setAlpha(0);
      var imgLight = scene.add.image(cloudX + ox, cloudY + oy, texKey);
      imgLight.setScrollFactor(0).setDepth(depth + 0.001).setRotation(rot).setTint(look.light).setAlpha(0);
      images.push(imgDark, imgLight);
      var baseScale = (size / 128) * scale;
      puffs.push({
        ox: ox, oy: oy,
        imgDark: imgDark, imgLight: imgLight,
        baseScale: baseScale,
        isCore: isCore,
        isBottom: isBottom,
        life: Math.random(),
        period: 6 + Math.random() * 4,
        phase: Math.random() * Math.PI * 2,
        driftX: (Math.random() - 0.5) * 10,
        driftY: -(5 + Math.random() * 7),
        peakAlpha: isCore ? (0.9 + Math.random() * 0.1) : (0.7 + Math.random() * 0.1)
      });
    }

    if (type === 'T01') {
      actualW = rand(config.wMin, config.wMax);
      actualH = rand(config.hMin, config.hMax);
      var w = actualW, h = actualH;
      var y0 = h * 0.35;
      
      // Generate Gaussian bumps for top(x)
      var bumps = [];
      var numBumps = 2 + Math.floor(Math.random() * 2); // 2 or 3
      for (var b = 0; b < numBumps; b++) {
        var cx = (Math.random() - 0.5) * 0.6 * w; // [-0.3w, 0.3w]
        var width = rand(0.18, 0.28) * w;
        var height = rand(0.6, 1.0);
        if (b === Math.floor(numBumps/2)) height = 1.0; // Middle highest
        bumps.push({ cx: cx, width: width, height: height });
      }
      
      topFunc = function(x) {
        var sum = 0;
        for (var i = 0; i < bumps.length; i++) {
          var d = (x - bumps[i].cx) / bumps[i].width;
          sum += bumps[i].height * Math.exp(-d * d);
        }
        var B = Math.min(1, Math.max(0, sum));
        return y0 - h * (0.35 + 0.65 * B);
      };

      // Core puffs
      for (var i = 0; i < config.coreCount; i++) {
        var px = (Math.random() - 0.5) * 0.8 * w; // [-0.4w, 0.4w]
        var r = rand(20, 35); // size/2
        var topY = topFunc(px);
        var minY = topY + r * 0.6;
        var maxY = y0 - r * 0.5;
        var py = minY > maxY ? maxY : rand(minY, maxY);
        var isBottom = py > y0 - h * 0.3;
        createPuffPair(px, py, r * 2, true, isBottom);
      }
      
      // Edge puffs
      for (var j = 0; j < config.edgeCount; j++) {
        var ex = (Math.random() - 0.5) * 0.9 * w; // [-0.45w, 0.45w]
        var er = rand(15, 30);
        var ey = topFunc(ex) + er * 0.3;
        createPuffPair(ex, ey, er * 2, false, false);
      }
    } else if (type === 'T03') {
      actualW = rand(config.wMin, config.wMax);
      actualH = rand(config.hMin, config.hMax);
      var w3 = actualW, h3 = actualH;
      var y0 = h3 * 0.35;
      var r0 = 35; // Avg radius
      
      // Define 5 layers
      for (var k = 0; k < 5; k++) {
        var yk = y0 - r0 - k * (h3 - 2 * r0) / 4;
        var wk = w3 * (1 - 0.16 * k);
        var sizek = 70 - k * 3.75; // 70 to 55
        if (k === 4 && Math.random() < 0.3) sizek = 80; // Top bump
        layers.push({ y: yk, w: wk, size: sizek });
      }
      
      // Distribute core puffs (22 total)
      var corePerLayer = [5, 5, 4, 4, 4]; // Sum 22
      for (var l = 0; l < 5; l++) {
        var layer = layers[l];
        for (var c = 0; c < corePerLayer[l]; c++) {
          var r = layer.size / 2;
          var px = (Math.random() - 0.5) * (layer.w - r * 2);
          var py = layer.y + (Math.random() - 0.5) * r * 0.6;
          var isBottom = py > y0 - h3 * 0.3;
          createPuffPair(px, py, layer.size, true, isBottom);
        }
      }
      
      // Edge puffs (14 total, mostly top 3 layers)
      var edgePerLayer = [0, 0, 4, 5, 5]; // Sum 14
      for (var l2 = 0; l2 < 5; l2++) {
        var layer2 = layers[l2];
        for (var e = 0; e < edgePerLayer[l2]; e++) {
          var r2 = layer2.size / 2;
          var side = Math.random() < 0.5 ? -1 : 1;
          var px2 = side * (layer2.w / 2 - r2 * 0.2);
          var py2 = layer2.y + (Math.random() - 0.5) * r2 * 0.5;
          if (l2 === 4 && Math.random() < 0.5) { // Top center
             px2 = (Math.random() - 0.5) * layer2.w * 0.5;
             py2 = layer2.y - r2 * 0.5;
          }
          createPuffPair(px2, py2, layer2.size, false, false);
        }
      }
    } else if (type === 'T02') {
      var numSub = 3 + Math.floor(Math.random() * 4);
      var minX = 9999, maxX = -9999, minY = 9999, maxY = -9999;
      for (var s = 0; s < numSub; s++) {
        var subX = (Math.random() - 0.5) * 350;
        var subY = (Math.random() - 0.5) * 60;
        var subW = rand(50, 100);
        var subH = rand(25, 45);
        minX = Math.min(minX, subX - subW/2); maxX = Math.max(maxX, subX + subW/2);
        minY = Math.min(minY, subY - subH/2); maxY = Math.max(maxY, subY + subH/2);
        
        var subCore = 4 + Math.floor(Math.random() * 3);
        var subEdge = 2 + Math.floor(Math.random() * 3);
        for (var sc = 0; sc < subCore; sc++) {
          var sx = subX + (Math.random() - 0.5) * subW * 0.6;
          var sy = subY + (Math.random() - 0.5) * subH * 0.6;
          createPuffPair(sx, sy, rand(20, 40), true, sy > subY);
        }
        for (var se = 0; se < subEdge; se++) {
          var ex2 = subX + (Math.random() - 0.5) * subW;
          var ey2 = subY + (Math.random() - 0.5) * subH;
          createPuffPair(ex2, ey2, rand(15, 30), false, false);
        }
      }
      actualW = maxX - minX;
      actualH = maxY - minY;
    } else if (type === 'T07') {
      actualW = rand(config.wMin, config.wMax);
      actualH = rand(config.hMin, config.hMax);
      var w7 = actualW, h7 = actualH;
      var count7 = config.grainCount;
      for (var g = 0; g < count7; g++) {
        var gx = (Math.random() - 0.5) * w7;
        var gy = (Math.random() - 0.5) * h7 + Math.sin(gx * 0.02) * 20;
        var img = scene.add.image(cloudX + gx, cloudY + gy, 'wx_grain');
        img.setScrollFactor(0).setDepth(depth).setTint(look.light).setAlpha(0);
        images.push(img);
        puffs.push({
          ox: gx, oy: gy,
          imgDark: null, imgLight: img,
          baseScale: rand(6, 14) / 24,
          isCore: false, isBottom: false,
          life: Math.random(),
          period: 8 + Math.random() * 6,
          phase: Math.random() * Math.PI * 2,
          driftX: 0, driftY: 0,
          peakAlpha: rand(0.25, 0.55)
        });
      }
    }

    var onUpdate = function (time, delta) {
      var dt = (delta || 16) / 1000;
      if (dt > 0.05) dt = 0.05;
      var ts = time * 0.001;
      
      for (var k = 0; k < puffs.length; k++) {
        var p = puffs[k];
        p.life += dt / p.period;
        if (p.life >= 1) {
          p.life = 0;
          if (!p.isCore && type !== 'T07') {
             // Respawn edge puffs on the shape
             if (type === 'T01' && topFunc) {
                var w = actualW;
                var ex = (Math.random() - 0.5) * 0.9 * w;
                var er = rand(15, 30);
                p.ox = ex;
                p.oy = topFunc(ex) + er * 0.3;
             } else if (type === 'T03' && layers.length > 0) {
                var lIdx = 2 + Math.floor(Math.random() * 3); // Top 3 layers
                var layer = layers[lIdx];
                var r2 = layer.size / 2;
                var side = Math.random() < 0.5 ? -1 : 1;
                p.ox = side * (layer.w / 2 - r2 * 0.2);
                p.oy = layer.y + (Math.random() - 0.5) * r2 * 0.5;
             }
          }
        }
        
        var l = p.life;
        var alpha = 0;
        var scale = p.baseScale;
        var px = cloudX + p.ox;
        var py = cloudY + p.oy;
        
        if (p.isCore) {
          var breath = 1 + 0.06 * Math.sin(ts * (2 * Math.PI / p.period) + p.phase);
          scale *= breath;
          alpha = p.peakAlpha;
        } else if (type === 'T07') {
          alpha = p.peakAlpha * Math.sin(l * Math.PI);
        } else {
          alpha = p.peakAlpha * Math.sin(l * Math.PI);
          scale *= (0.8 + 0.4 * l);
          px += p.driftX * l;
          py += p.driftY * l;
        }
        
        alpha *= globalAlphaMul * look.alphaMult;
        
        if (p.imgDark) {
          p.imgDark.setPosition(px, py + p.baseScale * 128 * 0.1);
          p.imgDark.setScale(scale * 1.05);
          p.imgDark.setAlpha(alpha);
        }
        if (p.imgLight) {
          var lightAlpha = alpha;
          // Bottom darkening: if center is in bottom 30% of cloud height
          if (p.isCore && p.oy > actualH * 0.35 - actualH * 0.3) {
             lightAlpha *= 0.45;
          }
          p.imgLight.setPosition(px - p.baseScale * 128 * 0.08, py - p.baseScale * 128 * 0.08);
          p.imgLight.setScale(scale * 0.92);
          p.imgLight.setAlpha(lightAlpha);
        }
      }
    };
    
    scene.events.on('update', onUpdate);
    
    var cleanup = function () {
      scene.events.off('update', onUpdate);
      for (var m = 0; m < images.length; m++) {
        images[m].destroy();
      }
      images = [];
      puffs = [];
    };
    
    scene.events.once('shutdown', cleanup);
    
    return {
      setPosition: function (nx, ny) {
        cloudX = nx;
        cloudY = ny;
      },
      setAlphaMul: function (a) {
        globalAlphaMul = a;
      },
      getBounds: function () {
        return { x: cloudX - actualW/2, y: cloudY - actualH/2, w: actualW, h: actualH };
      },
      destroy: cleanup
    };
  }

  // Creates a soft, animated cloud made of overlapping puff images.
  // Returns { destroy: function }
  function makeSoftCloud(scene, x, y, opts) {
    opts = opts || {};
    ensurePuffTexture(scene);
    
    var w = opts.w || 200;
    var h = opts.h || 70;
    var isDark = opts.dark || false;
    var depth = opts.depth !== undefined ? opts.depth : -25;
    
    var images = [];
    var puffs = [];
    var anchors = [];
    
    // Helper to calculate tint based on vertical position (anchor.y)
    function tintFor(anchorY) {
      var normY = (anchorY + h/2) / h; // 0 (top) to 1 (bottom)
      normY = Math.max(0, Math.min(1, normY));
      
      var colorTop, colorBot;
      if (isDark) {
        colorTop = 0x5f6b7a;
        colorBot = 0x2c3440;
      } else {
        colorTop = 0xffffff;
        colorBot = 0xd6dde6;
      }
      
      // Simple linear interpolation for tint
      var r1 = (colorTop >> 16) & 0xff, g1 = (colorTop >> 8) & 0xff, b1 = colorTop & 0xff;
      var r2 = (colorBot >> 16) & 0xff, g2 = (colorBot >> 8) & 0xff, b2 = colorBot & 0xff;
      var r = Math.round(r1 + (r2 - r1) * normY);
      var g = Math.round(g1 + (g2 - g1) * normY);
      var b = Math.round(b1 + (b2 - b1) * normY);
      return (r << 16) | (g << 8) | b;
    }
    
    var puffCount = 30;
    var baseSize = h * 1.3; // Base diameter reference
    var puffRadius = baseSize / 2;

    // Define anchors for a wide cumulus shape (two bumps, flat bottom)
    // Anchor range scaled down so that (anchor_extent + puff_radius) ~= opts.w/h
    // X: outermost ~ ±(w/2 - radius*0.7), Y: top ~ -(h/2 - radius*0.5), bottom ~ +(h/2 - radius*0.7)
    var maxAbsX = Math.max(w * 0.1, w / 2 - puffRadius * 0.7);
    var maxAbsYTop = Math.max(h * 0.05, h / 2 - puffRadius * 0.5);
    var maxAbsYBot = Math.max(h * 0.05, h / 2 - puffRadius * 0.7);

    // Bottom row (flat) - 6 anchors
    for (var i = 0; i < 6; i++) {
      var bx = (i - 2.5) * (maxAbsX / 2.5);
      anchors.push({ x: bx, y: maxAbsYBot });
    }
    // Left bump - 4 anchors
    anchors.push({ x: -maxAbsX * 0.8, y: -maxAbsYTop * 0.3 });
    anchors.push({ x: -maxAbsX * 0.5, y: -maxAbsYTop * 0.8 });
    anchors.push({ x: -maxAbsX * 0.2, y: -maxAbsYTop * 0.6 });
    anchors.push({ x: -maxAbsX * 0.1, y: -maxAbsYTop * 0.2 });
    // Right bump - 4 anchors
    anchors.push({ x: maxAbsX * 0.1, y: -maxAbsYTop * 0.2 });
    anchors.push({ x: maxAbsX * 0.2, y: -maxAbsYTop * 0.6 });
    anchors.push({ x: maxAbsX * 0.5, y: -maxAbsYTop * 0.8 });
    anchors.push({ x: maxAbsX * 0.8, y: -maxAbsYTop * 0.3 });
    // Center top - 2 anchors
    anchors.push({ x: 0, y: -maxAbsYTop * 0.9 });
    anchors.push({ x: 0, y: -maxAbsYTop * 0.4 });
    
    // Total anchors: 6 + 4 + 4 + 2 = 16
    
    for (var k = 0; k < puffCount; k++) {
      var img = scene.add.image(x, y, 'wx_puff');
      img.setScrollFactor(0).setDepth(depth);
      
      // Assign random anchor
      var anchor = anchors[(Math.random() * anchors.length) | 0];
      
      // Life cycle params
      var period = 4 + Math.random() * 3; // 4-7 seconds
      var life = Math.random(); // Start at random phase
      
      img.setTint(tintFor(anchor.y));
      
      images.push(img);
      puffs.push({
        img: img,
        anchor: anchor,
        life: life,
        period: period,
        driftX: (Math.random() - 0.5) * 10, // ±5px
        driftY: -(3 + Math.random() * 5),   // -3 to -8px (up)
        peakAlpha: 0.75 + Math.random() * 0.10 // 0.75-0.85
      });
    }
    
    var onUpdate = function (time, delta) {
      var dt = (delta || 16) / 1000;
      if (dt > 0.05) dt = 0.05;
      
      for (var j = 0; j < puffs.length; j++) {
        var p = puffs[j];
        p.life += dt / p.period;
        
        if (p.life >= 1) {
          p.life = 0;
          // Respawn at random anchor
          p.anchor = anchors[(Math.random() * anchors.length) | 0];
          p.img.setTint(tintFor(p.anchor.y));
        }
        
        var l = p.life;
        // Alpha: sin(life * PI) -> 0 at 0 and 1, peak at 0.5
        var alpha = p.peakAlpha * Math.sin(l * Math.PI);
        
        // Scale: grow from 0.6 to 1.0 of baseSize
        var scale = (0.6 + 0.4 * l) * (baseSize / 128); // 128 is texture size
        
        // Position: anchor + drift
        var px = x + p.anchor.x + p.driftX * l;
        var py = y + p.anchor.y + p.driftY * l;
        
        p.img.setPosition(px, py);
        p.img.setScale(scale);
        p.img.setAlpha(alpha);
      }
    };
    
    scene.events.on('update', onUpdate);
    
    var cleanup = function () {
      scene.events.off('update', onUpdate);
      for (var m = 0; m < images.length; m++) {
        images[m].destroy();
      }
    };
    
    scene.events.once('shutdown', cleanup);
    
    return {
      destroy: cleanup
    };
  }

  return { start: start, pick: pickWeather, name: weatherName, softCloud: makeSoftCloud, cloud2: makeCloud2, skyPieces: skyPieceList, skyLook: getSkyLook };
})();
