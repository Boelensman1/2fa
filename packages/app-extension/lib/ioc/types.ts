const IOC_TYPES = {
  ConfigContainer: Symbol.for('ConfigContainer'),
  StateManager: Symbol.for('StateManager'),
  DB: Symbol.for('DB'),
  OtpFieldRegistry: Symbol.for('OtpFieldRegistry'),
  AutofillOfferRegistry: Symbol.for('AutofillOfferRegistry'),
  RememberOfferRegistry: Symbol.for('RememberOfferRegistry'),
  VaultContainer: Symbol.for('VaultContainer'),
}

export default IOC_TYPES
