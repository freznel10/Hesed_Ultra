# Hesed Ultra — Implementation Plan

> **Status:** phases 0–5 are built and tested, and the code for phase 6 (logins, tokens, Postgres) is in place; only creating the Netlify site remains. See [README.md](README.md) for how things work now. Where this plan and the README differ, the README is current. The main differences from this plan:
>
> - Agents connect over HTTP at `/mcp` on the running app, not through a separate stdio program. The local database can only be opened by one program at a time.
> - `npm run dev` runs Vite with the functions built in, not the Netlify CLI.
> - Online, the database driver is plain `pg`; the schema is managed by `db/migrations.ts`.
> - Not built: undoing a change from the change log, MCP resources and prompts, activity animations other than walking, and the phase 7 extras.

A family app with two halves that share one database:

1. **Pixel-art daily life log** — each day is shown as a small pixel scene of what the family did.
2. **Budget & savings tracker** — log spending, set budgets, track savings goals.

Data can be added and changed in the app **and** by Claude or other agents through an MCP server. The app runs locally first and moves to Netlify later without changing code.

---

## 1. Guiding decisions

| Concern | Choice | Why |
|---|---|---|
| Frontend | **Vite + React + TypeScript** | Fast local dev, static build that Netlify serves for free. |
| Pixel scene | **HTML Canvas 2D** + sprite sheets, `image-rendering: pixelated`, integer scaling | No game engine needed; full control over your own sprites. Can move to PixiJS later if scenes get heavy. |
| Styling | Plain CSS + a pixel font (e.g. a free OFL pixel font) | Keeps the retro look consistent. |
| API | **Netlify Functions** (TypeScript), run locally with `netlify dev` | The same code runs on your laptop and on Netlify. |
| Database | **Postgres via Drizzle ORM**. Locally: **PGlite** (Postgres running inside Node, stored in a folder, nothing to install). Production: **Netlify DB (Neon Postgres)** | One schema and one set of queries everywhere. |
| Validation | **Zod** schemas shared by the UI, API, and MCP | One definition of "a valid transaction" for every way data comes in. |
| Agent access | **MCP server** with two ways in: local **stdio** (Claude Desktop / Claude Code on your machine) and remote **Streamable HTTP** at `/mcp` on Netlify | Claude and other agents can read and write the same data the app does. |
| Money | **Philippine peso (PHP)** stored as integer centavos | Avoids floating-point rounding errors. |
| Auth | Local: none. Netlify: every family member logs in (PIN or passphrase, signed cookie), with parent/child roles, + **API tokens** for agents | Simple, private, and every change can be traced to who or what made it. |

---

## 2. Repository layout

```
Hesed_Ultra/
├─ PLAN.md
├─ package.json
├─ netlify.toml
├─ .env.example                 # DATABASE_URL, MCP_TOKEN, etc. (no real secrets committed)
├─ assets/                      # ← your existing sprites/assets go here (source files, e.g. .aseprite/.png)
│  ├─ characters/               #   family member sprites
│  ├─ places/                   #   backgrounds: home, school, office, park, church, market…
│  ├─ props/                    #   coins, piggy bank/jar, food, cars…
│  └─ ui/                       #   icons, frames, fonts
├─ public/sprites/              # exported sprite sheets + JSON atlases the app actually loads
├─ src/                         # React app
│  ├─ main.tsx, App.tsx
│  ├─ pages/  Today.tsx  Calendar.tsx  Budget.tsx  Savings.tsx  Family.tsx  Settings.tsx
│  ├─ scene/                    # canvas renderer
│  │  ├─ engine.ts              #   game loop, camera, integer scaling
│  │  ├─ sprites.ts             #   load sheets/atlases, animations
│  │  ├─ dayScene.ts            #   turns a day's activities into a scene timeline
│  │  └─ catalog.ts             #   activity type → place + animation + props
│  └─ api.ts                    # typed fetch client
├─ core/                        # ★ shared domain logic (no UI, no HTTP)
│  ├─ schemas.ts                #   Zod: Member, Activity, Transaction, Budget, Goal…
│  ├─ activities.ts             #   create/update/list/delete activities
│  ├─ finance.ts                #   transactions, budgets, month summaries, goal progress
│  └─ audit.ts                  #   records every change with its source
├─ db/
│  ├─ schema.ts                 # Drizzle tables
│  ├─ client.ts                 # PGlite locally, Neon in production (picked by env)
│  ├─ migrations/
│  └─ seed.ts                   # sample family + a demo week
├─ netlify/functions/
│  ├─ api.ts                    # REST API → core/*
│  └─ mcp.ts                    # remote MCP (Streamable HTTP) → core/*
└─ mcp/
   ├─ tools.ts                  # MCP tool definitions → core/* (shared by both transports)
   └─ stdio.ts                  # local MCP entry point for Claude Desktop / Claude Code
```

**Key rule:** the app API and the MCP server are both thin wrappers over `core/`. Agents can't bypass validation, and every change goes through the same audit log.

---

## 3. Data model (first version)

```
members         id, name, role (parent/child/pet…), color, sprite_key, birthday, active
places          id, name, sprite_key, x, y                    # spots on the scene map
activity_types  id, name, icon, default_place_id, animation   # "school", "work", "cooking", "church", "play"…
activities      id, date, start_time, end_time, type_id, place_id,
                title, note, mood (1–5), photo_url, created_by, source
activity_members activity_id, member_id                         # who took part
categories      id, name, kind (expense/income), icon, color, parent_id
transactions    id, date, amount_cents, currency, category_id, member_id,
                payee, note, activity_id (optional link to that day's event), source
budgets         id, month (YYYY-MM), category_id, limit_cents
savings_goals   id, name, target_cents, target_date, sprite_key (jar/piggy/house…), archived
savings_entries id, goal_id, date, amount_cents (+deposit / −withdrawal), note, source
audit_log       id, at, actor (member id or token name), source (app|mcp|import),
                entity, entity_id, action, before_json, after_json
settings        key, value                                      # currency, family name, week start…
```

Linking `transactions.activity_id` lets the scene show coins over the market when you bought groceries that day.

---

## 4. The pixel scene

**Layout:** one fixed "neighbourhood" map (e.g. 320×180 base resolution, scaled ×3/×4) with places as hotspots: home, school, workplace, market, park, church, restaurant, and so on. Your sprites in `assets/places` fill these spots.

**How a day becomes a scene (`dayScene.ts`):**
1. Load the day's activities, sorted by time.
2. Each member gets a path: home → place A (at A's start time) → place B → … → home.
3. A **time scrubber** (06:00–22:00) drives the scene. Press play and avatars walk between places; drag it to jump.
4. At a place, the member plays the activity's animation (sitting, cooking, running, praying…) and shows a speech-bubble icon.
5. **Finance overlays:** coins pop up where money was spent, and the savings jar on the house shows this month's progress toward the main goal.
6. **Mood / weather:** the sky tint follows time of day, and an optional weather or mood icon is set per day.

**Other views:**
- **Calendar:** month grid where each day is a tiny auto-generated thumbnail of its scene.
- **Savings:** each goal is a jar or piggy bank that fills in pixel steps; a deposit plays a small coin animation.
- **Budget:** pixel progress bars per category that turn yellow at 80% and red past 100%.

**Asset pipeline:** keep editable sources in `assets/`, and export sprite sheets with a JSON atlas (Aseprite's "Export Sprite Sheet → JSON Array" works) into `public/sprites/`. `catalog.ts` maps names (`"dad_walk"`, `"place_school"`) to atlas frames, so swapping art never touches code. Missing sprites fall back to coloured placeholder boxes, so the app works before all the art is done.

---

## 5. App features (input via the app)

- **Today:** quick-add activity (type, who, time, note, mood) and quick-add expense; the scene updates live.
- **Calendar:** browse past days, edit or delete entries.
- **Budget:** monthly budgets per category, transaction list with filters, month summary (spent / remaining / top categories).
- **Savings:** goals, deposits and withdrawals, progress and projected completion date.
- **Family:** members, colours, sprite choice.
- **Settings:** currency, places, activity types, categories, API tokens for agents, export/import (JSON/CSV).

---

## 6. Agent / MCP access

**Tools exposed (all validated by the shared Zod schemas, all audited with `source = "mcp"`):**

| Tool | Purpose |
|---|---|
| `list_members`, `list_activity_types`, `list_categories` | So the agent can resolve names like "Mom" or "groceries" to IDs |
| `log_activity` | "We went to the park 3–5pm with the kids" |
| `update_activity`, `delete_activity` | Corrections |
| `get_day` | Everything for a date (activities + spending), for summaries |
| `log_expense` / `log_income` | "Spent 1,250 on groceries at the market" |
| `update_transaction`, `delete_transaction` | Corrections |
| `set_budget`, `get_month_summary` | "How much is left for food this month?" |
| `add_savings_entry`, `list_goals`, `create_goal` | "Put 5,000 into the emergency fund" |
| `search` | Free-text over notes, titles, and payees |

Plus MCP **resources** such as `hesed://day/2026-11-10` and `hesed://month/2026-11` for read-only context, and a **prompt** `daily_journal` that turns a casual description of the day into structured activities and expenses.

**Connecting:**
- **Locally:** `claude mcp add hesed -- npx tsx mcp/stdio.ts` (Claude Code), or the equivalent entry in Claude Desktop's config. It writes directly to the local PGlite database.
- **Netlify:** `https://<site>.netlify.app/mcp` with `Authorization: Bearer <token>`. Tokens are created in Settings, stored hashed, revocable, and named per agent so the audit log shows who did what. (Adding OAuth later would allow use as a claude.ai custom connector.)

**Safety:** deletes require an explicit `confirm: true` argument, amounts are capped per call (configurable), and every change is reversible from the audit log ("undo last agent change").

---

## 7. Running locally

```bash
# one-time
npm install
npm run db:migrate        # creates ./.data/pglite
npm run db:seed           # optional demo family + week

# day to day
npm run dev               # Vite app + API at http://localhost:5173 (dev:netlify for the Netlify CLI)
npm run mcp               # (optional) run the stdio MCP server by hand for testing
```

No Netlify account is needed for local use; `netlify-cli` is a dev dependency. The data lives in `./.data/` (git-ignored); back it up with `npm run export`.

---

## 8. Deploying to Netlify (later)

1. Connect the GitHub repo to a Netlify site (build: `npm run build`, publish: `dist`, functions: `netlify/functions`).
2. Add **Netlify DB** (Neon Postgres); it sets `NETLIFY_DATABASE_URL`, and `db/client.ts` switches to Neon automatically.
3. Run migrations on deploy (`npm run db:migrate` in the build command).
4. Set `SESSION_SECRET` in Netlify environment variables.
5. Optional: move photo uploads to **Netlify Blobs**.
6. Optional: migrate local data with `npm run export` locally, then `npm run import` against production.

---

## 9. Build phases

| Phase | Deliverable | Done when |
|---|---|---|
| **0. Scaffold** ✅ | Vite+React+TS, netlify.toml, Drizzle + PGlite, lint/test (Vitest) | `npm run dev` shows a page and `/api/health` answers |
| **1. Core + data** ✅ | `db/schema.ts`, migrations, seed, `core/*` with Zod + audit log, unit tests | Core functions are tested for activities, transactions, budgets, and goals |
| **2. REST API + basic UI** ✅ | CRUD screens for activities, transactions, budgets, and goals (no pixels yet) | The family can log a full day by hand |
| **3. MCP server** ✅ | `mcp/tools.ts`, stdio entry, `/mcp` function, token auth | Claude Code can log an expense and it appears in the app |
| **4. Pixel scene v1** ✅ | Sprite loader, map, member walking, activity animations, time scrubber, using your assets | Today's entries play back as a scene |
| **5. Finance visuals** ✅ | Savings jars, budget bars, coin pops, calendar thumbnails | Budget and savings pages are fully pixel-styled |
| **6. Deploy** (code ready, site not created) | Netlify site + Netlify DB + login + tokens | Reachable from phones; agents connect remotely |
| **7. Nice-to-haves** | Installable on phones (PWA) with offline queue, photos, end-of-day summary, recurring expenses, CSV bank import | — |

---

## 10. Decisions so far

**Family (seeded as `members`):** Freznel, Diane, Ellie, Rafa. Every member gets a login once the app is online.

**Currency:** PHP (₱), stored as centavos (`amount_cents`), displayed as `₱1,250.00`. The `en-PH` locale is used for number and date formatting.

**Places (map hotspots):**

| Key | Place | Notes |
|---|---|---|
| `house` | House | Home base; everyone starts and ends the day here |
| `church` | Church | |
| `school` | School | |
| `mall` | Malls | One hotspot; the activity note says which mall |
| `office` | Office | |

More places can be added in Settings without code changes.

**Activity types (seed list, editable):**

| Key | Activity | Default place | Animation idea |
|---|---|---|---|
| `dining_out` | Dining out | mall | sitting at table, eating |
| `piano` | Studying piano | house | playing keys |
| `worship` | Worship | church | standing, music notes |
| `cleaning` | Cleaning | house | sweeping |
| `school` | School / class | school | sitting at desk |
| `studying` | Studying / homework | house | reading book |
| `work` | Work | office | typing |
| `shopping` | Shopping | mall | carrying bags |
| `play` | Play / rest | house | idle / bouncing |
| `travel` | Commute / travel | — | walking between places |

**Expense categories (seed, PHP context, editable):** Groceries, Dining out, Transportation/Gas, Utilities (Meralco, water, internet), Tuition & school, Lessons (piano), Church/Tithes & offerings, Household, Health, Shopping, Allowance, Others.

**Logins and permissions (when online):**

| Role | Members | Can do |
|---|---|---|
| `parent` | Freznel, Diane | Everything: budgets, savings, settings, API tokens, undo |
| `child` | Ellie, Rafa | Log and edit their own activities, log their own spending/allowance, view the family scene and savings goals; no access to budget settings, tokens, or other members' transactions |

Each member logs in with their own PIN or passphrase. Kids' accounts can be limited further later if needed. Agent tokens are created by a parent and can act "on behalf of" a member so the audit log stays accurate.

## 11. Character art (from the first sprite sheets)

Four characters, each drawn front-facing, with front/back/side walk poses and close-up portraits with expressions:

| Member | Look |
|---|---|
| Freznel | Black hair, glasses, black polo, grey trousers |
| Diane | Long brown hair, glasses, black blazer and trousers |
| Ellie | Long black hair, glasses, blue headphones, pink hoodie, wide jeans, white sneakers |
| Rafa | Spiky black hair, yellow-and-green striped tee, jeans |

Ellie and Rafa are 10 and 11, so the kids' screens stay simple but don't need to be toddler-level: big buttons, icons plus words, and a quick "what did you do today?" flow.

**Preparing the art for the game.** The current images are 2000×1116 JPG previews on a white background, with the art scaled up by a non-whole factor. Before they go in the game they need:

1. **Transparent PNG** (JPG adds blurry halos around every pixel).
2. **A true pixel grid:** shrink each character back to its native size (it looks like roughly 32×64 for adults and smaller for the kids) with nearest-neighbour sampling, then tidy stray pixels.
3. **One sprite sheet per member** with fixed-size frames, e.g. rows = down / up / left / right, columns = walk frames 1–4. Right can be the mirrored left.
4. **Extra rows later** for activities: sit, eat, play piano, sweep, worship, type.
5. **Portraits** as a separate 48×48 sheet: neutral, happy, laughing, surprised, tired.

Placeholder rectangles in each member's colour are used until the cleaned sheets exist, so the code isn't blocked on art.

## 12. Art made so far

**Places** (`tools/gen_places.py`, drawn in code, transparent PNGs in `assets/places/`, enlarged previews in `assets/places/preview/`):
house, church (New Wine Alabang), school_miriam, school_ateneo, office, and malls: SM Marikina, SM Aura, Ayala Feliz, Up Town Center, Festival, Alabang Town Center. These are stylised impressions, not replicas, with no store logos. To change colours or details, or to add a mall to the `MALLS` list, edit the script and rerun it.

**Characters** (`tools/prep_characters.py`): auto-converted from `assets/characters/reference/family-front.jpg` at the art's true pixel size (about 8.25 image px per art pixel) into native sprites: Freznel 46×131, Diane 43×125, Ellie 43×122, Rafa 39×111 (`assets/characters/<name>_front.png`). Glasses, faces, headphones, stripes and the hoodie pattern all survive; only a few stray pixels from JPG noise remain.

**Walk sprites and portraits** (`tools/prep_sheet.py`, from `assets/characters/reference/family-sheet.jpg`):

- `assets/characters/<name>_walk.png`: 6 frames per person in a row, each 32×66 px with feet on the bottom edge. `walk.json` says what each frame shows (front, back, right, left, front/back walking). People are about 56 px tall.
- `assets/characters/portraits/`: 8 faces, about 50×56 px: Freznel (neutral, surprised), Diane (happy, smile, laugh), Ellie (surprised, worried), Rafa (surprised).

Known gaps in the source art, to fix by redrawing or regenerating:

- Diane's 4th walk frame shows a different person, so it is marked `skip`.
- Side-walk frames are single poses, not a full cycle; 2–3 frames per direction are usable. Freznel and Diane have no front/back walking frames.
- Portraits are uneven: Rafa and Ellie have no neutral or happy face, Freznel has no happy face.
- Freznel's full-size sprite has two small white slivers at the hips.

**Scale:** the town draws buildings at 2× and the 56 px walk sprites at 1×. The full-size sprites (110–131 px) are for profile cards, and portraits are for moods and the daily view.

## 13. Open questions

1. Are the originals on the T7 Shield higher quality or layered (Aseprite/PSD)? If so, rerun the character script on those.
2. Should mall visits record which mall (a list of malls), or just "mall" plus a note? The plan assumes a list of malls.
