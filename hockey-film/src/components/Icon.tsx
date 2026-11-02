// Tiny inline SVG icon set (stroke icons, 24x24) so we don't depend on an icon font.
const P: Record<string, string> = {
  select: 'M5 3l14 8-6 2-2 6z',
  hand: 'M8 13V5.5a1.5 1.5 0 013 0V12m0-6.5v-1a1.5 1.5 0 013 0V12m0-5.5a1.5 1.5 0 013 0V12m0-3.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-2a6 6 0 01-5-2.7L4.6 15a1.5 1.5 0 012.4-1.8L8 14.5',
  pen: 'M4 20c3-1 4-3 6-6s4-6 7-9l2 2c-3 3-6 5-9 7s-5 3-6 6z',
  line: 'M5 19L19 5',
  arrow: 'M5 19L19 5M10 5h9v9',
  curve: 'M4 19C6 9 12 6 19 6M14 3l5 3-3 5',
  ellipse: 'M12 5c5 0 9 3.1 9 7s-4 7-9 7-9-3.1-9-7 4-7 9-7z',
  rect: 'M4 6h16v12H4z',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  eraser: 'M16 3l5 5-11 11H5l-2-2zM9 9l6 6M10 19h11',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  prev: 'M18 5l-9 7 9 7zM6 5v14',
  next: 'M6 5l9 7-9 7zM18 5v14',
  back: 'M11 6l-7 6 7 6zM20 6l-7 6 7 6z',
  fwd: 'M13 6l7 6-7 6zM4 6l7 6-7 6z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  eyeOff: 'M3 3l18 18M10.6 6.1A10 10 0 0112 6c6 0 10 6 10 6a17 17 0 01-3.3 3.8M6.6 6.6C3.9 8.4 2 12 2 12s4 7 10 7c1.7 0 3.2-.5 4.5-1.2',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 018 0v4',
  unlock: 'M6 11h12v10H6zM8 11V7a4 4 0 017.5-2',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  panel: 'M3 4h18v16H3zM15 4v16',
  help: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  home: 'M3 11l9-8 9 8M5 9v11h14V9',
  loop: 'M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  pencil: 'M3 21l3.5-1 12-12-2.5-2.5-12 12zM14 6.5l2.5 2.5',
  video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3z',
  spotlight: 'M12 8a5 4 0 100 8 5 4 0 000-8zM12 2v3M4.5 5l2 2M19.5 5l-2 2M2 12h2M20 12h2',
  marker: 'M12 3a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM9 10h6l-1 6h-4zM4 19c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z',
  trail: 'M4 20c2-6 6-2 8-8s4-6 6-7M15 4l4 1-1 4',
  zone: 'M4 5h16l-3 14H7zM8 9h8M9 13h6',
  gap: 'M4 6v12M20 6v12M4 12h16M8 9l-4 3 4 3M16 9l4 3-4 3',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  teach: 'M4 5h16v10H4zM8 19h8M12 15v4M10 8l4 2-4 2z',
};

export function Icon({ name, size = 22 }: { name: keyof typeof P | string; size?: number }) {
  const filled = name === 'play' || name === 'pause' || name === 'prev' || name === 'next' || name === 'back' || name === 'fwd';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={P[name] ?? ''} />
    </svg>
  );
}
