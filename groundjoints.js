// Perspective paving joints for the plaza (level 10). Pure math, no Phaser.
// World coordinates: x is the feet-plane world x, y is the screen y (same as _drawPitsPersp).
// k is the depth factor: k=SP is the feet plane (speed 1.0), k=1 is the backdrop bottom.
function lines(o) {
  const sx = o.sx, gameW = o.gameW, YB = o.YB, VPY = o.VPY, VPX = o.VPX, SP = o.SP;
  const yTop = o.yTop, spacing = o.spacing, topAt = o.topAt;
  const steps = (o.steps != null) ? o.steps : 20;
  const EMPTY = { vert: [], cross: [] };
  if (!(spacing > 0) || !(YB > VPY) || !(SP > 0) || !(yTop < YB)) return EMPTY;
  const kMin = (yTop - VPY) / (YB - VPY);
  const xL = sx - 40, xR = sx + gameW + 40;
  const vert = [], cross = [];
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const seg = (x1, y1, x2, y2, i, k) => { vert.push([x1, y1, x2, y2, i, k]); };

  // Vertical joints: world x = i*spacing at the feet plane, projected to depth k.
  // Screen x at depth k: VPX + (k/SP)*(i*spacing - VPX). Solve for i over the visible range.
  const iLo = Math.floor((xL - VPX) * SP / (kMin * spacing) + VPX / spacing) - 2;
  const iHi = Math.ceil((xR - VPX) * SP / (1 * spacing) + VPX / spacing) + 2;
  for (let i = iLo; i <= iHi; i++) {
    const wx = i * spacing;
    for (let s = 0; s < steps; s++) {
      const k0 = kMin + (1 - kMin) * s / steps;
      const k1 = kMin + (1 - kMin) * (s + 1) / steps;
      const x0 = VPX + (k0 / SP) * (wx - VPX), y0 = VPY + k0 * (YB - VPY);
      const x1 = VPX + (k1 / SP) * (wx - VPX), y1 = VPY + k1 * (YB - VPY);
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      // Filter out segments completely outside the visible x range [xL, xR]
      if (my >= topAt(mx) && !((x0 < xL && x1 < xL) || (x0 > xR && x1 > xR))) {
        seg(x0, y0, x1, y1, i, (k0 + k1) / 2);
      }
    }
  }

  // Horizontal joints: 2 lines at world-depth-equal spacing (1/k linear in j).
  const ks = [];
  for (let j = 1; j <= 2; j++) ks.push(1 / (1 + (1 / kMin - 1) * j / 3));
  for (const k of ks) {
    const y = VPY + k * (YB - VPY);
    for (let x = xL; x < xR; x += 8) {
      const x2 = Math.min(x + 8, xR);
      const mx = (x + x2) / 2;
      if (y >= topAt(mx)) cross.push([x, y, x2, y]);
    }
  }
  return { vert, cross };
}
if (typeof module !== 'undefined') module.exports = { lines };
if (typeof window !== 'undefined') window.GroundJoints = { lines };