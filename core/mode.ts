/**
 * Local or online?
 *
 * Local (your own computer): no logins; the app trusts the "Who's here?" picker.
 * Online (Netlify, or any time a Postgres URL is set): PIN logins and agent tokens are
 * required, which needs SESSION_SECRET. If it is missing online, the app refuses to
 * serve data rather than run unprotected.
 */
const env = process.env;

export const sessionSecret = () => env.SESSION_SECRET || null;

export const isOnline = () =>
  Boolean(env.NETLIFY_DATABASE_URL || env.DATABASE_URL || env.AWS_LAMBDA_FUNCTION_NAME || (env.NETLIFY === "true" && !env.NETLIFY_DEV));

export const loginRequired = () => Boolean(sessionSecret()) || isOnline();

export class Misconfigured extends Error {
  constructor() {
    super("This site is online but SESSION_SECRET is not set, so it is locked. Add SESSION_SECRET in the site's environment variables and redeploy.");
  }
}

/** Call at the start of every request. */
export function assertSafe() {
  if (isOnline() && !sessionSecret()) throw new Misconfigured();
}
