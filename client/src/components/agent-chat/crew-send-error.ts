/**
 * Maps a failed crew round to the line the user reads.
 *
 * Lives in its own module rather than in AgentChatPanel.tsx: a non-component export in
 * a component file breaks React Fast Refresh, and Vite responded with
 * "hmr invalidate ... Could not Fast Refresh (new export)" followed by a full module
 * graph swap — during which a lazily-imported route failed with "Failed to fetch
 * dynamically imported module". Keeping component files exporting only components
 * keeps HMR surgical.
 */

/**
 * Branches on the status the server actually sent, not on text inside the message.
 * apiRequest throws a ClientAppError carrying statusCode and code, and it REPLACES the
 * message with the server's prose — so the previous `msg.includes('429')` and
 * `msg.includes('503')` tests could never match: "Please wait before sending another
 * message." contains no "429". Every structured failure therefore collapsed into one
 * generic line, and two unrelated faults — an organization with no model binding, and a
 * room with no crew members — were indistinguishable in the UI even though the server
 * had named both precisely.
 *
 * 4xx messages are the server telling the user something they can act on, so they are
 * shown verbatim. 5xx prose is kept only as a fallback, since it may be an internal
 * detail rather than something a user can do anything about.
 */
export function crewSendErrorMessage(err: unknown): string {
  const status = (err as { statusCode?: number } | null)?.statusCode;
  const serverMessage = err instanceof Error && err.message ? err.message : '';

  if (status === 429) return 'The crew is still finishing the last round — try again in a moment.';
  if (serverMessage && typeof status === 'number' && status >= 400 && status < 500) return serverMessage;
  if (status === 503) return serverMessage || 'No model provider is currently available. Please retry.';
  return 'The crew could not respond. Please try again.';
}

