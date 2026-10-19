/** Presentation only: embedded workbenches use CREW's chat and activity feed. */
const assistantPanel = '[data-workbench-agent-chat],.shadow-2xl:has(input[placeholder="Ask the agent a question..."]),.shadow-2xl:has(input[placeholder="Agent not available..."])';
const assistantEvidence = '[data-workbench-agent-chat],.shadow-2xl input[placeholder="Ask the agent a question..."],.shadow-2xl input[placeholder="Agent not available..."]';
export const CREW_APP_PRESENTATION_CSS = '[aria-label="Activity feed"],button[aria-label="Open activity feed"]{display:none!important}'
  + assistantPanel + '{display:none!important}'
  + '.grid:has(' + assistantEvidence + '){grid-template-columns:minmax(0,1fr)!important}'
  + '.grid:has(' + assistantEvidence + ')>div{grid-column:1/-1!important}'
  + '.grid>div:has(' + assistantEvidence + '){display:none!important}';
