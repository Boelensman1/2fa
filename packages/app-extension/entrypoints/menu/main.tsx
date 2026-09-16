import React from 'react'
import ReactDOM from 'react-dom/client'
// Imported by path, not through `@/lib/ui/components`: that barrel reaches
// PairScreen, CreateVaultScreen and the hooks, none of which this page needs.
import Layout from '@/lib/ui/components/Layout'
import Menu from './App.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Layout>
      <Menu />
    </Layout>
  </React.StrictMode>,
)
