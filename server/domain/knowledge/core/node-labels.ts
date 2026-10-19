/**
 * Canonical Knowledge Graph node labels.
 *
 * Labels are free-form strings in the DB, but centralising them here ensures
 * consistent spelling across ingestion, extraction, and question-engine code,
 * and allows the UI to offer a complete filter set without hard-coding strings
 * in the client.
 */

export const KNOWLEDGE_NODE_LABELS = [
  "System Entity",
  "Infrastructure",
  "Code Pattern",
  "Architecture",
  "Lesson Learned",
  "Verified Convention",  // Human-approved answers from the Question Engine
  "Jira Issue",
  "Confluence Page",
  "Slack Message",
  "User",
  "Error",
  "Documentation",
] as const;

export type KnowledgeNodeLabel = typeof KNOWLEDGE_NODE_LABELS[number];
