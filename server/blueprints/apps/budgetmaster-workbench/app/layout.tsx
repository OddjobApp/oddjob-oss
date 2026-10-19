import type { Metadata } from 'next'
import './globals.css'
import NavBar from './components/NavBar'

export const metadata: Metadata = {
  title: 'BudgetMaster Workbench',
  description: 'Sovereign Algorithmic Wealth Matrix — ledger, forecast, and treasury control',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#090d16] text-white">
        <NavBar />
        {children}
      </body>
    </html>
  )
}
