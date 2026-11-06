import { api, esc, tierBadge, INTAKE_LABELS, nav } from '/common.js';

nav('');
const id = new URLSearchParams(location.search).get('id');
const $ = (sel) => document.querySelector(sel);

function answerList(role, d) {
  const intake = d.intakes[role];
  const who = role === 'tenant' ? d.case.tenant_name : d.case.landlord_name;
  const header = `<h2>${role === 'tenant' ? 'Tenant' : 'Landlord'} intake <span class="muted small">· ${esc(who)}</span></h2>`;
  const links = `<p class="small">Intake link: <code>${esc(intake.url)}</code><br>
    <a href="/notice/${d.case.id}/${role}" target="_blank">Printable notice with QR code ↗</a></p>`;
  if (!intake.answers) return `<section class="card">${header}<p class="muted">Not yet submitted.</p>${links}</section>`;

  const fmt = (q, v) => {
    if (v === undefined) return '—';
    if (q.type === 'money') return `$${Number(v).toLocaleString()}`;
    if (q.type === 'choice') return q.options.find((o) => o.value === v)?.label ?? v;
    return v;
  };
  const items = d.questions[role].flatMap((s) => s.items)
    .filter((q) => intake.answers[q.id] !== undefined)
    .map((q) => `<dt>${esc(q.label)}</dt><dd>${esc(fmt(q, intake.answers[q.id]))}</dd>`).join('');
  return `<section class="card">${header}<p class="muted small">Submitted ${esc(intake.submitted_at)} UTC</p>
    <dl class="answers">${items}</dl>${links}</section>`;
}

function render(d) {
  const { case: c, assessment: a } = d;
  const ratio = d.intakes.tenant?.answers?.rent_owed
    ? (() => {
      const t = d.intakes.tenant.answers;
      return t.amount_can_pay ? ` · tenant can pay $${t.amount_can_pay.toLocaleString()} of $${t.rent_owed.toLocaleString()} owed` : ` · $${t.rent_owed.toLocaleString()} owed`;
    })() : '';

  $('#content').innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;align-items:start">
      <div>
        <h1>${esc(c.case_number)} ${tierBadge(a.tier, a.intakeStatus)}</h1>
        <div class="muted">${esc(c.tenant_name)} (tenant) v. ${esc(c.landlord_name)} (landlord) · ${esc(c.property_address || '')}</div>
        <div class="muted small">Filed ${esc(c.filed_date)} · Hearing ${esc(c.hearing_date || 'not scheduled')}${esc(ratio)}</div>
      </div>
    </div>

    ${d.alerts.length ? `<section class="card" style="background:var(--warn-bg);color:var(--warn-ink)">
      <strong>⚠ Staff alerts</strong><ul class="actions">${d.alerts.map((x) => `<li>${esc(x.message)}</li>`).join('')}</ul></section>` : ''}

    <div class="grid-2" style="margin-top:1rem">
      <section class="card">
        <h2>Settlement assessment</h2>
        <div style="display:flex;gap:1.5rem;align-items:center">
          <div><div class="score-big">${a.score ?? '—'}</div><div class="muted small">score / 100${a.provisional && a.score !== null ? ' (provisional)' : ''}</div></div>
          <div><div class="muted small">Intake</div><strong>${esc(INTAKE_LABELS[a.intakeStatus])}</strong>
            <div class="muted small" style="margin-top:.4rem">Recommended</div><strong>${esc(a.primaryAction)}</strong></div>
        </div>
        <h3>Recommended actions</h3>
        <ul class="actions">${a.actions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <h3>Why this score (rules that fired)</h3>
        ${a.rules.length ? a.rules.map((r) => `<div class="rule"><span>${esc(r.label)}</span>
          <span class="pts ${r.points < 0 ? 'neg' : ''}">${r.points > 0 ? '+' : '−'}${Math.abs(r.points)}</span></div>`).join('')
          : '<p class="muted small">No rules fired yet.</p>'}
        ${a.rawScore !== a.score && a.score !== null ? `<p class="muted small">Raw total ${a.rawScore}, clamped to 0–100.</p>` : ''}
        <p class="disclaimer">This assessment helps staff allocate mediation and assistance resources. It is not a judicial determination and does not affect any party's right to a hearing. <a href="/rules.html">See all rules</a>.</p>
      </section>

      <section class="card">
        <h2>Case workflow</h2>
        <div class="form-grid">
          <label class="full">Status <select id="status">${d.statuses.map((s) =>
            `<option value="${s.value}" ${s.value === c.status ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
          <label class="full">Hearing date <input type="date" id="hearing" value="${esc(c.hearing_date || '')}"></label>
          <label class="full">Staff notes <textarea id="notes">${esc(c.notes)}</textarea></label>
        </div>
        <div style="display:flex;gap:.5rem;margin-top:.75rem;flex-wrap:wrap">
          <button class="primary" id="save">Save</button>
          ${a.intakeStatus !== 'complete' ? '<button id="remind">Send intake reminder</button>' : ''}
          <span id="save-msg" class="muted small" style="align-self:center"></span>
        </div>
        <h3>Referrals</h3>
        ${d.referrals.length ? `<ul class="actions">${d.referrals.map((p) =>
          `<li><strong>${esc(p.name)}</strong> <span class="muted small">(${esc(p.type)} · for ${esc(p.audience)})</span><br>
           <span class="small">${esc(p.contact)}</span></li>`).join('')}</ul>` : '<p class="muted small">No matching programs yet.</p>'}
        <h3>Activity</h3>
        <ul class="timeline actions">${d.events.map((e) => `<li><span class="muted">${esc(e.created_at)}</span> — ${esc(e.detail)}</li>`).join('')}</ul>
      </section>
    </div>

    <div class="grid-2">${answerList('tenant', d)}${answerList('landlord', d)}</div>

    <section class="card">
      <h2>Messages sent <span class="muted small">(simulated — see outbox)</span></h2>
      <table><thead><tr><th>When</th><th>To</th><th>Channel</th><th>Recipient</th></tr></thead><tbody>
      ${d.notifications.map((n) => `<tr><td class="small">${esc(n.created_at)}</td><td>${esc(n.role)}</td><td>${esc(n.channel)}</td><td class="small">${esc(n.recipient)}</td></tr>`).join('')}
      </tbody></table>
    </section>`;

  $('#save').addEventListener('click', async () => {
    try {
      await api(`/api/cases/${id}`, { method: 'PATCH', body: { status: $('#status').value, notes: $('#notes').value, hearing_date: $('#hearing').value } });
      await load();
      $('#save-msg').textContent = 'Saved.';
    } catch (e) { $('#save-msg').textContent = e.message; }
  });
  $('#remind')?.addEventListener('click', async () => {
    const r = await api(`/api/cases/${id}/remind`, { method: 'POST' });
    await load();
    $('#save-msg').textContent = `${r.sent} reminder(s) queued for ${r.roles.join(' & ')}.`;
  });
}

async function load() {
  const d = await api(`/api/cases/${id}`);
  document.title = `${d.case.case_number} · Eviction Diversion Detector`;
  render(d);
}
await load().catch((e) => { $('#content').innerHTML = `<p class="errors">${esc(e.message)}</p>`; });
