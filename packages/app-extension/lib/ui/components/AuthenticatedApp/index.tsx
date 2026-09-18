import type { FC } from 'react'
import { useCallback, useRef, useState } from 'react'

import { bgActions } from '@/lib/state'
import { closeSyncServerEditor, popupTabDraft } from '@/lib/drafts'
import Logger from '@/lib/classes/Logger'
import type {
  FillTarget,
  ListedEntry,
  SiteOffer,
  VaultSummary,
} from '@/lib/types'
import { useActiveTab, useDraft, useFillTarget } from '../../hooks'
import { describeFillFailure } from '../../fillMessages'
import EntryDetail from '../EntryDetail'
import FillConfirm from '../FillConfirm'
import RememberSite from '../RememberSite'
import SettingsTab from '../SettingsTab'
import Splash from '../Splash'
import TabBar, { type TabId } from '../TabBar'
import Toast from '../Toast'
import VaultTab from '../VaultTab'

const log = new Logger('popup/AuthenticatedApp')

interface AuthenticatedAppProps {
  summary: VaultSummary
  onVaultChanged: () => void
}

/** How long the copy confirmation stays up. */
const TOAST_MS = 1800

const AuthenticatedApp: FC<AuthenticatedAppProps> = ({
  summary,
  onVaultChanged,
}) => {
  /**
   * Which tab was open, kept across the popup closing.
   *
   * `selected`, `confirming` and `remembering` below are deliberately not:
   * the latter two are frozen snapshots of a live fill and must not outlive
   * it, and a restored detail view would hide the list the popup is for.
   */
  const [tab, setTab, { ready }] = useDraft<TabId>(popupTabDraft, 'vault')
  const [selected, setSelected] = useState<ListedEntry | null>(null)
  /**
   * Set when a fill needs the user to look at the frame it is going into.
   *
   * Holds the target as well as the entry, frozen. `fillTarget` is polled, so
   * it can change under an open confirmation -- and the user would then be
   * saying yes to a url they were never shown.
   */
  const [confirming, setConfirming] = useState<{
    entry: ListedEntry
    target: FillTarget
  } | null>(null)
  /**
   * Set when a fill just succeeded and the entry did not claim the page.
   *
   * Frozen like `confirming`, and for a second reason as well: by the time
   * this is up the page may have submitted itself and navigated, so the url
   * the offer was made about is no longer anything that can be looked up.
   */
  const [remembering, setRemembering] = useState<{
    entry: ListedEntry
    offer: SiteOffer
    inSubframe: boolean
  } | null>(null)
  const [savingSite, setSavingSite] = useState(false)
  const activeTab = useActiveTab()
  const fillTarget = useFillTarget(activeTab?.id)
  const [toast, setToast] = useState<{
    message: string
    tone: 'success' | 'error'
  } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  const showToast = useCallback(
    (message: string, tone: 'success' | 'error' = 'success') => {
      setToast({ message, tone })
      clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
    },
    [],
  )

  /**
   * The clipboard write happens here, not in the background.
   *
   * A service worker has no `navigator.clipboard`, so the code has to cross
   * back to the popup regardless. It is generated on demand and never
   * rendered.
   */
  const copy = useCallback(
    async (entry: ListedEntry) => {
      try {
        const otp = await bgActions.getToken(entry.id)
        if (!otp) {
          showToast('Could not generate a code', 'error')
          return
        }
        await navigator.clipboard.writeText(otp)
        showToast('Code copied')
      } catch (error) {
        log.error(error instanceof Error ? error : new Error(String(error)))
        showToast('Could not copy the code', 'error')
      }
    },
    [showToast],
  )

  const onCopy = useCallback((entry: ListedEntry) => void copy(entry), [copy])

  /**
   * Types a code into the field the background found on the page.
   *
   * The entry is whichever one the user clicked, matching site or not -- that
   * is the whole point of filling from here rather than from the inline menu,
   * which only ever offers what the frame's url claims.
   *
   * `untrusted-frame` is not a failure. It is the background saying the field
   * lives in an embedded frame this entry does not vouch for, and that it has
   * generated nothing and will not until asked twice. Everything else is over.
   */
  const fill = useCallback(
    async (
      entry: ListedEntry,
      target: FillTarget | null,
      confirmed = false,
    ) => {
      if (!target) return
      try {
        const result = await bgActions.fillDetectedField(
          target,
          entry.id,
          confirmed,
        )

        if (result?.reason === 'untrusted-frame') {
          setConfirming({ entry, target })
          return
        }

        setConfirming(null)

        if (result?.filled === true) {
          // `partial` still filled -- the code and the row of boxes were
          // different lengths -- so it closes like any other success, but says
          // what happened rather than claiming everything was fine.
          showToast(
            result.reason ? describeFillFailure(result.reason) : 'Code filled',
          )

          const offer = result.remember
          if (offer) {
            // The one thing worth holding the popup open for. Everything below
            // says why it normally is not.
            setRemembering({ entry, offer, inSubframe: target.inSubframe })
            return
          }

          // Close behind the toast: the code is in the field, and the popup is
          // now standing between the user and the button they are about to
          // press. Deliberately not immediate, so "did that work?" has an
          // answer other than the popup vanishing.
          setTimeout(() => window.close(), TOAST_MS)
          return
        }

        showToast(describeFillFailure(result?.reason), 'error')
      } catch (error) {
        log.error(error instanceof Error ? error : new Error(String(error)))
        showToast('Could not fill that field', 'error')
      }
    },
    [showToast],
  )

  const onFill = useCallback(
    (entry: ListedEntry) => void fill(entry, fillTarget),
    [fill, fillTarget],
  )

  /**
   * Answers the offer, then gets out of the way.
   *
   * Both answers close the popup, because the fill has already happened and
   * the user is on their way to the page's own submit button. A third outcome
   * -- ignoring it -- closes the popup too, since clicking the page is what
   * dismisses a popup; an unanswered offer is a no, which is the right default
   * for something that writes to the vault.
   */
  const remember = useCallback(async () => {
    if (!remembering) return
    setSavingSite(true)
    try {
      const result = await bgActions.rememberEntrySite(
        remembering.entry.id,
        remembering.offer.pageUrl,
      )
      if (result?.ok === true) {
        showToast('Site remembered')
      } else {
        showToast(result?.error ?? 'Could not save that', 'error')
      }
    } catch (error) {
      log.error(error instanceof Error ? error : new Error(String(error)))
      showToast('Could not save that', 'error')
    } finally {
      setSavingSite(false)
      setRemembering(null)
      setTimeout(() => window.close(), TOAST_MS)
    }
  }, [remembering, showToast])

  const dismissOffer = useCallback(() => {
    setRemembering(null)
    setTimeout(() => window.close(), TOAST_MS)
  }, [])

  /**
   * Switching tabs is leaving the sync server form, not stepping out of it.
   *
   * So what was typed there goes, secret and all. Coming back to Settings then
   * shows the summary again rather than a half-filled form -- `SettingsTab`
   * re-reads the same two drafts when it mounts.
   */
  const changeTab = (next: TabId) => {
    if (tab === 'settings' && next !== 'settings') void closeSyncServerEditor()
    setTab(next)
  }

  const lock = () => {
    void bgActions.lockVault().then(onVaultChanged)
  }

  const reset = () => {
    void bgActions.resetVault().then(onVaultChanged)
  }

  return (
    <div className="flex h-[32rem] flex-col bg-white">
      <div className="min-h-0 flex-1">
        {!ready ? (
          <Splash />
        ) : remembering ? (
          <RememberSite
            entry={remembering.entry}
            offer={remembering.offer}
            inSubframe={remembering.inSubframe}
            busy={savingSite}
            onRemember={() => void remember()}
            onDismiss={dismissOffer}
          />
        ) : confirming ? (
          <FillConfirm
            entry={confirming.entry}
            target={confirming.target}
            onConfirm={() =>
              void fill(confirming.entry, confirming.target, true)
            }
            onCancel={() => setConfirming(null)}
          />
        ) : selected ? (
          <EntryDetail
            entry={selected}
            onCopy={onCopy}
            onFill={fillTarget ? onFill : null}
            fillHost={fillTarget?.host ?? null}
            onBack={() => setSelected(null)}
          />
        ) : tab === 'vault' ? (
          <VaultTab
            url={activeTab?.url}
            fillTarget={fillTarget}
            onCopy={onCopy}
            onOpen={setSelected}
            onFill={onFill}
            onLock={lock}
          />
        ) : (
          <SettingsTab
            summary={summary}
            onLock={lock}
            onReset={reset}
            onVaultChanged={onVaultChanged}
          />
        )}
      </div>

      <Toast message={toast?.message ?? null} tone={toast?.tone} />

      {/* Hidden behind the detail view and the two fill questions: all of them
          are drill-downs from the vault tab, not third destinations, so a
          highlighted tab there would lie. */}
      {!ready || selected || confirming || remembering ? null : (
        <TabBar active={tab} onChange={changeTab} />
      )}
    </div>
  )
}

export default AuthenticatedApp
