/**
 * @file dnd.ts
 * Shared DnD constants for the contact-row → sidebar-chip flow.
 * Rules: pure module, no React imports. Touch-device detection runs once at module load.
 */

/** MIME type used as the data-transfer key when dragging a contact row. */
export const DND_MIME = 'application/x-smart-contacts-id'

/**
 * True if the current device is a touch-primary device.
 * On touch devices, drag-and-drop is a no-op: rows are not made draggable
 * and sidebar chips do not attach drop-target listeners.
 */
export const isTouchDevice =
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
