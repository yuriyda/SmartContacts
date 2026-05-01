/**
 * @file MainList.tsx
 * Scrollable contacts list. Renders ContactRow for each visible contact.
 * Supports keyboard j/k navigation via onKeyDown on the container.
 * Shows loading state and EmptyState when appropriate.
 * Rules: no DB access; receives already-filtered contacts from parent.
 */
import type { Contact } from '@smart-contacts/shared'
import { useApp } from './AppContext'
import { ContactRow } from './ContactRow'
import { EmptyState } from './common'
import { Users } from 'lucide-react'

interface MainListProps {
  contacts: Contact[]
  selectedId: string | null
  selectedIds: ReadonlySet<string>
  /** Called on mouse click — receives event for multi-select mode detection. */
  onSelect: (id: string, e: React.MouseEvent) => void
  /** Called when checkbox is clicked — always toggles regardless of modifiers. */
  onToggleSelection: (id: string, e: React.MouseEvent) => void
  /** Called by keyboard j/k navigation — always single-select. */
  onNavigate: (id: string) => void
  onTouch: (id: string) => void
  onSoftDelete: (id: string) => void
  onOpenEdit: (id: string) => void
  loading: boolean
}

export function MainList({
  contacts,
  selectedId,
  selectedIds,
  onSelect,
  onToggleSelection,
  onNavigate,
  onTouch,
  onSoftDelete,
  onOpenEdit,
  loading,
}: MainListProps) {
  const { TC, t } = useApp()

  if (loading) {
    return <div className={`flex-1 p-6 ${TC.surface} ${TC.textSec}`}>{t('status.loading')}</div>
  }

  if (contacts.length === 0) {
    return (
      <div className={`flex-1 flex items-center justify-center ${TC.surface}`}>
        <EmptyState icon={Users} title={t('empty.no_contacts')} body={t('empty.demo_hint')} />
      </div>
    )
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!contacts.length) return
    const currentIndex = selectedId ? contacts.findIndex((c) => c.id === selectedId) : -1

    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.min(currentIndex + 1, contacts.length - 1)
      const contact = contacts[next]
      if (contact) onNavigate(contact.id)
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = Math.max(currentIndex - 1, 0)
      const contact = contacts[prev]
      if (contact) onNavigate(contact.id)
    }
  }

  return (
    <div
      className={`flex-1 overflow-y-auto ${TC.surface} focus:outline-none`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="listbox"
      aria-label="Contacts list"
    >
      {contacts.map((c) => (
        <ContactRow
          key={c.id}
          contact={c}
          selected={c.id === selectedId}
          multiSelected={selectedIds.has(c.id)}
          anySelected={selectedIds.size > 0}
          onSelect={(e) => onSelect(c.id, e)}
          onToggleSelection={(e) => onToggleSelection(c.id, e)}
          onTouch={() => onTouch(c.id)}
          onSoftDelete={() => onSoftDelete(c.id)}
          onOpenEdit={onOpenEdit}
        />
      ))}
    </div>
  )
}
