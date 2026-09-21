import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Who gets in, with user and password, depending on no provider — and WHERE that is kept.
 *
 * It exists so Doc First can be used the way Keycloak is: start the image, log in as admin, get to
 * work. Until here identity came from Google IAP, and that tied the method to one specific cloud —
 * anyone outside GCP had no way to use it.
 *
 * ## Why the storage is pluggable
 *
 * SQLite in a file was the only option, and on Cloud Run a file is **ephemeral and per instance**.
 * An access created at 10:00 lives on the instance that served that request; when the platform
 * recycles it, `users.db` goes with it. The person whose account was created simply stops getting
 * in — **no error, no log, nothing to grep**. Nobody discovers this on the day it is configured;
 * they discover it weeks later, when someone says "it forgot me again".
 *
 * So the same choice Keycloak gives is given here: a file for running on a laptop, a real database
 * for a deployment that survives its own instances. The interface below is the whole contract, and
 * `review/tests/users-conformance.test.js` runs ONE set of tests against every implementation —
 * an implementation that does not pass it is not supported.
 *
 * ## About the passwords
 *
 * - stored with **scrypt** (Node ships it), one salt per person, never in plain text;
 * - comparison in **constant time**, so the response time does not reveal how many characters match;
 * - a hash is derived even for an e-mail that does not exist, or the response time would say who
 *   has an account here;
 * - the admin's initial password is **randomly generated** and shown ONCE in the log of the first
 *   start. "admin/admin" is inviting, but whoever starts it and forgets leaves the door open — and
 *   an internal documentation tool tends to stay up for years with nobody looking;
 * - changing the initial password is **mandatory**: until it changes, the person reaches only the
 *   change screen.
 *
 * ⚠️ All of that lives HERE, in `UserStoreBase`, and not in the implementations. A password hashed
 * one way in SQLite and another way in Postgres is an account that works in one database and not
 * in the other — and the person hits "e-mail or password do not match" with the right password in
 * their hands. The implementations below know about rows. They do not know about scrypt.
 * @module
 */

const derive = promisify(scrypt) as (secret: string, salt: Buffer, length: number) => Promise<Buffer>;

/** scrypt output length, in bytes. Same number for every implementation — see the note above. */
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Short enough to type, long enough that guessing is not a strategy.
 *
 * Exported because the login screen states the rule before the person breaks it, and a screen
 * saying "12 or more" next to a server enforcing something else is the kind of mismatch nobody
 * catches until someone is stuck at the door.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * A rule the PERSON broke — not the program. It carries the i18n key so the edge can say it in
 * their language (see review/core/i18n.js for who reads what).
 *
 * ⚠️ `message` stays English, always. It is what reaches a log and a stack trace, and evidence
 * that changes wording by locale is evidence nobody can grep. The key is the translated half; the
 * message is the greppable half. Both, on purpose.
 */
export class UserInputError extends Error {
  readonly key: string;
  readonly params: Record<string, string | number>;

  constructor(message: string, key: string, params: Record<string, string | number> = {}) {
    super(message);
    this.name = 'UserInputError';
    this.key = key;
    this.params = params;
  }

  /** Anything thrown, as something the edge can translate. An unknown cause gets a generic key. */
  static from(cause: unknown, fallbackKey: string): UserInputError {
    if (cause instanceof UserInputError) return cause;
    return new UserInputError(cause instanceof Error ? cause.message : String(cause), fallbackKey);
  }
}

/** A person, as the rest of the service sees them. No secret in here. */
export interface User {
  email: string;
  name: string;
  mustChangePassword: boolean;
  createdAt: string;
}

/**
 * Persistence of people and their sessions. SQLite, Firestore and Postgres implement this.
 *
 * Everything is a promise, including what SQLite could answer straight away: a caller that has to
 * know whether the store is local is a caller that breaks when the store changes.
 */
export interface UserStore {
  /** Creates the person. Returns the password — the generated one when none is given. */
  create(email: string, name: string, password?: string, mustChange?: boolean): Promise<string>;
  /** Checks the password. Returns the person, or null — without saying whether the e-mail exists. */
  check(email: string, password: string): Promise<User | null>;
  changePassword(email: string, next: string): Promise<void>;
  find(email: string): Promise<User | null>;
  /** True when nobody has been created yet: the first-access condition. */
  isEmpty(): Promise<boolean>;
  openSession(email: string, hours?: number): Promise<string>;
  fromSession(id: string | undefined): Promise<User | null>;
  closeSession(id: string | undefined): Promise<void>;
  purgeExpiredSessions(): Promise<void>;
  close(): Promise<void>;
}

/** A row as a database keeps it: the profile plus the two things that must never leave this file. */
export interface StoredUser extends User {
  salt: Buffer;
  hash: Buffer;
}

/** A session row. Timestamps are ISO strings everywhere, so they compare the same in every store. */
export interface StoredSession {
  email: string;
  expiresAt: string;
}

/** One place, so every store agrees on what "the same e-mail" means. */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Everything that must not differ between databases: the hashing, the constant-time comparison,
 * the session lifetime, the minimum password length.
 *
 * An implementation fills in the seven row operations below and gets the rest for free. That is
 * the point — there is no way for one store to hash differently from another, because none of
 * them hashes at all.
 */
export abstract class UserStoreBase implements UserStore {
  // ------------------------------------------------------------- rows: one per database
  protected abstract insertUser(row: StoredUser): Promise<void>;
  protected abstract readUser(email: string): Promise<StoredUser | null>;
  protected abstract writeCredential(email: string, salt: Buffer, hash: Buffer): Promise<void>;
  protected abstract countUsers(): Promise<number>;
  protected abstract insertSession(id: string, email: string, createdAt: string, expiresAt: string): Promise<void>;
  protected abstract readSession(id: string): Promise<StoredSession | null>;
  protected abstract deleteSession(id: string): Promise<void>;
  protected abstract deleteSessionsExpiredBefore(instant: string): Promise<void>;

  abstract close(): Promise<void>;

  // ------------------------------------------------------------- the part that cannot diverge
  async #hash(password: string, salt: Buffer): Promise<Buffer> {
    // NFKC first: the same password typed on two keyboards can arrive as two different byte
    // sequences, and the person would be locked out by an accent they cannot see.
    return derive(password.normalize('NFKC'), salt, KEY_LENGTH);
  }

  async create(email: string, name: string, password?: string, mustChange = true): Promise<string> {
    const chosen = password ?? randomBytes(12).toString('base64url');
    const salt = randomBytes(SALT_LENGTH);
    const hash = await this.#hash(chosen, salt);
    await this.insertUser({
      email: normalizeEmail(email), name, salt, hash,
      mustChangePassword: mustChange, createdAt: new Date().toISOString(),
    });
    return chosen;
  }

  async check(email: string, password: string): Promise<User | null> {
    const row = await this.readUser(normalizeEmail(email));

    // Derive a hash even with no person. Without this, an unknown e-mail would answer in
    // microseconds and a known one in milliseconds — which hands over who has an account here.
    const salt = row ? row.salt : randomBytes(SALT_LENGTH);
    const computed = await this.#hash(password, salt);
    if (!row) return null;

    if (computed.length !== row.hash.length || !timingSafeEqual(computed, row.hash)) return null;
    return profileOf(row);
  }

  async changePassword(email: string, next: string): Promise<void> {
    if (next.length < MIN_PASSWORD_LENGTH) {
      throw new UserInputError(
        `a password needs at least ${MIN_PASSWORD_LENGTH} characters`,
        'api.password.tooShort', { min: MIN_PASSWORD_LENGTH });
    }
    const salt = randomBytes(SALT_LENGTH);
    const hash = await this.#hash(next, salt);
    await this.writeCredential(normalizeEmail(email), salt, hash);
  }

  async find(email: string): Promise<User | null> {
    const row = await this.readUser(normalizeEmail(email));
    return row ? profileOf(row) : null;
  }

  async isEmpty(): Promise<boolean> {
    return (await this.countUsers()) === 0;
  }

  // ------------------------------------------------------------- sessions
  async openSession(email: string, hours = 12): Promise<string> {
    const id = randomBytes(32).toString('base64url');
    const now = new Date();
    await this.insertSession(
      id, normalizeEmail(email), now.toISOString(),
      new Date(now.getTime() + hours * 3600_000).toISOString());
    return id;
  }

  async fromSession(id: string | undefined): Promise<User | null> {
    if (!id) return null;
    const session = await this.readSession(id);
    // Expiry is decided here, against the service's clock, and not by each database's own idea of
    // "now". A session that is dead in SQLite and alive in Postgres is not one product.
    if (!session || session.expiresAt < new Date().toISOString()) return null;
    return this.find(session.email);
  }

  async closeSession(id: string | undefined): Promise<void> {
    if (id) await this.deleteSession(id);
  }

  async purgeExpiredSessions(): Promise<void> {
    await this.deleteSessionsExpiredBefore(new Date().toISOString());
  }
}

/** Drops the secret. Anything that leaves this file goes through here. */
function profileOf(row: StoredUser): User {
  return {
    email: row.email, name: row.name,
    mustChangePassword: row.mustChangePassword, createdAt: row.createdAt,
  };
}

/** Where SQLite writes when nothing is configured. The tool has to work with no configuration. */
export const DEFAULT_SQLITE_PATH = './dados/pessoas.db';

/**
 * Reads `REVISAO_USERS` and opens the store it names.
 *
 *   (absent)              | SQLite at `REVISAO_PESSOAS`, or at the default path
 *   sqlite:<path>         | SQLite in that file. `sqlite::memory:` for a throwaway one
 *   firestore             | Firestore, in the project given by `REVISAO_PROJETO`
 *   postgres://…          | Postgres. `postgresql://…` too — libpq accepts both
 *
 * Each implementation is imported only when it is chosen: whoever runs on SQLite should not load
 * the Firestore client, and whoever never touches Postgres should not have to install `pg`.
 */
export async function openUserStore(
  url: string | undefined,
  options: { projectId?: string; sqlitePath?: string } = {},
): Promise<UserStore> {
  const sqlitePath = options.sqlitePath ?? DEFAULT_SQLITE_PATH;
  const chosen = (url ?? '').trim();

  if (chosen === '' || chosen === 'sqlite') {
    const { UsersSqlite } = await import('./users-sqlite.ts');
    return new UsersSqlite(sqlitePath);
  }
  if (chosen.startsWith('sqlite:')) {
    const { UsersSqlite } = await import('./users-sqlite.ts');
    return new UsersSqlite(sqlitePathOf(chosen));
  }
  if (chosen === 'firestore') {
    if (!options.projectId) throw new Error('firestore needs REVISAO_PROJETO');
    const { UsersFirestore } = await import('./users-firestore.ts');
    return new UsersFirestore(options.projectId);
  }
  if (chosen.startsWith('postgres://') || chosen.startsWith('postgresql://')) {
    const { UsersPostgres } = await import('./users-postgres.ts');
    return new UsersPostgres(chosen);
  }
  // ⚠️ The value is masked before it goes into the message, and this is not caution for its own
  // sake: a typo as ordinary as `Postgres://` or a missing slash lands here, and the string
  // contains `user:password@host`. The message reaches console.error, which on a hosted runtime is
  // the log collector — readable by anyone who can read logs. Elsewhere this project already
  // takes care to log the KIND and never the URL; this was the path that undid it.
  throw new Error(
    `REVISAO_USERS="${maskCredentials(chosen)}" is not recognised `
    + '(use sqlite:<path>, firestore, postgres://… or postgresql://…)');
}

/**
 * Does this value end up keeping people in a FILE on the local disk?
 *
 * Absent and `sqlite` both land on SQLite at a path, so both count. `sqlite::memory:` does not:
 * it is already understood to be thrown away, and warning about it would be noise. Anything else
 * — firestore, postgres, or a value this factory does not recognise — is not a local file.
 */
export function isFileBackedUserStore(url: string | undefined): boolean {
  const chosen = (url ?? '').trim();
  if (chosen === '' || chosen === 'sqlite') return true;
  if (!chosen.startsWith('sqlite:')) return false;
  return sqlitePathOf(chosen) !== ':memory:';
}

/**
 * Does the runtime look like one whose disk does not survive the instance?
 *
 * ⚠️ `K_SERVICE` is a SIGNAL, not a certainty. It is what Cloud Run sets on every instance, and
 * it is the cheapest reliable evidence available at boot — but a container on Fly, App Runner or
 * a Kubernetes pod with no volume loses a file just as quietly, and each announces itself with a
 * different variable. This list is expected to GROW. A `false` here means "no evidence", never
 * "the disk is safe".
 */
export function looksEphemeral(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.K_SERVICE);
}

/**
 * The boot warning for the combination that loses people, or `null` when there is nothing to say.
 *
 * ⚠️ It says what WILL happen and what to do instead, because "warning: ephemeral storage" is a
 * line everybody scrolls past. The failure it describes is silent by nature — the account is
 * simply gone and nobody connects it to a deploy — so this line is the only chance anyone gets to
 * connect the two.
 *
 * English and hard-coded, NOT through i18n: this prints before there is a session, a person or a
 * chosen language. The comment at the top of review/core/i18n.js is the long version.
 *
 * ⚠️ Both halves of the condition matter equally. A warning that shows up on a laptop, where a
 * file is exactly the right answer, is a warning people learn to ignore — and then it protects
 * nothing on the day it is true.
 */
export function ephemeralUserStoreWarning(
  url: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!isFileBackedUserStore(url) || !looksEphemeral(env)) return null;
  return 'users are kept in a file on a disk that looks ephemeral (K_SERVICE is set). '
    + 'Accounts created here vanish when the platform recycles the instance, with no error and no '
    + 'log: the person simply stops being able to sign in. '
    + 'Set REVISAO_USERS=firestore (with REVISAO_PROJETO) or REVISAO_USERS=postgres://… to keep them.';
}

/** Hides `user:password@` in anything URL-shaped, so a connection string can be quoted safely. */
export function maskCredentials(value: string): string {
  return value.replace(/:\/\/[^@/]*@/, '://***@');
}

/**
 * `sqlite:./dados/x.db`, `sqlite:/var/lib/x.db` and `sqlite::memory:` all have to land on the path
 * SQLite expects. The `//` form is accepted too, because everyone writes URLs that way at least
 * once.
 */
function sqlitePathOf(url: string): string {
  const rest = url.slice('sqlite:'.length);
  return rest.startsWith('//') ? rest.slice(2) : rest;
}
