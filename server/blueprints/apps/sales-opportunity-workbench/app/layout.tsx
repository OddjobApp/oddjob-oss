import type { Metadata } from 'next'
import './globals.css'
import NavBar from './components/NavBar'

export const metadata: Metadata = {
  title: 'Sales Opportunity Workbench',
  description: 'Narrowing-window revenue cockpit - pipeline board, opportunity register, weighted forecast, and deal-risk alerts',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#09090b] text-white">
        <NavBar />
        {children}
      </body>
    </html>
  )
}
