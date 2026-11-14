'use client';

// Postorizon brand mark ("Horizon arcs") — replaces the upstream Postiz mark.
// Source of truth: brand/postorizon-mark.svg (light variant: white horizon line,
// for dark surfaces).
export const Logo = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="60"
      height="60"
      viewBox="0 0 64 64"
      fill="none"
      className="mt-[8px] min-w-[60px] min-h-[60px]"
      role="img"
      aria-label="Postorizon"
    >
      <defs>
        <linearGradient id="pz-dawn-logo" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#FFB03A" />
          <stop offset="0.45" stopColor="#FF5A3C" />
          <stop offset="0.72" stopColor="#FF4D6D" />
          <stop offset="1" stopColor="#7A5AF8" />
        </linearGradient>
      </defs>
      <path
        d="M6 44 a26 26 0 0 1 52 0"
        fill="none"
        stroke="#7A5AF8"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M14 44 a18 18 0 0 1 36 0"
        fill="none"
        stroke="#FF4D6D"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path d="M24 44 a8 8 0 0 1 16 0 Z" fill="url(#pz-dawn-logo)" />
      <rect x="6" y="44" width="52" height="5" rx="2.5" fill="#FFFFFF" />
    </svg>
  );
};
