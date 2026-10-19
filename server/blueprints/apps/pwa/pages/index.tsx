import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { motion } from 'framer-motion';

// ── PWA shell — AI will replace content, manifest, and service worker ─────────

export default function Home() {
  const [isInstallable, setIsInstallable] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const handleBeforeInstall = (e: Event) => { e.preventDefault(); setDeferredPrompt(e); setIsInstallable(true); };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setIsInstallable(false);
  };

  return (
    <>
      <Head>
        <title>App</title>
        <meta name="description" content="Progressive Web App" />
        <meta name="theme-color" content="#0a0a0f" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </Head>
      <div className="min-h-screen bg-[#0a0a0f] text-white">
        <header className="sticky top-0 z-50 bg-black/60 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center justify-between">
          <span className="font-bold text-sm">App</span>
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2 py-0.5 rounded-full ${isOnline ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
              {isOnline ? 'Online' : 'Offline'}
            </span>
            {isInstallable && (
              <button onClick={handleInstall} className="text-xs bg-emerald-600 hover:bg-emerald-500 px-3 py-1 rounded-lg transition-colors">
                Install App
              </button>
            )}
          </div>
        </header>
        <main className="p-6 max-w-2xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <h1 className="text-3xl font-black mb-2">Welcome</h1>
            <p className="text-white/50 text-sm mb-8">This app works offline and can be installed on your home screen.</p>
            <div className="bg-white/5 border border-white/10 rounded-xl p-6">
              <p className="text-white/40 text-sm">App content goes here.</p>
            </div>
          </motion.div>
        </main>
      </div>
    </>
  );
}
