import type { Metadata } from 'next'
import './globals.css'
import { CrewViewBridge } from './components/CrewViewBridge'
import { DurableHandoffInbox } from './components/DurableHandoffInbox'

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
      <body>
        <DurableHandoffInbox />
        {children}
        <CrewViewBridge />
      </body>
    </html>
  )
}
