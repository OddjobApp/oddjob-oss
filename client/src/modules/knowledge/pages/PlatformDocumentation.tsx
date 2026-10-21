import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import ReactMarkdown from "react-markdown";
import { BookOpen, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Document {
  id: string; title: string; url: string; sourceUrl: string; version: string; textContent?: string;
}
async function load<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error("Could not load platform documentation");
  return response.json();
}
export default function PlatformDocumentation() {
  const [query, setQuery] = useState("");
  const search = useSearch();
  const slug = new URLSearchParams(search).get("id");
  const list = useQuery({ queryKey: ["platform-documentation"], queryFn: () => load<{ documents: Document[] }>("/api/knowledge/platform-docs") });
  const document = useQuery({ queryKey: ["platform-documentation", slug], enabled: !!slug,
    queryFn: () => load<Document>(`/api/knowledge/platform-docs/${encodeURIComponent(`platform:${slug}`)}`) });
  const docs = (list.data?.documents || []).filter(doc => doc.title.toLowerCase().includes(query.toLowerCase()));
  return <div className="container mx-auto max-w-6xl space-y-6 py-8">
    <header className="space-y-2">
      <h1 className="flex items-center gap-2 text-3xl font-bold"><BookOpen className="h-7 w-7" />Platform documentation</h1>
      <p className="text-muted-foreground">Published Oddjob guides available to every organization. Also included in knowledge search and agent retrieval.</p>
      <Badge variant="secondary">Shared · Read only</Badge>
    </header>
    {(list.isError || document.isError) && <p role="alert" className="text-destructive">Could not load documentation. Please try again.</p>}
    <div className="grid gap-6 lg:grid-cols-3">
      <aside className="space-y-3">
        <label htmlFor="platform-guide-filter" className="flex items-center gap-2 text-sm font-medium"><Search className="h-4 w-4" />Find a guide</label>
        <Input id="platform-guide-filter" value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter guides" />
        {list.isPending && <p role="status">Loading guides…</p>}
        {!list.isPending && !list.isError && !docs.length && <p>No matching guides.</p>}
        <nav aria-label="Platform guides" className="flex flex-col gap-2">
          {docs.map(doc => <Link key={doc.id} href={doc.url} className="rounded-md border border-border p-3 text-sm hover:bg-muted" aria-current={doc.id === `platform:${slug}` ? "page" : undefined}>{doc.title}</Link>)}
        </nav>
      </aside>
      <Card className="min-w-0 lg:col-span-2">
        <CardHeader><CardTitle>{document.data?.title || "Choose a guide"}</CardTitle></CardHeader>
        <CardContent>
          {document.isFetching && slug && <p role="status">Loading guide…</p>}
          {!slug && <p className="text-muted-foreground">These guides are maintained with Oddjob. Organization uploads and private knowledge stay separate.</p>}
          {document.data && <>
            <p className="mb-4 text-xs text-muted-foreground">Published version {document.data.version.slice(0, 12)} · <a className="underline" href={document.data.sourceUrl} target="_blank" rel="noreferrer">Repository source</a></p>
            <article className="prose prose-sm max-w-none break-words dark:prose-invert">
              <ReactMarkdown skipHtml urlTransform={url => {
                if (url.startsWith("#")) return url;
                try { const resolved = new URL(url, document.data!.sourceUrl); return resolved.protocol === "https:" ? resolved.href : ""; }
                catch { return ""; }
              }}>{document.data.textContent || ""}</ReactMarkdown>
            </article>
          </>}
        </CardContent>
      </Card>
    </div>
  </div>;
}
