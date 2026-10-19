import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Agent Training Workbench',
  description: 'Evaluate, analyze, and improve AI agent performance',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#090d16] text-white">{children}</body>
    </html>
  )
}
