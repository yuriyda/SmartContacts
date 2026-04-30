// Google Drive `appdata` transport for sync-package bundles.
// Pure HTTP via injectable fetchImpl (default = global fetch); browser-friendly,
// no Tauri/Node deps.
//
// Editing rules:
// - Keep transport-only. No business logic / sync orchestration here — that lives
//   in shared/src/sync/syncEngine.ts (P4.T3).
// - Token plumbing belongs to oauth.ts; this module only consumes a string.
// - uploadBundle always calls findSyncFileId first to decide create vs replace.
//   Tests that call uploadBundle must expect TWO fetch calls (list, then POST or PATCH).
// - Multipart boundary is unique per call to avoid collisions with concurrent uploads.

// ---------------------------------------------------------------------------
// Constants

const FILES_BASE = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files'

// ---------------------------------------------------------------------------
// Types

export interface DriveAppdataClient {
  /** Look up our sync file's id by name. Returns null when no file exists yet. */
  findSyncFileId(accessToken: string, fileName: string): Promise<string | null>

  /**
   * Upload (create or replace) a JSON bundle. Returns the fileId.
   *
   * Internally calls findSyncFileId first to decide between POST (create) and
   * PATCH (replace). Callers should expect two fetch calls when mocking.
   */
  uploadBundle(accessToken: string, fileName: string, bundle: object): Promise<string>

  /** Download bundle JSON by fileId. Returns parsed JSON (`unknown`). */
  downloadBundle(accessToken: string, fileId: string): Promise<unknown>
}

// ---------------------------------------------------------------------------
// Helpers

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}

async function assertOk(response: Response, verb: string): Promise<void> {
  if (!response.ok) {
    throw new Error(`Drive ${verb} failed: ${response.status} ${response.statusText}`)
  }
}

function makeBoundary(): string {
  return `---smart_contacts_${Math.random().toString(36).slice(2)}`
}

function buildMultipartBody(boundary: string, metadata: object, bundle: object): string {
  return (
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    `${JSON.stringify(bundle)}\r\n` +
    `--${boundary}--`
  )
}

// ---------------------------------------------------------------------------
// Factory

export function makeDriveAppdataClient(fetchImpl: typeof fetch = fetch): DriveAppdataClient {
  // ------------------------------------------------------------------
  async function findSyncFileId(accessToken: string, fileName: string): Promise<string | null> {
    const q = encodeURIComponent(
      `name='${fileName}' and 'appDataFolder' in parents and trashed=false`,
    )
    const url = `${FILES_BASE}?spaces=appDataFolder&q=${q}&fields=files(id,name)`

    const response = await fetchImpl(url, {
      headers: authHeaders(accessToken),
    })

    await assertOk(response, 'list')

    const data = (await response.json()) as { files: { id: string }[] }
    return data.files?.[0]?.id ?? null
  }

  // ------------------------------------------------------------------
  async function uploadBundle(
    accessToken: string,
    fileName: string,
    bundle: object,
  ): Promise<string> {
    const existingId = await findSyncFileId(accessToken, fileName)

    const boundary = makeBoundary()
    // Drive rejects 'parents' on PATCH — only include it for create (POST)
    const metadata = existingId
      ? { name: fileName }
      : { name: fileName, parents: ['appDataFolder'] }

    const url = existingId
      ? `${UPLOAD_BASE}/${existingId}?uploadType=multipart`
      : `${UPLOAD_BASE}?uploadType=multipart`

    const method = existingId ? 'PATCH' : 'POST'
    const body = buildMultipartBody(boundary, metadata, bundle)

    const response = await fetchImpl(url, {
      method,
      headers: {
        ...authHeaders(accessToken),
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    })

    await assertOk(response, 'upload')

    const data = (await response.json()) as { id: string }
    return data.id
  }

  // ------------------------------------------------------------------
  async function downloadBundle(accessToken: string, fileId: string): Promise<unknown> {
    const url = `${FILES_BASE}/${fileId}?alt=media`

    const response = await fetchImpl(url, {
      headers: authHeaders(accessToken),
    })

    await assertOk(response, 'download')

    return response.json()
  }

  // ------------------------------------------------------------------
  return { findSyncFileId, uploadBundle, downloadBundle }
}
