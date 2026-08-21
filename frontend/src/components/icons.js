import React from 'react';

const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const MailIcon = (p) => (
  <svg {...base} {...p}>
    <rect x="2" y="4" width="20" height="16" rx="2.5" />
    <path d="m3 6.5 9 6 9-6" />
  </svg>
);

export const LockIcon = (p) => (
  <svg {...base} {...p}>
    <rect x="4" y="10.5" width="16" height="10" rx="2" />
    <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" />
  </svg>
);

export const EyeIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const EyeOffIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M3 3l18 18" />
    <path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.6 4.5M6.6 6.6C4 8.3 2 12 2 12s3.6 7 10 7c1.3 0 2.5-.2 3.6-.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
);

export const ZapIcon = (p) => (
  <svg {...base} fill="currentColor" stroke="none" {...p}>
    <path d="M13 2 3 14h7l-1 8 11-14h-7l0-6Z" />
  </svg>
);

export const TrendingUpIcon = (p) => (
  <svg {...base} {...p}>
    <polyline points="3 17 9 11 13 15 21 6" />
    <polyline points="14 6 21 6 21 13" />
  </svg>
);

export const ShieldIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3 4.5 6v6c0 5 3.4 8 7.5 9 4.1-1 7.5-4 7.5-9V6L12 3Z" />
  </svg>
);
