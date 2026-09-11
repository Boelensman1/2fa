import { useConfig, useGlobalState } from '@/lib/ui/hooks'

const Popup = () => {
  const { config } = useConfig()
  const globalState = useGlobalState()

  return (
    <>
      {(config.debug ?? globalState.status === 'error') &&
        globalState.debugString && <pre>{globalState.debugString}</pre>}
      {config.debug && <pre>{globalState.status}</pre>}
    </>
  )
}

export default Popup
