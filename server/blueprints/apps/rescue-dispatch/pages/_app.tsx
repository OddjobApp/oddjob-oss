import "../styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect, Component, type ReactNode, type ErrorInfo } from "react";

interface EBState { hasError: boolean; error?: Error }
class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { hasError: false };
  static getDerivedStateFromError(error: Error): EBState { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    fetch("/api/report-error", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "react-error", message: error.message, stack: error.stack, componentStack: info.componentStack }) }).catch(() => {});
  }
  render() {
    if (this.state.hasError) return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-white">
        <div className="text-center p-8 bg-white/5 border border-white/10 rounded-2xl max-w-md">
          <div className="text-rose-400 text-4xl mb-4">&#9888;</div>
          <h2 className="text-lg font-bold mb-2">Something went wrong</h2>
          <p className="text-sm text-white/50 mb-4">{this.state.error?.message ?? "An unexpected error occurred."}</p>
          <button onClick={() => this.setState({ hasError: false })} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-medium transition-colors">Try again</button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    const report = (d: object) => fetch("/api/report-error", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }).catch(() => {});
    const onError = (e: ErrorEvent) => report({ type: "error", message: e.message, source: e.filename, line: e.lineno, stack: e.error?.stack });
    const onUnhandled = (e: PromiseRejectionEvent) => report({ type: "unhandledrejection", message: String(e.reason), stack: e.reason?.stack });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onUnhandled); };
  }, []);
  return <ErrorBoundary><Component {...pageProps} /></ErrorBoundary>;
}
