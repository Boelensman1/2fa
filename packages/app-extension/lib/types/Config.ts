export default interface Config {
  debug: boolean
  /**
   * Whether focusing a detected otp field offers to fill it.
   *
   * On by default, and off is a real setting rather than a kill switch: the
   * menu is the only part of this extension that draws on someone else's page,
   * and a user who does not want that should not have to uninstall to say so.
   */
  inlineMenu: boolean
}
