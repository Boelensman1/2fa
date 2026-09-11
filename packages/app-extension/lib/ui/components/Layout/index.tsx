import type { ReactNode, FC } from 'react'

import '../../../styles/globals.css'

interface LayoutProps {
  children: ReactNode
}

const Layout: FC<LayoutProps> = ({ children }) => <>{children}</>

export default Layout
