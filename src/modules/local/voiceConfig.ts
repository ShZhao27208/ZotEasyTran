/** Pure voice-service config helpers (safe to unit test without Zotero). */

/** Resolve the service fragment interval: explicit pref > voice.json > 0.08. */
export function resolveFragmentInterval(
  profileValue?: number,
  prefValue?: string,
): number {
  const prefText = String(prefValue ?? "").trim();
  if (prefText) {
    const value = Number(prefText);
    return Number.isFinite(value) && value >= 0 ? value : 0.08;
  }
  const value = Number(profileValue);
  return Number.isFinite(value) && value >= 0 ? value : 0.08;
}
