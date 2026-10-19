/**
 * Shadow Dashboard
 * 
 * Phase 3 UI: Monitor active shadow validations and ground truth metrics.
 * Shows real-time sandbox execution status.
 */

import React, { useState, useEffect } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  LinearProgress,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  Alert,
  Divider
} from "@mui/material";
import {
  CheckCircle as SuccessIcon,
  Error as FailIcon,
  Pending as PendingIcon,
  Refresh as RefreshIcon,
  Assessment as MetricsIcon,
  Science as SandboxIcon,
  TrendingUp as TrendIcon
} from "@mui/icons-material";

interface ShadowRun {
  batchId: string;
  candidateId: string;
  candidateName: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  variationsTotal: number;
  variationsCompleted: number;
  startTime: Date;
  estimatedEnd?: Date;
  result?: {
    successRate: number;
    recommendation: "proceed" | "revise" | "reject";
    avgLatency: number;
    totalCost: number;
  };
}

interface GroundTruthMetrics {
  totalObservations: number;
  avgPredictionError: number;
  withinConfidenceRate: number;
  highSurpriseCount: number;
  calibration: {
    meanAbsoluteError: number;
    driftDetected: boolean;
  };
}

export const ShadowDashboard: React.FC = () => {
  const [runs, setRuns] = useState<ShadowRun[]>([]);
  const [metrics, setMetrics] = useState<GroundTruthMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [runsRes, metricsRes] = await Promise.all([
        fetch("/api/gms/shadow/runs"),
        fetch("/api/gms/shadow/metrics")
      ]);

      if (runsRes.ok) setRuns(await runsRes.json());
      if (metricsRes.ok) setMetrics(await metricsRes.json());
      setError(null);
    } catch (err) {
      setError("Failed to fetch shadow data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000); // Poll every 15s
    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = (status: ShadowRun["status"]) => {
    switch (status) {
      case "completed":
        return <SuccessIcon color="success" />;
      case "failed":
        return <FailIcon color="error" />;
      case "running":
        return <PendingIcon color="primary" />;
      default:
        return <PendingIcon color="disabled" />;
    }
  };

  const getRecommendationColor = (
    rec: "proceed" | "revise" | "reject"
  ) => {
    switch (rec) {
      case "proceed":
        return "success";
      case "revise":
        return "warning";
      case "reject":
        return "error";
    }
  };

  const activeRuns = runs.filter((r) => r.status === "running" || r.status === "pending");
  const completedRuns = runs.filter((r) => r.status === "completed");

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Loading shadow validation data...</Typography>
        <LinearProgress sx={{ mt: 2 }} />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}>
          <SandboxIcon color="primary" />
          <Typography variant="h5">Shadow Validation Dashboard</Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton onClick={fetchData}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Ground Truth Metrics */}
      {metrics && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1, mb: 2 }}>
              <MetricsIcon color="primary" />
              <Typography variant="h6">Ground Truth Metrics</Typography>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr 1fr' }, gap: 3 }}>
              <Box>
                <Typography variant="h4">{metrics.totalObservations}</Typography>
                <Typography variant="body2" color="text.secondary">
                  Total Observations
                </Typography>
              </Box>
              <Box>
                <Typography variant="h4">
                  {(metrics.avgPredictionError * 100).toFixed(1)}%
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Avg Prediction Error
                </Typography>
              </Box>
              <Box>
                <Typography variant="h4">
                  {(metrics.withinConfidenceRate * 100).toFixed(0)}%
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Within Confidence
                </Typography>
              </Box>
              <Box>
                <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1 }}>
                  <TrendIcon color={metrics.calibration.driftDetected ? "error" : "success"} />
                  <Typography variant="body2">
                    {metrics.calibration.driftDetected ? "Drift Detected" : "Calibrated"}
                  </Typography>
                </Box>
              </Box>
            </Box>

            {metrics.highSurpriseCount > 0 && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                {metrics.highSurpriseCount} high-surprise predictions detected.
                Verifier may need retraining.
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Active Runs */}
      {activeRuns.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Active Shadow Runs ({activeRuns.length})
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {activeRuns.map((run) => (
                <Box key={run.batchId}>
                  <Box sx={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography sx={{ fontWeight: 'medium' }}>{run.candidateName}</Typography>
                    <Chip
                      icon={getStatusIcon(run.status)}
                      label={run.status}
                      size="small"
                      color={run.status === "running" ? "primary" : "default"}
                    />
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={run.progress}
                    sx={{ mt: 1 }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {run.variationsCompleted} / {run.variationsTotal} variations completed
                  </Typography>
                </Box>
              ))}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Completed Runs Table */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Recent Shadow Runs ({completedRuns.length})
          </Typography>

          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Candidate</TableCell>
                  <TableCell>Success Rate</TableCell>
                  <TableCell>Recommendation</TableCell>
                  <TableCell>Latency</TableCell>
                  <TableCell>Cost</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {completedRuns.map((run) => (
                  <TableRow key={run.batchId}>
                    <TableCell>{run.candidateName}</TableCell>
                    <TableCell>
                      {run.result
                        ? `${(run.result.successRate * 100).toFixed(0)}%`
                        : "N/A"}
                    </TableCell>
                    <TableCell>
                      {run.result && (
                        <Chip
                          label={run.result.recommendation}
                          color={getRecommendationColor(run.result.recommendation) as any}
                          size="small"
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {run.result
                        ? `${(run.result.avgLatency / 1000).toFixed(1)}s`
                        : "N/A"}
                    </TableCell>
                    <TableCell>
                      {run.result ? `$${run.result.totalCost.toFixed(3)}` : "N/A"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
};

export default ShadowDashboard;
