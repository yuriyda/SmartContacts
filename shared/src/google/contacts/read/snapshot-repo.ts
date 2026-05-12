// Google Contact Snapshot repository for Smart Contacts.
// RO-INVARIANT: INV-3 (snapshot as three-way merge base).
//
// The ONLY module that performs SQL on the `google_contact_snapshots` table.
// Stores the last-known Google-side state of a contact for use as the merge base
// in three-way merges between local edits and incoming Google changes.
//
// Rules:
//  - All queries are parameterized — no string concatenation of user data.
//  - No `any` types.
//  - No transactions needed: each operation is a single atomic statement.

import type { DbAdapter } from '../../../db/adapter'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Snapshot {
  googleResourceName: string
  etag: string
  updateTime: string
  payloadJson: string
  lastSyncedAt: string
}

// ---------------------------------------------------------------------------
// Row shape returned from SQLite
// ---------------------------------------------------------------------------

interface SnapshotRow {
  google_resource_name: string
  etag: string
  update_time: string
  payload_json: string
  last_synced_at: string
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function rowToSnapshot(row: SnapshotRow): Snapshot {
  return {
    googleResourceName: row.google_resource_name,
    etag: row.etag,
    updateTime: row.update_time,
    payloadJson: row.payload_json,
    lastSyncedAt: row.last_synced_at,
  }
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class SnapshotRepo {
  constructor(private db: DbAdapter) {}

  /** Retrieve a snapshot by Google resource name; returns null if not found. */
  async get(resourceName: string): Promise<Snapshot | null> {
    const rows = await this.db.select<SnapshotRow>(
      'SELECT * FROM google_contact_snapshots WHERE google_resource_name = ?',
      [resourceName],
    )
    return rows.length > 0 ? rowToSnapshot(rows[0]!) : null
  }

  /** Insert or replace a snapshot row (upsert by PRIMARY KEY). */
  async upsert(s: Snapshot): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO google_contact_snapshots
         (google_resource_name, etag, update_time, payload_json, last_synced_at)
       VALUES (?, ?, ?, ?, ?)`,
      [s.googleResourceName, s.etag, s.updateTime, s.payloadJson, s.lastSyncedAt],
    )
  }

  /** Delete the snapshot for a single resource name. */
  async deleteByResource(resourceName: string): Promise<void> {
    await this.db.execute('DELETE FROM google_contact_snapshots WHERE google_resource_name = ?', [
      resourceName,
    ])
  }

  /** Delete all snapshots (full reset before a re-sync). */
  async deleteAll(): Promise<void> {
    await this.db.execute('DELETE FROM google_contact_snapshots')
  }

  /** Return every snapshot row; used for full-sync diff computation. */
  async listAll(): Promise<Snapshot[]> {
    const rows = await this.db.select<SnapshotRow>('SELECT * FROM google_contact_snapshots')
    return rows.map(rowToSnapshot)
  }
}
