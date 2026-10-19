import type { Metadata } from 'next'
import './globals.css'
import NavBar from './components/NavBar'

export const metadata: Metadata = {
  title: 'Codegen Pipeline Workbench',
  description: 'Autonomous code-generation cockpit - pipeline session dashboard and quality metrics for the Autonomous Code Generation Pipeline cycle',
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
