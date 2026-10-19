import dynamic from "next/dynamic";

const Content = dynamic(() => import("./content"), {
  ssr: false,
  loading: () => (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 text-sm text-slate-500">
      Loading pipeline sessions…
    </div>
  ),
});

export default function PipelinePage() {
  return <Content />;
}
