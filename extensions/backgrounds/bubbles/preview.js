/* Revealation bubbles static editor preview. */
(() => {
  'use strict';
  const previews = window.RevealationBackgroundPreviews;
  if (!previews) return;

  function accentRgb(host, probe) {
    probe.fillStyle = getComputedStyle(host).getPropertyValue('--rv-accent').trim() || '#6b4eff';
    const normalized = probe.fillStyle;
    const hex = normalized.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      const value = hex[1];
      return `${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}`;
    }
    const rgb = normalized.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i);
    return rgb ? `${rgb[1]}, ${rgb[2]}, ${rgb[3]}` : '107, 78, 255';
  }

  function paint(host) {
    const canvas = document.createElement('canvas');
    canvas.className = 'rv-static-background-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d', { alpha: true });
    const probe = document.createElement('canvas').getContext('2d');
    if (!ctx || !probe) return;
    host.style.backgroundColor = getComputedStyle(host).getPropertyValue('--rv-bg').trim() || 'transparent';

    let seed = 2026;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const bubbles = Array.from({ length: 36 }, () => ({
      x: random(), y: random(), radius: .018 + random() * .055,
      line: .75 + random() * .7, brightness: .65 + random() * .65,
      phase: random() * Math.PI * 2,
    }));

    function draw() {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const accent = accentRgb(host, probe);
      const count = Math.max(12, Math.min(29, Math.round(width * height / 66000)));
      const scale = Math.min(width, height);
      for (let index = 0; index < count; index++) {
        const bubble = bubbles[index];
        const radius = Math.max(.8, bubble.radius * scale);
        const x = bubble.x * width;
        const y = bubble.y * height;
        const visibility = bubble.brightness;
        const glow = ctx.createRadialGradient(x - .24 * radius, y - .26 * radius, radius * .06, x, y, radius);
        glow.addColorStop(0, `rgba(${accent}, ${.072 * visibility})`);
        glow.addColorStop(.45, `rgba(${accent}, ${.015 * visibility})`);
        glow.addColorStop(1, `rgba(${accent}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(${accent}, ${.18 * visibility})`;
        ctx.lineWidth = bubble.line;
        ctx.beginPath(); ctx.arc(x, y, radius - .6, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = `rgba(${accent}, ${.24 * visibility})`;
        ctx.lineWidth = Math.max(1.1, radius * .027);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(x, y, radius * .83, 3.74, 4.65); ctx.stroke();
      }
    }
    draw();
    return draw;
  }

  previews.register('bubbles', paint);
})();
