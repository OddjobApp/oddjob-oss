import "../styles/globals.css";
import "mapbox-gl/dist/mapbox-gl.css";
import type { AppProps } from "next/app";
import React, { Component, type ReactNode } from "react";
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="min-h-screen bg-zinc-950 text-white p-8">
        <h1 className="text-lg font-bold">
          Wayfare could not display this view
        </h1>
        <p>Your saved trip is still on the server. Reload to retry.</p>
        <button
          className="mt-4 border rounded-lg p-3"
          onClick={() => window.location.reload()}
        >
          Reload Wayfare
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
export default function App({ Component, pageProps }: AppProps) {
  return (
    <Boundary>
      <Component {...pageProps} />
    </Boundary>
  );
}
