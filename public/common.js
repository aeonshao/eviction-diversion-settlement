// Shared helpers for clerk-facing pages.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || (data.errors || []).join(', ') || res.statusText), { data });
  return data;
}

export const INTAKE_LABELS = {
  complete: 'Both responded',
  awaiting_tenant: 'Awaiting tenant',
  awaiting_landlord: 'Awaiting landlord',
  awaiting_both: 'Awaiting both',
};

export function tierBadge(tier, intakeStatus) {
  if (tier) return `<span class="tier ${esc(tier)}">${esc(tier)}</span>`;
  return `<span class="tier pending">${esc(INTAKE_LABELS[intakeStatus] || 'Pending')}</span>`;
}

export const fmtPct = (v) => (v === null || v === undefined ? '—' : `${v}%`);

export function nav(active) {
  const links = [['/', 'Case queue'], ['/metrics.html', 'Program metrics'], ['/outbox.html', 'Notification outbox'], ['/rules.html', 'Scoring rules']];
  document.body.insertAdjacentHTML('afterbegin', `
    <header class="top">
      <span class="brand">Eviction Diversion Detector</span>
      <nav>${links.map(([href, label]) => `<a href="${href}" class="${href === active ? 'active' : ''}">${label}</a>`).join('')}</nav>
    </header>`);
}
