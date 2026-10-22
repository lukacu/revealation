/* Revealation floating grid background. */
(() => {
  'use strict';

  function mount(host, options = {}) {
    const canvas = document.createElement('canvas');
    canvas.className = 'rv-grid-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Grid: Canvas 2D is not supported');

    const colorProbe = document.createElement('canvas').getContext('2d');
    const accentRgb = () => {
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
    };

    const random = (Number(options.seed) >>> 0) || 1741;
    let seed = random;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const cols = 16, rows = 10;
    const nodes = Array.from({ length: cols * rows }, (_, index) => ({
      u: (index % cols) / (cols - 1),
      v: Math.floor(index / cols) / (rows - 1),
      phase: next() * Math.PI * 2,
      speed: .45 + next() * .75,
      glow: next() > .78,
    }));
    const animationState = options.state && typeof options.state === 'object' ? options.state : { time: 0 };
    let width = 0, height = 0, time = Number(animationState.time) || 0, last = 0, frame = 0, ticker = 0, active = options.active !== false, destroyed = false;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function resize() {
      const rect = host.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(time);
    }
    function draw(now) {
      if (destroyed) return;
      ctx.clearRect(0, 0, width, height);
      const accent = accentRgb();
      const points = nodes.map(node => ({ x: node.u * width, y: node.v * height }));
      ctx.lineWidth = .8;
      for (let index = 0; index < points.length; index++) {
        const node = nodes[index];
        const point = points[index];
        if (index % cols < cols - 1) line(point, points[index + 1], accent, .16);
        if (index + cols < points.length) line(point, points[index + cols], accent, .16);
        const pulse = .16 + (node.glow ? .60 : .12) * (0.5 + 0.5 * Math.sin(now * node.speed + node.phase));
        if (node.glow) {
          const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 13);
          glow.addColorStop(0, `rgba(${accent}, ${pulse})`);
          glow.addColorStop(1, `rgba(${accent}, 0)`);
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(point.x, point.y, 13, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = `rgba(${accent}, ${pulse})`;
        ctx.beginPath(); ctx.arc(point.x, point.y, node.glow ? 1.8 : 1, 0, Math.PI * 2); ctx.fill();
      }
    }
    function line(a, b, accent, alpha) {
      ctx.strokeStyle = `rgba(${accent}, ${alpha})`;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    function stop() {
      if (frame) cancelAnimationFrame(frame);
      if (ticker) clearInterval(ticker);
      frame = 0; ticker = 0; last = 0; animationState.time = time;
    }
    function tick(stamp) {
      frame = 0;
      if (!active || document.hidden || reducedMotion.matches || destroyed) return;
      if (last) time += Math.min((stamp - last) / 1000, .06);
      animationState.time = time;
      last = stamp;
      draw(time);
      frame = requestAnimationFrame(tick);
    }
    function sync() {
      stop();
      draw(time);
      if (active && !document.hidden && !reducedMotion.matches && !destroyed) {
        ticker = setInterval(() => {
          if (document.hidden) return;
          time += 1 / 30;
          animationState.time = time;
          draw(time);
        }, 1000 / 30);
      }
    }
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(host); else window.addEventListener('resize', resize);
    const reducedListener = () => sync();
    if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', reducedListener);
    else reducedMotion.addListener(reducedListener);
    document.addEventListener('visibilitychange', sync);
    resize();

    return {
      start() { time = Number(animationState.time) || time; active = true; sync(); },
      stop() { active = false; sync(); },
      redraw() { resize(); },
      destroy() {
        if (destroyed) return;
        stop(); destroyed = true;
        if (observer) observer.disconnect(); else window.removeEventListener('resize', resize);
        if (reducedMotion.removeEventListener) reducedMotion.removeEventListener('change', reducedListener);
        else reducedMotion.removeListener(reducedListener);
        document.removeEventListener('visibilitychange', sync);
        canvas.remove();
      },
    };
  }

  window.RevealationBackgroundRuntime?.register('grid', (host, context) => mount(host, { active: false, state: context?.state }));
})();
