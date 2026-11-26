'use client';

import { useEffect, useState } from 'react';

/**
 * Renders a token's swatch and reads its hex from the computed style, so this
 * page always shows what src/styles/tokens.css actually defines.
 */
export function Swatch({ token, name, use }: { token: string; name: string; use: string }) {
  const [hex, setHex] = useState('');
  useEffect(() => {
    const probe = document.createElement('span');
    probe.style.color = `var(${token})`;
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
    probe.remove();
    setHex(rgb.length === 3 ? `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()}` : '');
  }, [token]);

  return (
    <div className="br-swatch">
      <div className="br-swatch-chip" style={{ background: `var(${token})` }} />
      <strong>{name}</strong>
      <code>{token}</code>
      <span className="br-swatch-hex">{hex || ' '}</span>
      <p>{use}</p>
    </div>
  );
}
