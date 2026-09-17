export enum FavaLibEvent {
  Changed = 'changed',
  /**
   * The vault password was changed and the new key material has been saved.
   * Anything holding the password, or keys derived from it, outside the vault
   * must drop it -- see key-hierarchy-review/04-key-rotation.md.
   */
  PasswordChanged = 'passwordChanged',
  LoadedFromLockedRepresentation = 'loadedFromLockedRepresentation',
  ConnectToExistingVaultFinished = 'connectToExistingVaultFinished',
  ConnectionToSyncServerStatusChanged = 'connectionToSyncServerStatusChanged',
  Log = 'log',
  Ready = 'ready',
}
