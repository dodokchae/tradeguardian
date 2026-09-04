'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface ClosePositionResult {
  symbol: string;
  pnl: number;       // dollar P&L
  pnlPercent: number; // percentage P&L (already multiplied by 100)
  entryPrice: number;
  exitPrice: number;
  qty: number;
  isOption?: boolean;
  isCrypto?: boolean;
}

interface Props {
  result: ClosePositionResult | null;
  onDismiss: () => void;
}

// ─── Web Audio Sound Effects ───────────────────────────────────────────
function playWinSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + i * 0.12 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.6);
    });
    // Shimmer
    const shimmer = ctx.createOscillator();
    const shimmerGain = ctx.createGain();
    shimmer.type = 'triangle';
    shimmer.frequency.setValueAtTime(1568, ctx.currentTime + 0.5);
    shimmer.frequency.exponentialRampToValueAtTime(2093, ctx.currentTime + 0.8);
    shimmerGain.gain.setValueAtTime(0.1, ctx.currentTime + 0.5);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(ctx.destination);
    shimmer.start(ctx.currentTime + 0.5);
    shimmer.stop(ctx.currentTime + 1.3);
  } catch { /* Audio not supported */ }
}

function playLoseSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    // Descending minor tone
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(440, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.6);
    gain1.gain.setValueAtTime(0.15, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.8);
    // Low buzz
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(110, ctx.currentTime + 0.3);
    osc2.frequency.exponentialRampToValueAtTime(73, ctx.currentTime + 0.9);
    gain2.gain.setValueAtTime(0.08, ctx.currentTime + 0.3);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.3);
    osc2.stop(ctx.currentTime + 1.1);
  } catch { /* Audio not supported */ }
}

// ─── Confetti Canvas ───────────────────────────────────────────────────
interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  color: string;
  size: number;
  rotation: number;
  rotSpeed: number;
  shape: 'rect' | 'circle';
  opacity: number;
  gravity: number;
}

function createConfettiParticles(w: number, h: number): Particle[] {
  const colors = ['#10b981', '#34d399', '#6ee7b7', '#facc15', '#fde047', '#a3e635', '#38bdf8', '#818cf8', '#f472b6', '#fb923c'];
  const particles: Particle[] = [];
  for (let i = 0; i < 150; i++) {
    particles.push({
      x: Math.random() * w,
      y: -20 - Math.random() * h * 0.5,
      vx: (Math.random() - 0.5) * 8,
      vy: Math.random() * 4 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 8 + 4,
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 12,
      shape: Math.random() > 0.5 ? 'rect' : 'circle',
      opacity: 1,
      gravity: 0.12 + Math.random() * 0.08,
    });
  }
  return particles;
}

// ─── Loss shatter particles ───────────────────────────────────────────
interface ShatterParticle {
  x: number; y: number;
  vx: number; vy: number;
  size: number;
  opacity: number;
  color: string;
  decay: number;
}

function createShatterParticles(cx: number, cy: number): ShatterParticle[] {
  const colors = ['#f43f5e', '#fb7185', '#fda4af', '#881337', '#e11d48', '#9f1239'];
  const particles: ShatterParticle[] = [];
  for (let i = 0; i < 80; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 6 + 2;
    particles.push({
      x: cx + (Math.random() - 0.5) * 60,
      y: cy + (Math.random() - 0.5) * 60,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.random() * 5 + 2,
      opacity: 1,
      color: colors[Math.floor(Math.random() * colors.length)],
      decay: 0.012 + Math.random() * 0.015,
    });
  }
  return particles;
}

export const ClosePositionResultOverlay: React.FC<Props> = ({ result, onDismiss }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const [show, setShow] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const soundPlayedRef = useRef(false);

  const handleDismiss = useCallback(() => {
    setFadeOut(true);
    setTimeout(() => {
      setShow(false);
      setFadeOut(false);
      onDismiss();
    }, 400);
  }, [onDismiss]);

  useEffect(() => {
    if (!result) {
      setShow(false);
      soundPlayedRef.current = false;
      return;
    }
    setShow(true);
    setFadeOut(false);

    // Play sound
    if (!soundPlayedRef.current) {
      soundPlayedRef.current = true;
      if (result.pnl >= 0) {
        playWinSound();
      } else {
        playLoseSound();
      }
    }

    // Auto-dismiss after 6s
    const timer = setTimeout(handleDismiss, 6000);
    return () => clearTimeout(timer);
  }, [result, handleDismiss]);

  // Canvas animation
  useEffect(() => {
    if (!show || !result || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const isWin = result.pnl >= 0;

    if (isWin) {
      // Confetti
      const particles = createConfettiParticles(canvas.width, canvas.height);
      const animate = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;
        particles.forEach((p) => {
          p.vy += p.gravity;
          p.x += p.vx;
          p.y += p.vy;
          p.rotation += p.rotSpeed;
          p.vx *= 0.99;
          if (p.y > canvas.height + 50) {
            p.opacity -= 0.02;
          }
          if (p.opacity <= 0) return;
          alive = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;
          if (p.shape === 'rect') {
            ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          } else {
            ctx.beginPath();
            ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        });
        if (alive) {
          animFrameRef.current = requestAnimationFrame(animate);
        }
      };
      animate();
    } else {
      // Shatter / crack effect
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const particles = createShatterParticles(cx, cy);

      // Draw cracks
      const cracks: Array<{ points: Array<{ x: number; y: number }> }> = [];
      for (let i = 0; i < 8; i++) {
        const pts: Array<{ x: number; y: number }> = [{ x: cx, y: cy }];
        let angle = Math.random() * Math.PI * 2;
        let px = cx, py = cy;
        const segments = 4 + Math.floor(Math.random() * 5);
        for (let j = 0; j < segments; j++) {
          angle += (Math.random() - 0.5) * 1.2;
          const len = 30 + Math.random() * 80;
          px += Math.cos(angle) * len;
          py += Math.sin(angle) * len;
          pts.push({ x: px, y: py });
        }
        cracks.push({ points: pts });
      }

      let frame = 0;
      const animate = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        frame++;

        // Screen shake in first 10 frames
        if (frame < 10) {
          const shakeX = (Math.random() - 0.5) * 8;
          const shakeY = (Math.random() - 0.5) * 8;
          ctx.save();
          ctx.translate(shakeX, shakeY);
        }

        // Draw cracks with growing reveal
        const revealProgress = Math.min(frame / 20, 1);
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.6)';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#f43f5e';
        ctx.shadowBlur = 12;
        cracks.forEach((crack) => {
          const drawCount = Math.ceil(crack.points.length * revealProgress);
          ctx.beginPath();
          ctx.moveTo(crack.points[0].x, crack.points[0].y);
          for (let i = 1; i < drawCount; i++) {
            ctx.lineTo(crack.points[i].x, crack.points[i].y);
          }
          ctx.stroke();
        });
        ctx.shadowBlur = 0;

        // Draw shatter particles
        let alive = false;
        particles.forEach((p) => {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.06;
          p.vx *= 0.98;
          p.opacity -= p.decay;
          if (p.opacity <= 0) return;
          alive = true;
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        });
        ctx.globalAlpha = 1;

        // Vignette pulse
        if (frame < 60) {
          const pulse = Math.sin(frame * 0.15) * 0.1 + 0.15;
          const gradient = ctx.createRadialGradient(cx, cy, canvas.width * 0.2, cx, cy, canvas.width * 0.7);
          gradient.addColorStop(0, 'transparent');
          gradient.addColorStop(1, `rgba(136, 19, 55, ${pulse})`);
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        if (frame < 10) {
          ctx.restore();
        }

        if (alive || frame < 60) {
          animFrameRef.current = requestAnimationFrame(animate);
        }
      };
      animate();
    }

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [show, result]);

  if (!show || !result) return null;

  const isWin = result.pnl >= 0;
  const absP = Math.abs(result.pnl);
  const absPct = Math.abs(result.pnlPercent);

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-all duration-400 ${
        fadeOut ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
      }`}
      onClick={handleDismiss}
      style={{ cursor: 'pointer' }}
    >
      {/* Dark backdrop */}
      <div className={`absolute inset-0 ${isWin ? 'bg-black/70' : 'bg-black/80'} backdrop-blur-sm`} />

      {/* Particle canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 1 }}
      />

      {/* Result card */}
      <div
        className={`relative z-10 max-w-md w-full mx-4 rounded-2xl border shadow-2xl p-8 text-center animate-in zoom-in-95 fade-in duration-300 ${
          isWin
            ? 'bg-gradient-to-b from-[#10b981]/20 via-[#131315] to-[#131315] border-[#10b981]/40 shadow-[0_0_60px_rgba(16,185,129,0.25)]'
            : 'bg-gradient-to-b from-rose-500/15 via-[#131315] to-[#131315] border-rose-500/40 shadow-[0_0_60px_rgba(244,63,94,0.2)]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon */}
        <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4 ${
          isWin
            ? 'bg-[#10b981]/20 border-2 border-[#10b981]/50'
            : 'bg-rose-500/15 border-2 border-rose-500/40'
        }`}>
          <span className={`material-symbols-outlined text-5xl ${isWin ? 'text-[#10b981]' : 'text-rose-400'}`}>
            {isWin ? 'emoji_events' : 'trending_down'}
          </span>
        </div>

        {/* Title */}
        <h2 className={`text-2xl font-black mb-1 ${isWin ? 'text-[#10b981]' : 'text-rose-400'}`}>
          {isWin ? 'Position Closed — Profit!' : 'Position Closed — Loss'}
        </h2>
        <p className="text-xs text-[#a1a1aa] mb-5">
          {result.symbol} • {result.qty} {result.isOption ? 'contract' : result.isCrypto ? 'token' : 'share'}{result.qty > 1 ? 's' : ''}
        </p>

        {/* P&L Display */}
        <div className={`text-5xl font-black font-mono mb-2 tracking-tight ${isWin ? 'text-[#10b981]' : 'text-rose-400'}`}>
          {isWin ? '+' : '-'}${absP.toFixed(2)}
        </div>
        <div className={`text-lg font-bold font-mono mb-6 ${isWin ? 'text-[#34d399]' : 'text-[#fb7185]'}`}>
          {isWin ? '+' : '-'}{absPct.toFixed(2)}%
        </div>

        {/* Entry / Exit */}
        <div className="grid grid-cols-2 gap-3 mb-6 text-xs">
          <div className="bg-[#18181b] rounded-lg p-3 border border-[#2b2a2c]">
            <div className="text-[#a1a1aa] text-[10px] uppercase tracking-wider mb-1">Entry Price</div>
            <div className="font-mono font-bold text-[#e4e4e7]">${result.entryPrice.toFixed(2)}</div>
          </div>
          <div className="bg-[#18181b] rounded-lg p-3 border border-[#2b2a2c]">
            <div className="text-[#a1a1aa] text-[10px] uppercase tracking-wider mb-1">Exit Price</div>
            <div className={`font-mono font-bold ${isWin ? 'text-[#10b981]' : 'text-rose-400'}`}>
              ${result.exitPrice.toFixed(2)}
            </div>
          </div>
        </div>

        {/* Dismiss hint */}
        <p className="text-[10px] text-[#71717a]">Click anywhere to dismiss</p>
      </div>
    </div>
  );
};

export default ClosePositionResultOverlay;
