/* Revealation grid static editor preview. */
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
      const cols = 16, rows = 10;
      ctx.lineWidth = .8;
      ctx.strokeStyle = `rgba(${accent}, .16)`;
      for (let col = 0; col < cols; col++) {
        const x = col * width / (cols - 1);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let row = 0; row < rows; row++) {
        const y = row * height / (rows - 1);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
      [19, 52, 91, 126].forEach(index => {
        const x = (index % cols) * width / (cols - 1);
        const y = Math.floor(index / cols) * height / (rows - 1);
        const radius = Math.max(10, width * .018);
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, `rgba(${accent}, .52)`);
        glow.addColorStop(1, `rgba(${accent}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(${accent}, .55)`;
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
      });
    }
    draw();
    return draw;
  }

  previews.register('grid', paint);
})();
