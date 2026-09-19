import type { FC, FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  MAX_INPUT_SELECTOR_LENGTH,
  MAX_MATCHERS_PER_ENTRY,
  MAX_MATCHER_VALUE_LENGTH,
  MAX_URL_LENGTH,
  URL_MATCHER_TYPES,
  validateUrlMatcher,
} from 'favalib/matchers'
import type { UrlMatcherType } from 'favalib'

import type { EntryEditDraft, EntryEditValues } from '@/lib/drafts'
import type { EditableEntry, EntryUpdates } from '@/lib/types'
import { bgActions } from '@/lib/state'
import Button from '../Button'
import Splash from '../Splash'
import TextField from '../TextField'

interface EntryEditorProps {
  entryId: EditableEntry['id']
  draft: EntryEditDraft | null
  onDraftChange: (_draft: EntryEditDraft) => void
  onCancel: (_entry: EditableEntry | null) => void
  onSaved: (_entry: EditableEntry) => void
}

const formValues = (entry: EditableEntry): EntryEditValues => ({
  issuer: entry.issuer,
  name: entry.name,
  url: entry.url ?? '',
  matchers: entry.matchers.map((matcher) => ({ ...matcher })),
  inputSelector: entry.inputSelector ?? '',
})

/** Metadata only; the vault and TOTP secret stay in the background worker. */
const EntryEditor: FC<EntryEditorProps> = ({
  entryId,
  draft,
  onDraftChange,
  onCancel,
  onSaved,
}) => {
  const [entry, setEntry] = useState<EditableEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const current = await bgActions.getEditableEntry(entryId)
        if (cancelled) return
        setEntry(current)
        if (!current)
          setError(
            'This entry is unavailable. It may have been deleted or the vault may be locked.',
          )
      } catch {
        if (!cancelled) setError('Could not load this entry. Try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [entryId, reload])

  const values =
    draft?.entryId === entryId ? draft.values : entry ? formValues(entry) : null

  const change = (patch: Partial<EntryEditValues>) => {
    if (!values || saving.current) return
    onDraftChange({ entryId, values: { ...values, ...patch } })
    setError(null)
  }

  const save = async () => {
    if (!values || !entry || saving.current) return
    const updates: EntryUpdates = {
      issuer: values.issuer.trim(),
      name: values.name.trim(),
      url: values.url.trim() || null,
      inputSelector: values.inputSelector.trim() || null,
      matchers: values.matchers
        .map((matcher) => ({ ...matcher, value: matcher.value.trim() }))
        .filter((matcher) => matcher.value.length > 0),
    }
    let reason: string | null = null
    if (!updates.issuer || !updates.name)
      reason = 'Issuer and account name are required.'
    else if (updates.issuer.length > 256 || updates.name.length > 256)
      reason = 'Issuer and account name must be at most 256 characters.'
    else if ((updates.url?.length ?? 0) > MAX_URL_LENGTH)
      reason = `Website must be at most ${MAX_URL_LENGTH} characters.`
    else if (
      (updates.inputSelector?.length ?? 0) > MAX_INPUT_SELECTOR_LENGTH ||
      /[\r\n]/.test(updates.inputSelector ?? '')
    )
      reason = 'The OTP field selector is too long or contains a newline.'
    else if (updates.matchers.length > MAX_MATCHERS_PER_ENTRY)
      reason = `An entry can have at most ${MAX_MATCHERS_PER_ENTRY} matchers.`
    else reason = updates.matchers.map(validateUrlMatcher).find(Boolean) ?? null
    if (reason) {
      setError(reason)
      return
    }

    saving.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await bgActions.updateEntry(entryId, updates)
      if (!mounted.current) return
      if (result?.ok) onSaved(result.entry)
      else setError(result?.error ?? 'Could not save this entry. Try again.')
    } catch {
      if (mounted.current) setError('Could not save this entry. Try again.')
    } finally {
      saving.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void save()
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onCancel(entry)}
          className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-50"
        >
          Back
        </button>
        <h1 className="text-sm font-semibold text-gray-900">Edit entry</h1>
      </header>
      {loading ? (
        <Splash />
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {entry && values ? (
            <fieldset disabled={busy} className="space-y-3">
              <TextField
                label="Issuer"
                value={values.issuer}
                onChange={(event) => change({ issuer: event.target.value })}
                maxLength={256}
                autoFocus
                autoComplete="off"
              />
              <TextField
                label="Account name"
                value={values.name}
                onChange={(event) => change({ name: event.target.value })}
                maxLength={256}
                autoComplete="off"
              />
              <TextField
                label="Website"
                value={values.url}
                onChange={(event) => change({ url: event.target.value })}
                maxLength={MAX_URL_LENGTH}
                placeholder="https://example.com/login"
                spellCheck={false}
                autoComplete="off"
                hint="Shown in entry details. Site matchers decide where this entry is offered."
              />
              <fieldset className="space-y-2">
                <legend className="mb-1 text-xs font-medium text-gray-700">
                  Site matchers
                </legend>
                {values.matchers.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    No matchers, so this entry never appears under “For this
                    site”.
                  </p>
                ) : null}
                {values.matchers.map((matcher, index) => (
                  <div key={index} className="flex items-center gap-1">
                    <select
                      aria-label={`Matcher ${index + 1} type`}
                      value={matcher.type}
                      onChange={(event) =>
                        change({
                          matchers: values.matchers.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  type: event.target.value as UrlMatcherType,
                                }
                              : item,
                          ),
                        })
                      }
                      className="min-w-0 rounded border border-gray-300 px-1 py-2 text-xs"
                    >
                      {URL_MATCHER_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`Matcher ${index + 1} value`}
                      value={matcher.value}
                      onChange={(event) =>
                        change({
                          matchers: values.matchers.map((item, i) =>
                            i === index
                              ? { ...item, value: event.target.value }
                              : item,
                          ),
                        })
                      }
                      maxLength={MAX_MATCHER_VALUE_LENGTH}
                      autoComplete="off"
                      spellCheck={false}
                      className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-2 text-xs"
                    />
                    <button
                      type="button"
                      aria-label={`Remove matcher ${index + 1}`}
                      onClick={() =>
                        change({
                          matchers: values.matchers.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                      className="rounded px-2 py-1 text-red-600 hover:bg-gray-100"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={
                    busy || values.matchers.length >= MAX_MATCHERS_PER_ENTRY
                  }
                  onClick={() =>
                    change({
                      matchers: [
                        ...values.matchers,
                        { type: 'BaseDomain', value: '' },
                      ],
                    })
                  }
                  className="text-xs text-blue-600 hover:underline disabled:text-gray-400"
                >
                  Add matcher
                </button>
              </fieldset>
              <TextField
                label="OTP field selector"
                value={values.inputSelector}
                onChange={(event) =>
                  change({ inputSelector: event.target.value })
                }
                maxLength={MAX_INPUT_SELECTOR_LENGTH}
                placeholder="input#otp-code"
                autoComplete="off"
                spellCheck={false}
                hint="A CSS selector that overrides automatic code field detection on matching sites."
              />
            </fieldset>
          ) : null}
          {!entry ? (
            <Button
              variant="secondary"
              onClick={() => setReload((value) => value + 1)}
            >
              Try again
            </Button>
          ) : null}
        </div>
      )}
      <footer className="space-y-2 border-t border-gray-200 p-3">
        {error ? (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={loading || !entry || busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => onCancel(entry)}
        >
          Cancel
        </Button>
      </footer>
    </form>
  )
}

export default EntryEditor
