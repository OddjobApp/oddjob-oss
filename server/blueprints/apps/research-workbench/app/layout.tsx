import type { Metadata } from 'next'
import './globals.css'
import { LayoutShell } from './components/LayoutShell'

export const metadata: Metadata = {
  title: 'Research Workbench',
  description: 'Universal research, synthesis, and decision portal',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#090d16] text-white">
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  )
}
