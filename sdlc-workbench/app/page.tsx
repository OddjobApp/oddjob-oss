import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">SDLC Workbench</h1>
        <p className="text-muted-foreground mb-8">Select a workbench to access:</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Link href="/pm-workbench" className="p-6 border rounded-lg hover:bg-accent transition-colors">
            <h2 className="text-xl font-semibold mb-2">PM Workbench</h2>
            <p className="text-sm text-muted-foreground">Product management and sprint planning</p>
          </Link>
          
          <Link href="/scrum-master-workbench" className="p-6 border rounded-lg hover:bg-accent transition-colors">
            <h2 className="text-xl font-semibold mb-2">Scrum Master Workbench</h2>
            <p className="text-sm text-muted-foreground">Sprint execution and team coordination</p>
          </Link>
          
          <Link href="/qa-workbench" className="p-6 border rounded-lg hover:bg-accent transition-colors">
            <h2 className="text-xl font-semibold mb-2">QA Workbench</h2>
            <p className="text-sm text-muted-foreground">Quality assurance and testing</p>
          </Link>
          
          <Link href="/stakeholder-workbench" className="p-6 border rounded-lg hover:bg-accent transition-colors">
            <h2 className="text-xl font-semibold mb-2">Stakeholder Workbench</h2>
            <p className="text-sm text-muted-foreground">Stakeholder reporting and dashboards</p>
          </Link>
          
          <Link href="/ai-workforce-dashboard" className="p-6 border rounded-lg hover:bg-accent transition-colors">
            <h2 className="text-xl font-semibold mb-2">AI Workforce Dashboard</h2>
            <p className="text-sm text-muted-foreground">AI agent monitoring and management</p>
          </Link>
        </div>
      </div>
    </div>
  )
}
