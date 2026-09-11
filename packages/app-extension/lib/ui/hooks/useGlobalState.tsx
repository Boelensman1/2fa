import { useState, useEffect } from 'react'
import type { State } from '@/lib/types'
import { bgActions, initialState } from '@/lib/state'

const useGlobalState = ({
  updateInterval,
}: { updateInterval?: number } = {}) => {
  const [globalState, setGlobalState] = useState<State>(initialState)

  useEffect(() => {
    const updateState = async () => {
      const newState = await bgActions.getState()
      setGlobalState(newState)
    }

    void updateState()
    const interval = setInterval(
      () => void updateState(),
      updateInterval ?? 500,
    )
    return () => clearInterval(interval)
  }, [updateInterval])

  return globalState
}

export default useGlobalState
