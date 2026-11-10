import { useEffect, useRef } from "react";
import { MEMBERS } from "../../core/family";
import { loadSprite } from "./sprites";

/** Phase 0 town: one row of places on a street, with the family standing at the house. */
const STREET = ["house", "church", "school_miriam", "school_ateneo", "office", "mall_sm_marikina", "mall_sm_aura"];
// Buildings are drawn at 2x and people at 1x so the family reads clearly next to them.
const SCALE = 2;
const W = 1520;
const H = 300;
const GROUND = 256;
const CELL_W = 32; // walk strip cell size, see public/sprites/walk.json
const CELL_H = 66;

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
      ctx.fillRect(0, GROUND, W, 12);
      ctx.fillStyle = "#545660";
      ctx.fillRect(0, GROUND + 12, W, H - GROUND - 12);
      ctx.fillStyle = "#e6dcaa";
      for (let x = 0; x < W; x += 28) ctx.fillRect(x, H - 16, 14, 2);

      const places = await Promise.all(STREET.map(loadSprite));
      const family = await Promise.all(MEMBERS.map((m) => loadSprite(`${m.key}_walk`)));
      if (cancelled) return;
      let x = 8;
      let houseX = 0;
      places.forEach((img, i) => {
        if (!img) return;
        if (STREET[i] === "house") houseX = x;
        ctx.drawImage(img, x, GROUND + 8 - img.height * SCALE, img.width * SCALE, img.height * SCALE);
        x += (img.width + 4) * SCALE;
      });
      // family standing in front of the house: frame 0 (facing front) of each walk strip
      let fx = houseX + 36;
      family.forEach((img, i) => {
        if (img) ctx.drawImage(img, 0, 0, CELL_W, CELL_H, fx, GROUND + 18 - CELL_H, CELL_W, CELL_H);
        else {
          ctx.fillStyle = MEMBERS[i].color;
          ctx.fillRect(fx + 8, GROUND - 30, 16, 48);
        }
        fx += CELL_W;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <canvas ref={ref} width={W} height={H} className="pixel town" />;
}
