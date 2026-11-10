import { useEffect, useMemo, useRef, useState } from "react";
import type { Activity, Goal, Member, Place, Transaction } from "../api";
import { formatPHP } from "../util";
import { loadSprite } from "./sprites";
import { DAY_END, DAY_START, memberAt, placesForDay, schedule, toClock } from "./timeline";

const SCALE = 2; // buildings are drawn at 2x, people at 1x
const H = 330;
const GROUND = 286;
const MIN_W = 1192; // fills the page width on a laptop; the street is centred inside it
const CELL_W = 32;
const CELL_H = 66;
const GAP = 24;

type WalkInfo = { frames: Record<string, string[]> };
type Loaded = { img: HTMLImageElement | null; x: number; w: number; key: string; name: string };

/** Sky colour through the day: dawn, daylight, dusk, night. */
function sky(t: number): string {
  const stops: [number, number[]][] = [
    [6 * 60, [244, 190, 150]], [8 * 60, [150, 206, 236]], [16.5 * 60, [150, 206, 236]],
    [18.5 * 60, [240, 150, 100]], [20 * 60, [40, 44, 90]], [22 * 60, [24, 26, 60]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, a] = stops[i - 1];
      const [t1, b] = stops[i];
      const k = Math.max(0, (t - t0) / (t1 - t0));
      return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * k)).join(",")})`;
    }
  }
  return "rgb(24,26,60)";
}

function label(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, bg = "#f5f2e8", fg = "#222034") {
  ctx.font = "bold 11px ui-monospace, Menlo, Consolas, monospace";
  const w = Math.ceil(ctx.measureText(text).width) + 10;
  const x = Math.round(cx - w / 2);
  ctx.fillStyle = "#222034";
  ctx.fillRect(x - 2, y - 2, w + 4, 20);
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, 16);
  ctx.fillStyle = fg;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 5, y + 9);
}

function coin(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#222034";
  ctx.fillRect(x + 2, y, 8, 12);
  ctx.fillRect(x, y + 2, 12, 8);
  ctx.fillStyle = "#e8b640";
  ctx.fillRect(x + 2, y + 2, 8, 8);
  ctx.fillStyle = "#fff0a8";
  ctx.fillRect(x + 4, y + 2, 2, 6);
}

export default function DayScene(props: {
  activities: Activity[];
  transactions: Transaction[];
  members: Member[];
  places: Place[];
  goal?: Goal;
}) {
  const { activities, transactions, members, places, goal } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [t, setT] = useState(DAY_START);
  const [playing, setPlaying] = useState(false);
  const [art, setArt] = useState<{ street: Loaded[]; walks: (HTMLImageElement | null)[]; info: WalkInfo; width: number } | null>(null);

  const slots = useMemo(() => schedule(activities), [activities]);
  const streetKeys = useMemo(() => placesForDay(slots, places.map((p) => p.key)), [slots, places]);

  // load the sprites for this day's street
  useEffect(() => {
    let off = false;
    (async () => {
      const imgs = await Promise.all(streetKeys.map((k) => loadSprite(places.find((p) => p.key === k)?.sprite ?? k)));
      const walks = await Promise.all(members.map((m) => loadSprite(`${m.key}_walk`)));
      const info: WalkInfo = await fetch("/sprites/walk.json").then((r) => r.json()).catch(() => ({ frames: {} }));
      const total = imgs.reduce((n, img) => n + (img?.width ?? 96) * SCALE + GAP, GAP);
      let x = GAP + Math.max(0, Math.round((MIN_W - total) / 2));
      const street = streetKeys.map((key, i) => {
        const w = (imgs[i]?.width ?? 96) * SCALE;
        const item = { img: imgs[i], x, w, key, name: places.find((p) => p.key === key)?.name ?? key };
        x += w + GAP;
        return item;
      });
      if (!off) setArt({ street, walks, info, width: Math.max(total, MIN_W) });
    })();
    return () => { off = true; };
  }, [streetKeys, members, places]);

  // play: one scene minute every 40 ms, so a full day takes about 40 seconds
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT((v) => (v >= DAY_END ? (setPlaying(false), DAY_END) : v + 1)), 40);
    return () => clearInterval(id);
  }, [playing]);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !art) return;
    const W = art.width;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = sky(t);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#5ca048";
    ctx.fillRect(0, GROUND, W, 12);
    ctx.fillStyle = "#545660";
    ctx.fillRect(0, GROUND + 12, W, H - GROUND - 12);
    ctx.fillStyle = "#e6dcaa";
    for (let x = 0; x < W; x += 28) ctx.fillRect(x, H - 6, 14, 2);

    for (const p of art.street) {
      if (p.img) ctx.drawImage(p.img, p.x, GROUND + 8 - p.img.height * SCALE, p.w, p.img.height * SCALE);
      else { ctx.fillStyle = "#c4cad2"; ctx.fillRect(p.x, GROUND - 120, p.w, 128); label(ctx, p.name, p.x + p.w / 2, GROUND - 70); }
    }
    const centre = (key: string) => { const p = art.street.find((s) => s.key === key) ?? art.street[0]; return p.x + p.w / 2; };

    // above each place: what is happening there now, and coins for money spent there
    const top = (p: Loaded) => GROUND + 8 - (p.img?.height ?? 60) * SCALE;
    const stack = new Map<string, number>();
    const above = (place: string) => {
      const p = art.street.find((x) => x.key === place) ?? art.street[0];
      const n = stack.get(p.key) ?? 0;
      stack.set(p.key, n + 1);
      return { cx: p.x + p.w / 2, y: Math.max(4, top(p) - 24 - n * 22) };
    };
    for (const s of slots) {
      if (t >= s.start && t < s.end) {
        const { cx, y } = above(s.place);
        label(ctx, s.activity.title, cx, y);
      }
      const spent = transactions.filter((x) => x.kind === "expense" && x.activityId === s.activity.id).reduce((n, x) => n + x.amountCents, 0);
      if (spent && t >= s.start) {
        const { cx, y } = above(s.place);
        const text = formatPHP(spent);
        label(ctx, text, cx + 8, y, "#fff0a8");
        coin(ctx, cx - ctx.measureText(text).width / 2 - 16, y + 2);
      }
    }

    // people
    const tick = Math.floor(t / 4);
    members.forEach((m, i) => {
      const st = memberAt(m.key, slots, t);
      const offset = (i - (members.length - 1) / 2) * 26;
      const x = Math.round(centre(st.from) + (centre(st.to) - centre(st.from)) * st.progress + offset - CELL_W / 2);
      const y = GROUND + 20 - CELL_H;
      const img = art.walks[i];
      const tags = art.info.frames[m.key] ?? [];
      if (!img) { ctx.fillStyle = m.color; ctx.fillRect(x + 8, y + 18, 16, 48); return; }
      const side = tags.map((tag, f) => (tag === "right" ? f : -1)).filter((f) => f >= 0);
      const frame = st.moving && side.length ? side[tick % side.length] : Math.max(0, tags.indexOf("front"));
      const left = st.moving && centre(st.to) < centre(st.from);
      const bob = st.moving ? tick % 2 : 0;
      ctx.save();
      if (left) { ctx.translate(x + CELL_W, y - bob); ctx.scale(-1, 1); ctx.drawImage(img, frame * CELL_W, 0, CELL_W, CELL_H, 0, 0, CELL_W, CELL_H); }
      else ctx.drawImage(img, frame * CELL_W, 0, CELL_W, CELL_H, x, y - bob, CELL_W, CELL_H);
      ctx.restore();
    });

    // on the road: the clock on the left, the main savings goal on the right
    label(ctx, toClock(t), 34, H - 26);
    if (goal) {
      const text = `${goal.name} ${goal.percent}%`;
      ctx.font = "bold 11px ui-monospace, Menlo, Consolas, monospace";
      const cx = W - ctx.measureText(text).width / 2 - 16;
      label(ctx, text, cx, H - 26, "#fff0a8");
      coin(ctx, cx - ctx.measureText(text).width / 2 - 24, H - 24);
    }
  }, [art, t, slots, members, transactions, goal]);

  return (
    <div className="scene">
      <div className="scene-scroll">
        <canvas ref={canvas} width={art?.width ?? MIN_W} height={H} className="pixel" style={{ width: "100%", minWidth: (art?.width ?? MIN_W) * 0.6 }} />
      </div>
      <div className="scrubber">
        <button onClick={() => { if (t >= DAY_END) setT(DAY_START); setPlaying((p) => !p); }}>{playing ? "❚❚ Pause" : "▶ Play day"}</button>
        <input type="range" aria-label="Time of day" min={DAY_START} max={DAY_END} value={t} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} />
        <span className="clock">{toClock(t)}</span>
      </div>
    </div>
  );
}
