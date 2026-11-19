import { useEffect, useRef } from 'react';

const ORANGE = '#FF6A1A';
const MAX_LINK_DISTANCE = 145;
const TWO_PI = Math.PI * 2;

function createNodes(width, height) {
  const areaCount = Math.round((width * height) / 15500);
  const count = Math.max(width < 600 ? 18 : 28, Math.min(90, areaCount));
  const nodes = new Array(count);
  const speedScale = width < 600 ? 0.72 : 1;

  for (let index = 0; index < count; index += 1) {
    const speed = (5 + Math.random() * 7) * speedScale;
    const angle = Math.random() * TWO_PI;
    nodes[index] = {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 0.65 + Math.random() * 0.75,
      phase: Math.random() * TWO_PI,
      active: Math.random() < 0.13,
    };
  }

  return nodes;
}

export default function NeuralBackground({ staticMode = false }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !context) return undefined;

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let nodes = [];
    let animationFrame = 0;
    let previousTime = 0;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      nodes = createNodes(width, height);
      previousTime = 0;
      render(0, staticMode || motionPreference.matches);
    };

    const render = (time, isStatic = false) => {
      const elapsed = previousTime ? Math.min((time - previousTime) / 1000, 0.04) : 0;
      previousTime = time;
      context.clearRect(0, 0, width, height);

      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        if (!isStatic && elapsed > 0) {
          node.x += node.vx * elapsed;
          node.y += node.vy * elapsed;
          if (node.x < -8) node.x = width + 8;
          else if (node.x > width + 8) node.x = -8;
          if (node.y < -8) node.y = height + 8;
          else if (node.y > height + 8) node.y = -8;
        }
      }

      for (let left = 0; left < nodes.length; left += 1) {
        const first = nodes[left];
        for (let right = left + 1; right < nodes.length; right += 1) {
          const second = nodes[right];
          const dx = second.x - first.x;
          const dy = second.y - first.y;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared >= MAX_LINK_DISTANCE * MAX_LINK_DISTANCE) continue;

          const distanceRatio = Math.sqrt(distanceSquared) / MAX_LINK_DISTANCE;
          context.beginPath();
          context.moveTo(first.x, first.y);
          context.lineTo(second.x, second.y);
          context.strokeStyle = first.active || second.active ? ORANGE : '#D9DCE2';
          context.globalAlpha = (first.active || second.active ? 0.095 : 0.12) * (1 - distanceRatio) + 0.012;
          context.lineWidth = 1;
          context.stroke();
        }
      }

      context.globalAlpha = 1;
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        const pulse = isStatic ? 0 : (Math.sin(time * 0.00115 + node.phase) + 1) * 0.5;
        const radius = node.active ? 1.45 + pulse * 0.55 : node.radius;
        context.beginPath();
        context.arc(node.x, node.y, radius, 0, TWO_PI);
        context.fillStyle = node.active ? ORANGE : '#D9DCE2';
        context.globalAlpha = node.active ? 0.55 + pulse * 0.35 : 0.32 + node.radius * 0.22;
        context.shadowColor = node.active ? ORANGE : 'transparent';
        context.shadowBlur = node.active ? 12 + pulse * 8 : 0;
        context.fill();
      }
      context.globalAlpha = 1;
      context.shadowBlur = 0;

      if (!isStatic && !staticMode && !motionPreference.matches) animationFrame = window.requestAnimationFrame(render);
    };

    const onMotionChange = () => {
      window.cancelAnimationFrame(animationFrame);
      previousTime = 0;
      render(0, staticMode || motionPreference.matches);
    };

    resize();
    if (!staticMode && !motionPreference.matches) animationFrame = window.requestAnimationFrame(render);
    window.addEventListener('resize', resize, { passive: true });
    motionPreference.addEventListener?.('change', onMotionChange);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', resize);
      motionPreference.removeEventListener?.('change', onMotionChange);
    };
  }, [staticMode]);

  return <canvas ref={canvasRef} className={`neural-background${staticMode ? ' neural-background-static' : ''}`} aria-hidden="true" />;
}
