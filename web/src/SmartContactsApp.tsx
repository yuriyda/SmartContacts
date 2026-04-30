/**
 * @file SmartContactsApp.tsx
 * Top-level shell: opens the DB via useDb (outside AppProvider), then renders ScreenBody
 * which wires contacts, filters, selection state, dialogs, hotkeys, toasts, and onboarding.
 * Rules: useDb must be called OUTSIDE AppProvider so db can be injected as a prop.
 * No DB access directly in this file — all mutations go through useContacts.
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
} from '@smart-contacts/shared'
import { AppProvider, useApp } from './ui/AppContext'
import { useDb } from './store/useDb'
import { useContacts } from './store/useContacts'
import { Sidebar } from './ui/Sidebar'
import { MainList } from './ui/MainList'
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

export function SmartContactsApp() {
  const dbState = useDb()
  return (
    <AppProvider
      db={dbState.db}
      deviceId={dbState.deviceId}
      contactsRepo={dbState.contactsRepo}
      defsRepo={dbState.defsRepo}
    >
      <ScreenBody dbState={dbState} />
    </AppProvider>
  )
}

function ScreenBody({ dbState }: { dbState: ReturnType<typeof useDb> }) {
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

  // ---------------------------------------------------------------------------

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<ContactFilters>(DEFAULT_FILTERS)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [editing, setEditing] = useState<{ open: boolean; contact: Contact | null }>({
    open: false,
    contact: null,
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  const filtered = useFilteredContacts(contacts, filters)
  const aliveCount = useMemo(() => contacts.filter((c) => !c.deletedAt).length, [contacts])
  const selected = useMemo(
    () => contacts.find((c) => c.id === selectedId) ?? null,
    [contacts, selectedId],
  )

  const setFilter = useCallback(
    <K extends keyof ContactFilters>(k: K, v: ContactFilters[K]) =>
      setFilters((p) => ({ ...p, [k]: v })),
    [],
  )
  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), [])

  // Saved filter presets — derived from metaSettings so they update reactively.
  const savedFilters = useMemo(() => loadSavedFilters(metaSettings), [metaSettings])

  const setAllFilters = useCallback((next: ContactFilters) => setFilters(next), [])

  const { toasts, push, dismiss } = useToasts()

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

  // Hotkey-bound search input ref
  const searchInputRef = useRef<HTMLInputElement>(null)

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
      await upsert(c)
      // Mirror rule: ensure each internal relation partner has a back-link to c
      for (const rel of c.relationsInternal ?? []) {
        const partner = contacts.find((x) => x.id === rel.contactId)
        if (!partner) continue
        const has = (partner.relationsInternal ?? []).some((r) => r.contactId === c.id)
        if (!has) {
          const backLink =
            rel.type !== undefined ? { contactId: c.id, type: rel.type } : { contactId: c.id }
          await upsert({
            ...partner,
            relationsInternal: [...(partner.relationsInternal ?? []), backLink],
          })
        }
      }
      setEditing({ open: false, contact: null })
      setSelectedId(c.id)
    },
    [contacts, upsert],
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
      await upsert(updated)
      push(t('actions.added_to_group', { name: group.name ?? group.id }))
    },
    [contacts, upsert, push, t],
  )

  const onDropContactOnTag = useCallback(
    async (contactId: string, tagName: string) => {
      const c = contacts.find((x) => x.id === contactId)
      if (!c) return
      const updated = addContactToTag(c, tagName)
      if (updated === c) return // idempotent — already tagged, silent no-op
      await upsert(updated)
      push(t('actions.added_to_tag', { name: tagName }))
    },
    [contacts, upsert, push, t],
  )

  const onDropContactOnOrganization = useCallback(
    async (contactId: string, orgName: string) => {
      const c = contacts.find((x) => x.id === contactId)
      if (!c) return
      const updated = addContactToOrganization(c, orgName)
      if (updated === c) return // idempotent — already linked, silent no-op
      await upsert(updated)
      push(t('actions.added_to_organization', { name: orgName }))
    },
    [contacts, upsert, push, t],
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

  // Soft-delete with undo toast
  const handleSoftDelete = useCallback(
    async (id: string) => {
      await softDelete(id)
      push(t('confirm.delete_title'), {
        action: { label: t('actions.restore'), onClick: () => void restore(id) },
        duration: 5000,
      })
    },
    [softDelete, push, t, restore],
  )

  const onToggleProtect = useCallback(
    async (c: Contact) => {
      // No confirm to PROTECT (low-stakes). Confirm to UNPROTECT.
      if (c.protected) {
        const ok = window.confirm(t('confirm.unprotect_body', { name: c.displayName ?? '' }))
        if (!ok) return
      }
      await upsert({ ...c, protected: !c.protected })
    },
    [upsert, t],
  )

  const onToggleHide = useCallback(
    async (c: Contact) => {
      // Confirm to HIDE; no confirm to UNHIDE.
      if (!c.hidden) {
        const ok = window.confirm(t('confirm.hide_body', { name: c.displayName ?? '' }))
        if (!ok) return
      }
      await upsert({ ...c, hidden: !c.hidden })
    },
    [upsert, t],
  )

  // j/k navigation through filtered list
  const navigate = useCallback(
    (delta: 1 | -1) => {
      if (filtered.length === 0) return
      const idx = selectedId ? filtered.findIndex((c) => c.id === selectedId) : -1
      let next = idx + delta
      if (next < 0) next = 0
      if (next >= filtered.length) next = filtered.length - 1
      setSelectedId(filtered[next]!.id)
    },
    [filtered, selectedId],
  )

  useKeyboard([
    { combo: 'cmd+n', handler: handleAdd, description: 'hotkey.add' },
    { combo: 'cmd+,', handler: () => setSettingsOpen((o) => !o), description: 'hotkey.settings' },
    { combo: 'j', handler: () => navigate(1), description: 'hotkey.next' },
    { combo: 'k', handler: () => navigate(-1), description: 'hotkey.prev' },
    { combo: 'e', handler: handleEdit, description: 'hotkey.edit' },
    {
      combo: 'd',
      handler: () => selectedId && void handleSoftDelete(selectedId),
      description: 'hotkey.delete',
    },
    {
      combo: 't',
      handler: () => selectedId && void touch(selectedId),
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
        if (filters.search) {
          setFilter('search', '')
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
        <MainList
          contacts={filtered}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onTouch={(id) => void touch(id)}
          onSoftDelete={(id) => void handleSoftDelete(id)}
          onOpenEdit={handleOpenEdit}
          loading={loading}
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
          onTouch={() => selectedId && void touch(selectedId)}
          onDelete={() => selectedId && void handleSoftDelete(selectedId)}
          onRestore={() => selectedId && void restore(selectedId)}
          onSelectContact={setSelectedId}
          width={detailWidth}
        />
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
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        contacts={contacts}
        defs={defs}
        refreshDefs={refreshDefs}
        refreshContacts={refresh}
        onResetGuide={replayGuide}
        onResetLayout={handleResetLayout}
      />

      <GuideOverlay open={guideOpen} onDismiss={dismissGuide} />
      <HotkeyHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
