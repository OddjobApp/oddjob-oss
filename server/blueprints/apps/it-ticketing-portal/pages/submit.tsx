import { useState } from "react";
import { useRouter } from "next/router";
import { motion } from "framer-motion";
import { Send, CheckCircle2 } from "lucide-react";
import Layout from "../components/Layout";
import type { TicketCategory, TicketPriority } from "./api/tickets";
import { ticketService } from "../lib/platform-client";

const CATEGORIES: TicketCategory[] = ["Hardware", "Software", "Access", "Network"];
const PRIORITIES: TicketPriority[] = ["Low", "Medium", "High"];

export default function Submit() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<TicketCategory>("Software");
  const [priority, setPriority] = useState<TicketPriority>("Medium");
  const [requester, setRequester] = useState("you@org");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [persistedSource, setPersistedSource] = useState<"platform" | "local" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!subject.trim()) {
      setError("Please enter a subject.");
      return;
    }
    setSubmitting(true);
    try {
      const { ticket, source } = await ticketService.create({
        subject,
        category,
        priority,
        details,
        requester,
      });
      setCreatedId(ticket.id);
      setPersistedSource(source);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit ticket");
    } finally {
      setSubmitting(false);
    }
  }

  if (createdId) {
    return (
      <Layout title="Submit Ticket" subtitle="Your request has been logged">
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="max-w-lg bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
          <CheckCircle2 size={40} className="text-emerald-400 mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-1">Ticket submitted</h2>
          <p className="text-sm text-white/50 mb-2">
            Your ticket <span className="font-mono text-white/80">{createdId}</span> is now stored in{" "}
            <span className="text-white/80 font-medium">
              {persistedSource === "platform" ? "organization AppRecords" : "the ticket store"}
            </span>
            .
          </p>
          <p className="text-xs text-white/40 mb-6">
            You can track status updates under My Tickets or run automated L1 triage.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button onClick={() => router.push("/tickets")} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-semibold transition-colors">
              View My Tickets
            </button>
            <button onClick={() => router.push("/agent-triage")} className="px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 rounded-xl text-sm font-semibold transition-colors">
              Open Agent Triage
            </button>
            <button
              onClick={() => {
                setCreatedId(null);
                setSubject("");
                setDetails("");
              }}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-semibold transition-colors"
            >
              Submit another
            </button>
          </div>
        </motion.div>
      </Layout>
    );
  }

  return (
    <Layout title="Submit Ticket" subtitle="Tell us what you need help with">
      <motion.form initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} onSubmit={onSubmit} className="max-w-lg space-y-5">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-white/40 mb-2">Subject</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Laptop won't connect to Wi-Fi"
            className="w-full bg-white/5 border border-white/10 focus:border-emerald-500/40 rounded-xl px-4 py-2.5 text-sm outline-none transition-colors"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-white/40 mb-2">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)} className="w-full bg-white/5 border border-white/10 focus:border-emerald-500/40 rounded-xl px-4 py-2.5 text-sm outline-none transition-colors">
              {CATEGORIES.map((c) => <option key={c} value={c} className="bg-neutral-900">{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-white/40 mb-2">Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)} className="w-full bg-white/5 border border-white/10 focus:border-emerald-500/40 rounded-xl px-4 py-2.5 text-sm outline-none transition-colors">
              {PRIORITIES.map((p) => <option key={p} value={p} className="bg-neutral-900">{p}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-white/40 mb-2">Requester Email</label>
          <input
            value={requester}
            onChange={(e) => setRequester(e.target.value)}
            placeholder="you@org"
            className="w-full bg-white/5 border border-white/10 focus:border-emerald-500/40 rounded-xl px-4 py-2.5 text-sm outline-none transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-widest text-white/40 mb-2">Details</label>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={4}
            placeholder="Describe the issue, any error messages, and steps to reproduce."
            className="w-full bg-white/5 border border-white/10 focus:border-emerald-500/40 rounded-xl px-4 py-2.5 text-sm outline-none transition-colors resize-none"
          />
        </div>

        {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}

        <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl text-sm font-semibold transition-colors">
          <Send size={15} /> {submitting ? "Submitting…" : "Submit Ticket"}
        </button>
      </motion.form>
    </Layout>
  );
}
