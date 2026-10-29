export const safeJson = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };
export const iso = () => new Date().toISOString();
export const clamp = (n, low, high) => Math.min(high, Math.max(low, Number(n) || 0));
export function allowedMonitorURL(input) {
  try {
    const url = new URL(String(input));
    if (url.protocol !== 'https:' || url.port && url.port !== '443') return false;
    const h = url.hostname.toLowerCase().replace(/\.$/, '');
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.test') || h.endsWith('.invalid')) return false;
    if (!h.includes('.') || h.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || /^0x/.test(h) || h.includes('%')) return false;
    if (url.username || url.password || url.hash) return false;
    return true;
  } catch { return false; }
}
export function classifyProviderFailure(status, message = '') {
  const s = String(message).toLowerCase();
  if (status === 402 || /credit_balance_exhausted|insufficient_quota|quota exhausted|quota exceeded|exceeded your current quota|trial expired|balance exhausted|resource_exhausted/.test(s)) return 'exhausted';
  if (status === 401 || status === 403) return 'invalid';
  if (status === 429) return 'cooldown';
  return 'temporary';
}
export function candidateProviders(rows, kind, zeroSpend = true) {
  const now = Date.now();
  return rows.filter(p => p.kind === kind && p.enabled && p.state === 'ready' &&
    (!zeroSpend || ((p.plan === 'free' || p.plan === 'trial') && p.free_verified)) &&
    (p.quota_units === null || Number(p.used_units) < Number(p.quota_units)) &&
    (!p.quota_reset_at || Date.parse(p.quota_reset_at) > now || (p.quota_units === null || Number(p.used_units) < Number(p.quota_units)))
  ).sort((a,b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));
}
export function xmlSafe(v) { return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;'); }
export function normalizeAction(v) {
  const a = String(v || '').toLowerCase().trim();
  return ['diagnose','open_pr','retry_build'].includes(a) ? a : null;
}
