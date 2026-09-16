const IOC_TYPES = {
  ConfigContainer: Symbol.for('ConfigContainer'),
  StateManager: Symbol.for('StateManager'),
  DB: Symbol.for('DB'),
  OtpFieldRegistry: Symbol.for('OtpFieldRegistry'),
  AutofillOfferRegistry: Symbol.for('AutofillOfferRegistry'),
  VaultContainer: Symbol.for('VaultContainer'),
}

export default IOC_TYPES
