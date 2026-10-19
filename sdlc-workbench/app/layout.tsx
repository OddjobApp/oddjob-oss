import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SDLC Workbench',
  description: 'Shared SDLC workbench for product management, sprint planning, QA, stakeholder reporting, and AI workforce monitoring',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
