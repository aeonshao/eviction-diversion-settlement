// Party-facing intake form. Rendered from the question definitions the server sends.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const token = location.pathname.split('/').pop();
const root = document.getElementById('content');
let data;

function questionHtml(q, prev) {
  const v = prev?.[q.id];
  const showIf = q.showIf ? ` data-show-if='${esc(JSON.stringify(q.showIf))}'` : '';
  let control;
  if (q.type === 'choice') {
    control = `<div class="choices" role="radiogroup">${q.options.map((o) => `
      <label><input type="radio" name="${q.id}" value="${esc(o.value)}" ${v === o.value ? 'checked' : ''}>${esc(o.label)}</label>`).join('')}</div>`;
  } else if (q.type === 'money') {
    control = `<input name="${q.id}" inputmode="decimal" placeholder="$0" value="${v ?? ''}" style="max-width:12rem">`;
  } else {
    control = `<input name="${q.id}" value="${esc(v ?? '')}">`;
  }
  return `<div class="q" data-q="${q.id}"${showIf}><span class="qlabel">${esc(q.label)}</span>${control}</div>`;
}

function collect(form) {
  const out = {};
  for (const [k, v] of new FormData(form)) out[k] = v;
  return out;
}

function applyVisibility(form) {
  const answers = collect(form);
  let total = 0;
  let answered = 0;
  for (const el of form.querySelectorAll('.q')) {
    const cond = el.dataset.showIf ? JSON.parse(el.dataset.showIf) : null;
    const visible = !cond || Object.entries(cond).every(([k, v]) => answers[k] === v);
    el.hidden = !visible;
    el.querySelectorAll('input').forEach((i) => { i.disabled = !visible; });
    if (visible) {
      total++;
      if (answers[el.dataset.q]) answered++;
    }
  }
  form.querySelector('.progress > div').style.width = `${Math.round((answered / total) * 100)}%`;
}

function render() {
  const roleLabel = data.role === 'tenant' ? 'Tenant' : 'Landlord';
  root.innerHTML = `
    <h1>${data.submitted ? 'Update your answers' : 'A few quick questions'}</h1>
    <p>Case <strong>${esc(data.case_number)}</strong> · ${esc(data.property_address || '')} · You are the <strong>${roleLabel.toLowerCase()}</strong>.
    ${data.hearing_date ? `Hearing date: <strong>${esc(data.hearing_date)}</strong>.` : ''}</p>
    <p class="muted small">This takes less than 5 minutes. Your answers help the court offer options like free mediation,
    payment plans, rental assistance, or more time — possibly without a hearing. Answering is voluntary and does not
    waive your right to a hearing.</p>
    <form id="f" novalidate>
      <div class="progress" aria-hidden="true"><div></div></div>
      ${data.questions.map((s) => `<fieldset><legend>${esc(s.section)}</legend>
        ${s.items.map((q) => questionHtml(q, data.answers)).join('')}</fieldset>`).join('')}
      <p class="errors" id="errors"></p>
      <button class="primary" type="submit">Submit</button>
    </form>`;
  const form = document.getElementById('f');
  form.addEventListener('input', () => applyVisibility(form));
  form.addEventListener('submit', submit);
  applyVisibility(form);
}

async function submit(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const res = await fetch(`/api/intake/${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(collect(e.target)),
    });
    const body = await res.json();
    if (!res.ok) {
      document.getElementById('errors').textContent = res.status === 422
        ? 'Please answer every question before submitting.'
        : body.error || 'Something went wrong. Please try again.';
      btn.disabled = false;
      return;
    }
    root.innerHTML = `
      <h1>Thank you</h1>
      <p>Your answers were sent to the court’s diversion program. Court staff may contact you about mediation or other options.
      <strong>Keep your hearing date unless the court tells you otherwise.</strong></p>
      ${body.referrals.length ? `<h2>Resources that may help you</h2><ul class="actions">${body.referrals.map((p) => `
        <li><strong>${esc(p.name)}</strong><br>${esc(p.description)}<br><span class="small">${esc(p.contact)}</span></li>`).join('')}</ul>` : ''}
      <p class="muted small">Need to change an answer? Reopen this same link.</p>`;
  } catch {
    document.getElementById('errors').textContent = 'Network error. Please try again.';
    btn.disabled = false;
  }
}

await fetch(`/api/intake/${token}`)
  .then(async (r) => {
    data = await r.json();
    if (!r.ok) throw new Error(data.error);
    render();
  })
  .catch((e) => { root.innerHTML = `<p class="errors">${esc(e.message || 'Could not load this form.')}</p>`; });
