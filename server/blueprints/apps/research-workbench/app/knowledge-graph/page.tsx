"use client";

import dynamic from "next/dynamic";

const Content = dynamic(() => import("./content"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-[#090d16] p-6 text-slate-500">
      Loading knowledge graph...
    </div>
  ),
});

export default function KnowledgeGraphPage() {
  return <Content />;
}
