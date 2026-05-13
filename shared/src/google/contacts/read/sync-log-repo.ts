// Sync-log repository for Google Contacts read-only pull.
// RO-INVARIANT: INV-1 (separate audit log for Google Contacts pull), L2.3 (audit).
//
// The ONLY module that performs SQL on the `google_contacts_sync_log` table.
// Records structured audit events (oauth, http, dry-run, apply, conflict) for
// every sync run, enabling diagnostics and disconnect-history review.
//
// Rules:
//  - All queries are parameterized — no string concatenation of user data.
//  - No `any` types.
//  - No transactions needed: each operation is a single atomic statement.
//  - Do NOT read from or write to the generic `sync_log` table.

import type { DbAdapter } from '../../../db/adapter'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SyncLogEvent =
  | 'oauth_consent'
  | 'oauth_refresh'
  | 'oauth_disconnected'
  | 'http_call'
  | 'fetch_page'
  | 'dry_run_computed'
  | 'user_confirmed'
  | 'user_cancelled'
  | 'apply_complete'
  | 'apply_failed'
  | 'conflict_resolved'
  | 'photo_download_failed'
  | 'error'

export interface SyncLogRow {
  id: number
  runId: string
  ts: string
  event: SyncLogEvent
  level: 'info' | 'warn' | 'error'
  payloadJson: string | null
}

// ---------------------------------------------------------------------------
// Row shape returned from SQLite
// ---------------------------------------------------------------------------

interface RawRow {
  id: number
  run_id: string
  ts: string
  event: string
  level: string
  payload_json: string | null
}

// ---------------------------------------------------------------------------
// Mapping helper
// ---------------------------------------------------------------------------

function rowToLog(row: RawRow): SyncLogRow {
  return {
    id: row.id,
    runId: row.run_id,
    ts: row.ts,
    event: row.event as SyncLogEvent,
    level: row.level as 'info' | 'warn' | 'error',
    payloadJson: row.payload_json,
  }
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class SyncLogRepo {
  constructor(private db: DbAdapter) {}

  /** Append a single audit event to the log. */
  async append(input: {
    runId: string
    event: SyncLogEvent
    level?: 'info' | 'warn' | 'error'
    payload?: unknown
  }): Promise<void> {
    const level = input.level ?? 'info'
    const ts = new Date().toISOString()
    const payloadJson = JSON.stringify(input.payload ?? null)
    await this.db.execute(
      `INSERT INTO google_contacts_sync_log (run_id, ts, event, level, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
      [input.runId, ts, input.event, level, payloadJson],
    )
  }

  /** Return all rows for a given run, ordered by ts ASC. */
  async listByRun(runId: string): Promise<SyncLogRow[]> {
    const rows = await this.db.select<RawRow>(
      `SELECT * FROM google_contacts_sync_log WHERE run_id = ? ORDER BY ts ASC`,
      [runId],
    )
    return rows.map(rowToLog)
  }

  /** Return the n most recent rows for a given event type, ordered by ts DESC. */
  async listLatest(event: SyncLogEvent, n: number): Promise<SyncLogRow[]> {
    const rows = await this.db.select<RawRow>(
      `SELECT * FROM google_contacts_sync_log WHERE event = ? ORDER BY ts DESC LIMIT ?`,
      [event, n],
    )
    return rows.map(rowToLog)
  }

  /** Return the ts of the most recent oauth_consent event, or null if none exists. */
  async latestConsentTs(): Promise<string | null> {
    const rows = await this.db.select<{ ts: string }>(
      `SELECT ts FROM google_contacts_sync_log
       WHERE event = 'oauth_consent'
       ORDER BY ts DESC
       LIMIT 1`,
    )
    return rows[0]?.ts ?? null
  }

  /** Return rows matching any of the supplied event types, ordered by ts DESC, with optional limit. */
  async listLatestByEvent(events: SyncLogEvent[], limit?: number): Promise<SyncLogRow[]> {
    if (events.length === 0) return []
    const placeholders = events.map(() => '?').join(', ')
    const params: unknown[] = [...events]
    const limitClause = limit !== undefined ? ' LIMIT ?' : ''
    if (limit !== undefined) params.push(limit)
    const rows = await this.db.select<RawRow>(
      `SELECT * FROM google_contacts_sync_log
       WHERE event IN (${placeholders})
       ORDER BY ts DESC${limitClause}`,
      params,
    )
    return rows.map(rowToLog)
  }

  /** Delete all rows (for tests and Disconnect-Delete path). */
  async clear(): Promise<void> {
    await this.db.execute('DELETE FROM google_contacts_sync_log')
  }
}
