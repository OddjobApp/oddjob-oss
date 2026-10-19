/** Focus explicit read-only app reviews on app evidence rather than unrelated admin tools. */
export const APP_REVIEW_READ_TOOLS = new Set([
  'list_installed_apps', 'read_app_records', 'read_app_activity',
]);

export function isReadOnlyAppReview(message: string): boolean {
  const request = message.split('\n\n[CREW selected Google items]\n')[0];
  return /\bread[ -]only\b/i.test(request) &&
    (/\b(?:loaded|installed|blueprint)\s+app\b/i.test(request) ||
      /\bread_app_(?:records|activity)\b/.test(request));
}
