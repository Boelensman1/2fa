interface State {
  debugString: string
  status: 'loading' | 'no-vault' | 'locked' | 'ready' | 'error'
}

export default State
