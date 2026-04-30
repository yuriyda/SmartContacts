// snapshot-store.ts
// Provides lightweight IndexedDB persistence for raw database snapshots.
// Only edit this file to change snapshot storage mechanics — not the adapter contract.
// Rules:
//  - Database name: "smart-contacts-snapshots"
//  - Object store name: "snapshots"
//  - Keys are plain strings (database name); values are Uint8Array blobs.
//  - Must work in both real browser (IndexedDB) and test (fake-indexeddb) environments.

const DB_NAME = 'smart-contacts-snapshots'
const STORE_NAME = 'snapshots'
const DB_VERSION = 1

function openSnapshotDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Load a snapshot blob from IndexedDB by name.
 * Returns null if no snapshot exists for the given name.
 * Resolves on transaction `oncomplete` (durable read), rejects on abort/error.
 */
export async function loadSnapshot(name: string): Promise<Uint8Array | null> {
  const db = await openSnapshotDb()
  return new Promise((resolve, reject) => {
    let result: Uint8Array | null = null
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(name)
    req.onsuccess = () => {
      result = req.result instanceof Uint8Array ? req.result : null
    }
    tx.oncomplete = () => {
      db.close()
      resolve(result)
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error('IDB read transaction failed'))
    }
    tx.onabort = () => {
      db.close()
      reject(tx.error ?? new Error('IDB read transaction aborted'))
    }
  })
}

/**
 * Save a snapshot blob to IndexedDB under the given name.
 * Overwrites any existing snapshot with the same name.
 * Resolves only on `tx.oncomplete` (durable commit), not `req.onsuccess`,
 * so callers can rely on the data surviving an immediate reload/crash.
 */
export async function saveSnapshot(name: string, data: Uint8Array): Promise<void> {
  const db = await openSnapshotDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(data, name)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error('IDB write transaction failed'))
    }
    tx.onabort = () => {
      db.close()
      reject(tx.error ?? new Error('IDB write transaction aborted'))
    }
  })
}
