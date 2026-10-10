// Morphs the end-of-verses divider through the shapes in data/ornaments.json.
// The geometry must stay in step with layouts/partials/ornament/path.html.
(() => {
  const el = document.querySelector(".ornament-morph");
  if (!el || !("IntersectionObserver" in window)) return;
  const path = el.querySelector("path");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");

  const N = 120;
  const SN = 16;
  const TAU = 2 * Math.PI;
  const UP = -Math.PI / 2;
  const STEP = 3.6;
  const HOLD = 0.5;

  const ring = (s) => {
    const out = new Float64Array(N);
    if (s.c != null) return out.fill(s.c);
    const { n, ri, ro = 1, k = 1, p = 0.5, tw = 0, rot = 0, sp = 0, sw = 0.08 } = s;
    const seg = TAU / n;
    const q = ri / ro;
    const dx = q * Math.cos(seg / 2) - 1;
    const dy = q * Math.sin(seg / 2);
    for (let j = 0; j < N; j++) {
      const a = (TAU * j) / N - (rot * Math.PI) / 180;
      let local = (a - seg * Math.floor(a / seg)) / seg;
      if (tw) local -= (tw * Math.sin(TAU * local)) / TAU;
      const d = Math.min(local, 1 - local);
      const x = 2 * d;
      const phi = d * seg;
      const straight = dy / (Math.cos(phi) * dy - Math.sin(phi) * dx);
      let f = Math.pow(Math.max(0, 1 - x * x), p);
      if (sp) f = sp * Math.exp(-x / sw) + (1 - sp) * f;
      out[j] = ro * (straight * (1 - k) + (q + (1 - q) * f) * k);
    }
    return out;
  };

  const geometry = (def) => {
    const sats = [];
    for (const s of def.sats || []) {
      for (let i = 0; i < s.n; i++) {
        sats.push({ c: s.c, a: ((s.rot || 0) * Math.PI) / 180 + (TAU * i) / s.n, l: s.l, w: s.w, m: s.m || 0 });
      }
    }
    return { rings: def.rings.map(ring), sats, n: def.rings[0].n || 0 };
  };

  const shapes = JSON.parse(el.dataset.shapes).map(geometry);
  const colours = Number(el.dataset.colours) || 1;
  const zero = new Float64Array(N);
  const tmp = new Float64Array(N);
  const num = (v) => (v * 100).toFixed(1);

  const ringPath = (r, rot) => {
    if (Math.max(...r) < 1e-3) return "";
    let d = "";
    for (let j = 0; j < N; j++) {
      const t = (TAU * j) / N + rot;
      d += (j ? "L" : "M") + num(r[j] * Math.cos(t)) + " " + num(r[j] * Math.sin(t));
    }
    return d + "Z";
  };

  const satPath = (c, a, l, w, m) => {
    if (l < 1e-3 || w < 1e-3) return "";
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let d = "";
    for (let j = 0; j < SN; j++) {
      const t = (TAU * j) / SN;
      const u = c + (Math.cos(t) * l) / 2;
      const v = (Math.sin(t) * Math.pow(Math.abs(Math.sin(t / 2)), m) * w) / 2;
      d += (j ? "L" : "M") + num(u * ca - v * sa) + " " + num(u * sa + v * ca);
    }
    return d + "Z";
  };

  const morph = (A, B, m, rot) => {
    let d = "";
    const rings = Math.max(A.rings.length, B.rings.length);
    for (let r = 0; r < rings; r++) {
      const a = A.rings[r] || zero;
      const b = B.rings[r] || zero;
      for (let j = 0; j < N; j++) tmp[j] = a[j] + (b[j] - a[j]) * m;
      d += ringPath(tmp, rot);
    }
    const sats = Math.max(A.sats.length, B.sats.length);
    for (let i = 0; i < sats; i++) {
      const a = A.sats[i] || { ...B.sats[i], l: 0, w: 0 };
      const b = B.sats[i] || { ...A.sats[i], l: 0, w: 0 };
      const da = Math.atan2(Math.sin(b.a - a.a), Math.cos(b.a - a.a));
      d += satPath(
        a.c + (b.c - a.c) * m,
        a.a + da * m + rot,
        a.l + (b.l - a.l) * m,
        a.w + (b.w - a.w) * m,
        a.m + (b.m - a.m) * m,
      );
    }
    return d;
  };

  // Each morph turns by one petal so the next shape lands upright. Below six-fold symmetry
  // that turn is large enough to read as spinning, so those shapes hold still.
  const spin = (g) => (g.n && TAU / g.n <= Math.PI / 3 ? TAU / g.n : 0);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  let elapsed = 0;
  let last = 0;
  let raf = 0;
  let visible = false;
  let colour = 1;

  const setColour = (c) => {
    if (c === colour) return;
    el.classList.replace("ornament-c" + colour, "ornament-c" + c);
    colour = c;
  };

  const frame = (now) => {
    elapsed += Math.max(0, now - last) / 1000;
    last = now;
    const x = elapsed / STEP;
    const i = Math.floor(x);
    const ph = x - i;
    const from = shapes[i % shapes.length];
    const to = shapes[(i + 1) % shapes.length];
    const m = ph < HOLD ? 0 : ease((ph - HOLD) / (1 - HOLD));
    path.setAttribute("d", morph(from, to, m, UP + m * spin(to)));
    setColour(((ph < HOLD ? i : i + 1) % colours) + 1);
    raf = requestAnimationFrame(frame);
  };

  const update = () => {
    const run = visible && !motion.matches && !document.hidden;
    if (run && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      if (motion.matches) {
        elapsed = 0;
        path.setAttribute("d", morph(shapes[0], shapes[0], 0, UP));
        setColour(1);
      }
    }
  };

  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    update();
  }).observe(el);
  motion.addEventListener("change", update);
  document.addEventListener("visibilitychange", update);
})();
