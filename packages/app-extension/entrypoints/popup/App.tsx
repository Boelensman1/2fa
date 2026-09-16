import { useConfig, useGlobalState } from '@/lib/ui/hooks'

/**
 * The popup, which for now is a window onto the otp-field detector.
 *
 * There is no vault in this package yet, so there is nothing to fill and
 * nothing to list. What there is worth seeing is what the heuristic made of
 * the page in the active tab, and its reasons -- the fixture suite cannot tell
 * us how it does against a real site, and this is the only thing that can.
 */
const Popup = () => {
  const { config, saveConfig } = useConfig()
  const globalState = useGlobalState()

  return (
    <div className="p-3 text-xs">
      <h1 className="mb-2 font-semibold">Detected otp fields</h1>

      {globalState.status !== 'ready' ? (
        <p className="text-neutral-500">Starting up ({globalState.status})…</p>
      ) : globalState.debugString === '' ? (
        <p className="text-neutral-500">
          No otp fields on this page. A frame that finds nothing is not listed,
          so this also covers a tab that was open before the extension loaded --
          reload it if that is what happened.
        </p>
      ) : (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words">
          {globalState.debugString}
        </pre>
      )}

      <label className="mt-3 flex items-center gap-1.5 text-neutral-500">
        <input
          type="checkbox"
          checked={config.debug}
          onChange={(event) => void saveConfig({ debug: event.target.checked })}
        />
        Verbose logging
      </label>
    </div>
  )
}

export default Popup
