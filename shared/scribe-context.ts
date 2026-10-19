export interface ScribeSelection {
  documentId?: number;
  branchId?: number;
  stationKey?: string;
  stationTitle?: string;
  nodeId?: number;
  excerpt?: string;
  annotationId?: number;
  title?: string;
  lensType?: string;
  critiqueBody?: string;
  proposedDiff?: string;
}

export function scribeScopePrefix(selection: ScribeSelection): string {
  if (selection.annotationId) {
    const lensStr = selection.lensType ? ` (${selection.lensType})` : '';
    const bodyStr = selection.critiqueBody ? `: "${selection.critiqueBody}"` : '';
    return `[Scribe Annotation #${selection.annotationId}${lensStr} on "${selection.stationTitle || selection.stationKey || 'Manuscript'}"${bodyStr}]`;
  }
  const stationStr = selection.stationTitle || selection.stationKey || 'Manuscript';
  const nodeStr = selection.nodeId ? ` Node #${selection.nodeId}` : '';
  const keyStr = selection.stationKey ? ` (${selection.stationKey})` : '';
  const excerptStr = selection.excerpt ? `, Excerpt: "${selection.excerpt}"` : '';
  return `[Scribe Station "${stationStr}"${keyStr}${nodeStr}${excerptStr}]`;
}
