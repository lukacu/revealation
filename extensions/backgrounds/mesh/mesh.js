/* Revealation ambient mesh.
   Global interface: RevealationBackgrounds.mesh.mount(host, { active, seed })
   Returns { setActive(bool), redraw(), snapshot(), destroy(), canvas }.
   Slow deformations of a triangulated lattice, without network or dependencies.
*/
(() => {
  'use strict';
  const registry = window.RevealationBackgrounds ||= {};
  const rngFromSeed = seed => {
    let state = (Number(seed) >>> 0) || 2718;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  };

  function mount(host, options = {}) {
    if (!(host instanceof Element)) throw new TypeError('Mesh: host must be an Element');
    host.classList.add('rv-ambient-host');
    const canvas = document.createElement('canvas');
    canvas.className = 'rv-ambient-canvas rv-ambient-mesh';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Mesh: Canvas 2D is not supported');

    const random = rngFromSeed(options.seed ?? 271828);
    const cols = 13, rows = 8;
    const nodes = Array.from({ length: cols * rows }, (_, k) => {
      const i = k % cols, j = Math.floor(k / cols);
      return {
        u: (i + (random() - 0.5) * 0.30) / (cols - 1),
        v: (j + (random() - 0.5) * 0.27) / (rows - 1),
        phase: random() * Math.PI * 2,
        freq: 0.16 + random() * 0.15,
        mag: 0.6 + random() * 0.6,
        accent: random() > 0.88
      };
    });
    const edges = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const here = j * cols + i;
        if (i < cols - 1) edges.push([here, here + 1]);
        if (j < rows - 1) edges.push([here, here + cols]);
        if (i < cols - 1 && j < rows - 1) {
          edges.push((i + j) % 2 ? [here + 1, here + cols] : [here, here + cols + 1]);
        }
      }
    }

    const animationState = options.state && typeof options.state === 'object' ? options.state : { time: 0 };
    let w = 0, h = 0, time = Number(animationState.time) || 0, lastStamp = 0, lastDraw = 0, frameId = 0;
    let active = options.active !== false;
    let restoreAfterPrint = false;
    let destroyed = false;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const colorProbe = document.createElement('canvas').getContext('2d');
    function accentRgb() {
      const raw = getComputedStyle(host).getPropertyValue('--rv-accent').trim() || '#6b4eff';
      colorProbe.fillStyle = raw;
      const normalized = colorProbe.fillStyle;
      const hex = normalized.match(/^#([0-9a-f]{6})$/i);
      if (hex) {
        const value = hex[1];
        return `${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}`;
      }
      const rgb = normalized.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i);
      return rgb ? `${rgb[1]}, ${rgb[2]}, ${rgb[3]}` : '107, 78, 255';
    }
    const getAccent = () => {
      return accentRgb();
    };

    function draw(t = 0) {
      if (destroyed || w <= 0 || h <= 0) return;
      ctx.clearRect(0, 0, w, h);
      const accent = getAccent();
      const marginX = 0, marginY = 0;
      const amp = Math.min(w / cols, h / rows) * 0.14;
      const positions = nodes.map(n => ({
        x: marginX + n.u * (w - 2 * marginX) + Math.sin(t * n.freq + n.phase) * amp * n.mag,
        y: marginY + n.v * (h - 2 * marginY) + Math.cos(t * n.freq * 0.85 + n.phase * 1.7) * amp * n.mag
      }));
      const visibility = (x, y) => {
        const nx = (x - w / 2) / (w / 2), ny = (y - h / 2) / (h / 2);
        return Math.max(0.33, Math.min(1, 0.38 + 0.6 * Math.sqrt(nx * nx + ny * ny)));
      };

      ctx.lineWidth = 0.8;
      edges.forEach(([a, b]) => {
        const p = positions[a], q = positions[b];
        const strength = visibility((p.x + q.x) / 2, (p.y + q.y) / 2);
        ctx.strokeStyle = `rgba(${accent}, ${0.145 * strength})`;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      });
      positions.forEach((p, i) => {
        const strength = visibility(p.x, p.y);
        const emph = nodes[i].accent;
        ctx.fillStyle = `rgba(${accent}, ${(emph ? 0.43 : 0.26) * strength})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, emph ? 1.8 : 1.05, 0, Math.PI * 2); ctx.fill();
        if (emph) {
          ctx.strokeStyle = `rgba(${accent}, ${0.11 * strength})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(p.x, p.y, 4.7, 0, Math.PI * 2); ctx.stroke();
        }
      });
    }

    function resize() {
      if (destroyed) return;
      const rect = host.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(time);
    }

    const shouldRun = () => active && !document.hidden && !reducedMotion.matches && !destroyed;
    function tick(now) {
      frameId = 0;
      if (!shouldRun()) return;
      if (lastStamp) time += Math.min((now - lastStamp) / 1000, 0.06);
      animationState.time = time;
      lastStamp = now;
      if (now - lastDraw >= 1000 / 30) { draw(time); lastDraw = now; }
      frameId = requestAnimationFrame(tick);
    }
    function stop() { if (frameId) cancelAnimationFrame(frameId); frameId = 0; lastStamp = 0; animationState.time = time; }
    function sync() {
      stop();
      if (shouldRun()) frameId = requestAnimationFrame(tick);
      else draw(time);
    }
    function beforePrint() { restoreAfterPrint = active; active = false; stop(); draw(0); }
    function afterPrint() { active = restoreAfterPrint; draw(time); sync(); }

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(host);
    else window.addEventListener('resize', resize);
    const reducedListener = () => sync();
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', reducedListener);
    else reducedMotion.addListener(reducedListener);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    resize(); sync();

    return {
      canvas,
      setActive(value) {
        active = !!value;
        if (active) time = Number(animationState.time) || time;
        sync();
      },
      redraw() { resize(); },
      snapshot() { draw(0); return canvas.toDataURL('image/png'); },
      destroy() {
        if (destroyed) return;
        stop(); destroyed = true;
        if (observer) observer.disconnect();
        else window.removeEventListener('resize', resize);
        if (reducedMotion.removeEventListener) reducedMotion.removeEventListener('change', reducedListener);
        else reducedMotion.removeListener(reducedListener);
        document.removeEventListener('visibilitychange', sync);
        window.removeEventListener('beforeprint', beforePrint);
        window.removeEventListener('afterprint', afterPrint);
        canvas.remove();
        if (!host.querySelector('.rv-ambient-canvas')) host.classList.remove('rv-ambient-host');
      }
    };
  }
  registry.mesh = { mount };
  window.RevealationBackgroundRuntime?.register('mesh', (host, context) => {
    const effect = mount(host, { active: false, state: context?.state });
    return {
      start() { effect.setActive(true); },
      stop() { effect.setActive(false); },
      destroy() { effect.destroy(); },
    };
  });
})();
