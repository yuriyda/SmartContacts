// wa-sqlite-backend.ts
// DbAdapter implementation backed by wa-sqlite (synchronous build) with an in-memory VFS.
// Persistence is achieved by saving/loading a raw database file snapshot via snapshot-store.ts.
//
// Rules for editing:
//  - Do NOT change the DbAdapter contract (select/execute/transaction/close).
//  - Do NOT switch to the async wa-sqlite build without updating the VFS accordingly.
//  - Snapshot flush happens when the SQLite xSync VFS hook fires; close() awaits any in-flight flush.
//  - Never nest transactions — wa-sqlite does not support SAVEPOINT in this adapter.
//  - SnapshotVFS extends VFS.Base from wa-sqlite/src/VFS.js to get correct xFileControl/xLock defaults.

import type { DbAdapter } from './adapter'
import { loadSnapshot, saveSnapshot } from './snapshot-store'

// ---------------------------------------------------------------------------
// Types for wa-sqlite internals (not exported by the package)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SQLiteAPI = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VFSBase = any

// ---------------------------------------------------------------------------
// In-memory VFS with snapshot pre-load and xSync persistence
// ---------------------------------------------------------------------------

type FileEntry = { name: string; flags: number; size: number; data: ArrayBuffer }

function makeSnapshotVFS(
  vfsName: string,
  dbName: string,
  preloadedData: Uint8Array | undefined,
  VFSBaseClass: VFSBase,
  SQLITE_OK: number,
  SQLITE_CANTOPEN: number,
  SQLITE_IOERR_SHORT_READ: number,
  SQLITE_OPEN_CREATE: number,
  SQLITE_OPEN_DELETEONCLOSE: number,
): VFSBase {
  /**
   * SnapshotVFS — in-memory SQLite VFS with optional pre-load from a snapshot byte array.
   * On xSync, schedules an async flush of the live database bytes to snapshot-store.
   */
  class SnapshotVFS extends VFSBaseClass {
    name: string = vfsName

    // Map of virtual files keyed by filename.
    private mapNameToFile: Map<string, FileEntry> = new Map()
    // Map of open files keyed by sqlite3_file pointer id.
    private mapIdToFile: Map<number, FileEntry> = new Map()

    // Snapshot flush state.
    private flushTimer: ReturnType<typeof setTimeout> | null = null
    private pendingFlush: Promise<void> = Promise.resolve()
    private pendingFlushResolve: (() => void) | null = null

    constructor() {
      super()
      if (preloadedData && preloadedData.byteLength > 0) {
        // Seed the virtual filesystem with the snapshot bytes.
        const buf = new ArrayBuffer(preloadedData.byteLength)
        new Uint8Array(buf).set(preloadedData)
        this.mapNameToFile.set(dbName, {
          name: dbName,
          flags: SQLITE_OPEN_CREATE,
          size: preloadedData.byteLength,
          data: buf,
        })
      }
    }

    // ---- VFS interface -------------------------------------------------------

    xOpen(name: string | null, fileId: number, flags: number, pOutFlags: DataView): number {
      name = name ?? `tmp_${fileId}`
      let file = this.mapNameToFile.get(name)
      if (!file) {
        if (flags & SQLITE_OPEN_CREATE) {
          file = { name, flags, size: 0, data: new ArrayBuffer(0) }
          this.mapNameToFile.set(name, file)
        } else {
          return SQLITE_CANTOPEN
        }
      }
      this.mapIdToFile.set(fileId, file)
      pOutFlags.setInt32(0, flags, true)
      return SQLITE_OK
    }

    xClose(fileId: number): number {
      const file = this.mapIdToFile.get(fileId)
      this.mapIdToFile.delete(fileId)
      if (file && file.flags & SQLITE_OPEN_DELETEONCLOSE) {
        this.mapNameToFile.delete(file.name)
      }
      return SQLITE_OK
    }

    xRead(fileId: number, pData: Uint8Array, iOffset: number): number {
      const file = this.mapIdToFile.get(fileId)!
      const bgn = Math.min(iOffset, file.size)
      const end = Math.min(iOffset + pData.byteLength, file.size)
      const nBytes = end - bgn
      if (nBytes > 0) {
        pData.set(new Uint8Array(file.data, bgn, nBytes))
      }
      if (nBytes < pData.byteLength) {
        pData.fill(0, nBytes)
        return SQLITE_IOERR_SHORT_READ
      }
      return SQLITE_OK
    }

    xWrite(fileId: number, pData: Uint8Array, iOffset: number): number {
      const file = this.mapIdToFile.get(fileId)!
      const needed = iOffset + pData.byteLength
      if (needed > file.data.byteLength) {
        const newSize = Math.max(needed, 2 * (file.data.byteLength || 4096))
        const newBuf = new ArrayBuffer(newSize)
        new Uint8Array(newBuf).set(new Uint8Array(file.data, 0, file.size))
        file.data = newBuf
      }
      new Uint8Array(file.data, iOffset, pData.byteLength).set(pData)
      file.size = Math.max(file.size, needed)
      return SQLITE_OK
    }

    xTruncate(fileId: number, iSize: number): number {
      const file = this.mapIdToFile.get(fileId)!
      file.size = Math.min(file.size, iSize)
      return SQLITE_OK
    }

    xSync(fileId: number, _flags: number): number {
      // Fire-and-forget snapshot flush on every SQLite fsync (end of write).
      const file = this.mapIdToFile.get(fileId)
      if (file && file.name === dbName) {
        this._scheduleFlush(file)
      }
      return SQLITE_OK
    }

    xFileSize(fileId: number, pSize64: DataView): number {
      const file = this.mapIdToFile.get(fileId)!
      pSize64.setBigInt64(0, BigInt(file.size), true)
      return SQLITE_OK
    }

    xDelete(name: string, _syncDir: number): number {
      this.mapNameToFile.delete(name)
      return SQLITE_OK
    }

    xAccess(name: string, _flags: number, pResOut: DataView): number {
      pResOut.setInt32(0, this.mapNameToFile.has(name) ? 1 : 0, true)
      return SQLITE_OK
    }

    // ---- Snapshot helpers ----------------------------------------------------

    private _scheduleFlush(file: FileEntry): void {
      if (this.flushTimer !== null) clearTimeout(this.flushTimer)

      if (!this.pendingFlushResolve) {
        this.pendingFlush = new Promise<void>((res) => {
          this.pendingFlushResolve = res
        })
      }

      this.flushTimer = setTimeout(() => {
        this.flushTimer = null
        const snapshot = new Uint8Array(file.data.slice(0, file.size))
        const resolve = this.pendingFlushResolve!
        this.pendingFlushResolve = null
        // Best-effort persistence: swallow errors here (xSync cannot block).
        // close()/flushNow() is the explicit-shutdown path and surfaces failures.
        saveSnapshot(dbName, snapshot).then(
          () => resolve(),
          () => resolve(),
        )
      }, 250)
    }

    /** Flush immediately and await completion. Called from close(). */
    async flushNow(): Promise<void> {
      const file = this.mapNameToFile.get(dbName)
      if (!file) return

      if (this.flushTimer !== null) {
        clearTimeout(this.flushTimer)
        this.flushTimer = null
        const resolve = this.pendingFlushResolve
        this.pendingFlushResolve = null
        const snapshot = new Uint8Array(file.data.slice(0, file.size))
        await saveSnapshot(dbName, snapshot).catch(() => undefined)
        if (resolve) resolve()
      } else {
        await this.pendingFlush
      }
    }
  }

  return new SnapshotVFS()
}

// ---------------------------------------------------------------------------
// DbAdapter factory
// ---------------------------------------------------------------------------

export async function openWaSqliteAdapter(name: string): Promise<DbAdapter> {
  // Load pre-existing snapshot from IndexedDB (may be null on first open).
  const snapshot = await loadSnapshot(name)

  // Import wa-sqlite API and constants.
  const {
    Factory,
    SQLITE_OPEN_CREATE,
    SQLITE_OPEN_READWRITE,
    SQLITE_ROW,
    SQLITE_OK,
    SQLITE_CANTOPEN,
    SQLITE_IOERR_SHORT_READ,
    SQLITE_OPEN_DELETEONCLOSE,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = (await import('wa-sqlite')) as any

  // Import VFS base class.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { Base: VFSBase } = (await import('wa-sqlite/src/VFS.js')) as any

  // Boot the WASM module.
  // In Node (tests), pre-read the .wasm via fs and pass as `wasmBinary` to skip fetch.
  // In browser, the factory uses its default URL-based fetch.
  // The `@vite-ignore` markers prevent Vite from statically analysing these as
  // browser-bundleable imports — fs/module are Node built-ins and would error.
  let wasmBinary: Uint8Array | undefined
  try {
    const { createRequire } = await import(/* @vite-ignore */ 'module')
    const { readFileSync } = await import(/* @vite-ignore */ 'fs')
    const req = createRequire(import.meta.url)
    const wasmJsPath: string = req.resolve('wa-sqlite/dist/wa-sqlite.mjs')
    const wasmPath = wasmJsPath.replace(/wa-sqlite\.mjs$/, 'wa-sqlite.wasm')
    wasmBinary = new Uint8Array(readFileSync(wasmPath))
  } catch (_e) {
    // Browser environment — let the WASM factory use its default fetch logic.
  }

  const { default: SQLiteESMFactory } = await import('wa-sqlite/dist/wa-sqlite.mjs')
  const module = await SQLiteESMFactory(wasmBinary ? { wasmBinary } : {})
  const sqlite3: SQLiteAPI = Factory(module)

  // Build a unique VFS name per adapter instance so parallel tests don't collide.
  const vfsName = `snapshot-vfs-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`

  const vfs = makeSnapshotVFS(
    vfsName,
    name,
    snapshot ?? undefined,
    VFSBase,
    SQLITE_OK as number,
    SQLITE_CANTOPEN as number,
    SQLITE_IOERR_SHORT_READ as number,
    SQLITE_OPEN_CREATE as number,
    SQLITE_OPEN_DELETEONCLOSE as number,
  )
  sqlite3.vfs_register(vfs, false)

  // Open the database file via our custom VFS.
  const db: number = await sqlite3.open_v2(
    name,
    SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE,
    vfsName,
  )

  // ---- DbAdapter helpers --------------------------------------------------
  //
  // wa-sqlite uses a single shared connection and a global stmt registry. If two
  // concurrent callers (e.g. two React effects running in parallel) each enter
  // `for await (const stmt of sqlite3.statements(...))`, their generators
  // interleave: generator A yields its stmt, callback B starts, generator A's
  // next() then finalizes A's stmt before A's caller resumes step()/column().
  // Result: SQLiteError "not a statement" in select().
  //
  // Fix: serialize select / execute / transaction through a single FIFO queue
  // so only one SQL operation is in flight at a time. Transactions are atomic
  // single units in the queue — their inner select/execute calls bypass the
  // queue (see runInner) so they don't deadlock on the outer queue slot.
  let queue: Promise<unknown> = Promise.resolve()
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn, fn)
    queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  async function selectInner<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    const results: T[] = []
    try {
      for await (const stmt of sqlite3.statements(db, sql)) {
        if (params && params.length > 0) {
          sqlite3.bind_collection(stmt, params)
        }
        const columns: string[] = sqlite3.column_names(stmt) as string[]
        while ((await sqlite3.step(stmt)) === SQLITE_ROW) {
          const row: Record<string, unknown> = {}
          for (let i = 0; i < columns.length; i++) {
            const col = columns[i] as string
            const raw = sqlite3.column(stmt, i)
            // BLOBs returned by wa-sqlite are live views into WASM linear memory;
            // copy to a detached Uint8Array so the caller's view is stable.
            row[col] =
              raw instanceof Uint8Array && raw.buffer === module.HEAPU8.buffer ? raw.slice() : raw
          }
          results.push(row as T)
        }
      }
    } catch (err: unknown) {
      const e = err as { message?: string; code?: number }
      if (typeof e?.message === 'string' && e.message.includes('no such table')) {
        return []
      }
      throw err
    }
    return results
  }

  async function executeInner(sql: string, params?: unknown[]): Promise<void> {
    for await (const stmt of sqlite3.statements(db, sql)) {
      if (params && params.length > 0) {
        sqlite3.bind_collection(stmt, params)
      }
      await sqlite3.step(stmt)
    }
  }

  let inTransaction = false

  // Public wrappers: serialized by default. Inside a transaction, the inner
  // adapter's select/execute call the *Inner variants directly so they don't
  // re-enter the queue and deadlock waiting for the outer transaction slot.
  async function select<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    if (inTransaction) return selectInner<T>(sql, params)
    return serialize(() => selectInner<T>(sql, params))
  }

  async function execute(sql: string, params?: unknown[]): Promise<void> {
    if (inTransaction) return executeInner(sql, params)
    return serialize(async () => {
      await executeInner(sql, params)
      // Outside a transaction every execute is its own write; flush eagerly
      // so single-statement writes (e.g. saveMeta) are durable before resolve.
      await vfs.flushNow()
    })
  }

  async function transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    // Nested transactions are not supported — issuing a second BEGIN would
    // error inside SQLite and corrupt outer-transaction state.
    if (inTransaction) {
      throw new Error(
        'wa-sqlite-backend: nested transactions are not supported (no SAVEPOINT support).',
      )
    }
    return serialize(async () => {
      inTransaction = true
      try {
        await executeInner('BEGIN')
        try {
          const result = await fn(adapter)
          await executeInner('COMMIT')
          // Force a synchronous flush after every committed transaction so
          // multi-call writers (loadDemo: defs.upsert × 3 + bulkLoad + meta INSERT)
          // are durably persisted before the caller observes "done". Without this,
          // a debounced 250ms timer can be reset by subsequent writes and the
          // earlier transaction's pages stay in-memory only — visible in the
          // adapter but absent from the IndexedDB snapshot.
          await vfs.flushNow()
          return result
        } catch (err) {
          await executeInner('ROLLBACK').catch(() => undefined)
          throw err
        }
      } finally {
        inTransaction = false
      }
    })
  }

  async function close(): Promise<void> {
    await vfs.flushNow()
    await sqlite3.close(db)
  }

  const adapter: DbAdapter = { select, execute, transaction, close }
  return adapter
}
