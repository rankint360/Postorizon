import React from 'react';

// Postorizon horizontal lockup (light variant, for dark surfaces) — replaces the
// upstream Postiz wordmark SVG. Asset: public/postorizon-logo-horizontal-light.svg
export const LogoTextComponent = () => {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/postorizon-logo-horizontal-light.svg"
      alt="Postorizon"
      width={150}
      height={33}
    />
  );
};
