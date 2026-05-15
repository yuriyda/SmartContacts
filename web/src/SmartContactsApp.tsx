/**
 * @file SmartContactsApp.tsx
 * Top-level shell: opens the DB via useDb (outside AppProvider), then renders ScreenBody
 * which wires contacts, filters, selection state, dialogs, hotkeys, toasts, and onboarding.
 *
 * SmartContactsShell — accepts a DbState prop so any persistence backend (wa-sqlite for web,
 * tauri-plugin-sql for desktop, or future Capacitor SQLite for mobile) can inject its state.
 * SmartContactsApp — thin wrapper that calls useDb() and hands off to SmartContactsShell.
 *
 * Rules:
 *  - useDb must be called OUTSIDE AppProvider so db can be injected as a prop.
 *  - SmartContactsShell must NOT call useDb internally — tree-shaking must be able to
 *    exclude the wa-sqlite backend from the Tauri bundle.
 *  - No DB access directly in this file — all mutations go through useContacts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Contact, CustomFieldDef, GroupMembership } from '@smart-contacts/shared'
import {
  ulid,
  type Chip,
  type ParsedQuickEntry,
  clampWidth,
  addContactToGroup,
  addContactToTag,
  addContactToOrganization,
  countChangedFields,
  applyMultiSelect,
  modeFromEvent,
  applyContactSort,
  toggleContactSort,
  type ContactSort,
  type ContactSortField,
} from '@smart-contacts/shared'
import { exportBackup, type GoogleSyncRuntime } from '@smart-contacts/shared'
import { AppProvider, useApp } from './ui/AppContext'
import { useDb } from './store/useDb'
import type { DbState } from './store/dbState'
import { useContacts } from './store/useContacts'
import { useNetworkData, useOpenTasks } from './store/useNetworkData'
import { useNotificationScheduler } from './store/useNotificationScheduler'
import { useInteractions } from './store/useInteractions'
import { useContactTasks } from './store/useContactTasks'
import { Sidebar } from './ui/Sidebar'
import { MainList } from './ui/MainList'
import { useAvatarContactIds } from './ui/useAvatarContactIds'
import { useAvatarBlobMap } from './ui/useAvatarBlobMap'
import { ContactContextMenu } from './ui/ContactContextMenu'
import { SortBar } from './ui/SortBar'
import { FilterChipsBar } from './ui/FilterChipsBar'
import { StatusBar } from './ui/StatusBar'
import { NavHeader } from './ui/NavHeader'
import { ContactDetail } from './ui/ContactDetail'
import { ResizeHandle } from './ui/ResizeHandle'
import { ContactEditDialog } from './ui/ContactEditDialog'
import { SettingsDialog } from './ui/SettingsDialog'
import { GuideOverlay } from './ui/GuideOverlay'
import { HotkeyHelp } from './ui/HotkeyHelp'
import { ToastContainer } from './ui/common'
import { useToasts } from './ui/useToasts'
import { useConfirm } from './ui/useConfirm'
import { usePrompt } from './ui/usePrompt'
import { useKeyboard } from './ui/useKeyboard'
import { useFilteredContacts } from './ui/useFilteredContacts'
import { DEFAULT_FILTERS } from './ui/filterTypes'
import type { ContactFilters } from './ui/filterTypes'
import {
  loadSavedFilters,
  saveSavedFilters,
  isFilterNonTrivial,
  type SavedFilter,
} from './ui/savedFilters'
import { NetworkDashboard } from './ui/network/NetworkDashboard'
import { CenterTabBar } from './ui/CenterTabBar'
import { BulkActionBar } from './ui/BulkActionBar'
import { readStaleThresholds } from './store/networkSettings'
import { useUndoStore } from './store/undoStore'
import { useUndoableActions } from './store/useUndoableActions'

/**
 * SmartContactsShell — platform-agnostic entry point.
 * Accepts a pre-initialised DbState so any persistence backend can drive the tree.
 * Tree-shaking: this component does NOT import useDb, keeping wa-sqlite out of
 * bundles that only import SmartContactsShell (e.g. the Tauri frontend).
 */
export function SmartContactsShell({
  dbState,
  googleSync,
}: {
  dbState: DbState
  /** Optional Google Contacts sync runtime — provided by Tauri shell; web shell passes null. */
  googleSync?: GoogleSyncRuntime | null
}) {
  return (
    <AppProvider
      db={dbState.db}
      deviceId={dbState.deviceId}
      contactsRepo={dbState.contactsRepo}
      defsRepo={dbState.defsRepo}
    >
      <ScreenBody dbState={dbState} googleSync={googleSync ?? null} />
    </AppProvider>
  )
}

/**
 * SmartContactsApp — thin web entry point.
 * Boots wa-sqlite via useDb() and hands the result to SmartContactsShell.
 */
export function SmartContactsApp() {
  const dbState = useDb()
  // Web shell: no Google Contacts sync (Tauri-only in Phase 1).
  return <SmartContactsShell dbState={dbState} googleSync={null} />
}

function ScreenBody({
  dbState,
  googleSync,
}: {
  dbState: DbState
  googleSync: GoogleSyncRuntime | null
}) {
  const {
    TC,
    t,
    locale,
    setLocale,
    theme,
    setTheme,
    mode,
    setMode,
    density,
    setDensity,
    metaSettings,
    saveMeta,
    deviceId,
  } = useApp()

  const { contacts, loading, upsert, softDelete, restore, touch, refresh } = useContacts(
    dbState.contactsRepo,
  )

  // Set of contact IDs Google says have a profile photo — drives the small
  // "photo present" badge next to the Google logo in each ContactRow.
  const avatarContactIds = useAvatarContactIds(googleSync)
  // Locally cached avatar bytes — drives the in-row thumbnail (replaces the
  // initials circle when a photo is available).
  const avatarUrls = useAvatarBlobMap(googleSync)

  const [defs, setDefs] = useState<CustomFieldDef[]>([])
  const [defsVersion, setDefsVersion] = useState(0)

  useEffect(() => {
    if (!dbState.defsRepo) return
    let cancelled = false
    void (async () => {
      const list = await dbState.defsRepo!.list()
      if (!cancelled) setDefs(list)
    })()
    return () => {
      cancelled = true
    }
  }, [dbState.defsRepo, defsVersion])

  const refreshDefs = useCallback(async () => {
    setDefsVersion((v) => v + 1)
  }, [])

  // ---------------------------------------------------------------------------
  // Panel widths — persisted in meta.layout_widths_v1
  // ---------------------------------------------------------------------------

  // Defaults used on first load and after reset.
  const SIDEBAR_DEFAULT = 224
  const DETAIL_DEFAULT = 384

  // Read persisted widths from metaSettings, clamped to valid ranges.
  const readLayoutWidths = useCallback((meta: Record<string, string>) => {
    const raw = meta['layout_widths_v1']
    if (!raw) return { sidebar: SIDEBAR_DEFAULT, detail: DETAIL_DEFAULT }
    try {
      const parsed = JSON.parse(raw) as { sidebar?: number; detail?: number }
      return {
        sidebar: clampWidth(parsed.sidebar ?? SIDEBAR_DEFAULT, 180, 480),
        detail: clampWidth(parsed.detail ?? DETAIL_DEFAULT, 240, 640),
      }
    } catch {
      return { sidebar: SIDEBAR_DEFAULT, detail: DETAIL_DEFAULT }
    }
  }, [])

  const [sidebarWidth, setSidebarWidth] = useState(() => readLayoutWidths(metaSettings).sidebar)
  const [detailWidth, setDetailWidth] = useState(() => readLayoutWidths(metaSettings).detail)

  // Sync widths when meta loads asynchronously (DB reads after mount).
  useEffect(() => {
    const { sidebar, detail } = readLayoutWidths(metaSettings)
    setSidebarWidth(sidebar)
    setDetailWidth(detail)
  }, [metaSettings, readLayoutWidths])

  const persistWidths = useCallback(
    (sidebar: number, detail: number) => {
      void saveMeta('layout_widths_v1', JSON.stringify({ sidebar, detail }))
    },
    [saveMeta],
  )

  const handleResetLayout = useCallback(() => {
    void saveMeta('layout_widths_v1', '')
    setSidebarWidth(SIDEBAR_DEFAULT)
    setDetailWidth(DETAIL_DEFAULT)
  }, [saveMeta])

  // Stale thresholds — read from metaSettings, used by NetworkDashboard.
  const staleThresholds = useMemo(() => readStaleThresholds(metaSettings), [metaSettings])

  // Active top-bar view — persisted in meta so it survives page reload.
  const activeView = useMemo<'contacts' | 'network'>(
    () => (metaSettings.active_view_v1 === 'network' ? 'network' : 'contacts'),
    [metaSettings.active_view_v1],
  )
  const onChangeView = useCallback(
    (v: 'contacts' | 'network') => {
      void saveMeta('active_view_v1', v)
    },
    [saveMeta],
  )

  const { recentInteractions, openTasks } = useNetworkData(
    dbState.interactionsRepo,
    dbState.tasksRepo,
    activeView === 'network',
  )

  // Always-loaded open tasks for the notification scheduler (fires regardless of active view).
  const openTasksForNotifications = useOpenTasks(dbState.tasksRepo)

  useNotificationScheduler({
    enabled: metaSettings.notifications_enabled_v1 === '1',
    hourStr: metaSettings.notify_time_v1 ?? '09',
    lastFiredISO: metaSettings.last_fired_v1,
    contacts,
    openTasks: openTasksForNotifications,
    saveMeta,
    i18nTitle: t('settings.notify.daily_title'),
    i18nEmpty: t('settings.notify.daily_empty'),
  })

  // ---------------------------------------------------------------------------

  // selectedId doubles as the cursor (active row): drives detail view + arrow-nav target.
  // lastAnchorId is the *range anchor* — start of the current Shift-extended selection.
  // It is independent of cursor: Shift+Click moves cursor but leaves anchor pinned, so
  // successive Shift+Clicks expand/contract the range from a fixed start point (TO model).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lastAnchorId, setLastAnchorId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState(new Set<string>())
  // Right-click context menu state. null when closed; otherwise viewport coords + target row.
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    contactId: string
  } | null>(null)

  // Per-contact interaction journal (P8.B.1)
  const {
    interactions: contactInteractions,
    upsert: upsertInteraction,
    softDelete: softDeleteInteraction,
  } = useInteractions(dbState.interactionsRepo, selectedId)

  // Per-contact task list (P8.B.2)
  const {
    tasks: contactTasks,
    upsert: upsertTask,
    markDone: markTaskDone,
    reopen: reopenTask,
    softDelete: softDeleteTask,
  } = useContactTasks(dbState.tasksRepo, selectedId)

  // ---------------------------------------------------------------------------
  // Undo / Redo store + recorder (P9.T8)
  // ---------------------------------------------------------------------------
  const undoStore = useUndoStore()
  const undoable = useUndoableActions({
    contacts,
    upsert,
    softDelete,
    restore,
    touch,
    upsertInteraction,
    softDeleteInteraction,
    upsertTask,
    markTaskDone,
    reopenTask,
    softDeleteTask,
    getInteraction: (id) => contactInteractions.find((i) => i.id === id),
    getTask: (id) => contactTasks.find((t) => t.id === id),
    store: undoStore,
  })

  const [filters, setFilters] = useState<ContactFilters>(DEFAULT_FILTERS)

  // Reset multi-select + range anchor when any filter dimension changes.
  // Cursor (selectedId) is clamped separately below so the detail view stays put
  // when the cursor target survives the filter narrow.
  useEffect(() => {
    setSelectedIds(new Set())
    setLastAnchorId(null)
  }, [filters.scope, filters.group, filters.tag, filters.organization, filters.search])

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [editing, setEditing] = useState<{ open: boolean; contact: Contact | null }>({
    open: false,
    contact: null,
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  // settingsInitialTab: set to 'backup' when opened via native menu Export/Import action.
  const [settingsInitialTab, setSettingsInitialTab] = useState<'general' | 'backup'>('general')
  const [helpOpen, setHelpOpen] = useState(false)

  // Filtered list (filters only). The displayed list combines this with sort
  // below so all downstream consumers (MainList, moveCursor, clamp effect,
  // bulk handlers, marquee hit-test) see the rows in the user's chosen order.
  const filteredOnlyRaw = useFilteredContacts(contacts, filters)

  // Refinement: "with Google photo" — runs after the scope/group/tag pipeline
  // because the source of truth (snapshot.photoUrl) lives outside the pure
  // Contact object. Kept here (not inside useFilteredContacts) so the shared
  // contactFilter module remains DB- and runtime-agnostic.
  const filteredOnly = useMemo(
    () =>
      filters.hasPhoto === true
        ? filteredOnlyRaw.filter((c) => avatarContactIds.has(c.id))
        : filteredOnlyRaw,
    [filteredOnlyRaw, filters.hasPhoto, avatarContactIds],
  )

  // Sort state — initialised from metaSettings.sort_v1; null means "no sort,
  // preserve the order applyContactFilters produced". Parsed defensively so a
  // corrupted persisted value doesn't blow up the boot.
  const [sort, setSort] = useState<ContactSort | null>(() => {
    const raw = metaSettings.sort_v1
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as ContactSort
      if (
        parsed &&
        typeof parsed.field === 'string' &&
        (parsed.dir === 'asc' || parsed.dir === 'desc')
      ) {
        return parsed
      }
      return null
    } catch {
      return null
    }
  })

  const filtered = useMemo(
    () => applyContactSort(filteredOnly, sort, locale),
    [filteredOnly, sort, locale],
  )

  const onToggleSort = useCallback(
    (field: ContactSortField) => {
      setSort((prev) => {
        const next = toggleContactSort(prev, field)
        void saveMeta('sort_v1', JSON.stringify(next))
        return next
      })
    },
    [saveMeta],
  )

  const aliveCount = useMemo(() => contacts.filter((c) => !c.deletedAt).length, [contacts])
  const selected = useMemo(
    () => contacts.find((c) => c.id === selectedId) ?? null,
    [contacts, selectedId],
  )

  // Clamp cursor / selection / anchor against currently visible IDs.
  // Mirrors TaskOrchestrator/tauri-app/src/hooks/useFilteredTasks.ts:145-151.
  // Triggers on deletions, scope changes, search narrow — keeps state consistent
  // so cursor never points at a hidden row and Shift-extend never references a
  // dropped anchor.
  useEffect(() => {
    const visibleIds = new Set(filtered.map((c) => c.id))
    setSelectedIds((prev) => {
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (visibleIds.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
    setSelectedId((prev) => (prev === null || visibleIds.has(prev) ? prev : null))
    setLastAnchorId((prev) => (prev === null || visibleIds.has(prev) ? prev : null))
  }, [filtered])

  const setFilter = useCallback(
    <K extends keyof ContactFilters>(k: K, v: ContactFilters[K]) =>
      setFilters((p) => ({ ...p, [k]: v })),
    [],
  )
  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), [])

  // Network dashboard: clicking a widget row navigates to the contact in Contacts view.
  // Resets filters so the target contact is guaranteed to appear in MainList regardless
  // of the prior scope/group/tag/org/search filter state.
  const onOpenContact = useCallback(
    (id: string) => {
      setFilters(DEFAULT_FILTERS)
      setSelectedId(id)
      void saveMeta('active_view_v1', 'contacts')
    },
    [saveMeta],
  )

  // Saved filter presets — derived from metaSettings so they update reactively.
  const savedFilters = useMemo(() => loadSavedFilters(metaSettings), [metaSettings])

  const setAllFilters = useCallback((next: ContactFilters) => setFilters(next), [])

  const { toasts, push, dismiss } = useToasts()
  const { confirm, Mount: ConfirmMount } = useConfirm()
  const { prompt, Mount: PromptMount } = usePrompt()

  const onSaveFilter = useCallback(async () => {
    const name = window.prompt(t('prompt.filter_name'))
    if (!name?.trim()) return
    const preset: SavedFilter = { id: ulid(), name: name.trim(), filters }
    await saveSavedFilters(saveMeta, [...savedFilters, preset])
    push(t('actions.save_filter'))
  }, [t, filters, saveMeta, savedFilters, push])

  const onDeleteSavedFilter = useCallback(
    async (id: string) => {
      await saveSavedFilters(
        saveMeta,
        savedFilters.filter((sf) => sf.id !== id),
      )
    },
    [saveMeta, savedFilters],
  )

  // ---------------------------------------------------------------------------
  // Bulk handlers (P9.T7)
  // ---------------------------------------------------------------------------

  // Helper: iterate selectedIds, run a per-contact mutator, then clear selection.
  const forEachSelected = useCallback(
    async <T,>(mutator: (c: Contact) => Promise<T> | T): Promise<number> => {
      let count = 0
      for (const id of selectedIds) {
        const c = contacts.find((x) => x.id === id)
        if (!c) continue
        await mutator(c)
        count++
      }
      setSelectedIds(new Set())
      return count
    },
    [selectedIds, contacts],
  )

  const onBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds)
    // Capture snapshots before deletion so the bulk UndoAction can restore each contact.
    const children: import('./store/undoStore').UndoAction[] = []
    for (const id of ids) {
      const c = contacts.find((x) => x.id === id)
      if (!c) continue
      await softDelete(id)
      children.push({ kind: 'softDelete', contact: c })
    }
    undoStore.push({ kind: 'bulk', children })
    setSelectedIds(new Set())
    push(t('confirm.delete_title'), {
      action: {
        label: t('actions.restore'),
        onClick: () => {
          for (const id of ids) void restore(id)
        },
      },
      duration: 6000,
    })
  }, [selectedIds, contacts, softDelete, restore, undoStore, push, t])

  const onBulkRestore = useCallback(async () => {
    const ids = Array.from(selectedIds)
    const children: import('./store/undoStore').UndoAction[] = []
    for (const id of ids) {
      await restore(id)
      children.push({ kind: 'restore', id })
    }
    undoStore.push({ kind: 'bulk', children })
    setSelectedIds(new Set())
    push(t('bulk.done', { n: String(ids.length) }))
  }, [selectedIds, restore, undoStore, push, t])

  const onBulkHide = useCallback(async () => {
    const children: import('./store/undoStore').UndoAction[] = []
    const n = await forEachSelected(async (c) => {
      if (!c.hidden) {
        await upsert({ ...c, hidden: true })
        children.push({ kind: 'flagToggle', id: c.id, field: 'hidden', prev: false, next: true })
      }
    })
    undoStore.push({ kind: 'bulk', children })
    push(t('bulk.done', { n: String(n) }))
  }, [forEachSelected, upsert, undoStore, push, t])

  const onBulkUnhide = useCallback(async () => {
    const children: import('./store/undoStore').UndoAction[] = []
    const n = await forEachSelected(async (c) => {
      if (c.hidden) {
        await upsert({ ...c, hidden: false })
        children.push({ kind: 'flagToggle', id: c.id, field: 'hidden', prev: true, next: false })
      }
    })
    undoStore.push({ kind: 'bulk', children })
    push(t('bulk.done', { n: String(n) }))
  }, [forEachSelected, upsert, undoStore, push, t])

  const onBulkProtect = useCallback(async () => {
    const children: import('./store/undoStore').UndoAction[] = []
    const n = await forEachSelected(async (c) => {
      if (!c.protected) {
        await upsert({ ...c, protected: true })
        children.push({
          kind: 'flagToggle',
          id: c.id,
          field: 'protected',
          prev: false,
          next: true,
        })
      }
    })
    undoStore.push({ kind: 'bulk', children })
    push(t('bulk.done', { n: String(n) }))
  }, [forEachSelected, upsert, undoStore, push, t])

  const onBulkUnprotect = useCallback(async () => {
    const children: import('./store/undoStore').UndoAction[] = []
    const n = await forEachSelected(async (c) => {
      if (c.protected) {
        await upsert({ ...c, protected: false })
        children.push({
          kind: 'flagToggle',
          id: c.id,
          field: 'protected',
          prev: true,
          next: false,
        })
      }
    })
    undoStore.push({ kind: 'bulk', children })
    push(t('bulk.done', { n: String(n) }))
  }, [forEachSelected, upsert, undoStore, push, t])

  const onBulkTouch = useCallback(async () => {
    const ids = Array.from(selectedIds)
    const children: import('./store/undoStore').UndoAction[] = []
    for (const id of ids) {
      const c = contacts.find((x) => x.id === id)
      const prev = c?.lastContactedAt ?? undefined
      await touch(id)
      children.push({ kind: 'touch', id, prevLastContactedAt: prev })
    }
    undoStore.push({ kind: 'bulk', children })
    setSelectedIds(new Set())
    push(t('bulk.done', { n: String(ids.length) }))
  }, [selectedIds, contacts, touch, undoStore, push, t])

  const onBulkAddTag = useCallback(async () => {
    const tag = await prompt({ title: t('bulk.add_tag_prompt') })
    if (!tag) return
    const children: import('./store/undoStore').UndoAction[] = []
    const n = await forEachSelected(async (c) => {
      const updated = addContactToTag(c, tag)
      if (updated !== c) {
        await upsert(updated)
        children.push({ kind: 'edit', before: c, after: updated })
      }
    })
    undoStore.push({ kind: 'bulk', children })
    push(t('bulk.done', { n: String(n) }))
  }, [prompt, forEachSelected, upsert, undoStore, push, t])

  const onBulkAddToGroup = useCallback(async () => {
    const name = await prompt({ title: t('bulk.add_group_prompt') })
    if (!name) return
    const id = name.toLowerCase().replace(/\s+/g, '_')
    const children: import('./store/undoStore').UndoAction[] = []
    const n = await forEachSelected(async (c) => {
      const updated = addContactToGroup(c, { id, name })
      if (updated !== c) {
        await upsert(updated)
        children.push({ kind: 'edit', before: c, after: updated })
      }
    })
    undoStore.push({ kind: 'bulk', children })
    push(t('bulk.done', { n: String(n) }))
  }, [prompt, forEachSelected, upsert, undoStore, push, t])

  const onBulkSetPriority = useCallback(async () => {
    const raw = await prompt({ title: t('bulk.set_priority_prompt'), placeholder: '1..5' })
    if (!raw) return
    const p = parseInt(raw, 10)
    if (!Number.isFinite(p) || p < 1 || p > 5) {
      push(t('bulk.invalid_priority'))
      return
    }
    const priority = p as 1 | 2 | 3 | 4 | 5
    const children: import('./store/undoStore').UndoAction[] = []
    const n = await forEachSelected(async (c) => {
      if (c.priority !== priority) {
        await upsert({ ...c, priority })
        children.push({ kind: 'edit', before: c, after: { ...c, priority } })
      }
    })
    undoStore.push({ kind: 'bulk', children })
    push(t('bulk.done', { n: String(n) }))
  }, [prompt, forEachSelected, upsert, undoStore, push, t])

  const onBulkExport = useCallback(async () => {
    if (!dbState.db) return
    const bundle = await exportBackup(dbState.db, { idsFilter: selectedIds, includeHidden: true })
    const json = JSON.stringify(bundle, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `smart-contacts-selection-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    push(t('bulk.done', { n: String(selectedIds.size) }))
  }, [dbState.db, selectedIds, push, t])

  // Hotkey-bound search input ref
  const searchInputRef = useRef<HTMLInputElement>(null)
  // MainList container ref — used by T3 keyboard nav (scrollIntoView) and T4 marquee.
  const mainListRef = useRef<HTMLDivElement>(null)

  const handleAdd = useCallback(() => setEditing({ open: true, contact: null }), [])

  const handleEdit = useCallback(() => {
    if (!selected) return
    setEditing({ open: true, contact: selected })
  }, [selected])

  const handleOpenEdit = useCallback(
    (id: string) => {
      const c = contacts.find((x) => x.id === id)
      if (!c) return
      setSelectedId(id)
      setEditing({ open: true, contact: c })
    },
    [contacts],
  )

  const handleSaveContact = useCallback(
    async (c: Contact) => {
      // Extra confirm when editing a protected contact with actual changes
      const original = contacts.find((x) => x.id === c.id)
      if (original?.protected) {
        const changed = countChangedFields(original, c)
        if (changed > 0) {
          const ok = await confirm({
            title: t('confirm.protect_edit_title'),
            body: t('confirm.protect_edit_summary', { n: changed }),
            destructive: false,
          })
          if (!ok) return
        }
      }
      // Record create vs edit depending on whether contact already exists.
      if (original) {
        await undoable.recordEdit(original, c)
      } else {
        await undoable.recordCreate(c)
      }
      // Mirror rule: ensure each internal relation partner has a back-link to c.
      // Back-links are recorded individually as edits (minor, but traceable).
      for (const rel of c.relationsInternal ?? []) {
        const partner = contacts.find((x) => x.id === rel.contactId)
        if (!partner) continue
        const has = (partner.relationsInternal ?? []).some((r) => r.contactId === c.id)
        if (!has) {
          const backLink =
            rel.type !== undefined ? { contactId: c.id, type: rel.type } : { contactId: c.id }
          const updated = {
            ...partner,
            relationsInternal: [...(partner.relationsInternal ?? []), backLink],
          }
          await undoable.recordEdit(partner, updated)
        }
      }
      setEditing({ open: false, contact: null })
      setSelectedId(c.id)
    },
    [contacts, undoable, t, confirm],
  )

  // ---------------------------------------------------------------------------
  // DnD handlers — called when a contact row is dropped onto a sidebar chip.
  // ---------------------------------------------------------------------------

  const onDropContactOnGroup = useCallback(
    async (contactId: string, group: GroupMembership) => {
      const c = contacts.find((x) => x.id === contactId)
      if (!c) return
      const updated = addContactToGroup(c, group)
      if (updated === c) return // idempotent — already a member, silent no-op
      await undoable.recordEdit(c, updated)
      push(t('actions.added_to_group', { name: group.name ?? group.id }))
    },
    [contacts, undoable, push, t],
  )

  const onDropContactOnTag = useCallback(
    async (contactId: string, tagName: string) => {
      const c = contacts.find((x) => x.id === contactId)
      if (!c) return
      const updated = addContactToTag(c, tagName)
      if (updated === c) return // idempotent — already tagged, silent no-op
      await undoable.recordEdit(c, updated)
      push(t('actions.added_to_tag', { name: tagName }))
    },
    [contacts, undoable, push, t],
  )

  const onDropContactOnOrganization = useCallback(
    async (contactId: string, orgName: string) => {
      const c = contacts.find((x) => x.id === contactId)
      if (!c) return
      const updated = addContactToOrganization(c, orgName)
      if (updated === c) return // idempotent — already linked, silent no-op
      await undoable.recordEdit(c, updated)
      push(t('actions.added_to_organization', { name: orgName }))
    },
    [contacts, undoable, push, t],
  )

  // Merge QuickEntry chips into a Contact object.
  // Extracted as a standalone helper so both onQuickAdd and onOpenFullDialog share the logic.
  const mergeChipsIntoContact = useCallback(
    (c: Contact, chips: Chip[]): Contact => {
      const result = { ...c }
      for (const ch of chips) {
        switch (ch.payload.kind) {
          case 'tag':
            result.tags = [...(result.tags ?? []), ch.payload.name]
            break
          case 'priority':
            result.priority = ch.payload.value
            break
          case 'group': {
            const id = 'g_' + ch.payload.name.toLowerCase().replace(/\s+/g, '-')
            result.groups = [...(result.groups ?? []), { id, name: ch.payload.name }]
            break
          }
          case 'phone':
            result.phones = [
              ...(result.phones ?? []),
              { value: ch.payload.value, type: 'mobile', primary: true },
            ]
            break
          case 'email':
            result.emails = [
              ...(result.emails ?? []),
              { value: ch.payload.value, type: 'work', primary: true },
            ]
            break
          case 'organization':
            result.organizations = [{ name: ch.payload.name, current: true }]
            break
          case 'position':
            result.occupation = ch.payload.value
            break
          case 'birthday':
            result.events = [{ date: ch.payload.date, type: 'birthday' }]
            break
          case 'nickname':
            result.nickname = ch.payload.value
            break
          case 'channel':
            result.preferredChannel = ch.payload.value
            break
          case 'social':
            result.socialDetected = [
              ...(result.socialDetected ?? []),
              { platform: ch.payload.platform, handle: ch.payload.handle },
            ]
            break
          case 'relation': {
            const { query } = ch.payload
            const partner = contacts.find((x) =>
              (x.displayName ?? '').toLowerCase().includes(query.toLowerCase()),
            )
            if (partner) {
              result.relationsInternal = [
                ...(result.relationsInternal ?? []),
                { contactId: partner.id },
              ]
            }
            break
          }
        }
      }
      return result
    },
    [contacts],
  )

  // QuickEntry: create a contact directly from the inline chips input
  const onQuickAdd = useCallback(
    async (parsed: ParsedQuickEntry) => {
      if (!deviceId) return
      const seed: Contact = {
        id: ulid(),
        displayName: parsed.displayName,
        createdAt: '',
        updatedAt: '',
        lamportTs: 0,
        deviceId,
      }
      const merged = mergeChipsIntoContact(seed, parsed.chips)
      await handleSaveContact(merged)
    },
    [deviceId, mergeChipsIntoContact, handleSaveContact],
  )

  // QuickEntry Tab: open full ContactEditDialog pre-populated with parsed chips
  const onOpenFullDialog = useCallback(
    (parsed: ParsedQuickEntry) => {
      if (!deviceId) return
      const seed: Contact = {
        id: ulid(),
        displayName: parsed.displayName,
        createdAt: '',
        updatedAt: '',
        lamportTs: 0,
        deviceId,
      }
      const merged = mergeChipsIntoContact(seed, parsed.chips)
      setEditing({ open: true, contact: merged })
    },
    [deviceId, mergeChipsIntoContact],
  )

  // Soft-delete with undo toast; requires extra confirm for protected contacts
  const handleSoftDelete = useCallback(
    async (id: string) => {
      const c = contacts.find((x) => x.id === id)
      if (!c) return
      if (c.protected) {
        const ok = await confirm({
          title: t('confirm.protect_delete_title'),
          body: t('confirm.protect_delete_body', { name: c.displayName ?? '' }),
          destructive: true,
        })
        if (!ok) return
      }
      // recordSoftDelete captures the contact snapshot then soft-deletes.
      // Toast restore button calls restore() directly (intentional — not via recorder).
      await undoable.recordSoftDelete(id)
      push(t('confirm.delete_title'), {
        action: { label: t('actions.restore'), onClick: () => void restore(id) },
        duration: 5000,
      })
    },
    [contacts, undoable, push, t, restore, confirm],
  )

  const onToggleProtect = useCallback(
    async (c: Contact) => {
      // No confirm to PROTECT (low-stakes). Confirm to UNPROTECT.
      if (c.protected) {
        const ok = await confirm({
          title: t('confirm.unprotect_title'),
          body: t('confirm.unprotect_body', { name: c.displayName ?? '' }),
          destructive: true,
        })
        if (!ok) return
      }
      await undoable.recordToggleFlag(c, 'protected')
    },
    [undoable, t, confirm],
  )

  const onToggleHide = useCallback(
    async (c: Contact) => {
      // Confirm to HIDE; no confirm to UNHIDE.
      if (!c.hidden) {
        const ok = await confirm({
          title: t('confirm.hide_title'),
          body: t('confirm.hide_body', { name: c.displayName ?? '' }),
          destructive: true,
        })
        if (!ok) return
      }
      await undoable.recordToggleFlag(c, 'hidden')
    },
    [undoable, t, confirm],
  )

  // Multi-select row click handler (Shift / Ctrl+Cmd support).
  // Threads lastAnchorId (range anchor) — separate from cursor — into applyMultiSelect:
  // Shift+Click leaves anchor pinned so successive Shift+Clicks expand/contract from it.
  const onSelectRow = useCallback(
    (id: string, e: React.MouseEvent) => {
      const mode = modeFromEvent(e)
      const orderedIds = filtered.map((c) => c.id)
      const result = applyMultiSelect(
        { prev: selectedIds, anchor: lastAnchorId, id, orderedIds },
        mode,
      )
      setSelectedIds(result.next)
      setSelectedId(result.nextCursor)
      setLastAnchorId(result.nextAnchor)
    },
    [selectedIds, lastAnchorId, filtered],
  )

  // Checkbox toggle: always uses 'toggle' mode regardless of modifiers.
  const onToggleSelection = useCallback(
    (id: string, _e: React.MouseEvent) => {
      const orderedIds = filtered.map((c) => c.id)
      const result = applyMultiSelect(
        { prev: selectedIds, anchor: lastAnchorId, id, orderedIds },
        'toggle',
      )
      setSelectedIds(result.next)
      setSelectedId(result.nextCursor)
      setLastAnchorId(result.nextAnchor)
    },
    [selectedIds, lastAnchorId, filtered],
  )

  // Cursor navigation through filtered list. Supports six targets and an `extend`
  // flag for Shift+key — extends the selection from the existing range anchor up
  // to the new cursor (anchor stays pinned, mirroring TO's Shift+Click semantics).
  // After moving, scrolls the new cursor row into view.
  const PAGE_STEP = 10
  const moveCursor = useCallback(
    (target: 'up' | 'down' | 'first' | 'last' | 'pgup' | 'pgdn', extend: boolean) => {
      if (filtered.length === 0) return
      const currentIdx = selectedId ? filtered.findIndex((c) => c.id === selectedId) : -1
      const start = currentIdx >= 0 ? currentIdx : 0
      let nextIdx = start
      switch (target) {
        case 'up':
          nextIdx = Math.max(0, start - 1)
          break
        case 'down':
          nextIdx = Math.min(filtered.length - 1, start + 1)
          break
        case 'first':
          nextIdx = 0
          break
        case 'last':
          nextIdx = filtered.length - 1
          break
        case 'pgup':
          nextIdx = Math.max(0, start - PAGE_STEP)
          break
        case 'pgdn':
          nextIdx = Math.min(filtered.length - 1, start + PAGE_STEP)
          break
      }
      const nextId = filtered[nextIdx]!.id

      if (extend) {
        // Range mode from anchor → new cursor. If no anchor yet, fall back to the
        // current cursor as anchor (so Shift+Down with empty selection still works).
        const orderedIds = filtered.map((c) => c.id)
        const anchor = lastAnchorId ?? selectedId
        const result = applyMultiSelect(
          { prev: selectedIds, anchor, id: nextId, orderedIds },
          'range',
        )
        setSelectedIds(result.next)
        setSelectedId(result.nextCursor)
        setLastAnchorId(result.nextAnchor)
      } else {
        // Plain move: cursor only, single-select on the new cursor.
        setSelectedId(nextId)
        setSelectedIds(new Set([nextId]))
        setLastAnchorId(nextId)
      }

      // Scroll the new cursor row into view (block: 'nearest' avoids jumping the
      // viewport when the row is already visible).
      queueMicrotask(() => {
        const el = mainListRef.current?.querySelector(
          `[data-contact-id="${nextId}"]`,
        ) as HTMLElement | null
        el?.scrollIntoView({ block: 'nearest' })
      })
    },
    [filtered, selectedId, lastAnchorId, selectedIds],
  )

  // j/k vim-style alias to ArrowDown/ArrowUp (no Shift-extend variants — keep terse).
  const navigate = useCallback(
    (delta: 1 | -1) => moveCursor(delta === 1 ? 'down' : 'up', false),
    [moveCursor],
  )

  // Cmd/Ctrl+Shift+A — select all visible. Cmd/Ctrl+A is intercepted by Tauri's
  // native "select all" so we use Shift to disambiguate (matches TO behavior).
  const onSelectAllVisible = useCallback(() => {
    if (filtered.length === 0) return
    setSelectedIds(new Set(filtered.map((c) => c.id)))
    // cursor + anchor untouched
  }, [filtered])

  // Right-click on a contact row → open the context menu at viewport coords.
  const onListContextMenu = useCallback((id: string, e: React.MouseEvent) => {
    setContextMenu({ x: e.clientX, y: e.clientY, contactId: id })
  }, [])

  // Context-menu action handlers. Each accepts the id-set chosen by the menu
  // (single id when right-clicked outside multi-selection; whole set otherwise).
  // All mutations route through `undoable.*` so they integrate with undo/redo.
  const onCtxOpenDetail = useCallback((id: string) => setSelectedId(id), [])
  const onCtxEditOne = useCallback((id: string) => handleOpenEdit(id), [handleOpenEdit])
  const onCtxTouch = useCallback(
    async (ids: ReadonlySet<string>) => {
      for (const id of ids) await undoable.recordTouch(id)
    },
    [undoable],
  )
  const onCtxToggleHidden = useCallback(
    async (ids: ReadonlySet<string>) => {
      for (const id of ids) {
        const c = contacts.find((x) => x.id === id)
        if (c) await undoable.recordToggleFlag(c, 'hidden')
      }
    },
    [contacts, undoable],
  )
  const onCtxToggleProtected = useCallback(
    async (ids: ReadonlySet<string>) => {
      for (const id of ids) {
        const c = contacts.find((x) => x.id === id)
        if (c) await undoable.recordToggleFlag(c, 'protected')
      }
    },
    [contacts, undoable],
  )
  const onCtxDelete = useCallback(
    async (ids: ReadonlySet<string>) => {
      for (const id of ids) await handleSoftDelete(id)
      setSelectedIds(new Set())
    },
    [handleSoftDelete],
  )
  const onCtxRestore = useCallback(
    async (ids: ReadonlySet<string>) => {
      for (const id of ids) await undoable.recordRestore(id)
      setSelectedIds(new Set())
    },
    [undoable],
  )

  // Extracted undo/redo so they can be shared with native menu handler below.
  const handleUndo = useCallback(async () => {
    const action = undoStore.past[undoStore.past.length - 1]
    if (!action) {
      push(t('undo.empty'))
      return
    }
    await undoable.applyUndo(action)
    undoStore.popUndo()
    push(`${t('undo.toast_done')}: ${t(`undo.kind.${action.kind}`)}`)
  }, [undoStore, undoable, push, t])

  const handleRedo = useCallback(async () => {
    const action = undoStore.future[undoStore.future.length - 1]
    if (!action) {
      push(t('undo.empty_redo'))
      return
    }
    await undoable.applyRedo(action)
    undoStore.popRedo()
    push(`${t('undo.toast_redone')}: ${t(`undo.kind.${action.kind}`)}`)
  }, [undoStore, undoable, push, t])

  // Listen for native menu actions forwarded from tauri/src/main.tsx via CustomEvent.
  // Export/Import open Settings → Backup tab (native file dialogs are used there).
  // Undo/Redo delegate to the handlers above.
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (id === 'undo') void handleUndo()
      else if (id === 'redo') void handleRedo()
      else if (id === 'export' || id === 'import') {
        setSettingsInitialTab('backup')
        setSettingsOpen(true)
      }
    }
    window.addEventListener('smart-contacts:menu-action', handler)
    return () => window.removeEventListener('smart-contacts:menu-action', handler)
  }, [handleUndo, handleRedo])

  useKeyboard([
    { combo: 'cmd+n', handler: handleAdd, description: 'hotkey.add' },
    { combo: 'cmd+,', handler: () => setSettingsOpen((o) => !o), description: 'hotkey.settings' },
    {
      combo: 'cmd+shift+z',
      handler: handleRedo,
      description: 'hotkey.redo',
    },
    {
      combo: 'ctrl+y',
      handler: handleRedo,
      description: 'hotkey.redo',
    },
    {
      combo: 'cmd+z',
      handler: handleUndo,
      description: 'hotkey.undo',
    },
    // Vim-style aliases (kept for muscle memory).
    { combo: 'j', handler: () => navigate(1), description: 'hotkey.next' },
    { combo: 'k', handler: () => navigate(-1), description: 'hotkey.prev' },
    // Arrow-key cursor navigation; Shift extends selection from anchor.
    { combo: 'arrowdown', handler: () => moveCursor('down', false), description: 'hotkey.next' },
    { combo: 'arrowup', handler: () => moveCursor('up', false), description: 'hotkey.prev' },
    {
      combo: 'shift+arrowdown',
      handler: () => moveCursor('down', true),
      description: 'hotkey.extend_down',
    },
    {
      combo: 'shift+arrowup',
      handler: () => moveCursor('up', true),
      description: 'hotkey.extend_up',
    },
    { combo: 'home', handler: () => moveCursor('first', false), description: 'hotkey.first' },
    { combo: 'end', handler: () => moveCursor('last', false), description: 'hotkey.last' },
    {
      combo: 'shift+home',
      handler: () => moveCursor('first', true),
      description: 'hotkey.extend_first',
    },
    {
      combo: 'shift+end',
      handler: () => moveCursor('last', true),
      description: 'hotkey.extend_last',
    },
    { combo: 'pageup', handler: () => moveCursor('pgup', false), description: 'hotkey.pgup' },
    {
      combo: 'pagedown',
      handler: () => moveCursor('pgdn', false),
      description: 'hotkey.pgdn',
    },
    {
      combo: 'shift+pageup',
      handler: () => moveCursor('pgup', true),
      description: 'hotkey.extend_pgup',
    },
    {
      combo: 'shift+pagedown',
      handler: () => moveCursor('pgdn', true),
      description: 'hotkey.extend_pgdn',
    },
    {
      combo: 'cmd+shift+a',
      handler: onSelectAllVisible,
      description: 'hotkey.select_all',
    },
    // Enter on the cursor row opens the edit dialog (mirrors TO).
    // Guarded against open dialogs: a global Enter would otherwise hijack the
    // focused button (Save/Cancel/Confirm) since useKeyboard's skip-in-input
    // check covers input/textarea/select/contenteditable but not <button>.
    {
      combo: 'enter',
      handler: () => {
        if (editing.open || helpOpen || settingsOpen) return
        handleEdit()
      },
      description: 'hotkey.edit',
    },
    { combo: 'e', handler: handleEdit, description: 'hotkey.edit' },
    {
      combo: 'delete',
      handler: () => selectedId && void handleSoftDelete(selectedId),
      description: 'hotkey.delete',
    },
    {
      combo: 't',
      handler: () => selectedId && void undoable.recordTouch(selectedId),
      description: 'hotkey.touch',
    },
    {
      combo: '/',
      handler: () => searchInputRef.current?.focus(),
      description: 'hotkey.search',
    },
    { combo: '?', handler: () => setHelpOpen((o) => !o), description: 'hotkey.help' },
    {
      combo: 'esc',
      handler: () => {
        // Cascade order (mirrors TO useKeyboard.ts): topmost dismissable layer first.
        // 1. Context menu → close
        // 2. Help overlay → close
        // 3. Edit dialog → close
        // 4. Settings dialog → close
        // 5. Multi-selection → clear (anchor cleared too)
        // 6. Active search → clear
        // 7. Non-trivial filters → reset to defaults
        if (contextMenu) {
          setContextMenu(null)
          return
        }
        if (helpOpen) {
          setHelpOpen(false)
          return
        }
        if (editing.open) {
          setEditing({ open: false, contact: null })
          return
        }
        if (settingsOpen) {
          setSettingsOpen(false)
          return
        }
        if (selectedIds.size > 0) {
          setSelectedIds(new Set())
          setLastAnchorId(null)
          return
        }
        if (filters.search) {
          setFilter('search', '')
          return
        }
        if (isFilterNonTrivial(filters)) {
          resetFilters()
          return
        }
      },
      skipInInput: false,
    },
  ])

  // Onboarding guide
  const guideDismissed = metaSettings.guide_dismissed === '1'
  const [guideForced, setGuideForced] = useState(false)
  const guideOpen = !guideDismissed || guideForced

  const dismissGuide = useCallback(async () => {
    await saveMeta('guide_dismissed', '1')
    setGuideForced(false)
  }, [saveMeta])

  const replayGuide = useCallback(async () => {
    await saveMeta('guide_dismissed', '')
    setGuideForced(true)
  }, [saveMeta])

  return (
    <div className={`h-full flex flex-col ${TC.root}`}>
      <style>{`
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track       { background: ${TC.scrollTrack}; }
        ::-webkit-scrollbar-thumb       { background: ${TC.scrollThumb}; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: ${TC.scrollThumbHover}; }
        * { scrollbar-color: ${TC.scrollThumb} ${TC.scrollTrack}; }
      `}</style>
      <NavHeader
        contacts={contacts}
        search={filters.search}
        onSearchChange={(v) => setFilter('search', v)}
        onQuickAdd={onQuickAdd}
        onOpenFullDialog={onOpenFullDialog}
        onOpenSettings={() => setSettingsOpen(true)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        searchFocusRef={searchInputRef}
      />

      <div className="flex-1 flex min-h-0">
        {sidebarOpen && (
          <>
            <Sidebar
              contacts={contacts}
              filters={filters}
              setFilter={setFilter}
              setFilters={setAllFilters}
              resetFilters={resetFilters}
              onOpenSettings={() => setSettingsOpen(true)}
              savedFilters={savedFilters}
              onDeleteSavedFilter={(id) => void onDeleteSavedFilter(id)}
              width={sidebarWidth}
              onDropContactOnGroup={(id, g) => void onDropContactOnGroup(id, g)}
              onDropContactOnTag={(id, tag) => void onDropContactOnTag(id, tag)}
              onDropContactOnOrganization={(id, org) => void onDropContactOnOrganization(id, org)}
            />
            <ResizeHandle
              edge="left"
              width={sidebarWidth}
              min={180}
              max={480}
              onResize={setSidebarWidth}
              onCommit={(finalWidth) => persistWidths(finalWidth, detailWidth)}
            />
          </>
        )}
        <div className="flex-1 flex flex-col min-w-0">
          <CenterTabBar activeView={activeView} onChangeView={onChangeView} />
          {activeView === 'contacts' ? (
            <>
              {selectedIds.size >= 2 && (
                <BulkActionBar
                  count={selectedIds.size}
                  scope={filters.scope}
                  onDelete={() => void onBulkDelete()}
                  onRestore={() => void onBulkRestore()}
                  onHide={() => void onBulkHide()}
                  onUnhide={() => void onBulkUnhide()}
                  onProtect={() => void onBulkProtect()}
                  onUnprotect={() => void onBulkUnprotect()}
                  onTouch={() => void onBulkTouch()}
                  onAddTag={() => void onBulkAddTag()}
                  onAddToGroup={() => void onBulkAddToGroup()}
                  onSetPriority={() => void onBulkSetPriority()}
                  onExport={() => void onBulkExport()}
                  onClear={() => setSelectedIds(new Set())}
                />
              )}
              <FilterChipsBar
                filters={filters}
                setFilters={setAllFilters}
                resetFilters={resetFilters}
                contacts={contacts}
              />
              <SortBar
                sort={sort}
                onToggle={onToggleSort}
                {...(googleSync !== null
                  ? {
                      withPhotoOnly: filters.hasPhoto === true,
                      onToggleWithPhoto: () =>
                        setFilters((p) =>
                          p.hasPhoto === true
                            ? // Drop the optional key to keep DEFAULT_FILTERS round-trip stable.
                              (({ hasPhoto: _drop, ...rest }) => rest)(p)
                            : { ...p, hasPhoto: true },
                        ),
                    }
                  : {})}
              />
              <div className="flex-1 flex min-h-0">
                <MainList
                  ref={mainListRef}
                  contacts={filtered}
                  selectedId={selectedId}
                  selectedIds={selectedIds}
                  onSelect={onSelectRow}
                  onToggleSelection={onToggleSelection}
                  onMarqueeSelect={(next) => setSelectedIds(next)}
                  onContextMenu={onListContextMenu}
                  onTouch={(id) => void undoable.recordTouch(id)}
                  onSoftDelete={(id) => void handleSoftDelete(id)}
                  onOpenEdit={handleOpenEdit}
                  loading={loading}
                  avatarContactIds={avatarContactIds}
                  avatarUrls={avatarUrls}
                />
                <ResizeHandle
                  edge="right"
                  width={detailWidth}
                  min={240}
                  max={640}
                  onResize={setDetailWidth}
                  onCommit={(finalWidth) => persistWidths(sidebarWidth, finalWidth)}
                />
                <ContactDetail
                  contact={selected}
                  defs={defs}
                  allContacts={contacts}
                  onEdit={handleEdit}
                  onToggleProtect={onToggleProtect}
                  onToggleHide={onToggleHide}
                  onTouch={() => selectedId && void undoable.recordTouch(selectedId)}
                  onDelete={() => selectedId && void handleSoftDelete(selectedId)}
                  onRestore={() => selectedId && void undoable.recordRestore(selectedId)}
                  onSelectContact={setSelectedId}
                  width={detailWidth}
                  interactions={contactInteractions}
                  onInteractionUpsert={(i) => undoable.recordInteractionUpsert(i)}
                  onInteractionSoftDelete={(id) => undoable.recordInteractionSoftDelete(id)}
                  tasks={contactTasks}
                  onTaskUpsert={(t) => undoable.recordTaskUpsert(t)}
                  onTaskMarkDone={(id, doneAt) => undoable.recordTaskMarkDone(id, doneAt)}
                  onTaskReopen={(id) => undoable.recordTaskReopen(id)}
                  onTaskSoftDelete={(id) => undoable.recordTaskSoftDelete(id)}
                  confirm={confirm}
                  labelRepo={googleSync?.repos.label ?? null}
                  googleSync={googleSync}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex min-h-0">
              <NetworkDashboard
                contacts={filtered}
                recentInteractions={recentInteractions}
                openTasks={openTasks}
                onOpenContact={onOpenContact}
                thresholds={staleThresholds}
              />
            </div>
          )}
        </div>
      </div>

      <StatusBar
        total={aliveCount}
        filtered={filtered.length}
        onLocaleToggle={() => setLocale(locale === 'en' ? 'ru' : 'en')}
        onThemeToggle={() => setTheme(theme === 'default' ? 'gruvbox' : 'default')}
        onModeToggle={() => setMode(mode === 'dark' ? 'light' : 'dark')}
        onDensityToggle={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
        filterIsNonTrivial={isFilterNonTrivial(filters)}
        onSaveFilter={() => void onSaveFilter()}
      />

      <ContactEditDialog
        open={editing.open}
        contact={editing.contact}
        defs={defs}
        allContacts={contacts}
        onSave={(c) => void handleSaveContact(c)}
        onCancel={() => setEditing({ open: false, contact: null })}
        googleSync={googleSync}
      />

      <SettingsDialog
        open={settingsOpen}
        initialTab={settingsInitialTab}
        onClose={() => {
          setSettingsOpen(false)
          setSettingsInitialTab('general')
        }}
        contacts={contacts}
        upsert={upsert}
        defs={defs}
        refreshDefs={refreshDefs}
        refreshContacts={refresh}
        onResetGuide={replayGuide}
        onResetLayout={handleResetLayout}
        googleSync={googleSync}
      />

      <GuideOverlay open={guideOpen} onDismiss={dismissGuide} />
      <HotkeyHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
      {contextMenu &&
        (() => {
          const c = contacts.find((x) => x.id === contextMenu.contactId)
          if (!c) return null
          return (
            <ContactContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              contact={c}
              selectedIds={selectedIds}
              inTrash={filters.scope === 'trash'}
              onClose={() => setContextMenu(null)}
              onOpenDetail={onCtxOpenDetail}
              onEdit={onCtxEditOne}
              onTouch={(ids) => void onCtxTouch(ids)}
              onToggleHidden={(ids) => void onCtxToggleHidden(ids)}
              onToggleProtected={(ids) => void onCtxToggleProtected(ids)}
              onDelete={(ids) => void onCtxDelete(ids)}
              onRestore={(ids) => void onCtxRestore(ids)}
            />
          )
        })()}
      {ConfirmMount}
      {PromptMount}
    </div>
  )
}
