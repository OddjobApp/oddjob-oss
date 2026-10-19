/**
 * Skill Library Browser
 * 
 * Phase 4 UI: Browse, search, and manage the skill registry.
 * Shows skill lineage, statistics, and evolution history.
 */

import React, { useState, useEffect } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Chip,
  Grid,
  IconButton,
  Tooltip,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Pagination,
  LinearProgress,
  Alert,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon
} from "@mui/material";
import {
  Search as SearchIcon,
  TrendingUp as SuccessIcon,
  TrendingDown as FailIcon,
  Science as ExperimentIcon,
  AccountTree as LineageIcon,
  FitnessCenter as EvolutionIcon,
  CheckCircle as ValidatedIcon,
  Warning as WarningIcon,
  Close as CloseIcon,
  Visibility as ViewIcon
} from "@mui/icons-material";
import type { Skill, SkillComposition } from "../../../../../server/core/gms/common/types.ts";

interface SkillSearchResult {
  skill: Skill;
  similarity: number;
  matchReasons: string[];
}

interface SkillLibraryProps {
  onSelectSkill?: (skill: Skill) => void;
  onComposeSkills?: (skillIds: string[]) => void;
}

export const SkillLibrary: React.FC<SkillLibraryProps> = ({
  onSelectSkill,
  onComposeSkills
}) => {
  const [skills, setSkills] = useState<SkillSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [minSuccessRate, setMinSuccessRate] = useState<number>(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [stats, setStats] = useState<{
    totalSkills: number;
    byGeneration: Record<number, number>;
    avgSuccessRate: number;
  } | null>(null);

  const pageSize = 12;

  const fetchSkills = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        q: query,
        minSuccessRate: minSuccessRate.toString(),
        tags: selectedTags.join(","),
        limit: "50"
      });

      const response = await fetch(`/api/gms/skills/search?${params}`);
      if (!response.ok) throw new Error("Failed to fetch skills");

      const data = await response.json();
      setSkills(data.results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch("/api/gms/skills/stats");
      if (response.ok) setStats(await response.json());
    } catch {
      // Silently fail for stats
    }
  };

  useEffect(() => {
    fetchSkills();
    fetchStats();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(fetchSkills, 300);
    return () => clearTimeout(timeout);
  }, [query, minSuccessRate, selectedTags]);

  const getHealthStatus = (skill: Skill) => {
    const successRate = skill.productionStats.successfulRuns / (skill.productionStats.totalRuns || 1);
    const expectedRate = skill.shadowResult.successRate;
    const degradation = expectedRate - successRate;

    if (degradation > 0.15) return { status: "needs_evolution", color: "error" as const };
    if (degradation > 0.08) return { status: "degraded", color: "warning" as const };
    if (successRate < 0.5) return { status: "poor", color: "error" as const };
    return { status: "healthy", color: "success" as const };
  };

  const paginatedSkills = skills.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.ceil(skills.length / pageSize);

  const allTags = Array.from(new Set(skills.flatMap((s) => s.skill.tags)));

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, mb: 3 }}>
        <ExperimentIcon color="primary" sx={{ fontSize: 32 }} />
        <Box>
          <Typography variant="h4">Skill Library</Typography>
          <Typography variant="body2" color="text.secondary">
            {stats
              ? `${stats.totalSkills} skills • ${(stats.avgSuccessRate * 100).toFixed(0)}% avg success`
              : "Loading stats..."}
          </Typography>
        </Box>
      </Box>

      {/* Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '4fr 3fr 5fr' }, gap: 2, alignItems: 'center' }}>
            <Box>
              <TextField
                variant="outlined"
                fullWidth
                placeholder="Search skills..."
                value={query}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon />
                      </InputAdornment>
                    )
                  }
                }}
              />
            </Box>
            <Box>
              <FormControl fullWidth>
                <InputLabel>Min Success Rate</InputLabel>
                <Select
                  value={minSuccessRate}
                  onChange={(e: any) => setMinSuccessRate(Number(e.target.value))}
                  label="Min Success Rate"
                >
                  <MenuItem value={0}>Any</MenuItem>
                  <MenuItem value={0.7}>70%+</MenuItem>
                  <MenuItem value={0.8}>80%+</MenuItem>
                  <MenuItem value={0.9}>90%+</MenuItem>
                </Select>
              </FormControl>
            </Box>
            <Box>
              <Box sx={{ display: 'flex', flexDirection: 'row', gap: 1, flexWrap: 'wrap' }}>
                {allTags.slice(0, 5).map((tag) => (
                  <Chip
                    key={tag}
                    label={tag}
                    size="small"
                    onClick={() =>
                      setSelectedTags((prev) =>
                        prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                      )
                    }
                    color={selectedTags.includes(tag) ? "primary" : "default"}
                  />
                ))}
              </Box>
            </Box>
          </Box>
        </CardContent>
      </Card>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Skill Grid */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 2 }}>
        {paginatedSkills.map(({ skill, similarity }) => {
          const health = getHealthStatus(skill);
          const successRate = skill.productionStats.successfulRuns / (skill.productionStats.totalRuns || 1);

          return (
            <Box key={skill.id}>
              <Card
                sx={{
                  height: "100%",
                  cursor: onSelectSkill ? "pointer" : "default",
                  transition: "all 0.2s",
                  "&:hover": onSelectSkill ? { boxShadow: 4 } : {}
                }}
                onClick={() => onSelectSkill?.(skill)}
              >
                <CardContent>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Typography variant="h6" noWrap sx={{ maxWidth: "70%" }}>
                        {skill.name}
                      </Typography>
                      <Tooltip title={`Health: ${health.status}`}>
                        <ValidatedIcon color={health.color} fontSize="small" />
                      </Tooltip>
                    </Box>

                    <Typography variant="body2" color="text.secondary" noWrap>
                      {skill.description}
                    </Typography>

                    <Box sx={{ flexDirection: 'row', alignItems: 'center', gap: 1, display: 'flex' }}>
                      <Chip
                        icon={successRate >= 0.5 ? <SuccessIcon /> : <FailIcon />}
                        label={`${(successRate * 100).toFixed(0)}%`}
                        size="small"
                        color={successRate >= 0.8 ? "success" : successRate >= 0.6 ? "warning" : "error"}
                      />
                      <Chip
                        icon={<ExperimentIcon />}
                        label={`Gen ${skill.generation}`}
                        size="small"
                        variant="outlined"
                      />
                      <Tooltip title={`${skill.usageCount} uses`}>
                        <Typography variant="caption" color="text.secondary">
                          {skill.usageCount} uses
                        </Typography>
                      </Tooltip>
                    </Box>

                    <Box sx={{ mt: 1 }}>
                      {skill.tags.slice(0, 3).map((tag) => (
                        <Chip key={tag} label={tag} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
                      ))}
                    </Box>

                    {similarity > 0 && (
                      <Typography variant="caption" color="primary">
                        {(similarity * 100).toFixed(0)}% match
                      </Typography>
                    )}

                    <Box sx={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
                      <Tooltip title="View details">
                        <IconButton
                          size="small"
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            setSelectedSkill(skill);
                          }}
                        >
                          <ViewIcon />
                        </IconButton>
                      </Tooltip>
                      {skill.parentIds.length > 0 && (
                        <Tooltip title={`Evolved from ${skill.parentIds.length} parent(s)`}>
                          <EvolutionIcon fontSize="small" color="action" />
                        </Tooltip>
                      )}
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Box>
          );
        })}
      </Box>

      {/* Pagination */}
      {totalPages > 1 && (
        <Box sx={{ mt: 3, display: "flex", justifyContent: "center" }}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_: any, p: number) => setPage(p)}
            color="primary"
          />
        </Box>
      )}

      {/* Skill Detail Dialog */}
      <Dialog
        open={!!selectedSkill}
        onClose={() => setSelectedSkill(null)}
        maxWidth="md"
        fullWidth
      >
        {selectedSkill && (
          <>
            <DialogTitle>
              <Box sx={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">{selectedSkill.name}</Typography>
                <IconButton onClick={() => setSelectedSkill(null)}>
                  <CloseIcon />
                </IconButton>
              </Box>
            </DialogTitle>
            <DialogContent>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography>{selectedSkill.description}</Typography>

                <Divider />

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: '1fr 1fr 1fr 1fr' }, gap: 2 }}>
                  <Box>
                    <Typography variant="h6">
                      {selectedSkill.productionStats.totalRuns}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Total Runs
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="h6">
                      {(
                        (selectedSkill.productionStats.successfulRuns /
                          (selectedSkill.productionStats.totalRuns || 1)) *
                        100
                      ).toFixed(0)}
                      %
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Success Rate
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="h6">{selectedSkill.generation}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Generation
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="h6">{selectedSkill.usageCount}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Total Uses
                    </Typography>
                  </Box>
                </Box>

                <Divider />

                <Typography variant="subtitle2">Tags</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'row', gap: 1, flexWrap: 'wrap' }}>
                  {selectedSkill.tags.map((tag) => (
                    <Chip key={tag} label={tag} />
                  ))}
                </Box>

                {selectedSkill.parentIds.length > 0 && (
                  <>
                    <Typography variant="subtitle2">Lineage</Typography>
                    <List dense>
                      {selectedSkill.evolutionLineage.map((id, idx) => (
                        <ListItem key={id}>
                          <ListItemIcon>
                            {idx === selectedSkill.evolutionLineage.length - 1 ? (
                              <ValidatedIcon color="primary" />
                            ) : (
                              <LineageIcon />
                            )}
                          </ListItemIcon>
                          <ListItemText
                            primary={id}
                            secondary={idx === selectedSkill.evolutionLineage.length - 1 ? "Current" : "Ancestor"}
                          />
                        </ListItem>
                      ))}
                    </List>
                  </>
                )}

                {selectedSkill.mutations.length > 0 && (
                  <>
                    <Typography variant="subtitle2">Mutations</Typography>
                    <List dense>
                      {selectedSkill.mutations.map((mutation, idx) => (
                        <ListItem key={idx}>
                          <ListItemText
                            primary={mutation.type}
                            secondary={mutation.description}
                          />
                        </ListItem>
                      ))}
                    </List>
                  </>
                )}
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSelectedSkill(null)}>Close</Button>
              {onComposeSkills && (
                <Button
                  variant="contained"
                  onClick={() => {
                    onComposeSkills([selectedSkill.id]);
                    setSelectedSkill(null);
                  }}
                >
                  Use in Mission
                </Button>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
};

export default SkillLibrary;
