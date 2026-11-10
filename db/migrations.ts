/**
 * Ordered SQL migrations. Each runs once; applied ones are recorded in _migrations.
 * Phase 0 only creates the reference tables. Activities and finance tables come in Phase 1.
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
];
