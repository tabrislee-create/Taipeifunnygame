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
    fog: { top: 0x6f7f90, bottom: 0xb4bec8, sat: -0.35, bri: 0.85, tint: 0xaaaaaa, overlayAlphaMult: 0.35 }
  };

  // Two axes (user 2026-10-12): TIME (day / dusk / night) and WEATHER (null = clear, cloudy, drizzle, rain, thunder, fog, typhoon, petals). A condition is { time, wx }.
  // TIME_LOOK = the sky / backdrop look of dusk and night (day uses SKY_LOOK: the level's sunny colour preset, or the weather's own look).
  var TIME_LOOK = {
    dusk: { top: 0x5b4a8c, bottom: 0xff9a5a, sat: 0, bri: 0.9, tint: 0xffc49a, overlayAlphaMult: 0.35 },
    night: { top: 0x050a24, bottom: 0x1c2a5a, sat: -0.3, bri: 0.45, tint: 0x8a9cff, overlayAlphaMult: 0.35 }
  };
  // Levels whose picture is already painted at night / dusk (level 6's night market, every stall lit; user 2026-10-12): the time only changes the sky (gradient + stars), the backdrop keeps its own colours (no brightness / saturation change, no dark overlay).
  var BACKDROP_TIMELESS = { 6: true };
  // Drizzle drop look: width / length in px, opacity (user 2026-10-12: finer and more transparent, variant C picked; was 2 x 12, 0.55).
  var DRIZZLE = { w: 1, h: 10, a: 0.18 };
  // Rain / thunder / typhoon drop look: width / length in px, opacity (current values; user 2026-10-12 asked to tune the three together).
  var STORM = { rain: { w: 1, h: 16, a: 0.4 }, thunder: { w: 1.5, h: 16, a: 0.6 }, typhoon: { w: 2, h: 16, a: 0.8 } };   // user 2026-10-12: rain = variant B, thunder = variant A (typhoon uses TYPHOON_DROPS below)
  // Typhoon: a dense mix of fine / medium / heavy drops (user 2026-10-12: "大雨小雨中雨各種密密麻麻"); bigger drops fall faster and are more opaque.
  var TYPHOON_DROPS = [ { n: 450, w: 1, h: 10, a: 0.22, vy: 300 }, { n: 400, w: 1.5, h: 16, a: 0.45, vy: 350 }, { n: 275, w: 2.5, h: 24, a: 0.7, vy: 420 } ];
  // Thunder: same layers as typhoon but half the count (user 2026-10-13: rain amount = half of typhoon).
  var THUNDER_DROPS = TYPHOON_DROPS.map(function (L) { return { n: Math.round(L.n / 2), w: L.w, h: L.h, a: L.a, vy: L.vy }; });
  // Brightness multiplier of the picture under drizzle / rain on those levels (default = the weather's own look, 0.72 / 0.88 = 0.82; user 2026-10-12 asked to try 0.88 and 0.95 on level 6). Other weathers are tuned later.
  var RAIN_BRI_OF_LEVEL = { 6: 0.95 };   // level 6: x0.95 chosen by the user 2026-10-12 (x0.82 / x0.88 / x0.95 compared)
  // A level without a transparent-sky picture (every level except 1-6) has no clouds at all (user 2026-10-12): the cloud pictures would hang in front of its opaque backdrop.
  function noCloudScene(scene) { return scene.scene.key === 'Level' && !scene.skyCut; }
  // Time-only levels (user 2026-10-12): the random pick only draws from these.
  var TIMES_OF_LEVEL = { 6: ['night'] };
  function normCond(c) {   // { time, wx }; a bare string is a legacy weather id; undefined = clear day
    if (c && typeof c === 'object') return { time: c.time || 'day', wx: c.wx || null };
    return { time: 'day', wx: c || null };
  }
  function mixColor(a, b, t) {
    var r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t, g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t, bl = (a & 255) * (1 - t) + (b & 255) * t;
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
  }

  // Sunny colour of the sky-cut backdrop (building + trees only; the sky is separate). Colour 1 = the original look, 2 = softer, 3 = softest.
  // Per level (user 2026-10-12): level 1 = colour 3, level 2 = colour 1, level 4 = colour 1, level 5 = colour 1, level 18 = colour 1 (user 2026-10-13: the Ximending rainbow crossing should show many colours); a level not listed uses colour 3.
  var SKY_COLOR = { 1: { sat: 0.1, bri: 1.05 }, 2: { sat: -0.25, bri: 0.92 }, 3: { sat: -0.45, bri: 0.88 } };
  var SKY_COLOR_OF_LEVEL = { 1: 3, 2: 1, 4: 1, 5: 1, 18: 1 };

  function getSkyLook(cond) {
    cond = normCond(cond);
    var wl = cond.wx ? (SKY_LOOK[cond.wx] || SKY_LOOK.cloudy) : null;   // unknown weather falls back to cloudy
    if (cond.time === 'day') {
      if (wl) return wl;
      var c = SKY_COLOR[SKY_COLOR_OF_LEVEL[RUN.level] || 3];   // clear day: backdrop colour comes from the level's colour preset
      var look = {}; for (var k in SKY_LOOK.sunny) look[k] = SKY_LOOK.sunny[k];
      look.sat = c.sat; look.bri = c.bri;
      return look;
    }
    var tl = TIME_LOOK[cond.time], out = {};
    for (var key in tl) out[key] = tl[key];
    if (BACKDROP_TIMELESS[RUN.level]) { out.sat = 0; out.bri = 1; out.tint = null; }   // sky colours stay; the backdrop is left as painted
    if (!wl) return out;
    // time + weather: the weather greys and dims the time's look (grey sky colour scaled by how bright the time is, then half-mixed in)
    var dim = Math.min(1, tl.bri / 0.9), sc = function (col) { return mixColor(0x000000, col, dim); };
    out.top = mixColor(tl.top, sc(wl.top), 0.5); out.bottom = mixColor(tl.bottom, sc(wl.bottom), 0.5);
    var rainBri = BACKDROP_TIMELESS[RUN.level] && (cond.wx === 'rain' || cond.wx === 'drizzle') ? RAIN_BRI_OF_LEVEL[RUN.level] : undefined;
    out.sat = Math.max(-1, out.sat + wl.sat * 0.5); out.bri = out.bri * (rainBri !== undefined ? rainBri : wl.bri / SKY_LOOK.sunny.bri);
    return out;
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
  // Tint / alpha / count of the drifting clouds for a condition: the time's cloud colour times the weather's (CLOUD_LOOK light colours), so night = dark blue-grey, dusk = warm, rain = grey.
  function mulColor(a, b) { return ((((a >> 16) & 255) * ((b >> 16) & 255) / 255) << 16) | ((((a >> 8) & 255) * ((b >> 8) & 255) / 255) << 8) | (((a & 255) * (b & 255) / 255)); }
  function cloudStyle(cond) {
    var tl = CLOUD_LOOK[cond.time === 'day' ? 'sunny' : cond.time], wl = cond.wx ? (CLOUD_LOOK[cond.wx] || CLOUD_LOOK.cloudy) : CLOUD_LOOK.sunny;
    var storm = cond.wx === 'typhoon', heavy = storm ? 3 : cond.wx === 'thunder' ? 2 : (cond.wx === 'cloudy' || cond.wx === 'drizzle' || cond.wx === 'rain' || cond.wx === 'fog' ? 1.5 : 1);
    var night = cond.time === 'night';   // night clouds are opaque (stars behind them are hidden, user 2026-10-12); the colour is darkened to make up for the lost transparency
    var tint = night ? mulColor(mulColor(tl.light, wl.light), 0x9a9aa8) : mulColor(tl.light, wl.light);
    if (storm) tint = mulColor(tint, 0x9a9aa8);   // typhoon: darker still (user 2026-10-12: typhoon clouds are special)
    return { tint: tint, alpha: night ? wl.alphaMult : tl.alphaMult * wl.alphaMult, count: heavy, storm: storm };
  }
  function buildSkyFx(scene, ctx, cloudsOnly) {   // cloudsOnly: the title / select / reward screens (user 2026-10-12): drifting clouds, no sun beams
    var objs = ctx.skyObjs = [], beams = [], dots = [], clouds = [], cs = cloudStyle(ctx.cond || { time: 'day', wx: null });
    var dShift = (scene.scene.key === 'Level' && !scene.skyCut) ? 13 : 0;   // a level without a transparent-sky picture: the opaque backdrop is at -20, so the clouds go in front of it
    var pool = SKY_PIECES.filter(function (p) { return scene.textures.exists('skc_' + p[0]); });
    var dy = cs.storm ? 50 : 0;   // typhoon: the clouds hang lower
    var LAYERS = [   // far -> near: smaller, lower, slower, fainter, less parallax (the backdrop itself uses 0.03)
      { n: 6, wMin: 60,  wMax: 130, yMin: 170 + dy, yMax: 300 + dy, vx: 5,  alpha: 0.75, pf: 0.006, depth: -28.3 },
      { n: 5, wMin: 120, wMax: 220, yMin: 90 + dy,  yMax: 230 + dy, vx: 9,  alpha: 0.9,  pf: 0.012, depth: -28.2 },
      { n: 3, wMin: 200, wMax: 340, yMin: 10 + dy,  yMax: 150 + dy, vx: 14, alpha: 1.0,  pf: 0.02,  depth: -28.1 }
    ];
    function spawn(c, L, anywhere) {
      var ok = pool.filter(function (p) { return p[1] * 1.1 >= L.wMin; });
      if (!ok.length) ok = [pool.reduce(function (a, b) { return a[1] > b[1] ? a : b; })];
      var p = ok[(Math.random() * ok.length) | 0];
      var sc = Math.min(1.1, rand(L.wMin, L.wMax) / p[1]);
      if (c.o) { objs.splice(objs.indexOf(c.o), 1); c.o.destroy(); }
      c.o = scene.add.image(0, 0, 'skc_' + p[0]).setScrollFactor(0).setDepth(L.depth + dShift).setScale(sc).setAlpha(0);
      if (cs.tint !== 0xffffff) c.o.setTint(cs.tint);
      objs.push(c.o);
      if (Math.random() < 0.5) c.o.setFlipX(true);
      c.w = p[1] * sc; c.sc = sc; c.L = L;
      c.bx = anywhere ? rand(-c.w / 2, W + c.w / 2) : -c.w / 2 - rand(0, 200);
      c.o.y = rand(L.yMin, L.yMax);
      c.age = 0; c.life = rand(25, 45); c.ph = rand(0, 6.28);
    }
    if (pool.length) LAYERS.forEach(function (L) {
      for (var k = 0; k < Math.round(L.n * cs.count); k++) { var c = {}; spawn(c, L, true); c.age = rand(3, 10); clouds.push(c); }
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
        var vmul = 1;
        if (cs.storm) { var sl = ctx.slant || 0, dirS = Math.abs(sl) < 1 ? 1 : Math.max(-1, Math.min(1, sl / 40)); vmul = dirS * (1 + 3 * Math.min(1, Math.abs(sl) / 90)); }   // typhoon: race with the gust (up to 4x, and the other way when the wind turns)
        c.age += dt; c.bx += L.vx * vmul * dt;
        var x = c.bx - cam.scrollX * L.pf, span = W + c.w;
        x = ((x + c.w / 2) % span + span) % span - c.w / 2;
        c.o.x = x;
        c.o.setAlpha(L.alpha * cs.alpha * Math.max(0, Math.min(1, c.age / 3, (c.life - c.age) / 3)));   // 3 s fade in / out
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
  // Rain lands on the street: the characters' feet are at screen y ~456 (y_ground 400 is their centre line), so each drop ends at its own row in the paving band (depth look) instead of vanishing at 400 (user 2026-10-12: rain disappeared above the ground).
  var RAIN_LAND_MIN = 446, RAIN_LAND_MAX = 472;
  // Indoor levels (user 2026-10-13: level 4 is indoors): no wet floor / reflection / slippery footing / floor splashes.
  var INDOOR_LEVELS = { 4: true };
  // Indoors the rain is only visible on the window glass, not on the frames (screen rects of the glass panes; level 4's observation-deck windows, measured from a screenshot: 3 panes wide x 2 rows,
  // mullions at x 421-433 / 803-816, transom at y 110-123, top frame to y 55, sill from y 434; the backdrop only drifts a few px).
  var INDOOR_WINDOW = { 4: [ [178, 58, 419, 108], [435, 58, 801, 108], [818, 58, 960, 108], [178, 125, 419, 432], [435, 125, 801, 432], [818, 125, 960, 432] ] };
  // Wet street (user 2026-10-12): a sheen layer on the paving band that fades in while it rains, plus slippery footing (Player.update reads scene.wetGrip: 1 = dry, lower = longer slide).
  // WET_MAX = how wet the street gets per weather (sheen strength); WET_GRIP = the footing factor at full wetness (first guesses, to be tuned by the user); WET_SECONDS = time to get fully wet.
  var WET_MAX = { drizzle: 0.55, rain: 0.85, thunder: 1, typhoon: 1 }, WET_GRIP = { drizzle: 1, rain: 0.15, thunder: 0.1, typhoon: 0.05 }, WET_SECONDS = 8;
  // Levels whose wet street shows a mirror image of the backdrop's lower strip instead of the random sheen / light streaks (user 2026-10-12: do 1 and 6 first, then the others).
  var WET_REFLECT_LEVELS = { 1: true, 2: true, 3: true, 5: true, 6: true };
  var WET_STREAK_COLORS = { day: [0xffffff, 0xdbe9ff], dusk: [0xffc08a, 0xff9a6a, 0xffe0c0], night: [0xffb070, 0xff6a8a, 0x7ab0ff, 0xffe6a0] };
  var WET_SHEEN = { day: [0xdbe8ff, 0.5], dusk: [0xffc8a0, 0.5], night: [0x7a98ff, 0.42] };   // user 2026-10-12: stronger reflection (was 0.3 / 0.32 / 0.26)
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
  // Wet street: ctx.wet eases 0 -> WET_MAX[weather] over WET_SECONDS; the sheen is one Graphics redrawn each frame (a lighter band + shimmering light streaks);
  // it sits at depth -0.5, above the backdrop picture and below the pit graphics (-0.1), so the holes cover it. scene.wetGrip is the slippery-footing factor read by Player.update.
  // The reflection: the strip of the backdrop picture just above the shop base line (the paving band's top), mirrored, slightly blurred, faded downwards, drawn once into a canvas texture;
  // it sits where the paving band is (same scale / parallax as the backdrop) and gets the backdrop's own colour look (ColorMatrix), so its colours are the picture's.
  function buildReflection(ctx, scene) {
    var bd = scene.backdrop, pr = (typeof PERSP !== 'undefined') ? PERSP[RUN.level] : null;
    if (!bd || !bd.active || !pr || !bd.texture) return;
    var src = bd.texture.getSourceImage(), iw = src.width, ih = src.height, bandPx = Math.round(pr.band * 1920 / 3168), rh = bandPx, key = 'wetrefl_' + RUN.level;
    if (scene.textures.exists(key)) scene.textures.remove(key);
    var ct = scene.textures.createCanvas(key, iw, rh), c = ct.getContext();
    c.save(); c.translate(0, rh); c.scale(1, -1);
    if ('filter' in c) c.filter = 'blur(2px)';
    c.drawImage(src, 0, ih - bandPx - rh, iw, rh, 0, 0, iw, rh);
    c.restore();
    if ('filter' in c) c.filter = 'none';
    var gr = c.createLinearGradient(0, 0, 0, rh); gr.addColorStop(0, 'rgba(0,0,0,0.95)'); gr.addColorStop(1, 'rgba(0,0,0,0.1)');
    c.globalCompositeOperation = 'destination-in'; c.fillStyle = gr; c.fillRect(0, 0, iw, rh); ct.refresh();
    var img = scene.add.image(bd.x, bd.y - bandPx * bd.scaleY, key).setOrigin(0.5, 0).setScale(bd.scaleX, bd.scaleY).setScrollFactor(0).setDepth(-0.5).setAlpha(0);
    var look = getSkyLook(ctx.cond);
    if (scene.renderer.type === Phaser.WEBGL && img.postFX) { var cm = img.postFX.addColorMatrix(); if (look.sat !== 0) cm.saturate(look.sat); if (look.bri !== 1) cm.brightness(look.bri, true); }
    ctx.reflImg = img; ctx.reflKey = key;
  }
  function updateWet(ctx, dt, time) {
    if (!ctx.wetG) return;
    var target = WET_MAX[ctx.weatherId] || 0;
    ctx.wet = Math.min(target, ctx.wet + dt * target / WET_SECONDS);
    ctx.scene.wetGrip = 1 - (ctx.wet / (target || 1)) * (1 - (WET_GRIP[ctx.weatherId] || 1));
    var g = ctx.wetG, tm = ctx.cond.time, wet = ctx.wet, y0 = RAIN_LAND_MIN - 6, h = RAIN_LAND_MAX - RAIN_LAND_MIN + 10, sh = WET_SHEEN[tm];
    g.clear();
    if (ctx.reflImg) {   // mirror image of the backdrop: follows the backdrop's parallax; the wetter the street, the clearer it is
      var bd = ctx.scene.backdrop; if (bd && bd.active) ctx.reflImg.x = bd.x;
      ctx.reflImg.setAlpha(Math.min(1, wet) * (0.75 + 0.1 * Math.sin(time * 0.0013)));
      return;
    }
    g.fillStyle(sh[0], sh[1] * wet * 0.6); g.fillRect(0, y0, W, h * 0.5);          // lighter far half of the band
    g.fillStyle(sh[0], sh[1] * wet); g.fillRect(0, y0 + h * 0.5, W, h * 0.5);      // glossier near half
    var sc = ctx.scene.cameras.main.scrollX, cols = WET_STREAK_COLORS[tm];
    for (var i = 0; i < ctx.wetStreaks.length; i++) {
      var k = ctx.wetStreaks[i], x = ((k.x - sc * 0.6) % (W + 200) + (W + 200)) % (W + 200) - 100;
      var a = k.a * wet * (0.55 + 0.45 * Math.sin(time * 0.001 * k.sp + k.ph));
      g.fillStyle(cols[k.c % cols.length], a); g.fillEllipse(x, k.y, k.w, k.h);
    }
  }
  function updateSplashes(ctx, dt) {
    if (!ctx.splashG) return;
    ctx.splashG.clear();
    var i = 0;
    while (i < ctx.splashes.length) {
      var s = ctx.splashes[i];
      s.age += dt;
      if (s.age >= s.life) {
        ctx.splashes.splice(i, 1);
        continue;
      }
      var alpha = (1 - s.age / s.life) * 0.6;
      var progress = s.age / s.life;
      var maxR = s.size * 14;
      var r = maxR * progress;
      var h = r * 0.35;
      
      ctx.splashG.lineStyle(1.5, 0xdde8ff, alpha);
      ctx.splashG.strokeEllipse(s.x, s.y, r * 2, h * 2);
      
      ctx.splashG.fillStyle(0xdde8ff, alpha);
      for (var j = 0; j < s.drops.length; j++) {
        var d = s.drops[j];
        d.vy += 650 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        ctx.splashG.fillCircle(d.x, d.y, 1.5);
      }
      i++;
    }
  }

  function updateWind(ctx, dt, time) {
    if (!ctx.windG) return;
    var strength = Math.min(1, Math.abs(ctx.slant) / 90);
    var dir = ctx.slant >= 0 ? 1 : -1;
    ctx.windG.clear();
    for (var i = 0; i < ctx.windLines.length; i++) {
      var line = ctx.windLines[i];
      line.x += dir * (160 + 700 * strength) * line.spd * dt;
      // Wrap around: if out of bounds, reset to the opposite side (upwind)
      if (dir > 0) {
        if (line.x > W + line.len) {
          line.x = -line.len;
          line.y = rand(40, 480);
        }
      } else {
        if (line.x < -line.len) {
          line.x = W + line.len;
          line.y = rand(40, 480);
        }
      }
      var alpha = line.a0 * (0.04 + 0.30 * strength);
      ctx.windG.lineStyle(3, 0xffffff, alpha);   // 3 px (was 1.5; user 2026-10-12: thicker)
      var yMid = line.y + Math.sin(time * 0.004 + line.ph) * 4;
      ctx.windG.beginPath();
      ctx.windG.moveTo(line.x, line.y);
      ctx.windG.lineTo(line.x + dir * line.len * 0.5, yMid);
      ctx.windG.lineTo(line.x + dir * line.len, line.y);
      ctx.windG.strokePath();
    }
  }

  function updatePuddles(ctx, dt, time) {
    if (!ctx.puddleG) return;
    
    // Calculate global wetness factor g
    var target = WET_MAX[ctx.weatherId] || 1;
    var g = clamp((ctx.wet / target - 0.35) / 0.65, 0, 1);
    
    ctx.puddleG.clear();
    ctx.rippleG.clear();
    ctx.puddleMaskG.clear();
    
    var anyPuddle = false;
    var scrollX = ctx.scene.cameras.main.scrollX;
    var tm = ctx.cond.time;
    var waterColor = tm === 'day' ? 0x7f93a8 : (tm === 'dusk' ? 0xa07a68 : 0x16223f);
    
    for (var i = 0; i < ctx.puddles.length; i++) {
      var p = ctx.puddles[i];
      // Calculate size factor s
      var t = clamp((g - p.d) / (1 - p.d), 0, 1);
      p.s = t * t * (3 - 2 * t); // smoothstep
      
      if (p.s > 0.02) {
        anyPuddle = true;
        var sx = p.wx - scrollX;
        // Skip if off screen
        if (sx < -p.w || sx > W + p.w) continue;
        
        var w = p.w * p.s;
        var h = p.w * 0.17 * p.s;
        
        // Draw water surface
        ctx.puddleG.fillStyle(waterColor, 0.5);
        ctx.puddleG.fillEllipse(sx, p.y, w, h);
        
        // Draw bright edge
        ctx.puddleG.lineStyle(1.5, 0xdbe8ff, 0.45);
        ctx.puddleG.strokeEllipse(sx, p.y, w, h);
        
        // Update mask for reflection
        ctx.puddleMaskG.fillStyle(0xffffff);
        ctx.puddleMaskG.fillEllipse(sx, p.y, w, h);
      } else {
        p.s = 0;
      }
    }
    
    // Update reflection visibility
    if (ctx.puddleRefl) {
      ctx.puddleRefl.setAlpha(anyPuddle ? 0.9 : 0);
      ctx.puddleRefl.x = ctx.reflImg.x;
    }
    
    // Draw ripples
    for (var j = 0; j < ctx.ripples.length; j++) {
      var r = ctx.ripples[j];
      r.age += dt;
      if (r.age >= r.life) {
        ctx.ripples.splice(j, 1);
        j--;
        continue;
      }
      var progress = r.age / r.life;
      var alpha = 0.7 * (1 - progress);
      var outerR = 26 * progress;
      var innerR = outerR * 0.55;
      var rx = r.wx - scrollX;
      
      ctx.rippleG.lineStyle(1.2, 0xdbe8ff, alpha);
      ctx.rippleG.strokeEllipse(rx, r.y, outerR * 2, outerR * 0.6);
      ctx.rippleG.strokeEllipse(rx, r.y, innerR * 2, innerR * 0.6);
    }
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

  // Time of day (dusk / night): colour overlay (light on sky-cut levels, where the backdrop's ColorMatrix does most of the work) and, at night, stars behind the buildings.
  // Moon (user 2026-10-13): the diameter is MOON.r * 2 (was r = 34; half = 17, a third = 11), the surface is a procedural canvas texture (big soft maria like the real moon, many small craters
  // with bright rims, one bright crater with rays, fine speckle) instead of four plain circles. The texture is seeded so the moon looks the same every time.
  var MOON = { r: 34 / 3 };   // user 2026-10-13: a third of the first size (diameter 34 -> 22.7 px)
  function moonTexture(scene) {
    if (scene.textures.exists('wx_moon')) return;
    var S = 160, t = scene.textures.createCanvas('wx_moon', S, S), c = t.getContext(), m = S / 2, R = m - 1, seed = 20261013;
    function rnd() { seed = (seed + 0x6D2B79F5) | 0; var z = Math.imul(seed ^ (seed >>> 15), 1 | seed); z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z; return ((z ^ (z >>> 14)) >>> 0) / 4294967296; }
    c.save(); c.beginPath(); c.arc(m, m, R, 0, Math.PI * 2); c.clip();
    var base = c.createRadialGradient(m * 0.95, m * 0.9, R * 0.1, m, m, R);   // light disc, slightly darker toward the limb
    base.addColorStop(0, '#fff9e6'); base.addColorStop(0.75, '#f3ead0'); base.addColorStop(1, '#d9d0b0');
    c.fillStyle = base; c.fillRect(0, 0, S, S);
    // maria: big dark regions arranged like the photo (x, y, rx, ry as fractions of S, darkness); each is built from many small overlapping soft blobs so its edge is irregular, not a smooth ellipse
    [[0.34, 0.38, 0.20, 0.15, 0.20], [0.50, 0.28, 0.14, 0.11, 0.18], [0.63, 0.40, 0.12, 0.14, 0.18], [0.40, 0.57, 0.11, 0.14, 0.17], [0.27, 0.52, 0.08, 0.11, 0.15],
     [0.76, 0.27, 0.07, 0.07, 0.17], [0.61, 0.62, 0.07, 0.06, 0.14], [0.47, 0.44, 0.10, 0.07, 0.15], [0.20, 0.36, 0.05, 0.08, 0.14]].forEach(function (a) {
      for (var bl = 0; bl < 70; bl++) {
        var ba = rnd() * Math.PI * 2, bd = Math.sqrt(rnd()), bx = (a[0] + Math.cos(ba) * bd * a[2]) * S, by = (a[1] + Math.sin(ba) * bd * a[3]) * S, br = S * (0.012 + rnd() * 0.04);
        var bg = c.createRadialGradient(bx, by, 0, bx, by, br); bg.addColorStop(0, 'rgba(98,90,74,' + a[4] + ')'); bg.addColorStop(1, 'rgba(98,90,74,0)');
        c.fillStyle = bg; c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.fill();
      }
    });
    // craters: many tiny ones (a few larger), dark floor + thin light rim
    for (var k = 0; k < 170; k++) {
      var a0 = rnd() * Math.PI * 2, d0 = Math.sqrt(rnd()) * R * 0.95, x = m + Math.cos(a0) * d0, y = m + Math.sin(a0) * d0, r = 0.5 + rnd() * rnd() * rnd() * 5;
      c.fillStyle = 'rgba(105,97,80,' + (0.14 + rnd() * 0.22) + ')'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(255,253,238,' + (0.18 + rnd() * 0.3) + ')'; c.lineWidth = 0.5; c.beginPath(); c.arc(x - r * 0.15, y - r * 0.15, r * 1.05, 0, Math.PI * 2); c.stroke();
    }
    // one bright crater with rays (lower middle, like Tycho)
    var tx = S * 0.52, ty = S * 0.80;
    for (var q = 0; q < 16; q++) {
      var ang = rnd() * Math.PI * 2, len = S * (0.08 + rnd() * 0.2);
      c.strokeStyle = 'rgba(255,255,247,' + (0.18 + rnd() * 0.2) + ')'; c.lineWidth = 0.8 + rnd() * 0.8; c.beginPath(); c.moveTo(tx, ty); c.lineTo(tx + Math.cos(ang) * len, ty + Math.sin(ang) * len); c.stroke();
    }
    var tg = c.createRadialGradient(tx, ty, 0, tx, ty, 7); tg.addColorStop(0, 'rgba(255,255,250,0.95)'); tg.addColorStop(1, 'rgba(255,255,250,0)'); c.fillStyle = tg; c.beginPath(); c.arc(tx, ty, 7, 0, Math.PI * 2); c.fill();
    // fine speckle
    for (var n = 0; n < 1600; n++) {
      var an = rnd() * Math.PI * 2, dn = Math.sqrt(rnd()) * R, light = rnd() < 0.5;
      c.fillStyle = light ? 'rgba(255,253,240,' + (0.06 + rnd() * 0.12) + ')' : 'rgba(95,88,72,' + (0.05 + rnd() * 0.1) + ')';
      c.fillRect(m + Math.cos(an) * dn, m + Math.sin(an) * dn, 1 + rnd(), 1 + rnd());
    }
    c.restore(); t.refresh();
  }
  function buildMoon(scene, ctx) {
    var x = 690, y = 100, R = MOON.r;
    var wx = ctx.cond.wx;
    var k = 1;
    if (wx === 'cloudy') k = 0.5;
    else if (wx === 'fog') k = 0.4;
    else if (wx === 'drizzle') k = 0.35;
    else if (wx === 'rain' || wx === 'thunder') k = 0.25;
    else if (wx === 'typhoon') k = 0.1;

    moonTexture(scene);
    var disc = scene.add.image(x, y, 'wx_moon').setScrollFactor(0).setDepth(-28.35).setDisplaySize(R * 2, R * 2).setAlpha(k);
    ctx.glints.push(disc);

    // Soft Glow
    var glow = scene.add.image(x, y, 'sky_dot');
    glow.setScrollFactor(0);
    glow.setDepth(-28.36);
    glow.setBlendMode(Phaser.BlendModes.ADD);
    glow.setTint(0xfff4cc);
    glow.setScale(R * 5 / 32);
    glow.setAlpha(0.35 * k);
    ctx.glints.push(glow);
  }

  function buildTime(scene, time, ctx) {
    var look = getSkyLook(ctx.cond);
    var mult = scene.skyCut ? look.overlayAlphaMult : 1, keep = !!BACKDROP_TIMELESS[RUN.level];   // keep: no colour overlay over the picture (stars only)
    if (time === 'dusk') {
      var dAlpha1 = 0.15 * mult;
      var dAlpha2 = 0.08 * mult;
      if (!keep) ctx.rain.push({ o: scene.add.rectangle(W / 2, H / 2, W, H, 0xff8a3c, dAlpha1).setScrollFactor(0).setDepth(59), vx: 0, vy: 0, static: true });
      if (!keep) ctx.rain.push({ o: scene.add.rectangle(W / 2, 100, W, 200, 0xff5a8a, dAlpha2).setScrollFactor(0).setDepth(59), vx: 0, vy: 0, static: true });
    } else if (time === 'night') {
      var nAlpha = 0.42 * mult;
      if (!keep) ctx.rain.push({ o: scene.add.rectangle(W / 2, H / 2, W, H, 0x0a1038, nAlpha).setScrollFactor(0).setDepth(59), vx: 0, vy: 0, static: true });
      // stars (user 2026-10-12): many small dim ones, some medium, a few big bright ones with a soft glow; each twinkles slowly
      var starD = scene.skyCut ? -28.4 : -15.5,   // behind the drifting clouds (-28.3..-28.1, or -15.3..-15.1 on a level without a transparent sky), in front of the sky gradient / backdrop
         cols = [0xfff2b0, 0xfff2b0, 0xffffff, 0xcfe0ff, 0xffd8b0];
      skyDotTex(scene); ctx.stars = ctx.stars || [];
      for (var si = 0; si < 46; si++) {
        var tr = Math.random(), sz, a0;
        if (tr < 0.62) { sz = rand(0.45, 0.85); a0 = rand(0.25, 0.6); } else if (tr < 0.9) { sz = rand(0.95, 1.4); a0 = rand(0.5, 0.85); } else { sz = rand(1.6, 2.1); a0 = rand(0.85, 1); }   // sizes cut by ~40% (user: too big)
        var sx = rand(0, W), sy = rand(10, 230), col = cols[(Math.random() * cols.length) | 0];
        var star = makeStar(scene, sx, sy, sz, col); star.setDepth(starD).setAlpha(a0);
        ctx.glints.push(star); ctx.stars.push({ o: star, a0: a0, ph: rand(0, 6.28), sp: rand(0.6, 2.2) });
        if (sz > 1.55) {   // big star: soft glow
          var gl = scene.add.image(sx, sy, 'sky_dot').setScrollFactor(0).setDepth(starD).setBlendMode(Phaser.BlendModes.ADD).setScale(sz * 0.45).setAlpha(0.3).setTint(col);
          ctx.glints.push(gl); ctx.stars.push({ o: gl, a0: 0.35, ph: rand(0, 6.28), sp: rand(0.6, 2.2) });
        }
      }
      if (scene.skyCut) buildMoon(scene, ctx);
    }
  }

  function buildWeather(scene, weatherId, ctx) {
    var look = getSkyLook(ctx.cond);
    var mult = scene.skyCut ? look.overlayAlphaMult : 1;

    if (weatherId === 'rain') {
      var alpha = 0.14 * mult;
      var tint = scene.add.rectangle(GAME_W / 2, 270, GAME_W, 540, 0x203050, alpha).setScrollFactor(0).setDepth(59);
      ctx.rain.push({ o: tint, vx: 0, vy: 0, static: true });
      for (var i = 0; i < 55; i++) {
        var drop = scene.add.rectangle(rand(0, W), rand(0, H), STORM.rain.w, STORM.rain.h * rand(0.5, 1.7), 0xdde8ff, STORM.rain.a * rand(0.75, 1.15));   // uneven lengths (user 2026-10-13)
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
        var dd = scene.add.rectangle(rand(0, W), rand(0, H), DRIZZLE.w, DRIZZLE.h * rand(0.5, 1.7), 0xdde8ff, DRIZZLE.a * rand(0.75, 1.15));   // uneven lengths (user 2026-10-13)
        dd.setScrollFactor(0).setDepth(60).setRotation(0.163);
        ctx.rain.push({ o: dd, vx: 28, vy: 170 });
      }
    } else if (weatherId === 'thunder' || weatherId === 'typhoon') {
      var ty = weatherId === 'typhoon';
      ctx.rainy = true; ctx.typhoon = ty;
      var baseAlpha = ty ? 0.26 : 0.2;
      var finalAlpha = baseAlpha * mult;
      ctx.rain.push({ o: scene.add.rectangle(W / 2, H / 2, W, H, ty ? 0x1a2438 : 0x203050, finalAlpha).setScrollFactor(0).setDepth(59), vx: 0, vy: 0, static: true });
      if (ty) {
        TYPHOON_DROPS.forEach(function (L) {
          for (var ki = 0; ki < L.n; ki++) {
            var kd = scene.add.rectangle(rand(0, W), rand(0, H), L.w, L.h * rand(0.5, 1.7), 0xdde8ff, L.a * rand(0.75, 1.15));   // uneven lengths / opacity within a layer (user 2026-10-12)
            kd.setScrollFactor(0).setDepth(60).setRotation(0.1745);
            ctx.rain.push({ o: kd, vx: 52, vy: L.vy * rand(0.92, 1.08) });
          }
        });
      } else {
        THUNDER_DROPS.forEach(function (L) {
          for (var ki = 0; ki < L.n; ki++) {
            var kd = scene.add.rectangle(rand(0, W), rand(0, H), L.w, L.h * rand(0.5, 1.7), 0xdde8ff, L.a * rand(0.75, 1.15));
            kd.setScrollFactor(0).setDepth(60).setRotation(0.1745);
            ctx.rain.push({ o: kd, vx: 52, vy: L.vy * rand(0.92, 1.08) });
          }
        });
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
      ctx.scene.windInfo = { slant: ctx.slant, push: ctx.windNow };   // read by hud.js (wind-direction chip under the weather pill)
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
        if (ctx.indoorWin) {   // indoors: a drop is shown only while it is over a glass pane (hidden over the frames, the wall and the room)
          var inGlass = false;
          for (var gi = 0; gi < ctx.indoorWin.length; gi++) { var gw = ctx.indoorWin[gi]; if (r.o.x >= gw[0] && r.o.x <= gw[2] && r.o.y >= gw[1] && r.o.y <= gw[3]) { inGlass = true; break; } }
          r.o.setVisible(inGlass);
        }
        if (r.land === undefined) r.land = rand(RAIN_LAND_MIN, RAIN_LAND_MAX);
        if (r.o.y >= r.land) {
          var inPuddle = false;
          if (ctx.puddles.length > 0) {
            var wx = r.o.x + ctx.scene.cameras.main.scrollX;
            for (var pi = 0; pi < ctx.puddles.length; pi++) {
              var p = ctx.puddles[pi];
              if (p.s > 0.3) {
                var dx = (wx - p.wx) / (p.w * p.s / 2);
                var dy = (r.land - p.y) / (p.w * 0.17 * p.s / 2);
                if (dx * dx + dy * dy <= 1) {
                  inPuddle = true;
                  if (ctx.ripples.length < 40) {
                    ctx.ripples.push({ wx: wx, y: r.land, age: 0, life: rand(0.7, 1.0) });
                  }
                  break;
                }
              }
            }
          }
          if (!inPuddle && !ctx.noSplash && ctx.splashes.length < 80) {
            var w = r.o.width;
            var size = w <= 1.2 ? 0.6 : (w <= 2 ? 0.9 : 1.3);
            var drops = [];
            for (var k = 0; k < 3 + Math.floor(Math.random() * 2); k++) {
              drops.push({
                x: r.o.x, y: r.land,
                vx: rand(-30, 30),
                vy: rand(-150, -50)
              });
            }
            ctx.splashes.push({
              x: r.o.x, y: r.land,
              size: size,
              age: 0,
              life: rand(0.25, 0.4),
              drops: drops
            });
          }
          r.o.y = -10; r.o.x = rand(0, W); r.land = rand(RAIN_LAND_MIN, RAIN_LAND_MAX);
        }
        if (r.o.x > W + 20) r.o.x = -20; else if (r.o.x < -20) r.o.x = W + 20;
      }
    }
  }

  function start(scene, themeId, condIn) {
    var cond = normCond(condIn), weatherId = cond.wx;
    var ctx = {
      scene: scene, themeId: themeId, weatherId: weatherId, cond: cond,
      parts: [], clouds: [], rain: [], glints: [], rays: [],
      wind: 0, windTarget: 0, windTimer: 0,
      gustTimer: 0, gustActive: false, gustLeft: 0,
      lava: null, overlay: null, splashes: [], splashG: null, wetG: null, indoorWin: null, wet: 0, wetStreaks: [], reflImg: null, reflKey: null, windG: null, windLines: [],
      fx: [], rainy: false, noSplash: false, typhoon: false, slant: 0, windNow: 0, flash: null, flashTimer: 0,
      puddles: [], puddleG: null, puddleMaskG: null, puddleRefl: null, rippleG: null, ripples: [],
      last: 0, destroyed: false
    };
    
    // Sky Cut Logic
    if (scene.skyCut) {
      var look = getSkyLook(cond);
      
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

    }

    scene.windX = 0;
    buildTheme(scene, themeId, ctx);
    if (cond.time !== 'day') buildTime(scene, cond.time, ctx);
    if (weatherId) buildWeather(scene, weatherId, ctx);
    if (!ctx.skyFx && !noCloudScene(scene)) buildSkyFx(scene, ctx, !(scene.skyCut && cond.time === 'day' && (!weatherId || weatherId === 'petals')));   // user 2026-10-12: the sunny-sky clouds (levels 1-5) replace every circle cloud, tinted by time / weather; sun beams only on a clear sky-cut day   // title / select / reward / level-cleared screens (user 2026-10-12): the new drifting clouds instead of the old circle clouds
    if (ctx.skyFx || noCloudScene(scene)) { for (var ci = 0; ci < ctx.clouds.length; ci++) ctx.clouds[ci].o.destroy(); ctx.clouds = []; }   // sunny sky-cut: the new clouds replace the circle clouds
    var auto = !(typeof navigator !== 'undefined' && navigator.webdriver) && !(typeof location !== 'undefined' && /[?&]weather=/.test(location.search));
    if (auto && !weatherId && cond.time === 'day' && Math.random() < 0.4) addFalling(scene, ctx, 'petal');          // sunny: sometimes petals
    else if (auto && weatherId === 'cloudy' && cond.time === 'day' && Math.random() < 0.5) addFalling(scene, ctx, 'leaf');   // cloudy: sometimes leaves

    var indoor = scene.scene.key === 'Level' && INDOOR_LEVELS[RUN.level];
    if (indoor) { ctx.noSplash = true; ctx.indoorWin = INDOOR_WINDOW[RUN.level] || null; }
    if ((ctx.rainy || weatherId === 'rain') && !ctx.noSplash) {
      ctx.splashG = scene.add.graphics().setScrollFactor(0).setDepth(61);
    }
    if ((ctx.rainy || weatherId === 'rain') && scene.scene.key === 'Level' && !indoor) {   // wet street + slippery footing: only on a level
      ctx.wetG = scene.add.graphics().setScrollFactor(0).setDepth(-0.5);
      if (WET_REFLECT_LEVELS[RUN.level]) buildReflection(ctx, scene);
      if (!ctx.reflImg) for (var wk = 0; wk < 24; wk++) ctx.wetStreaks.push({ x: rand(0, W + 200), y: rand(RAIN_LAND_MIN, RAIN_LAND_MAX), w: rand(60, 240), h: rand(3, 7), a: rand(0.5, 0.95), c: (Math.random() * 4) | 0, sp: rand(0.8, 2.4), ph: rand(0, 6.28) });
      
      // Puddles: only if reflection exists and weather is rain/thunder/typhoon
      if (ctx.reflImg && (ctx.weatherId === 'thunder' || ctx.weatherId === 'typhoon')) {   // puddles: thunder and typhoon only (user 2026-10-13: not rain / drizzle)
        ctx.puddleG = scene.add.graphics().setScrollFactor(0).setDepth(-0.45);
        ctx.rippleG = scene.add.graphics().setScrollFactor(0).setDepth(-0.43);
        
        // Puddle reflection image (copy of reflImg)
        ctx.puddleRefl = scene.add.image(ctx.reflImg.x, ctx.reflImg.y, ctx.reflKey).setOrigin(0.5, 0).setScale(ctx.reflImg.scaleX, ctx.reflImg.scaleY).setScrollFactor(0).setDepth(-0.44).setAlpha(0);
        var look = getSkyLook(ctx.cond);
        if (scene.renderer.type === Phaser.WEBGL && ctx.puddleRefl.postFX) { 
          var cm = ctx.puddleRefl.postFX.addColorMatrix(); 
          if (look.sat !== 0) cm.saturate(look.sat); 
          if (look.bri !== 1) cm.brightness(look.bri, true); 
        }
        
        // Mask for puddle reflection
        ctx.puddleMaskG = scene.make.graphics({ x: 0, y: 0, add: false });
        ctx.puddleRefl.setMask(ctx.puddleMaskG.createGeometryMask());
        
        // Generate puddle data
        var lvlW = ctx.scene.lvl.width;
        for (var pi = 0; pi < 14; pi++) {
          var wx = 60 + (lvlW - 120) * (pi / 13) + rand(-20, 20);
          var y = rand(448, 470);
          var w = rand(70, 190);
          var d = rand(0, 0.45);
          ctx.puddles.push({ wx: wx, y: y, w: w, d: d, s: 0 });
        }
      }
    }
    if (ctx.typhoon && scene.scene.key === 'Level' && !indoor) {
      ctx.windG = scene.add.graphics().setScrollFactor(0).setDepth(58);
      for (var wi = 0; wi < 28; wi++) {
        ctx.windLines.push({
          x: rand(0, W),
          y: rand(40, 480),
          len: rand(70, 240),
          spd: rand(0.7, 1.4),
          a0: rand(0.5, 1),
          ph: rand(0, 6.28)
        });
      }
    }

    var onUpdate = function (time, delta) {
      if (ctx.destroyed) return;
      var dt = (delta || 16) / 1000;
      if (dt > 0.05) dt = 0.05;
      if (ctx.stars) for (var tw = 0; tw < ctx.stars.length; tw++) { var st = ctx.stars[tw]; if (st.o.active) st.o.setAlpha(st.a0 * (0.72 + 0.28 * Math.sin(time * 0.001 * st.sp + st.ph))); }
      updateTheme(ctx, dt, time);
      updateWeather(ctx, dt, time);
      updateSplashes(ctx, dt);
      updateWind(ctx, dt, time);
      updateWet(ctx, dt, time);
      updatePuddles(ctx, dt, time);
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
        if (ctx.splashG) ctx.splashG.destroy();
        ctx.splashes = [];
        if (ctx.wetG) ctx.wetG.destroy();
        if (ctx.reflImg) { ctx.reflImg.destroy(); ctx.reflImg = null; if (scene.textures.exists(ctx.reflKey)) scene.textures.remove(ctx.reflKey); }
        if (ctx.puddleG) ctx.puddleG.destroy();
        if (ctx.puddleRefl) ctx.puddleRefl.destroy();
        if (ctx.puddleMaskG) ctx.puddleMaskG.destroy();
        if (ctx.rippleG) ctx.rippleG.destroy();
        ctx.puddles = [];
        ctx.ripples = [];
        scene.windInfo = null;
        if (ctx.windG) ctx.windG.destroy();
        ctx.windLines = [];
        scene.wetGrip = 1;
      }
    };
  }

  // Per-level random weather (2026-10-09 plan). sunny = no overlay (35%); typhoon 10% on outdoor levels; fog only on mountain levels.
  var OUTDOOR = [1, 2, 3, 13, 15, 17, 27, 29, 30], MOUNTAIN = [5, 9, 10, 11, 22, 23, 29];
  // Returns a condition { time: 'day' | 'dusk' | 'night', wx: null | weather id }; the two axes are drawn separately.
  var CLEAR_DAY = { time: 'day', wx: null };
  function pickWeather(level) {
    var time = WX.devTime, wx = WX.devWx;   // forced from the developer menu (undefined = random; devWx 'none' = clear); cleared on the title screen
    var qs = (typeof location !== 'undefined') ? location.search : '';
    var qw = qs.match(/[?&]weather=([a-z]+)/), qt = qs.match(/[?&]time=([a-z]+)/);
    if (qt) time = qt[1];
    if (qw) { if (qw[1] === 'dusk' || qw[1] === 'night') { if (!qt) time = qw[1]; if (wx === undefined) wx = 'none'; } else wx = qw[1]; }   // ?weather=night keeps working (= ?time=night)
    var auto = !(typeof navigator !== 'undefined' && navigator.webdriver) && !qw && !qt;
    if (time === undefined) {
      var allowed = TIMES_OF_LEVEL[level];
      time = allowed ? allowed[(Math.random() * allowed.length) | 0] : (auto && Math.random() < 0.2 ? 'dusk' : 'day');   // automated tests stay deterministic (clear day) unless forced
    }
    if (wx === undefined && !auto) wx = null;
    if (wx === undefined) {
      var out = OUTDOOR.indexOf(level) >= 0, pool = ['cloudy', 'drizzle'];
      if (out) pool = pool.concat(['rain', 'thunder']);
      if (MOUNTAIN.indexOf(level) >= 0) pool.push('fog');
      var r = Math.random();
      if (r < 0.35) wx = null;
      else if (out) { if (r < 0.45) wx = 'typhoon'; else { r = (r - 0.45) / 0.55; wx = pool[Math.min(pool.length - 1, (r * pool.length) | 0)]; } }
      else { r = (r - 0.35) / 0.65; wx = pool[Math.min(pool.length - 1, (r * pool.length) | 0)]; }
    }
    return { time: time, wx: (wx === 'none' || !wx) ? null : wx };
  }

  var NAMES = { cloudy: '陰天', drizzle: '細雨', rain: '大雨', thunder: '雷陣雨', fog: '大霧', typhoon: '颱風', petals: '花瓣飄落' };
  var TIME_NAMES = { dusk: '黃昏', night: '夜晚' };
  // HUD label: day -> the weather alone (clear = 晴天); dusk / night -> 夜晚·大雨 (time alone when clear: 夜晚)
  function weatherName(c) {
    c = normCond(c); var w = c.wx ? (NAMES[c.wx] || c.wx) : null;
    if (c.time === 'day') return w || '晴天';
    return (TIME_NAMES[c.time] || c.time) + (w ? '·' + w : '');
  }

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

  return { start: start, pick: pickWeather, name: weatherName, softCloud: makeSoftCloud, cloud2: makeCloud2, skyPieces: skyPieceList, skyLook: getSkyLook, moon: MOON, rainBriOfLevel: RAIN_BRI_OF_LEVEL, drizzle: DRIZZLE, storm: STORM, typhoonDrops: TYPHOON_DROPS };
})();
