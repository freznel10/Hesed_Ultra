/**
 * Turns a day's activities into "where is everyone at minute t".
 * Pure logic with no drawing, so it can be tested on its own.
 */
export const DAY_START = 6 * 60;
export const DAY_END = 22 * 60;
/** Minutes spent walking between two places. */
export const TRAVEL = 30;
export const HOME = "house";

export type SceneActivity = {
  id: number;
  title: string;
  type: string;
  place: string | null;
  members: string[];
  startTime: string | null;
  endTime: string | null;
};

export type Slot = { activity: SceneActivity; place: string; start: number; end: number };

export const toMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
export const toClock = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.floor(min % 60)).padStart(2, "0")}`;

/**
 * Give every activity a start and end minute. Timed ones keep their times (one hour if
 * no end was given). Untimed ones are spread across the day in the order they were logged.
 */
export function schedule(activities: SceneActivity[]): Slot[] {
  const untimed = activities.filter((a) => !a.startTime);
  const step = (20 * 60 - 8 * 60) / Math.max(1, untimed.length);
  return activities
    .map((activity) => {
      const place = activity.place ?? HOME;
      if (activity.startTime) {
        const start = toMinutes(activity.startTime);
        return { activity, place, start, end: activity.endTime ? toMinutes(activity.endTime) : start + 60 };
      }
      const start = 8 * 60 + untimed.indexOf(activity) * step;
      return { activity, place, start, end: start + Math.min(90, step - TRAVEL) };
    })
    .sort((a, b) => a.start - b.start);
}

export type MemberState = {
  /** Place the member is at, or walking away from. */
  from: string;
  /** Place the member is walking to (same as `from` when standing still). */
  to: string;
  /** 0–1 along the walk. */
  progress: number;
  moving: boolean;
  /** The activity being done right now, if any. */
  doing: SceneActivity | null;
};

const still = (place: string, doing: SceneActivity | null = null): MemberState => ({ from: place, to: place, progress: 0, moving: false, doing });
const walk = (from: string, to: string, progress: number): MemberState =>
  from === to ? still(from) : { from, to, progress: Math.min(1, Math.max(0, progress)), moving: true, doing: null };

/** Where one family member is at minute t. Everyone starts and ends the day at home. */
export function memberAt(member: string, slots: Slot[], t: number): MemberState {
  const mine = slots.filter((s) => s.activity.members.includes(member));
  const current = mine.find((s) => t >= s.start && t < s.end);
  if (current) return still(current.place, current.activity);

  const prev = [...mine].reverse().find((s) => s.end <= t);
  const next = mine.find((s) => s.start > t);
  const cameFrom = prev?.place ?? HOME;

  if (next) {
    // Is there time to go home between the two? (walk home + walk out again)
    const goesHome = prev && next.start - prev.end >= 2 * TRAVEL + 30 && prev.place !== HOME;
    if (goesHome && t < prev.end + TRAVEL) return walk(prev.place, HOME, (t - prev.end) / TRAVEL);
    const origin = goesHome ? HOME : cameFrom;
    const leaveAt = next.start - TRAVEL;
    return t >= leaveAt ? walk(origin, next.place, (t - leaveAt) / TRAVEL) : still(origin);
  }
  if (prev) return walk(prev.place, HOME, (t - prev.end) / TRAVEL).progress >= 1 ? still(HOME) : walk(prev.place, HOME, (t - prev.end) / TRAVEL);
  return still(HOME);
}

/** The places to draw for a day: home first, then each place used, in the order given by `allPlaces`. */
export function placesForDay(slots: Slot[], allPlaces: string[]): string[] {
  const used = new Set(slots.map((s) => s.place));
  return [HOME, ...allPlaces.filter((p) => p !== HOME && used.has(p))];
}
