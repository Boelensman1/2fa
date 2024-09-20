import { useContext } from 'solid-js'

import Context from './Context'

const useStore = () => {
  return useContext(Context)
}

export default useStore
