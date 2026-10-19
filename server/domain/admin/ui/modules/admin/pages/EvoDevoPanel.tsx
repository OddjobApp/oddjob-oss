import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dna, GitBranch, History, Users, ChevronRight } from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Evo-Devo panel for the Evolution Flight Deck.
 *
 * The evo-devo engine had a complete API and no interface at all: fourteen
 * endpoints, none of them called from anywhere in the client. Lineage, stage
 * history and population membership were reachable only with curl.
 *
 * This is the read surface. Mutation stays where it is — developing a genome or
 * promoting a phenotype is an org-admin operation with real consequences, and
 * putting a "promote" button next to an audit trail invites clicking it before
 * reading it. Seeing what the system evolved is a different authority from
 * changing it, which is why the GET routes behind this are open to any member
 * of the organisation while the writes are not.
 */

/** Stage → accent. Ordered roughly by how much trust the stage implies. */
const STAGE_TONE: Record<string, string> = {
  embryonic: "border-slate-500/20 bg-slate-500/10 text-muted-foreground dark:text-muted-foreground",
  validation: "border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  differentiation: "border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  sandbox: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  shadow: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  canary: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  mature: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  suspended: "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  retired: "border-muted bg-muted/40 text-muted-foreground",
  failed: "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

const ACTION_TONE: Record<string, string> = {
  initialize: "text-muted-foreground",
  promote: "text-emerald-600 dark:text-emerald-400",
  rollback: "text-amber-600 dark:text-amber-400",
  kill: "text-rose-600 dark:text-rose-400",
  retire: "text-muted-foreground",
  fail: "text-rose-600 dark:text-rose-400",
};

interface GenomeRow {
  id: string; genomeKey: string; speciesId: string; generation: number;
  contentHash: string; createdAt: string; phenotypeCount: number;
}
interface PhenotypeRow {
  id: string; seed: number; compilerVersion: string; contentHash: string;
  createdAt: string; currentStage: string | null; evaluationCount: number;
}
interface StageEventRow {
  id: string; fromStage: string | null; toStage: string; action: string;
  evidence: Record<string, unknown>; actorId: string; createdAt: string;
}
interface PopulationRow {
  id: string; populationKey: string; speciesId: string; status: string;
  constraints: Record<string, unknown>; createdAt: string; memberCount: number;
}

function shortHash(hash: string): string {
  return hash ? hash.slice(0, 10) : "—";
}

export default function EvoDevoPanel() {
  const [selectedGenomeId, setSelectedGenomeId] = useState<string | null>(null);
  const [selectedPhenotypeId, setSelectedPhenotypeId] = useState<string | null>(null);

  const { data: genomes = [], isLoading: genomesLoading } = useQuery<GenomeRow[]>({
    queryKey: ["/api/evolution/evo-devo/genomes"],
  });

  const { data: populations = [] } = useQuery<PopulationRow[]>({
    queryKey: ["/api/evolution/evo-devo/populations"],
  });

  const { data: phenotypes = [] } = useQuery<PhenotypeRow[]>({
    queryKey: [`/api/evolution/evo-devo/genomes/${selectedGenomeId}/phenotypes`],
    enabled: !!selectedGenomeId,
  });

  const { data: history = [] } = useQuery<StageEventRow[]>({
    queryKey: [`/api/evolution/evo-devo/phenotypes/${selectedPhenotypeId}/history`],
    enabled: !!selectedPhenotypeId,
  });

  const selectedGenome = genomes.find((g) => g.id === selectedGenomeId);

  return (
    <div className="space-y-6" data-testid="evo-devo-panel">
      {/* ── Populations ─────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-wider">Populations</h2>
        </div>
        {populations.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-xs text-muted-foreground">
              No populations yet. A population is created before phenotypes can be admitted and selected.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {populations.map((p) => (
              <Card key={p.id} data-testid="evo-devo-population">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm font-semibold truncate">{p.populationKey}</CardTitle>
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider shrink-0">
                      {p.status}
                    </Badge>
                  </div>
                  <CardDescription className="text-[10px] uppercase tracking-wider">
                    {p.speciesId} · {p.memberCount} member{p.memberCount === 1 ? "" : "s"}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* ── Genomes ───────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Dna className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold uppercase tracking-wider">Genomes</h2>
          </div>

          {genomesLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : genomes.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-xs text-muted-foreground">
                No genomes registered. A founder genome is the starting point — everything else descends from one.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {genomes.map((g) => {
                const isSelected = g.id === selectedGenomeId;
                return (
                  <button
                    key={g.id}
                    type="button"
                    data-testid="evo-devo-genome"
                    onClick={() => {
                      setSelectedGenomeId(g.id);
                      setSelectedPhenotypeId(null);
                    }}
                    className={cn(
                      "w-full text-left rounded-xl border p-3 transition-colors",
                      isSelected
                        ? "border-primary/60 bg-primary/5"
                        : "border-border bg-card hover:border-primary/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{g.genomeKey}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                          {g.speciesId} · gen {g.generation} · {g.phenotypeCount} phenotype
                          {g.phenotypeCount === 1 ? "" : "s"}
                        </div>
                      </div>
                      <ChevronRight className={cn("w-4 h-4 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
                    </div>
                    {/* The content hash is the identity of the genome document.
                        Two genomes with the same hash are the same organism. */}
                    <div className="mt-2 font-mono text-[10px] text-muted-foreground/70">
                      {shortHash(g.contentHash)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Phenotypes + stage history ────────────────────────────── */}
        <section className="space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <GitBranch className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-bold uppercase tracking-wider">
                Phenotypes{selectedGenome ? ` · ${selectedGenome.genomeKey}` : ""}
              </h2>
            </div>

            {!selectedGenomeId ? (
              <Card>
                <CardContent className="py-8 text-center text-xs text-muted-foreground">
                  Select a genome to see the phenotypes it developed into.
                </CardContent>
              </Card>
            ) : phenotypes.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-xs text-muted-foreground">
                  This genome has not been developed yet.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {phenotypes.map((p) => {
                  const isSelected = p.id === selectedPhenotypeId;
                  const stage = p.currentStage ?? "uninitialised";
                  return (
                    <button
                      key={p.id}
                      type="button"
                      data-testid="evo-devo-phenotype"
                      onClick={() => setSelectedPhenotypeId(p.id)}
                      className={cn(
                        "w-full text-left rounded-xl border p-3 transition-colors",
                        isSelected
                          ? "border-primary/60 bg-primary/5"
                          : "border-border bg-card hover:border-primary/40",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          {/* Seed is part of the replay key: the same genome and
                              environment at the same seed is the same phenotype,
                              enforced by a unique index. */}
                          <div className="text-sm font-semibold">seed {p.seed}</div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                            compiler {p.compilerVersion} · {p.evaluationCount} evaluation
                            {p.evaluationCount === 1 ? "" : "s"}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] uppercase tracking-wider shrink-0", STAGE_TONE[stage] ?? "")}
                        >
                          {stage}
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <History className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-bold uppercase tracking-wider">Stage history</h2>
            </div>

            {!selectedPhenotypeId ? (
              <Card>
                <CardContent className="py-8 text-center text-xs text-muted-foreground">
                  Select a phenotype to see how it reached its current stage.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-4">
                  {/* Rendered oldest-first as a timeline. These rows are
                      immutable — the migration installs a trigger that rejects
                      UPDATE — so this is a genuine audit trail, not a status
                      field with history bolted on. */}
                  <ol className="space-y-3">
                    {history.map((event) => (
                      <li key={event.id} className="flex gap-3" data-testid="evo-devo-stage-event">
                        <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary/60" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className={cn("text-xs font-semibold uppercase tracking-wider", ACTION_TONE[event.action] ?? "")}>
                              {event.action}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {event.fromStage ? `${event.fromStage} → ` : ""}{event.toStage}
                            </span>
                          </div>
                          <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                            {event.actorId} · {new Date(event.createdAt).toLocaleString()}
                          </div>
                          {typeof (event.evidence as any)?.reason === "string" && (
                            <div className="text-[11px] text-muted-foreground mt-1">
                              {(event.evidence as any).reason}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
