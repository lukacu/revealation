/* Revealation ambient bubbles.
   Global interface: RevealationBackgrounds.bubbles.mount(host, { active, seed })
   Returns { setActive(bool), redraw(), snapshot(), destroy(), canvas }.
   Works with Reveal.js or any positioned container. No dependencies, no networking.
*/
(() => {
  'use strict';
  const registry = window.RevealationBackgrounds ||= {};

  const rngFromSeed = seed => {
    let state = (Number(seed) >>> 0) || 37913;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  };

  function mount(host, options = {}) {
    if (!(host instanceof Element)) throw new TypeError('Bubbles: host must be an Element');
    host.classList.add('rv-ambient-host');
    const canvas = document.createElement('canvas');
    canvas.className = 'rv-ambient-canvas rv-ambient-bubbles';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Bubbles: Canvas 2D is not supported');

    const random = rngFromSeed(options.seed ?? 2026);
    const bubbles = Array.from({ length: 36 }, () => ({
      x: random(), y: random(), radius: 0.018 + random() * 0.055,
      speed: 3 + random() * 8, drift: 0.7 + random() * 2,
      phase: random() * Math.PI * 2, line: 0.75 + random() * 0.7,
      brightness: 0.65 + random() * 0.65
    }));

    const animationState = options.state && typeof options.state === 'object' ? options.state : { time: 0 };
    let w = 0, h = 0, time = Number(animationState.time) || 0, lastStamp = 0, lastDraw = 0, frameId = 0, tickerId = 0;
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
      const count = Math.max(12, Math.min(29, Math.round(w * h / 66000)));
      const scale = Math.min(w, h);
      for (let i = 0; i < count; i++) {
        const b = bubbles[i];
        // ResizeObserver can briefly report a tiny canvas while Reveal moves
        // a background host between slides. Canvas arc() rejects a negative
        // radius, so keep the transient frame drawable until the real size
        // arrives.
        const r = Math.max(0.8, b.radius * scale);
        const loop = h + 2 * r;
        const y = (((b.y * h - t * b.speed + r) % loop) + loop) % loop - r;
        const x = b.x * w + Math.sin(t * b.drift * 0.21 + b.phase) * Math.min(18, w * 0.015);
        const visibility = b.brightness;

        // Airy, transparent interior: enough to read as a bubble, never a solid disc.
        const glow = ctx.createRadialGradient(x - 0.24 * r, y - 0.26 * r, r * 0.06, x, y, r);
        glow.addColorStop(0, `rgba(${accent}, ${0.072 * visibility})`);
        glow.addColorStop(0.45, `rgba(${accent}, ${0.015 * visibility})`);
        glow.addColorStop(1, `rgba(${accent}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

        ctx.strokeStyle = `rgba(${accent}, ${0.18 * visibility})`;
        ctx.lineWidth = b.line;
        ctx.beginPath(); ctx.arc(x, y, r - 0.6, 0, Math.PI * 2); ctx.stroke();

        // A partial specular glint provides depth without adding visual clutter.
        ctx.strokeStyle = `rgba(${accent}, ${0.24 * visibility})`;
        ctx.lineWidth = Math.max(1.1, r * 0.027);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(x, y, r * 0.83, 3.74, 4.65); ctx.stroke();
      }
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

    const shouldRun = () => active && !reducedMotion.matches && !destroyed;
    function tick(now) {
      frameId = 0;
      if (!shouldRun()) return;
      if (lastStamp) time += Math.min((now - lastStamp) / 1000, 0.06);
      animationState.time = time;
      lastStamp = now;
      if (now - lastDraw >= 1000 / 30) { draw(time); lastDraw = now; }
      frameId = requestAnimationFrame(tick);
    }
    function stop() {
      if (frameId) cancelAnimationFrame(frameId);
      if (tickerId) clearInterval(tickerId);
      frameId = 0; lastStamp = 0;
      tickerId = 0;
      animationState.time = time;
    }
    function sync() {
      stop();
      if (!shouldRun()) { draw(time); return; }
      draw(time);
      tickerId = setInterval(() => {
        if (!shouldRun()) return;
        time += 1 / 30;
        animationState.time = time;
        draw(time);
      }, 1000 / 30);
    }
    function beforePrint() {
      restoreAfterPrint = active;
      active = false; stop(); draw(0); // Deterministic printable appearance.
    }
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
      resume() {
        active = true;
        time = Number(animationState.time) || time;
        lastStamp = 0;
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
  registry.bubbles = { mount };
  window.RevealationBackgroundRuntime?.register('bubbles', (host, context) => {
    const effect = mount(host, { active: false, state: context?.state });
    return {
      start() { effect.resume(); },
      stop() { effect.setActive(false); },
      destroy() { effect.destroy(); },
    };
  });
})();
