/** Normalizes the version string reported by the API (used by /api/health later). */
export function formatVersion(version: string): string {
  const trimmed = version.trim();
  return trimmed === "" ? "unknown" : trimmed;
}
