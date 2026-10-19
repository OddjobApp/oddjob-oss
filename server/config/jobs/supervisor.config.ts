export const SUPERVISOR_CONFIG = {
  useEventDriven: process.env.SUPERVISOR_EVENT_DRIVEN === 'true',
  eventTimeoutMs: 30000,
  pollingFallbackEnabled: true,
};
