// Device initialisation: assigns a stable per-device ULID and seeds the vector_clock.
// `device_id` is written once on first run (idempotent on re-call) and persists
// across snapshots. Required by sync, taggings, and any code that needs to know
// "which device am I" — see types.ts `Contact.deviceId`.
import type { DbAdapter } from './adapter'
import { ulid } from '../ulid'

export async function initDevice(db: DbAdapter): Promise<void> {
  const rows = await db.select<{ value: string }>("SELECT value FROM meta WHERE key='device_id'")
  if (rows.length > 0) return
  const deviceId = ulid()
  await db.transaction(async (tx) => {
    await tx.execute(`INSERT INTO meta (key, value) VALUES ('device_id', ?)`, [deviceId])
    await tx.execute(`INSERT INTO vector_clock (device_id, counter) VALUES (?, 0)`, [deviceId])
  })
}

export async function getDeviceId(db: DbAdapter): Promise<string> {
  const rows = await db.select<{ value: string }>("SELECT value FROM meta WHERE key='device_id'")
  if (!rows[0]) throw new Error('Device not initialized; call initDevice() first.')
  return rows[0].value
}
