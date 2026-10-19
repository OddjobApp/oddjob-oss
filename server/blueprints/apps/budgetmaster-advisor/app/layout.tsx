import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BudgetMaster Financial Advisor',
  description: 'Ask your personal financial advisor — grounded in your real transactions',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#090d16] text-white">{children}</body>
    </html>
  )
}
