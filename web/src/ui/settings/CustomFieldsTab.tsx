/**
 * @file CustomFieldsTab.tsx
 * Settings tab: CRUD for custom field definitions.
 *
 * Rules:
 *  - All mutations go through defsRepo injected via props.
 *  - After any mutation call refreshDefs() to sync state.
 *  - softDelete is used for deletion (reversible at data layer).
 *  - No confirm dialog for delete (reversible operation, show toast instead).
 *  - select type requires non-empty options (validated before save).
 *  - No `any` types.
 */
import { useState, useCallback } from 'react'
import type { CustomFieldDef } from '@smart-contacts/shared'
import { ulid } from '@smart-contacts/shared'
import { useApp } from '../AppContext'
import { X, Plus } from '../icons'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FieldType = 'text' | 'date' | 'number' | 'url' | 'boolean' | 'select'

interface DefForm {
  id: string
  name: string
  type: FieldType
  options: string // newline-separated for select
  isNew: boolean
}

interface CustomFieldsTabProps {
  defs: CustomFieldDef[]
  refreshDefs: () => Promise<void>
  onToast: (msg: string) => void
}

// ---------------------------------------------------------------------------
// Editor form component
// ---------------------------------------------------------------------------

function DefEditor({
  form,
  onChange,
  onSave,
  onCancel,
}: {
  form: DefForm
  onChange: (f: DefForm) => void
  onSave: () => void
  onCancel: () => void
}) {
  const { TC, t } = useApp()
  const inputCls = `w-full text-sm rounded px-2.5 py-1.5 border outline-none focus:ring-1 focus:ring-sky-500 ${TC.input} ${TC.inputText} ${TC.text}`

  return (
    <div className={`mt-2 p-3 rounded border ${TC.borderClass} ${TC.elevated} space-y-3`}>
      <div>
        <label className={`block text-xs mb-0.5 ${TC.textMuted}`}>Field name *</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder="e.g. Department"
          className={inputCls}
          autoFocus
        />
      </div>
      <div>
        <label className={`block text-xs mb-0.5 ${TC.textMuted}`}>Type</label>
        <select
          value={form.type}
          onChange={(e) => onChange({ ...form, type: e.target.value as FieldType })}
          className={inputCls}
        >
          <option value="text">text</option>
          <option value="date">date</option>
          <option value="number">number</option>
          <option value="url">url</option>
          <option value="boolean">boolean</option>
          <option value="select">select</option>
        </select>
      </div>
      {form.type === 'select' && (
        <div>
          <label className={`block text-xs mb-0.5 ${TC.textMuted}`}>Options (one per line) *</label>
          <textarea
            value={form.options}
            onChange={(e) => onChange({ ...form, options: e.target.value })}
            placeholder={'Option A\nOption B\nOption C'}
            className={`${inputCls} min-h-20 font-mono resize-y`}
          />
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className={`px-3 py-1.5 text-sm rounded ${TC.elevated} ${TC.textSec} hover:opacity-80`}
        >
          {t('actions.cancel')}
        </button>
        <button
          type="button"
          onClick={onSave}
          className="px-3 py-1.5 text-sm rounded bg-sky-600 hover:bg-sky-500 text-white"
        >
          {t('actions.save')}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function emptyForm(id?: string): DefForm {
  return { id: id ?? '', name: '', type: 'text', options: '', isNew: !id }
}

export function CustomFieldsTab({ defs, refreshDefs, onToast }: CustomFieldsTabProps) {
  const { TC, t, defsRepo, deviceId } = useApp()

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<DefForm | null>(null)
  const [addForm, setAddForm] = useState<DefForm | null>(null)

  const activeDefs = defs.filter((d) => !d.deletedAt)

  const buildDef = useCallback(
    (form: DefForm): CustomFieldDef => {
      const now = new Date().toISOString()
      if (form.type === 'select') {
        return {
          id: form.id,
          name: form.name,
          type: 'select',
          options: form.options
            .split('\n')
            .map((o) => o.trim())
            .filter(Boolean),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          lamportTs: 0,
          deviceId: deviceId ?? '',
        }
      }
      return {
        id: form.id,
        name: form.name,
        type: form.type,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        lamportTs: 0,
        deviceId: deviceId ?? '',
      }
    },
    [deviceId],
  )

  const validateForm = useCallback((form: DefForm): string | null => {
    if (!form.name.trim()) return 'Name is required'
    if (form.type === 'select') {
      const opts = form.options
        .split('\n')
        .map((o) => o.trim())
        .filter(Boolean)
      if (opts.length === 0) return 'Select type requires at least one option'
    }
    return null
  }, [])

  const handleSaveNew = useCallback(async () => {
    if (!addForm || !defsRepo) return
    const err = validateForm(addForm)
    if (err) {
      onToast(err)
      return
    }
    const def = buildDef({ ...addForm, id: ulid() })
    await defsRepo.upsert(def)
    await refreshDefs()
    setAddForm(null)
    onToast('Custom field added')
  }, [addForm, defsRepo, validateForm, buildDef, refreshDefs, onToast])

  const handleSaveEdit = useCallback(async () => {
    if (!editForm || !defsRepo) return
    const err = validateForm(editForm)
    if (err) {
      onToast(err)
      return
    }
    // Preserve original createdAt
    const existing = defs.find((d) => d.id === editForm.id)
    const def = buildDef(editForm)
    const withCreated: CustomFieldDef = { ...def, createdAt: existing?.createdAt ?? def.createdAt }
    await defsRepo.upsert(withCreated)
    await refreshDefs()
    setEditForm(null)
    setExpandedId(null)
    onToast('Custom field updated')
  }, [editForm, defsRepo, validateForm, buildDef, refreshDefs, onToast, defs])

  const handleDelete = useCallback(
    async (id: string) => {
      if (!defsRepo) return
      await defsRepo.softDelete(id)
      await refreshDefs()
      if (expandedId === id) setExpandedId(null)
      onToast('Custom field removed')
    },
    [defsRepo, refreshDefs, expandedId, onToast],
  )

  const toggleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      setEditForm(null)
    } else {
      setExpandedId(id)
      const d = defs.find((x) => x.id === id)
      if (d) {
        setEditForm({
          id: d.id,
          name: d.name,
          type: d.type,
          options: d.type === 'select' ? (d as { options: string[] }).options.join('\n') : '',
          isNew: false,
        })
      }
    }
  }

  const typeBadgeCls = `text-xs px-1.5 py-0.5 rounded ${TC.elevated} ${TC.textMuted} font-mono`

  return (
    <div className="space-y-3">
      <p className={`text-xs ${TC.textMuted}`}>
        {activeDefs.length === 0
          ? 'No custom fields yet.'
          : `${activeDefs.length} field(s) defined.`}
      </p>

      {/* List */}
      <div className="space-y-1">
        {activeDefs.map((def) => (
          <div key={def.id} className={`rounded border ${TC.borderClass}`}>
            <div
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:opacity-80`}
              onClick={() => toggleExpand(def.id)}
            >
              <span className={`flex-1 text-sm ${TC.text}`}>{def.name}</span>
              <span className={typeBadgeCls}>{def.type}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDelete(def.id)
                }}
                className={`${TC.textMuted} hover:text-red-400 p-0.5`}
                aria-label={`Delete ${def.name}`}
              >
                <X size={13} />
              </button>
            </div>

            {/* Inline editor when expanded */}
            {expandedId === def.id && editForm && (
              <div className="px-3 pb-3">
                <DefEditor
                  form={editForm}
                  onChange={setEditForm}
                  onSave={() => void handleSaveEdit()}
                  onCancel={() => {
                    setExpandedId(null)
                    setEditForm(null)
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add new */}
      {addForm ? (
        <DefEditor
          form={addForm}
          onChange={setAddForm}
          onSave={() => void handleSaveNew()}
          onCancel={() => setAddForm(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAddForm(emptyForm())}
          className={`flex items-center gap-1.5 text-sm ${TC.textSec} hover:opacity-80`}
        >
          <Plus size={14} />
          {t('actions.add')} custom field
        </button>
      )}
    </div>
  )
}
