import { describe, expect, it } from "vitest";
import { memberAt, placesForDay, schedule, type SceneActivity, toClock, toMinutes } from "./timeline";

const act = (id: number, place: string | null, members: string[], startTime: string | null = null, endTime: string | null = null): SceneActivity => ({
  id, title: `a${id}`, type: "x", place, members, startTime, endTime,
});

describe("timeline", () => {
  it("converts clock times", () => {
    expect(toMinutes("07:30")).toBe(450);
    expect(toClock(450)).toBe("07:30");
  });

  it("walks to a place, stays for the activity, then walks home", () => {
    const slots = schedule([act(1, "school_miriam", ["ellie"], "08:00", "15:00")]);
    const at = (clock: string) => memberAt("ellie", slots, toMinutes(clock));
    expect(at("06:00")).toMatchObject({ from: "house", moving: false, doing: null });
    expect(at("07:45")).toMatchObject({ from: "house", to: "school_miriam", moving: true, progress: 0.5 });
    expect(at("08:00")).toMatchObject({ from: "school_miriam", moving: false, doing: { id: 1 } });
    expect(at("14:59").doing?.id).toBe(1);
    expect(at("15:15")).toMatchObject({ from: "school_miriam", to: "house", moving: true, progress: 0.5 });
    expect(at("16:00")).toMatchObject({ from: "house", moving: false });
    // someone not in the activity stays home all day
    expect(memberAt("rafa", slots, toMinutes("10:00"))).toMatchObject({ from: "house", moving: false, doing: null });
  });

  it("goes straight to the next place when there is no time to go home", () => {
    const slots = schedule([act(1, "church", ["diane"], "09:00", "11:00"), act(2, "mall_sm_aura", ["diane"], "11:30", "13:00")]);
    expect(memberAt("diane", slots, toMinutes("11:15"))).toMatchObject({ from: "church", to: "mall_sm_aura", moving: true });
  });

  it("goes home in between when the gap is long", () => {
    const slots = schedule([act(1, "office", ["freznel"], "08:00", "12:00"), act(2, "church", ["freznel"], "18:00", "19:00")]);
    const at = (clock: string) => memberAt("freznel", slots, toMinutes(clock));
    expect(at("12:15")).toMatchObject({ from: "office", to: "house", moving: true });
    expect(at("15:00")).toMatchObject({ from: "house", moving: false });
    expect(at("17:45")).toMatchObject({ from: "house", to: "church", moving: true });
  });

  it("does not walk for activities at home", () => {
    const slots = schedule([act(1, "house", ["rafa"], "16:00", "17:00")]);
    expect(memberAt("rafa", slots, toMinutes("15:50"))).toMatchObject({ moving: false });
    expect(memberAt("rafa", slots, toMinutes("16:30")).doing?.id).toBe(1);
  });

  it("spreads untimed activities through the day without overlap", () => {
    const slots = schedule([act(1, "church", ["ellie"]), act(2, "mall_festival", ["ellie"]), act(3, null, ["ellie"])]);
    expect(slots.map((s) => s.activity.id)).toEqual([1, 2, 3]);
    for (let i = 1; i < slots.length; i++) expect(slots[i].start).toBeGreaterThanOrEqual(slots[i - 1].end);
    expect(slots[0].start).toBe(8 * 60);
    expect(slots[2].place).toBe("house"); // no place → home
  });

  it("lists home plus the places used that day", () => {
    const slots = schedule([act(1, "mall_festival", ["ellie"]), act(2, "church", ["ellie"])]);
    expect(placesForDay(slots, ["house", "church", "office", "mall_festival"])).toEqual(["house", "church", "mall_festival"]);
  });
});
