// Google Labels repository for Smart Contacts.
// RO-INVARIANT: INV-4 (Google labels = read-only namespace, full-replace semantics).
//
// The ONLY module that performs SQL on `google_labels` and `google_label_memberships`.
// Labels are owned by Google; the local copy is always a full-replace mirror.
//
// Rules:
//  - All writes use full-replace (DELETE + INSERT), never UPSERT — required by INV-4.
//  - All multi-statement writes run inside db.transaction().
//  - No `any` types.
//  - Membership mutation is only permitted via replaceMembershipsForContact().

import type { DbAdapter } from '../../../db/adapter'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GoogleLabelRow {
  resourceName: string
  name: string
  groupType: 'system' | 'user'
  etag: string
  lastSyncedAt: string
}

// ---------------------------------------------------------------------------
// Row shape returned from SQLite
// ---------------------------------------------------------------------------

interface LabelSqlRow {
  resource_name: string
  name: string
  group_type: string
  etag: string
  last_synced_at: string
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function rowToLabel(row: LabelSqlRow): GoogleLabelRow {
  return {
    resourceName: row.resource_name,
    name: row.name,
    groupType: row.group_type as 'system' | 'user',
    etag: row.etag,
    lastSyncedAt: row.last_synced_at,
  }
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class LabelRepo {
  constructor(private db: DbAdapter) {}

  /**
   * Full-replace all labels: DELETE all existing rows, then INSERT the new set.
   * Satisfies INV-4 — no partial updates, no upserts.
   * Memberships are NOT touched here; they must be managed separately.
   */
  async replaceAll(labels: GoogleLabelRow[]): Promise<void> {
    await this.db.transaction(async (tx: DbAdapter) => {
      await tx.execute('DELETE FROM google_labels')
      for (const label of labels) {
        await tx.execute(
          `INSERT INTO google_labels (resource_name, name, group_type, etag, last_synced_at)
           VALUES (?, ?, ?, ?, ?)`,
          [label.resourceName, label.name, label.groupType, label.etag, label.lastSyncedAt],
        )
      }
    })
  }

  /**
   * Full-replace memberships for a single contact: DELETE existing rows for contactId,
   * then INSERT the new set.
   * This is the ONLY permitted way to mutate google_label_memberships.
   */
  async replaceMembershipsForContact(
    contactId: string,
    labelResourceNames: string[],
  ): Promise<void> {
    await this.db.transaction(async (tx: DbAdapter) => {
      await tx.execute('DELETE FROM google_label_memberships WHERE contact_id = ?', [contactId])
      for (const resourceName of labelResourceNames) {
        await tx.execute(
          `INSERT INTO google_label_memberships (contact_id, label_resource_name)
           VALUES (?, ?)`,
          [contactId, resourceName],
        )
      }
    })
  }

  /** Return every label row. */
  async listAll(): Promise<GoogleLabelRow[]> {
    const rows = await this.db.select<LabelSqlRow>('SELECT * FROM google_labels')
    return rows.map(rowToLabel)
  }

  /** Return all labels that a given contact belongs to, via membership join. */
  async listForContact(contactId: string): Promise<GoogleLabelRow[]> {
    const rows = await this.db.select<LabelSqlRow>(
      `SELECT gl.*
       FROM google_labels gl
       JOIN google_label_memberships glm ON gl.resource_name = glm.label_resource_name
       WHERE glm.contact_id = ?`,
      [contactId],
    )
    return rows.map(rowToLabel)
  }

  /**
   * Clear all label and membership data.
   * Memberships are deleted first to respect FK constraints where CASCADE is not guaranteed.
   */
  async clearAll(): Promise<void> {
    await this.db.transaction(async (tx: DbAdapter) => {
      await tx.execute('DELETE FROM google_label_memberships')
      await tx.execute('DELETE FROM google_labels')
    })
  }
}
