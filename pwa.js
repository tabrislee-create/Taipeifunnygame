// Phone helpers: a fullscreen button, an in-game "install" button and install instructions for iPhone.
// PWA.mkButtons(scene, cx, y) puts the buttons that make sense on this device in a centred row (title screen and pause panel):
//   全螢幕 / 退出全螢幕  - only where the browser allows an ordinary page to go fullscreen (Android Chrome, desktop; NOT iPhone Safari) and the game is not already running as an installed app
//   安裝遊戲            - only when the browser offered its install prompt (Android Chrome: beforeinstallprompt); one tap opens the system install dialog
//   安裝說明            - on a touch phone / tablet without an install prompt that is not installed yet (iPhone Safari, or Android after the prompt was used): opens the how-to page's install tab
// Also warns inside LINE's built-in browser (it can neither go fullscreen nor install).  Everything is feature-detected; nothing shows on a computer except the fullscreen button.
var PWA = (function () {
  var deferred = null, listeners = [];
  function emit() { listeners.slice().forEach(function (f) { try { f(); } catch (e) {} }); }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; emit(); });
  window.addEventListener('appinstalled', function () { deferred = null; emit(); });
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (n) { document.addEventListener(n, emit); });
  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isLine = /\bLine\//i.test(ua) || /\bFBAN|FBAV|Instagram/i.test(ua);
  var isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  function standalone() {
    try { if (window.navigator.standalone) return true; return !!(window.matchMedia && (matchMedia('(display-mode: standalone)').matches || (matchMedia('(display-mode: fullscreen)').matches && !fsElement()))); } catch (e) { return false; }
  }
  // (a browser tab that went fullscreen through our own button also matches display-mode: fullscreen, so it only counts as an installed app when the page did not request fullscreen itself)
  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function canFullscreen() {
    var d = document, el = d.documentElement;
    return !isIOS && !isLine && !!((d.fullscreenEnabled || d.webkitFullscreenEnabled) && (el.requestFullscreen || el.webkitRequestFullscreen));
  }
  function toggleFullscreen() {
    var d = document, el = d.documentElement;
    try {
      if (fsElement()) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); }
      else if (el.requestFullscreen) { var r = el.requestFullscreen({ navigationUI: 'hide' }); if (r && r.catch) r.catch(function () {}); }
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (e) {}
  }
  function install() {
    var e = deferred; if (!e) return;
    deferred = null; emit();
    try { e.prompt(); if (e.userChoice && e.userChoice.then) e.userChoice.then(emit); } catch (err) {}
  }
  // which buttons to show now: [{ id, label }]
  function wanted() {
    var out = [];
    if (canFullscreen() && !standalone()) out.push({ id: 'fs', label: fsElement() ? '退出全螢幕' : '全螢幕' });
    if (!standalone()) {
      if (deferred) out.push({ id: 'install', label: '安裝遊戲' });
      else if (isTouch && !isLine) out.push({ id: 'howto', label: '安裝說明' });
    }
    return out;
  }

  // buttons row: pills in the project's panel style, centred on cx (align 'c') or starting at cx (align 'l'); relayouts itself when the browser state changes
  function mkButtons(scene, cx, y, align) {
    var F = (typeof FONT !== 'undefined' && FONT) || 'Microsoft JhengHei, PingFang TC, sans-serif', objs = [], W = 112, H = 32, GAP = 8, depth = 150, dead = false;
    function clear() { objs.forEach(function (o) { o.destroy(); }); objs = []; }
    function act(id) {
      if (id === 'fs') toggleFullscreen();
      else if (id === 'install') install();
      else if (id === 'howto') {
        if (scene.scene.key === 'Title' || scene.scene.key === 'Choice') { scene.scene.pause(); scene.scene.launch('HowTo', { from: scene.scene.key, mode: 'install' }); }
        else if (scene.scene.key === 'CharPanel') { scene.scene.launch('HowTo', { from: 'CharPanel', mode: 'install' }); scene.scene.pause(); }
      }
    }
    function build() {
      if (dead || !scene.sys || !scene.sys.settings || scene.sys.settings.status >= 8) return;   // (isActive() is false while create() is still running, so test the status instead: 8 = shutdown)
      clear();
      var list = wanted(), total = list.length * W + Math.max(0, list.length - 1) * GAP, x0 = align === 'l' ? cx : cx - total / 2;
      list.forEach(function (b, i) {
        var x = x0 + i * (W + GAP), g = scene.add.graphics().setDepth(depth).setScrollFactor(0);
        g.fillStyle(0x0a1224, 0.82); g.fillRoundedRect(x, y - H / 2, W, H, 16); g.lineStyle(2, 0xffffff, 0.55); g.strokeRoundedRect(x, y - H / 2, W, H, 16);
        var t = scene.add.text(x + W / 2, y, b.label, { fontFamily: F, fontSize: '16px', fontStyle: 'bold', color: '#ffffff', stroke: '#0a1224', strokeThickness: 3 }).setOrigin(0.5).setDepth(depth + 1).setScrollFactor(0);
        var z = scene.add.zone(x, y - H / 2, W, H).setOrigin(0).setDepth(depth + 2).setScrollFactor(0).setInteractive({ useHandCursor: true });
        z.on('pointerup', function () { act(b.id); });
        objs.push(g, t, z);
      });
      if (isLine && scene.scene.key === 'Title') {
        var n = scene.add.text(GAME_W / 2, y, '目前在 LINE 等內建瀏覽器：無法全螢幕與安裝。請點右上角「⋯」→「用預設瀏覽器開啟」。', { fontFamily: F, fontSize: '14px', fontStyle: 'bold', color: '#ffd966', stroke: '#0a1224', strokeThickness: 3, align: 'center', wordWrap: { width: 760 } }).setOrigin(0.5).setDepth(depth + 1).setScrollFactor(0);
        objs.push(n);
      }
    }
    listeners.push(build);
    var done = function () { dead = true; var i = listeners.indexOf(build); if (i >= 0) listeners.splice(i, 1); clear(); };
    scene.events.once('shutdown', done); scene.events.once('destroy', done);
    build();
    return { rebuild: build, destroy: done };
  }
  return { onChange: function (f) { listeners.push(f); }, isTouch: isTouch, mkButtons: mkButtons, wanted: wanted, standalone: standalone, isIOS: isIOS, isLine: isLine, canFullscreen: canFullscreen, toggleFullscreen: toggleFullscreen, install: install, hasPrompt: function () { return !!deferred; }, _setPrompt: function (e) { deferred = e; emit(); } };
})();
