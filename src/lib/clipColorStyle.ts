const alpha = (color: string, opacity: string, percent: number) => {
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  return `#${full}${opacity}`;
};

export const clipColorVars = (color: string) => ({
  '--c': color,
  '--clip-color': color,
  '--clip-faint': alpha(color, '1a', 5),
  '--clip-glow': alpha(color, '4d', 30),
});

export const clipColorStyleText = (color: string) => {
  const vars = clipColorVars(color);
  return Object.entries(vars)
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
};
