import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { InputError, lookup } from "./context";
import type { User } from "./permissions";

const MAX_FAILS = 5;
const LOCK_MINUTES = 5;
const SESSION_DAYS = 30;

// ---------------------------------------------------------------- PINs

function hashPin(pin: string, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(pin, salt, 32).toString("hex")}`;
}

function pinMatches(pin: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(pin, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function setPin(db: Db, memberKey: string, pin: string) {
  if (!/^\d{4,8}$/.test(pin)) throw new InputError("A PIN is 4 to 8 digits");
  const member = await lookup.member(db, memberKey);
  await db
    .update(schema.members)
    .set({ pinHash: hashPin(pin), pinFails: 0, pinLockedUntil: null })
    .where(eq(schema.members.id, member.id));
}

/** Check a PIN. After 5 wrong tries the member is locked out for 5 minutes. */
export async function checkPin(db: Db, memberKey: string, pin: string, now = new Date()): Promise<User> {
  const member = await lookup.member(db, memberKey);
  if (!member.pinHash) throw new InputError(`${member.name} has no PIN yet. A parent can set one in Settings.`);
  if (member.pinLockedUntil && member.pinLockedUntil > now) {
    throw new InputError("Too many wrong tries. Wait a few minutes and try again.");
  }
  if (!pinMatches(pin, member.pinHash)) {
    const fails = member.pinFails + 1;
    const locked = fails >= MAX_FAILS;
    await db
      .update(schema.members)
      .set({ pinFails: locked ? 0 : fails, pinLockedUntil: locked ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null })
      .where(eq(schema.members.id, member.id));
    throw new InputError("Wrong PIN");
  }
  await db.update(schema.members).set({ pinFails: 0, pinLockedUntil: null }).where(eq(schema.members.id, member.id));
  return { key: member.key, role: member.role };
}

// ---------------------------------------------------------------- sessions (signed cookie value)

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function createSession(memberKey: string, secret: string, now = Date.now()) {
  const payload = `${memberKey}.${now + SESSION_DAYS * 86_400_000}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the member key if the session is genuine and not expired, else null. */
export function readSession(value: string | undefined, secret: string, now = Date.now()): string | null {
  if (!value) return null;
  const i = value.lastIndexOf(".");
  const payload = value.slice(0, i);
  const a = Buffer.from(value.slice(i + 1));
  const b = Buffer.from(sign(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [key, expires] = payload.split(".");
  return Number(expires) > now ? key : null;
}

// ---------------------------------------------------------------- agent tokens

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Create a token for an agent that acts as a family member. The token is shown once and only its hash is stored. */
export async function createToken(db: Db, name: string, memberKey: string) {
  const clean = name.trim();
  if (!/^[\w -]{1,40}$/.test(clean)) throw new InputError("Token names are 1–40 letters, digits, spaces, - or _");
  const member = await lookup.member(db, memberKey);
  const [taken] = await db.select().from(schema.apiTokens).where(eq(schema.apiTokens.name, clean));
  if (taken) throw new InputError(`A token named "${clean}" already exists`);
  const token = `hesed_${randomBytes(24).toString("base64url")}`;
  await db.insert(schema.apiTokens).values({ name: clean, tokenHash: hashToken(token), memberId: member.id });
  return { name: clean, token };
}

export async function checkToken(db: Db, token: string): Promise<User | null> {
  const [row] = await db
    .select({ id: schema.apiTokens.id, name: schema.apiTokens.name, key: schema.members.key, role: schema.members.role })
    .from(schema.apiTokens)
    .innerJoin(schema.members, eq(schema.apiTokens.memberId, schema.members.id))
    .where(and(eq(schema.apiTokens.tokenHash, hashToken(token)), eq(schema.apiTokens.revoked, false)));
  if (!row) return null;
  await db.update(schema.apiTokens).set({ lastUsedAt: new Date().toISOString() }).where(eq(schema.apiTokens.id, row.id));
  return { key: row.key, role: row.role, agent: row.name };
}

export function listTokens(db: Db) {
  return db
    .select({
      id: schema.apiTokens.id,
      name: schema.apiTokens.name,
      member: schema.members.key,
      createdAt: schema.apiTokens.createdAt,
      lastUsedAt: schema.apiTokens.lastUsedAt,
      revoked: schema.apiTokens.revoked,
    })
    .from(schema.apiTokens)
    .innerJoin(schema.members, eq(schema.apiTokens.memberId, schema.members.id))
    .orderBy(schema.apiTokens.id);
}

export async function revokeToken(db: Db, id: number) {
  const [row] = await db.update(schema.apiTokens).set({ revoked: true }).where(eq(schema.apiTokens.id, id)).returning();
  if (!row) throw new InputError(`No token with id ${id}`);
}
