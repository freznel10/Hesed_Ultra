/**
 * Ordered SQL migrations. Each runs once; applied ones are recorded in _migrations.
 */
export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "0001_reference_tables",
    sql: `
      CREATE TABLE members (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('parent', 'child')),
        color TEXT NOT NULL,
        sprite TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE
      );
      CREATE TABLE places (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        sprite TEXT
      );
      CREATE TABLE activity_types (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        default_place_id INTEGER REFERENCES places(id)
      );
    `,
  },
  {
    id: "0002_activities_finance_audit",
    sql: `
      CREATE TABLE categories (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('expense', 'income'))
      );
      CREATE TABLE activities (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        start_time TIME,
        end_time TIME,
        type_id INTEGER NOT NULL REFERENCES activity_types(id),
        place_id INTEGER REFERENCES places(id),
        title TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        mood INTEGER CHECK (mood BETWEEN 1 AND 5),
        source TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX activities_date ON activities(date);
      CREATE TABLE activity_members (
        activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        member_id INTEGER NOT NULL REFERENCES members(id),
        PRIMARY KEY (activity_id, member_id)
      );
      CREATE TABLE transactions (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        category_id INTEGER NOT NULL REFERENCES categories(id),
        member_id INTEGER REFERENCES members(id),
        payee TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        activity_id INTEGER REFERENCES activities(id) ON DELETE SET NULL,
        source TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX transactions_date ON transactions(date);
      CREATE TABLE budgets (
        id SERIAL PRIMARY KEY,
        month TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
        category_id INTEGER NOT NULL REFERENCES categories(id),
        limit_cents INTEGER NOT NULL CHECK (limit_cents >= 0),
        UNIQUE (month, category_id)
      );
      CREATE TABLE savings_goals (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        target_cents INTEGER NOT NULL CHECK (target_cents > 0),
        target_date DATE,
        archived BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE savings_entries (
        id SERIAL PRIMARY KEY,
        goal_id INTEGER NOT NULL REFERENCES savings_goals(id),
        date DATE NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
        note TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE audit_log (
        id SERIAL PRIMARY KEY,
        at TIMESTAMPTZ NOT NULL DEFAULT now(),
        actor TEXT NOT NULL,
        source TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
        before JSONB,
        after JSONB
      );
    `,
  },
];
