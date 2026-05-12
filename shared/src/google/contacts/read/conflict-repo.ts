// RO-INVARIANT: INV-5 (conflict queue with on-demand resolution).
// ConflictRepo — the ONLY module that performs SQL on the `sync_conflicts` table.
// Manages field-level conflict records created during Google Contacts 3-way merge.
//
// Rules:
//  - All SQL is parameterized — never interpolate user-supplied values.
//  - No `any` types.
//  - Conflicts are append-only until explicitly resolved; never auto-resolved.
//  - resolve() sets status='resolved' and records resolved_at as ISO-8601 UTC string.

import type { DbAdapter } from '../../../db/adapter'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConflictRow {
  id: number
  contactId: string
  googleResourceName: string
  fieldPath: string
  baseValueJson: string | null
  googleValueJson: string | null
  localValueJson: string
  status: 'pending' | 'resolved'
  resolution: 'local' | 'google' | 'custom' | null
  customValueJson: string | null
  detectedAt: string
  resolvedAt: string | null
}

export type NewConflict = Omit<
  ConflictRow,
  'id' | 'status' | 'resolution' | 'customValueJson' | 'resolvedAt'
> & { status?: 'pending' }

// ---------------------------------------------------------------------------
// Row → object mapping
// ---------------------------------------------------------------------------

interface RawRow {
  id: number
  contact_id: string
  google_resource_name: string
  field_path: string
  base_value_json: string | null
  google_value_json: string | null
  local_value_json: string
  status: string
  resolution: string | null
  custom_value_json: string | null
  detected_at: string
  resolved_at: string | null
}

function rowToConflict(r: RawRow): ConflictRow {
  return {
    id: r.id,
    contactId: r.contact_id,
    googleResourceName: r.google_resource_name,
    fieldPath: r.field_path,
    baseValueJson: r.base_value_json,
    googleValueJson: r.google_value_json,
    localValueJson: r.local_value_json,
    status: r.status as 'pending' | 'resolved',
    resolution: (r.resolution ?? null) as 'local' | 'google' | 'custom' | null,
    customValueJson: r.custom_value_json,
    detectedAt: r.detected_at,
    resolvedAt: r.resolved_at,
  }
}

// ---------------------------------------------------------------------------
// ConflictRepo
// ---------------------------------------------------------------------------

export class ConflictRepo {
  constructor(private db: DbAdapter) {}

  /** Batch-insert conflict rows with status='pending'. */
  async insertPending(rows: NewConflict[]): Promise<void> {
    if (rows.length === 0) return
    for (const row of rows) {
      await this.db.execute(
        `INSERT INTO sync_conflicts
           (contact_id, google_resource_name, field_path,
            base_value_json, google_value_json, local_value_json,
            status, detected_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [
          row.contactId,
          row.googleResourceName,
          row.fieldPath,
          row.baseValueJson ?? null,
          row.googleValueJson ?? null,
          row.localValueJson,
          row.detectedAt,
        ],
      )
    }
  }

  /** List pending conflicts, optionally filtered by contactId, ordered newest-first. */
  async listPending(opts?: { contactId?: string; limit?: number }): Promise<ConflictRow[]> {
    return this._list('pending', opts)
  }

  /** List resolved conflicts, optionally filtered by contactId, ordered newest-first. */
  async listResolved(opts?: { contactId?: string; limit?: number }): Promise<ConflictRow[]> {
    return this._list('resolved', opts)
  }

  /** Mark a conflict as resolved, recording resolution type and optional custom value. */
  async resolve(
    id: number,
    resolution: 'local' | 'google' | 'custom',
    customValueJson?: string | null,
  ): Promise<void> {
    const now = new Date().toISOString()
    await this.db.execute(
      `UPDATE sync_conflicts
         SET status = 'resolved',
             resolution = ?,
             custom_value_json = ?,
             resolved_at = ?
       WHERE id = ?`,
      [resolution, customValueJson ?? null, now, id],
    )
  }

  /** Delete all rows from sync_conflicts. */
  async clearAll(): Promise<void> {
    await this.db.execute('DELETE FROM sync_conflicts', [])
  }

  /** Count rows matching the given status. */
  async count(status: 'pending' | 'resolved'): Promise<number> {
    const rows = await this.db.select<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM sync_conflicts WHERE status = ?`,
      [status],
    )
    return rows[0]?.cnt ?? 0
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _list(
    status: 'pending' | 'resolved',
    opts?: { contactId?: string; limit?: number },
  ): Promise<ConflictRow[]> {
    const conditions: string[] = ['status = ?']
    const params: unknown[] = [status]

    if (opts?.contactId !== undefined) {
      conditions.push('contact_id = ?')
      params.push(opts.contactId)
    }

    const where = conditions.join(' AND ')
    const limitClause = opts?.limit !== undefined ? ` LIMIT ?` : ''
    if (opts?.limit !== undefined) params.push(opts.limit)

    const rows = await this.db.select<RawRow>(
      `SELECT * FROM sync_conflicts WHERE ${where} ORDER BY detected_at DESC${limitClause}`,
      params,
    )
    return rows.map(rowToConflict)
  }
}
