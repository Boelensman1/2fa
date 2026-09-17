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
  /**
   * A peer introduced a device this vault had not paired with itself.
   *
   * Informational: the device is already enrolled by the time this fires, and
   * acknowledging it changes nothing. See
   * key-hierarchy-review/14-sync-device-injection.md -- flat peer trust is the
   * model, so the library's job here is to say what happened, not to gate it.
   */
  SyncDeviceAdded = 'syncDeviceAdded',
  Log = 'log',
  Ready = 'ready',
}
