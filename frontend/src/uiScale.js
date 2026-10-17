/*
 * (v1.9) How much larger the screen draws everything than a laptop does (1 on a laptop,
 * about 1.33 on a 1920 px monitor, 1.78 on a 4K screen at 150 %). The CSS grows by
 * itself; a chart's height is a number in pixels, so charts multiply by this to keep
 * the same shape on every screen.
 */
import { useEffect, useState } from 'react';

const read = () => {
  if (typeof window === 'undefined' || !document.documentElement) return 1;
  const px = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
  return Math.max(1, px / 16);
};

export function useUiScale() {
  const [scale, setScale] = useState(read);
  useEffect(() => {
    let t = 0;
    const on = () => { clearTimeout(t); t = setTimeout(() => setScale(read()), 120); };
    window.addEventListener('resize', on);
    return () => { clearTimeout(t); window.removeEventListener('resize', on); };
  }, []);
  return scale;
}
