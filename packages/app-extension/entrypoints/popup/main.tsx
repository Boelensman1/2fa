import React from 'react'
import ReactDOM from 'react-dom/client'
import { Layout } from '@/lib/ui/components'
import Popup from './App.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Layout>
      <Popup />
    </Layout>
  </React.StrictMode>,
)
