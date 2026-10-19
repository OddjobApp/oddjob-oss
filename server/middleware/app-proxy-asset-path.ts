/** Remove the host proxy prefix before requesting a Next.js asset upstream. */
export function appProxyAssetPath(path: string): string {
  return path.replace(/^\/(?:forged|app)\/[^/]+(?=\/_next\/)/, '');
}
