import { Firestore } from '@google-cloud/firestore';
import { UserStoreBase, type StoredSession, type StoredUser } from './users.ts';

/**
 * People and sessions in Firestore: collections `users` and `sessions`.
 *
 * This is the answer for Cloud Run, where the local disk is ephemeral and per instance — an access
 * created on one instance disappears when the platform recycles it, with no error and no log. See
 * `users.ts` for why that is the reason this whole seam exists.
 *
 * The document id is the e-mail, already normalised. That is what makes `create` able to use
 * `create()` instead of `set()`: Firestore refuses a document that already exists, so two
 * simultaneous first accesses cannot both win. With a generated id the duplicate would be legal
 * and nobody would notice until two people shared an account.
 *
 * Unlike the event store next door, this collection is NOT insert-only: a password change is an
 * update, and a logout is a delete. People are state, not facts.
 *
 * ⚠️ Proved by code review only. There is no Firestore emulator on this machine, so the
 * conformance test skips this implementation with a message instead of pretending. Do not read a
 * green suite as evidence that this file works.
 */
export class UsersFirestore extends UserStoreBase {
  #db: Firestore;

  constructor(projectId: string) {
    super();
    this.#db = new Firestore({ projectId });
  }

  protected async insertUser(row: StoredUser): Promise<void> {
    await this.#db.collection('users').doc(row.email).create({
      email: row.email, name: row.name, salt: row.salt, hash: row.hash,
      must_change: row.mustChangePassword, created_at: row.createdAt,
    });
  }

  protected async readUser(email: string): Promise<StoredUser | null> {
    const doc = await this.#db.collection('users').doc(email).get();
    const d = doc.data();
    if (!d) return null;
    return {
      email: d.email, name: d.name,
      // Firestore hands bytes back as a Buffer already; the copy costs nothing and means the
      // constant-time comparison never receives something that is merely Buffer-like.
      salt: Buffer.from(d.salt), hash: Buffer.from(d.hash),
      mustChangePassword: !!d.must_change, createdAt: d.created_at,
    };
  }

  protected async writeCredential(email: string, salt: Buffer, hash: Buffer): Promise<void> {
    await this.#db.collection('users').doc(email).update({ salt, hash, must_change: false });
  }

  protected async countUsers(): Promise<number> {
    // `isEmpty` is the only caller and it asks a yes/no question, so one document is enough to
    // answer it. Counting the collection would bill a read per person to learn nothing more.
    const r = await this.#db.collection('users').limit(1).get();
    return r.size;
  }

  protected async insertSession(id: string, email: string, createdAt: string, expiresAt: string): Promise<void> {
    await this.#db.collection('sessions').doc(id).create({
      email, created_at: createdAt, expires_at: expiresAt,
    });
  }

  protected async readSession(id: string): Promise<StoredSession | null> {
    const d = (await this.#db.collection('sessions').doc(id).get()).data();
    return d ? { email: d.email, expiresAt: d.expires_at } : null;
  }

  protected async deleteSession(id: string): Promise<void> {
    await this.#db.collection('sessions').doc(id).delete();
  }

  protected async deleteSessionsExpiredBefore(instant: string): Promise<void> {
    // Expiry is an ISO string, so `<` on it is chronological order. Batched because Firestore
    // takes at most 500 writes per commit, and a service left running for a month accumulates
    // more dead sessions than that.
    const stale = await this.#db.collection('sessions')
      .where('expires_at', '<', instant).limit(400).get();
    if (stale.empty) return;
    const batch = this.#db.batch();
    for (const doc of stale.docs) batch.delete(doc.ref);
    await batch.commit();
  }

  async close(): Promise<void> {
    await this.#db.terminate();
  }
}
