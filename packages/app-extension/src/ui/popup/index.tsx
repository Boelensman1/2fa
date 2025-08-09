import '~/ui/shared/enableDevHmr'
import React from 'react'
import ReactDOM from 'react-dom/client'
import Popup from './popup'

import { Layout } from '../../internals'

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <Layout>
      <Popup />
    </Layout>
  </React.StrictMode>,
)
