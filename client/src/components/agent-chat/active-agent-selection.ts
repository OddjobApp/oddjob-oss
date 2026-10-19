export function activeAgentSelectionKey(orgId: number, userId: string, roomKey: string) {
  return `crew:active-agents:${orgId}:${encodeURIComponent(userId)}:${encodeURIComponent(roomKey)}`;
}
export function loadActiveAgentSelection(key: string, allowedIds: number[]): number[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (!Array.isArray(value) || value.some(id => !Number.isInteger(id) || id < 1)) return null;
    return [...new Set<number>(value)].filter(id => allowedIds.includes(id));
  } catch { return null; }
}
