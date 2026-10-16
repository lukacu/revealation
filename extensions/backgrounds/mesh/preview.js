/* Revealation mesh static editor preview. */
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

    const cols = 13, rows = 8, nodes = [];
    let seed = 271828;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let index = 0; index < cols * rows; index++) {
      const col = index % cols, row = Math.floor(index / cols);
      nodes.push({
        u: (col + (random() - .5) * .3) / (cols - 1),
        v: (row + (random() - .5) * .27) / (rows - 1),
        bright: index % 11 === 0,
      });
    }

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
      const points = nodes.map(node => ({ x: node.u * width, y: node.v * height }));
      ctx.lineWidth = .8;
      nodes.forEach((node, index) => {
        const point = points[index], col = index % cols;
        const connect = (other, alpha) => {
          ctx.strokeStyle = `rgba(${accent}, ${alpha})`;
          ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(other.x, other.y); ctx.stroke();
        };
        if (col < cols - 1) connect(points[index + 1], .14);
        if (index + cols < points.length) connect(points[index + cols], .14);
        if (col < cols - 1 && index + cols < points.length) connect(points[index + cols + 1], .08);
      });
      nodes.forEach((node, index) => {
        const point = points[index];
        ctx.fillStyle = `rgba(${accent}, ${node.bright ? .42 : .25})`;
        ctx.beginPath(); ctx.arc(point.x, point.y, node.bright ? 1.8 : 1.05, 0, Math.PI * 2); ctx.fill();
      });
    }
    draw();
    return draw;
  }

  previews.register('mesh', paint);
})();
