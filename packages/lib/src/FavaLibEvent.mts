export enum FavaLibEvent {
  /**
   * Vault state a consumer may be displaying has changed: an entry was added,
   * updated or deleted, or the sync device list changed -- a device enrolled,
   * removed, renamed or acknowledged.
   *
   * It carries no detail of what changed; the listener re-reads what it shows.
   */
  Changed = 'changed',
  /**
   * The vault password was changed and the new key material has been saved.
   * Anything holding the password, or keys derived from it, outside the vault
   * must drop it.
   */
  PasswordChanged = 'passwordChanged',
  LoadedFromLockedRepresentation = 'loadedFromLockedRepresentation',
  ConnectToExistingVaultFinished = 'connectToExistingVaultFinished',
  /** Sender pairing ended. Completion means sent and enrolled, not peer receipt. */
  AddDeviceFlowFinished = 'addDeviceFlowFinished',
  ConnectionToSyncServerStatusChanged = 'connectionToSyncServerStatusChanged',
  /**
   * A peer introduced a device this vault had not paired with itself.
   *
   * Informational: the device is already enrolled by the time this fires, and
   * acknowledging it changes nothing. Flat peer trust is the model, so the
   * library's job here is to say what happened, not to gate it.
   */
  SyncDeviceAdded = 'syncDeviceAdded',
  Log = 'log',
  Ready = 'ready',
}
