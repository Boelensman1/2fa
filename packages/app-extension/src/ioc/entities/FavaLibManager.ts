import { inject, injectable } from 'inversify'
import {
  type FavaLib,
  type Password,
  type LockedRepresentationString,
  getFavaLibVaultCreationUtils,
  DeviceType,
  type SaveFunction,
} from 'favalib'
import BrowserPlatformProvider from 'favalib/platformProviders/browser'

import { IOC_TYPES, Logger } from '../../internals'
import Db from './Db'
import { ConfigContainer } from '../../types'

const deviceType = 'browser-extension' as DeviceType
const passwordExtraDict = ['browser', 'extension'] as const

const log = new Logger('FavaLibManager')

@injectable()
class FavaLibManager {
  db: Db
  config: ConfigContainer

  private _favaLib?: FavaLib

  public constructor(
    @inject(IOC_TYPES.DB) db: Db,
    @inject(IOC_TYPES.ConfigContainer) config: ConfigContainer,
  ) {
    this.db = db
    this.config = config
  }

  private get favaLibVaultCreationUtils() {
    return getFavaLibVaultCreationUtils(
      BrowserPlatformProvider,
      deviceType,
      passwordExtraDict,
      this.saveFunction.bind(this),
      this.config.get('syncServerUrl'),
    )
  }

  private set favaLib(favaLib: FavaLib) {
    this._favaLib = favaLib
  }

  public get favaLib() {
    if (!this._favaLib) {
      throw new Error('favaLib is not initialised')
    }
    return this._favaLib
  }

  private saveFunction: SaveFunction = async (
    newLockedRepresentationString,
  ) => {
    log.info('Saving vault')
    await this.db.upsertMetaKV(
      'lockedRepresentationString',
      newLockedRepresentationString,
    )
  }

  async createNewFavaLibVault(password: Password) {
    const result =
      await this.favaLibVaultCreationUtils.createNewFavaLibVault(password)
    this.favaLib = result.favaLib
  }

  async hasLockedRepresentation() {
    return (
      (await this.db.getMetaValue('lockedRepresentationString')) !== undefined
    )
  }

  async loadFavaLibVault(password: Password) {
    const lockedRepresentationString = await this.db.getMetaValue(
      'lockedRepresentationString',
    )
    if (!lockedRepresentationString) {
      throw new Error('No locked representation found while loading')
    }

    const favaLib =
      await this.favaLibVaultCreationUtils.loadFavaLibFromLockedRepesentation(
        lockedRepresentationString as LockedRepresentationString,
        password,
      )
    favaLib.storage.setSaveFunction(this.saveFunction.bind(this))
  }
}

export default FavaLibManager
