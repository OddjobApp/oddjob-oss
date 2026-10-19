/**
 * Mission Synthesizer
 * 
 * Phase 2 PMI UI: Natural language input for generating mission candidates.
 * Integrates with Armory mission builder.
 */

import React, { useState } from "react";
import {
  Box,
  Button,
  TextField,
  Typography,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Alert,
  Slider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Tooltip
} from "@mui/material";
import {
  AutoFixHigh as AIIcon,
  Close as CloseIcon,
  TrendingUp as ScoreIcon,
  Timer as LatencyIcon,
  AttachMoney as CostIcon,
  Psychology as ReasoningIcon
} from "@mui/icons-material";
import type { BlueprintCandidateClient as BlueprintCandidate } from "@shared/schema/gms/client-types";

interface MissionSynthesizerProps {
  open: boolean;
  onClose: () => void;
  onSelectCandidate: (candidate: BlueprintCandidate) => void;
}

interface SynthesisState {
  loading: boolean;
  candidates: BlueprintCandidate[];
  error: string | null;
}

export const MissionSynthesizer: React.FC<MissionSynthesizerProps> = ({
  open,
  onClose,
  onSelectCandidate
}) => {
  const [request, setRequest] = useState("");
  const [nCandidates, setNCandidates] = useState(5);
  const [complexity, setComplexity] = useState<"simple" | "medium" | "complex">("medium");
  const [state, setState] = useState<SynthesisState>({
    loading: false,
    candidates: [],
    error: null
  });

  const handleSynthesize = async () => {
    if (!request.trim()) return;

    setState({ loading: true, candidates: [], error: null });

    try {
      const response = await fetch("/api/gms/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request,
          nCandidates,
          context: { complexity }
        })
      });

      if (!response.ok) throw new Error("Synthesis failed");

      const data = await response.json();
      setState({
        loading: false,
        candidates: data.candidates,
        error: null
      });
    } catch (err) {
      setState({
        loading: false,
        candidates: [],
        error: err instanceof Error ? err.message : "Unknown error"
      });
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 0.8) return "success";
    if (score >= 0.6) return "warning";
    return "error";
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}>
          <AIIcon color="primary" />
          <Typography variant="h6">AI Mission Synthesizer</Typography>
        </Box>
        <IconButton
          onClick={onClose}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Describe what you want to accomplish. The AI will generate multiple mission
            approaches with predicted success rates.
          </Typography>

          <TextField
            fullWidth
            multiline
            rows={3}
            label="Mission Request"
            placeholder="E.g., Analyze Q3 customer churn data and generate retention campaigns..."
            value={request}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRequest(e.target.value)}
            sx={{ mb: 2 }}
          />

          <Box sx={{ display: 'flex', flexDirection: 'row', gap: 2, alignItems: 'center' }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="caption" gutterBottom>
                Candidates to Generate: {nCandidates}
              </Typography>
              <Slider
                value={nCandidates}
                onChange={(_: any, v: number | number[]) => setNCandidates(v as number)}
                min={3}
                max={15}
                step={1}
                marks={[{ value: 3, label: "3" }, { value: 15, label: "15" }]}
              />
            </Box>

            <FormControl sx={{ minWidth: 120 }}>
              <InputLabel>Complexity</InputLabel>
              <Select
                value={complexity}
                onChange={(e: any) => setComplexity(e.target.value as typeof complexity)}
                label="Complexity"
              >
                <MenuItem value="simple">Simple</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="complex">Complex</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </Box>

        {state.error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {state.error}
          </Alert>
        )}

        {state.loading && (
          <Box sx={{ textAlign: "center", py: 4 }}>
            <CircularProgress size={48} sx={{ mb: 2 }} />
            <Typography color="text.secondary">
              Generating mission candidates with PMI...
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Counterfactual simulation in progress
            </Typography>
          </Box>
        )}

        {state.candidates.length > 0 && (
          <Box>
            <Typography variant="h6" gutterBottom>
              Generated Candidates ({state.candidates.length})
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {state.candidates.map((candidate, idx) => {
                const score = candidate.verifierScore?.successProbability || 0;
                const latency = candidate.verifierScore?.latencyEstimate || 0;
                const cost = candidate.verifierScore?.costEstimate || 0;

                return (
                  <Card
                    key={candidate.id}
                    variant="outlined"
                    sx={{
                      cursor: "pointer",
                      transition: "all 0.2s",
                      "&:hover": { boxShadow: 3 }
                    }}
                    onClick={() => onSelectCandidate(candidate)}
                  >
                    <CardContent>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box sx={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 'medium' }}>
                            #{idx + 1} {candidate.blueprint.name}
                          </Typography>
                          <Chip
                            icon={<ScoreIcon />}
                            label={`${(score * 100).toFixed(0)}%`}
                            color={getScoreColor(score) as any}
                            size="small"
                          />
                        </Box>

                        <Typography variant="body2" color="text.secondary">
                          {candidate.blueprint.description}
                        </Typography>

                        <Box sx={{ display: 'flex', flexDirection: 'row', gap: 1, flexWrap: 'wrap' }}>
                          <Tooltip title="Predicted latency">
                            <Chip
                              icon={<LatencyIcon />}
                              label={`${(latency / 1000).toFixed(1)}s`}
                              size="small"
                              variant="outlined"
                            />
                          </Tooltip>
                          <Tooltip title="Estimated cost">
                            <Chip
                              icon={<CostIcon />}
                              label={`$${cost.toFixed(3)}`}
                              size="small"
                              variant="outlined"
                            />
                          </Tooltip>
                          <Tooltip title="Reasoning depth">
                            <Chip
                              icon={<ReasoningIcon />}
                              label={`${candidate.blueprint.reasoningConfig.depth} loops`}
                              size="small"
                              variant="outlined"
                            />
                          </Tooltip>
                          <Chip
                            label={`${candidate.blueprint.steps.length} steps`}
                            size="small"
                            variant="outlined"
                          />
                          <Chip
                            label={`${candidate.blueprint.agents.length} agents`}
                            size="small"
                            variant="outlined"
                          />
                        </Box>

                        {candidate.generation.mutations.length > 0 && (
                          <Typography variant="caption" color="text.secondary">
                            Mutations: {candidate.generation.mutations.map(m => m.type).join(", ")}
                          </Typography>
                        )}
                      </Box>
                    </CardContent>
                  </Card>
                );
              })}
            </Box>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSynthesize}
          disabled={!request.trim() || state.loading}
          startIcon={state.loading ? <CircularProgress size={20} /> : <AIIcon />}
        >
          {state.loading ? "Synthesizing..." : "Generate Missions"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MissionSynthesizer;
