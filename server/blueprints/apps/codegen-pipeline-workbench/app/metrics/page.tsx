import dynamic from "next/dynamic";

const Content = dynamic(() => import("./content"), {
  ssr: false,
  loading: () => (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 text-sm text-slate-500">
      Loading quality metrics…
    </div>
  ),
});

export default function MetricsPage() {
  return <Content />;
}
