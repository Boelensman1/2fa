import useConfig from '../shared/useConfig'
import useGlobalState from '../shared/useGlobalState'

const Popup = () => {
  const { config } = useConfig()
  const globalState = useGlobalState()

  return (
    <>
      {(config.debug ?? globalState.status === 'error') &&
        globalState.debugString && <pre>{globalState.debugString}</pre>}
      {config.debug && <pre>{globalState.status}</pre>}
      <pre>{globalState.status}</pre>
    </>
  )
}

export default Popup
