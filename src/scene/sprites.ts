const cache = new Map<string, Promise<HTMLImageElement | null>>();

/** Load /sprites/<name>.png once. Resolves to null if missing so callers can draw a placeholder. */
export function loadSprite(name: string): Promise<HTMLImageElement | null> {
  let p = cache.get(name);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `/sprites/${name}.png`;
    });
    cache.set(name, p);
  }
  return p;
}
