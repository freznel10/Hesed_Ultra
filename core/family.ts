/** Seed data shared by the database seed, the UI placeholders and (later) the MCP tools. */

export const MEMBERS = [
  { key: "freznel", name: "Freznel", role: "parent", color: "#2b2b35", sprite: "freznel_front" },
  { key: "diane", name: "Diane", role: "parent", color: "#7a4a30", sprite: "diane_front" },
  { key: "ellie", name: "Ellie", role: "child", color: "#e27896", sprite: "ellie_front" },
  { key: "rafa", name: "Rafa", role: "child", color: "#e8b640", sprite: "rafa_front" },
] as const;

export const PLACES = [
  { key: "house", name: "House", sprite: "house" },
  { key: "church", name: "New Wine Church Alabang", sprite: "church" },
  { key: "school_miriam", name: "Miriam College", sprite: "school_miriam" },
  { key: "school_ateneo", name: "Ateneo", sprite: "school_ateneo" },
  { key: "office", name: "Office", sprite: "office" },
  { key: "mall_sm_marikina", name: "SM Marikina", sprite: "mall_sm_marikina" },
  { key: "mall_sm_aura", name: "SM Aura", sprite: "mall_sm_aura" },
  { key: "mall_ayala_feliz", name: "Ayala Malls Feliz", sprite: "mall_ayala_feliz" },
  { key: "mall_up_town_center", name: "UP Town Center", sprite: "mall_up_town_center" },
  { key: "mall_festival", name: "Festival Mall", sprite: "mall_festival" },
  { key: "mall_alabang_town_center", name: "Alabang Town Center", sprite: "mall_alabang_town_center" },
] as const;

export const ACTIVITY_TYPES = [
  { key: "dining_out", name: "Dining out", place: "mall_sm_aura" },
  { key: "piano", name: "Studying piano", place: "house" },
  { key: "worship", name: "Worship", place: "church" },
  { key: "cleaning", name: "Cleaning", place: "house" },
  { key: "school", name: "School", place: "school_miriam" },
  { key: "studying", name: "Studying / homework", place: "house" },
  { key: "work", name: "Work", place: "office" },
  { key: "shopping", name: "Shopping", place: "mall_sm_marikina" },
  { key: "play", name: "Play / rest", place: "house" },
  { key: "travel", name: "Commute / travel", place: null },
] as const;
