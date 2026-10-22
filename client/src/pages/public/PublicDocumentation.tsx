import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PUBLIC_FEATURE_DOCS } from "@shared/public-feature-docs";
import { publicDocumentationLink } from "@shared/public-documentation-links";
import { Shell } from "./PublicPages";

type PublicSpec = { title: string; markdown: string; revision: string; sourceUpdatedAt: string; source: string };
export default function PublicDocumentation({ slug }: { slug?: string }) {
  const topic = PUBLIC_FEATURE_DOCS.find(doc => doc.slug === slug);
  const [state, setState] = useState<{ slug?: string; doc?: PublicSpec; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!topic || !slug) return;
    const controller = new AbortController();
    setState({slug});
    fetch(`/api/public/documentation/${encodeURIComponent(slug)}`, { signal: controller.signal, credentials: "omit" })
      .then(async res => { if (!res.ok) throw new Error(res.status === 404 ? "This public guide is unavailable." : "Documentation could not be loaded. Please retry."); return res.json(); })
      .then(doc => setState({slug, doc}))
      .catch(error => { if (error.name !== "AbortError") setState({slug, error: error.message}); });
    return () => controller.abort();
  }, [slug, topic, attempt]);
  const doc = state.slug === slug ? state.doc : undefined;
  return <Shell title={slug ? topic?.title ?? "Guide not found" : "Oddjob feature documentation"} intro="Explore what Oddjob can do, how to get started, and what each capability needs. These public guides stay connected to the deployed platform documentation.">
    <a href="/use-cases" className="inline-flex min-h-11 items-center underline underline-offset-4">Explore use cases</a>
    {!slug ? <div className="grid gap-4 md:grid-cols-2">{PUBLIC_FEATURE_DOCS.map(item => <a key={item.slug} href={`/docs/${item.slug}`} className="rounded-xl border border-border p-5 font-semibold hover:bg-muted">{item.title}</a>)}</div> : !topic ? <p role="alert">This guide is not in the public documentation catalog. <a href="/docs" className="underline">Browse available guides.</a></p> : <div className="grid items-start gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Feature documentation" className="flex flex-wrap gap-2 lg:block lg:space-y-1">{PUBLIC_FEATURE_DOCS.map(item => <a key={item.slug} href={`/docs/${item.slug}`} aria-current={slug === item.slug ? "page" : undefined} className={`block rounded-lg px-3 py-2 text-sm ${slug === item.slug ? "bg-muted font-semibold" : "hover:bg-muted"}`}>{item.title}</a>)}</nav>
      <div className="min-w-0">{state.slug === slug && state.error ? <div role="alert" className="rounded-xl border p-6"><p>{state.error}</p><button onClick={() => setAttempt(value => value + 1)} className="mt-3 min-h-11 rounded-lg border px-4">Retry</button></div> : !doc ? <p role="status">Loading the feature guide…</p> : <>
        <p className="mb-5 text-xs leading-6 text-muted-foreground">Published from the deployed platform · Source updated {new Date(doc.sourceUpdatedAt).toLocaleDateString()} · Revision {doc.revision.slice(0, 12)}. This guide does not confirm that integrations or runtimes are enabled.</p>
        <article className="prose prose-sm max-w-none break-words dark:prose-invert prose-pre:max-w-full prose-pre:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto">
          <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{ h1: () => null, img: ({alt}) => <span>{alt}</span>, a: ({href,children}) => { const safe = publicDocumentationLink(href, slug); return safe ? <a href={safe} {...(safe.startsWith("http") ? {target:"_blank",rel:"noopener noreferrer"} : {})}>{children}</a> : <span>{children}</span>; } }}>{doc.markdown}</ReactMarkdown>
        </article>
      </>}</div>
    </div>}
  </Shell>;
}
