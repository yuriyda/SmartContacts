/**
 * @file native-bridge.ts
 * Tauri-only helpers that web/ can call when running inside Tauri.
 *
 * Rules:
 *  - Only invoked when window.__SMART_CONTACTS_NATIVE__ is set (caller checks).
 *  - Pure imports of @tauri-apps/* APIs; no React.
 *  - Functions return Promises; null/undefined indicates user-cancelled the dialog.
 *  - Do NOT import this file from web/ — use window.__SMART_CONTACTS_NATIVE__ instead.
 */
import { open, save } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'

export interface SavePickResult {
  filename: string
  path: string
}

/** Show a native save dialog. Returns the chosen path or null on cancel. */
export async function pickSaveLocation(suggestedFilename: string): Promise<SavePickResult | null> {
  const path = await save({
    defaultPath: suggestedFilename,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (!path) return null
  const filename = path.split(/[/\\]/).pop() ?? suggestedFilename
  return { filename, path }
}

/** Write text content to the chosen path. */
export async function writeTextToFile(path: string, content: string): Promise<void> {
  await writeTextFile(path, content)
}

/** Show a native open dialog and return the contents of the chosen file, or null on cancel. */
export async function pickAndReadJsonFile(): Promise<{ path: string; content: string } | null> {
  const result = await open({
    multiple: false,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (typeof result !== 'string') return null
  const content = await readTextFile(result)
  return { path: result, content }
}
