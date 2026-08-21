import React from 'react';
import { ZapIcon, TrendingUpIcon, ShieldIcon } from './icons';

// Handful of candlesticks trending up, right-aligned in the left panel —
// hand-authored coordinates rather than a chart library, since it's pure
// decoration and doesn't need to be data-driven.
function CandlestickGraphic() {
  const candles = [
    { x: 0,   wickTop: 60, wickBot: 10, bodyTop: 45, bodyBot: 20, up: true },
    { x: 26,  wickTop: 50, wickBot: 0,  bodyTop: 38, bodyBot: 12, up: false },
    { x: 52,  wickTop: 40, wickBot: -8, bodyTop: 26, bodyBot: 2,  up: true },
    { x: 78,  wickTop: 20, wickBot: -30, bodyTop: 8,  bodyBot: -18, up: true },
    { x: 104, wickTop: 6,  wickBot: -40, bodyTop: -4, bodyBot: -28, up: false },
    { x: 130, wickTop: -10, wickBot: -55, bodyTop: -20, bodyBot: -44, up: true },
    { x: 156, wickTop: -28, wickBot: -70, bodyTop: -36, bodyBot: -58, up: true },
  ];
  return (
    <svg className="auth-candles" viewBox="-10 -80 200 170" aria-hidden="true">
      {candles.map((c, i) => (
        <g key={i} transform={`translate(${c.x} 0)`}>
          <line x1="6" x2="6" y1={-c.wickTop} y2={-c.wickBot}
            stroke={c.up ? 'var(--green)' : 'var(--amber2)'} strokeWidth="1.5" opacity="0.55" />
          <rect x="0" y={-c.bodyTop} width="12" height={c.bodyTop - c.bodyBot}
            fill={c.up ? 'var(--green)' : 'var(--amber2)'} opacity={c.up ? 0.5 : 0.65} rx="1.5" />
        </g>
      ))}
    </svg>
  );
}

// Dot-wave field along the bottom of the panel — a signature ambient
// texture rather than literal data. Generated once with a simple sine
// offset so it reads as a wave without hand-placing every point.
function DotWave() {
  const rows = 5;
  const cols = 22;
  const dots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const waveY = Math.sin((c / cols) * Math.PI * 2 + r * 0.5) * 10;
      const cx = (c / (cols - 1)) * 100;
      const cy = 100 - r * 9 + waveY * 0.4;
      const dist = r / rows; // fades toward the top of the field
      dots.push({ cx, cy, r: 0.9 - dist * 0.4, o: 0.5 - dist * 0.4 });
    }
  }
  return (
    <svg className="auth-dotwave" viewBox="0 0 100 45" preserveAspectRatio="none" aria-hidden="true">
      {dots.map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy * 0.45} r={d.r * 0.35} fill="var(--acc)" opacity={d.o} />
      ))}
    </svg>
  );
}

const FEATURES = [
  { icon: TrendingUpIcon, title: 'AI Market Analysis', sub: 'Real-time market insights' },
  { icon: ShieldIcon,     title: 'Risk Management',    sub: 'Built-in protection for your capital' },
  { icon: ZapIcon,        title: 'Automated Trading',  sub: 'Execute trades 24/7' },
];

export default function AuthLayout({ children }) {
  return (
    <div className="auth-shell">
      <div className="auth-left">
        <DotWave />
        <CandlestickGraphic />
        <div className="auth-left-inner">
          <div className="auth-brand">
            <span className="auth-brand-icon"><ZapIcon /></span>
            <div>
              <div className="auth-brand-name">Huantam</div>
              <div className="auth-brand-tag">AI-Powered Trading Bot</div>
            </div>
          </div>

          <h1 className="auth-headline">
            Trade Smarter.<br />
            Automate Better.<br />
            <span className="accent">Grow Faster.</span>
          </h1>
          <p className="auth-desc">
            Huantam uses advanced AI algorithms to analyze markets and execute trades with precision and speed.
          </p>

          <div className="auth-features">
            {FEATURES.map(({ icon: Icon, title, sub }) => (
              <div className="feature-item" key={title}>
                <span className="feature-icon"><Icon /></span>
                <div>
                  <div className="feature-title">{title}</div>
                  <div className="feature-sub">{sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="auth-right">
        {children}
      </div>
    </div>
  );
}
