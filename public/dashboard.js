import { api, esc, tierBadge, fmtPct, nav } from '/common.js';

nav('/');

const TIER_ORDER = { High: 0, Medium: 1, Low: 2 };
let cases = [];
let statuses = [];
let sort = { key: 'tier', dir: 1 };

const $ = (id) => document.getElementById(id);

function tile(label, value, sub = '') {
  return `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
}

function renderSummary(m) {
  const awaitingTenant = cases.filter((c) => ['awaiting_tenant', 'awaiting_both'].includes(c.intakeStatus)).length;
  const alerts = cases.filter((c) => c.alerts.length).length;
  $('tiles').innerHTML = [
    tile('Open cases', m.totalCases),
    tile('High potential', m.tiers.High, 'route to mediation'),
    tile('Medium potential', m.tiers.Medium, 'move-out / screening'),
    tile('Suitable for diversion', fmtPct(m.diversionSuitableRate), 'of fully scored cases'),
    tile('Tenant not responded', awaitingTenant, 'default-judgment risk'),
    tile('Staff alerts', alerts, 'interpreter / accommodation'),
  ].join('');

  const parts = [['High', 'var(--tier-high)'], ['Medium', 'var(--tier-medium)'], ['Low', 'var(--tier-low)']];
  const total = parts.reduce((s, [k]) => s + m.tiers[k], 0);
  $('tier-total').textContent = `${total} scored · ${m.totalCases - total} awaiting intake`;
  $('segbar').innerHTML = parts.filter(([k]) => m.tiers[k] > 0).map(([k, color]) => {
    const share = Math.round((m.tiers[k] / total) * 100);
    return `<span style="flex:${m.tiers[k]};background:${color}" title="${k}: ${m.tiers[k]} cases (${share}%)"></span>`;
  }).join('');
  $('segbar').setAttribute('aria-label', parts.map(([k]) => `${k}: ${m.tiers[k]}`).join(', '));
  $('legend').innerHTML = parts.map(([k, color]) =>
    `<span><i style="background:${color}"></i>${k} · ${m.tiers[k]}</span>`).join('');
}

function sortValue(c, key) {
  if (key === 'tier') return c.tier ? TIER_ORDER[c.tier] * 1000 - (c.score ?? 0) : 9000;
  if (key === 'score') return c.score ?? -1;
  if (key === 'hearing_date') return c.hearing_date || '9999';
  return c[key] ?? '';
}

function renderRows() {
  const q = $('f-search').value.trim().toLowerCase();
  const tier = $('f-tier').value;
  const status = $('f-status').value;
  const alertsOnly = $('f-alerts').checked;

  const rows = cases.filter((c) => {
    if (q && ![c.case_number, c.tenant_name, c.landlord_name, c.property_address].join(' ').toLowerCase().includes(q)) return false;
    if (tier === 'pending' ? c.tier : tier && c.tier !== tier) return false;
    if (status && c.status !== status) return false;
    if (alertsOnly && !c.alerts.length) return false;
    return true;
  }).sort((a, b) => {
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });

  const statusLabel = Object.fromEntries(statuses.map((s) => [s.value, s.label]));
  $('rows').innerHTML = rows.map((c) => `
    <tr class="clickable" data-id="${c.id}" tabindex="0">
      <td><strong>${esc(c.case_number)}</strong><div class="muted small">${esc(c.property_address || '')}</div></td>
      <td>${esc(c.tenant_name)}<div class="muted small">v. ${esc(c.landlord_name)}</div></td>
      <td>${tierBadge(c.tier, c.intakeStatus)}</td>
      <td class="num">${c.score ?? '—'}${c.tier ? '' : c.score !== null ? '<span class="muted small"> prov.</span>' : ''}</td>
      <td>${esc(c.primaryAction)}${c.alerts.map((a) => `<span class="alert-chip">${esc(a)}</span>`).join('')}</td>
      <td>${esc(c.hearing_date || '—')}</td>
      <td class="small">${esc(statusLabel[c.status] || c.status)}</td>
    </tr>`).join('');
  $('empty').hidden = rows.length > 0;
}

async function load() {
  const [list, m] = await Promise.all([api('/api/cases'), api('/api/metrics')]);
  cases = list;
  if (!statuses.length) {
    statuses = m.statuses;
    $('f-status').insertAdjacentHTML('beforeend', statuses.map((s) => `<option value="${s.value}">${esc(s.label)}</option>`).join(''));
  }
  renderSummary(m);
  renderRows();
}

for (const id of ['f-search', 'f-tier', 'f-status', 'f-alerts']) $(id).addEventListener('input', renderRows);

document.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
  const key = th.dataset.sort;
  sort = { key, dir: sort.key === key ? -sort.dir : 1 };
  renderRows();
}));

const openCase = (tr) => tr && (location.href = `/case.html?id=${tr.dataset.id}`);
$('rows').addEventListener('click', (e) => openCase(e.target.closest('tr')));
$('rows').addEventListener('keydown', (e) => { if (e.key === 'Enter') openCase(e.target.closest('tr')); });

// New case dialog
const dlg = $('new-case');
$('new-case-btn').addEventListener('click', () => {
  $('new-case-form').reset();
  $('new-case-form').filed_date.value = new Date().toISOString().slice(0, 10);
  $('new-case-errors').textContent = '';
  dlg.showModal();
});
$('new-case-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'default') return;
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    const { id } = await api('/api/cases', { method: 'POST', body });
    location.href = `/case.html?id=${id}`;
  } catch (err) {
    $('new-case-errors').textContent = err.message;
  }
});

await load().catch((e) => { document.querySelector('main').insertAdjacentHTML('afterbegin', `<p class="errors">${esc(e.message)}</p>`); });
