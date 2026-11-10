import { useEffect, useRef } from "react";
import { MEMBERS } from "../../core/family";
import { loadSprite } from "./sprites";

/** Phase 0 town: one row of places on a street, with the family standing at the house. */
const STREET = ["house", "church", "school_miriam", "school_ateneo", "office", "mall_sm_marikina", "mall_sm_aura"];
const W = 760;
const H = 150;
const GROUND = 128;

export default function Town() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ctx = ref.current?.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      // sky, grass, road
      ctx.fillStyle = "#96ceec";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#5ca048";
      ctx.fillRect(0, GROUND, W, 6);
      ctx.fillStyle = "#545660";
      ctx.fillRect(0, GROUND + 6, W, H - GROUND - 6);
      ctx.fillStyle = "#e6dcaa";
      for (let x = 0; x < W; x += 14) ctx.fillRect(x, H - 8, 7, 1);

      const places = await Promise.all(STREET.map(loadSprite));
      const family = await Promise.all(MEMBERS.map((m) => loadSprite(m.sprite)));
      if (cancelled) return;
      let x = 4;
      let houseX = 0;
      places.forEach((img, i) => {
        if (!img) return;
        if (STREET[i] === "house") houseX = x;
        ctx.drawImage(img, x, GROUND + 4 - img.height);
        x += img.width + 4;
      });
      // family at quarter size in front of the house (placeholder until small walk sprites exist)
      let fx = houseX + 20;
      family.forEach((img, i) => {
        const w = img ? Math.round(img.width / 4) : 10;
        const h = img ? Math.round(img.height / 4) : 30;
        if (img) ctx.drawImage(img, fx, GROUND + 8 - h, w, h);
        else {
          ctx.fillStyle = MEMBERS[i].color;
          ctx.fillRect(fx, GROUND + 8 - h, w, h);
        }
        fx += w + 3;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <canvas ref={ref} width={W} height={H} className="pixel town" />;
}
