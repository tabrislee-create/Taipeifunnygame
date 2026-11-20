// Logical canvas size. Height is fixed at 540 (all level data assumes it); width follows the screen aspect so FIT leaves no black bars.
(function () {
  var touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || /[?&]touch=1/.test(location.search);
  var w = window.innerWidth, h = window.innerHeight;
  if (touch && window.screen) { w = Math.max(screen.width, screen.height); h = Math.min(screen.width, screen.height); }
  var aspect = (w && h) ? w / h : 16 / 9;
  window.GAME_H = 540;
  window.GAME_W = Math.max(960, Math.min(1280, Math.round(aspect * 540 / 2) * 2));
})();
