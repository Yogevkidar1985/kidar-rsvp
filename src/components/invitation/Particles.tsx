'use client';
import { useEffect, useRef } from 'react';
import type { ParticleKind } from '@/lib/types';

type Props = {
  kind: ParticleKind; count: number; colors: string[];
  /** fall: drift down from `originY`; burst: thrown up from the bottom, then fall */
  mode: 'fall' | 'burst';
  speed?: number; intensity?: number;
  /** size multiplies every piece; thick only its narrow side (a sliver at 0.4, a chunky piece at 2.5) */
  size?: number; thick?: number;
  /** seconds; 0 = keep going (fall mode only) */
  duration?: number;
  /** px from the top of the canvas where falling pieces appear */
  originY?: number;
  onDone?: () => void;
  className?: string; style?: React.CSSProperties;
};
type P = { x: number; y: number; vx: number; vy: number; r: number; rot: number; vr: number; sway: number; ph: number; c: string; life: number; k: ParticleKind };
const ORGANIC = new Set<ParticleKind>(['petals', 'feathers', 'hearts', 'stars']);
/** What "a mix" is made of. */
export const MIX: ParticleKind[] = ['confetti', 'ribbons', 'dots', 'stars', 'triangles', 'squares'];

/** Draws one piece around the origin. `thick` scales the narrow side only. */
export function shape(ctx: CanvasRenderingContext2D, kind: ParticleKind, r: number, thick = 1) {
  ctx.beginPath();
  switch (kind) {
    case 'ribbons': {
      // a long strip with a wave in it, like paper streamer cut short
      const l = r * 2.1, t = Math.max(0.8, r * 0.2 * thick);
      ctx.moveTo(-l, -t); ctx.bezierCurveTo(-l * 0.4, -t - r * 0.7, l * 0.4, -t + r * 0.7, l, -t);
      ctx.lineTo(l, t); ctx.bezierCurveTo(l * 0.4, t + r * 0.7, -l * 0.4, t - r * 0.7, -l, t); ctx.closePath();
      break;
    }
    case 'dots': ctx.ellipse(0, 0, r * 0.62, r * 0.62 * Math.min(1, 0.5 + thick * 0.5), 0, 0, Math.PI * 2); break;
    case 'squares': ctx.rect(-r * 0.6, -r * 0.6 * Math.min(1.4, thick), r * 1.2, r * 1.2 * Math.min(1.4, thick)); break;
    case 'triangles': ctx.moveTo(0, -r * 0.85 * Math.min(1.5, thick)); ctx.lineTo(r * 0.8, r * 0.6); ctx.lineTo(-r * 0.8, r * 0.6); ctx.closePath(); break;
    case 'sparkles': {
      // a four-pointed glint: thicker means a fuller waist
      const wst = r * 0.16 * thick;
      for (let i = 0; i < 8; i++) { const a = (Math.PI / 4) * i - Math.PI / 2, rr = i % 2 ? Math.min(r * 0.6, wst * 1.6) : r * 1.15; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath();
      break;
    }

    case 'petals':
      ctx.moveTo(0, -r); ctx.bezierCurveTo(r * 0.9, -r * 0.6, r * 0.7, r * 0.8, 0, r); ctx.bezierCurveTo(-r * 0.7, r * 0.8, -r * 0.9, -r * 0.6, 0, -r);
      break;
    case 'feathers':
      ctx.moveTo(0, -r * 1.5); ctx.bezierCurveTo(r * 0.55, -r * 0.7, r * 0.45, r * 0.8, 0, r * 1.5); ctx.bezierCurveTo(-r * 0.45, r * 0.8, -r * 0.55, -r * 0.7, 0, -r * 1.5);
      break;
    case 'hearts':
      ctx.moveTo(0, r * 0.9); ctx.bezierCurveTo(-r * 1.5, -r * 0.2, -r * 0.7, -r * 1.2, 0, -r * 0.4); ctx.bezierCurveTo(r * 0.7, -r * 1.2, r * 1.5, -r * 0.2, 0, r * 0.9);
      break;
    case 'stars':
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      break;
    default:
      ctx.rect(-r * 0.7, -r * 0.35 * thick, r * 1.4, r * 0.7 * thick);
  }
  ctx.fill();
}

export default function Particles({ kind, count, colors, mode, speed = 1, intensity = 0.8, size: scale = 1, thick = 1, duration = 0, originY = 0, onDone, className, style }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !colors.length) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { done.current?.(); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const weak = (navigator.hardwareConcurrency ?? 8) <= 4;
    const total = Math.max(1, Math.round(Math.min(count, 300) * (weak ? 0.5 : 1)));
    const dpr = Math.min(window.devicePixelRatio || 1, weak ? 1 : 2);
    let w = 0, h = 0, raf = 0, last = 0, visible = true, stopped = false;
    const start = performance.now();
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const size = () => {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const spawn = (first: boolean): P => {
      const base = { k: kind === 'mix' ? MIX[Math.floor(Math.random() * MIX.length)] : kind, r: rand(5, 10) * (0.6 + intensity * 0.6) * scale, rot: rand(0, 6.28), vr: rand(-1.4, 1.4), sway: rand(10, 34), ph: rand(0, 6.28), c: colors[Math.floor(Math.random() * colors.length)] };
      if (mode === 'burst') {
        const a = rand(-Math.PI * 0.86, -Math.PI * 0.14), v = rand(520, 1150) * Math.min(1, h / 760 + 0.25) * (0.75 + 0.25 * speed);
        return { ...base, x: w / 2 + rand(-w * 0.18, w * 0.18), y: h + 10, vx: Math.cos(a) * v * 0.55, vy: Math.sin(a) * v, life: 1 };
      }
      return { ...base, x: rand(w * 0.12, w * 0.88), y: first ? rand(originY, h) : originY + rand(-6, 6), vx: rand(-8, 8), vy: rand(26, 62) * speed, life: 1 };
    };
    const ps: P[] = Array.from({ length: total }, () => spawn(mode === 'fall'));
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf && !stopped) raf = requestAnimationFrame(tick); });
    io.observe(canvas);

    function tick(now: number) {
      raf = 0;
      if (stopped) return;
      const dt = Math.min((now - (last || now)) / 1000, 0.05);
      last = now;
      const elapsed = (now - start) / 1000;
      const ending = duration > 0 && elapsed > duration;
      ctx!.clearRect(0, 0, w, h);
      let alive = 0;
      for (const p of ps) {
        if (p.life <= 0) continue;
        if (mode === 'burst') { p.vy += 900 * dt * speed; p.vx *= 1 - 0.9 * dt; if (p.vy > 220 * speed) p.vy = 220 * speed; }
        p.ph += dt * 1.6;
        p.x += (p.vx + Math.sin(p.ph) * p.sway * (mode === 'burst' ? 0.6 : 1)) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        const fadeEdge = mode === 'fall' ? Math.min(1, (p.y - originY + 12) / 60) * Math.min(1, (h - p.y) / 140) : 1;
        if (ending) p.life -= dt * 1.2;
        if (p.y > h + 20 || p.x < -40 || p.x > w + 40) {
          if (mode === 'fall' && !ending) Object.assign(p, spawn(false)); else p.life = 0;
        }
        if (p.life <= 0) continue;
        alive++;
        ctx!.save();
        ctx!.globalAlpha = Math.max(0, Math.min(1, fadeEdge)) * p.life * (0.35 + intensity * 0.6);
        ctx!.translate(p.x, p.y); ctx!.rotate(p.rot); ctx!.scale(ORGANIC.has(p.k) ? Math.min(1.5, 0.55 + 0.45 * thick) : 1, 0.55 + 0.45 * Math.cos(p.ph * 1.3));
        ctx!.fillStyle = p.c;
        shape(ctx!, p.k, p.r, thick);
        ctx!.restore();
      }
      if (!alive) { stopped = true; ctx!.clearRect(0, 0, w, h); done.current?.(); return; }
      if (visible && !document.hidden) raf = requestAnimationFrame(tick);
    }
    const onVis = () => { if (!document.hidden && !raf && !stopped && visible) { last = 0; raf = requestAnimationFrame(tick); } };
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); };
  }, [kind, count, colors, mode, speed, intensity, scale, thick, duration, originY]);

  return <canvas ref={ref} aria-hidden className={className} style={{ pointerEvents: 'none', ...style }} />;
}
