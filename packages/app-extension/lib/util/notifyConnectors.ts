import { browser } from 'wxt/browser'
import type { CTEvent } from '../types'
import { ctActions } from '../state'

const notifyConnectors = async (event: CTEvent) => {
  const tabs = await browser.tabs.query({})

  await Promise.all(
    tabs.map((tab) => ctActions.eventNotification(tab.id, event)),
  )
}

export default notifyConnectors
