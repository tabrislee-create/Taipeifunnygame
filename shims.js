// Compatibility shims (written by hand, not by the Coder): methods the generated code assumes but Phaser 3.90 does not have.
(function () {
  const G = Phaser.GameObjects;
  const addTo = (proto, name, fn) => { if (proto && !proto[name]) proto[name] = fn; };
  [G.Image, G.Sprite, G.TileSprite, G.Text, G.Rectangle, G.Container].forEach((C) => {
    if (!C) return;
    addTo(C.prototype, 'setDisplayHeight', function (h) { this.displayHeight = h; return this; });
    addTo(C.prototype, 'setDisplayWidth', function (w) { this.displayWidth = w; return this; });
  });
  // Phaser 3.60+ removed setTintFill(); emulate with tint + tintFill flag (clearTint also resets the flag).
  [G.Image, G.Sprite].forEach((C) => {
    if (!C) return;
    if (!C.prototype.setTintFill) C.prototype.setTintFill = function (c) { this.setTint(c); this.tintFill = true; return this; };
    const ct = C.prototype.clearTint;
    C.prototype.clearTint = function () { this.tintFill = false; return ct.call(this); };
  });
  // 大字版 (user 2026-10-14): the landing page's 字體：標準／大字 toggle sets window.__bigText.  Every scene.add.text smaller than BIG_TEXT_MIN is raised to it;
  // bigger text is left alone (user chose "raise the small text to a floor, keep the big text").  Read at creation time, so a toggle takes effect on the next scene.
  const BIG_TEXT_MIN = 24;
  const GOF = Phaser.GameObjects.GameObjectFactory && Phaser.GameObjects.GameObjectFactory.prototype;
  if (GOF && GOF.text && !GOF._textOrig) {
    GOF._textOrig = GOF.text;
    GOF.text = function (x, y, str, style) {
      if (window.__bigText && style && style.fontSize != null && !style.keepSize) {   // keepSize: true opts a text out (the debug readout, level.js)
        const n = parseFloat(style.fontSize);
        if (n > 0 && n < BIG_TEXT_MIN) style = Object.assign({}, style, { fontSize: BIG_TEXT_MIN + 'px' });
      }
      return GOF._textOrig.call(this, x, y, str, style);
    };
  }
  // Arcade bodies follow the sprite's scale, so squash/stretch tweens made the body shrink and the player sink through the ground.
  // Keep the body size tied to sprite.baseScaleX/Y (set by makeSprite) so visual squash never changes the physics body.
  const Body = Phaser.Physics.Arcade && Phaser.Physics.Arcade.Body;
  if (Body && !Body.prototype._updateBoundsOrig) {
    Body.prototype._updateBoundsOrig = Body.prototype.updateBounds;
    Body.prototype.updateBounds = function () {
      const g = this.gameObject;
      if (g && g.baseScaleX && (g.scaleX !== g.baseScaleX || g.scaleY !== g.baseScaleY)) {
        const sx = g.scaleX, sy = g.scaleY;
        g.scaleX = g.baseScaleX; g.scaleY = g.baseScaleY;
        this._updateBoundsOrig();
        g.scaleX = sx; g.scaleY = sy;
      } else this._updateBoundsOrig();
    };
  }
})();
