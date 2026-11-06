import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';

import { openDb } from './db.js';
import { QUESTIONS, ROLES, validateAnswers } from './questions.js';
import { RULES, TIER_THRESHOLDS } from './scoring.js';
import { matchReferrals, loadPrograms } from './referrals.js';
import { sendIntakeInvites, intakeUrl } from './notify.js';
import { createCase, caseSummaries, caseDetail, metrics } from './service.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

export function buildServer({ store, baseUrl, clerkPassword }) {
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const html = (res, status, body) => {
    res.writeHead(status, { 'content-type': MIME['.html'] });
    res.end(body);
  };

  async function readBody(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 64 * 1024) throw Object.assign(new Error('Body too large'), { status: 413 });
      chunks.push(chunk);
    }
    try {
      return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    } catch {
      throw Object.assign(new Error('Invalid JSON'), { status: 400 });
    }
  }

  async function serveStatic(res, file) {
    const path = normalize(join(PUBLIC_DIR, file));
    if (!path.startsWith(PUBLIC_DIR)) return json(res, 404, { error: 'Not found' });
    try {
      const data = await readFile(path);
      res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      json(res, 404, { error: 'Not found' });
    }
  }

  // Optional shared-password protection for clerk-facing routes (set CLERK_PASSWORD).
  function clerkAuthorized(req) {
    if (!clerkPassword) return true;
    const header = req.headers.authorization || '';
    if (!header.startsWith('Basic ')) return false;
    const supplied = Buffer.from(Buffer.from(header.slice(6), 'base64').toString().split(':').slice(1).join(':'));
    const expected = Buffer.from(clerkPassword);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  async function noticePage(res, id, role) {
    const c = store.getCase(id);
    const intake = c && store.intakesFor(id)[role];
    if (!intake) return html(res, 404, 'Not found');
    const url = intakeUrl(baseUrl, intake.token);
    const qr = await QRCode.toString(url, { type: 'svg', margin: 1, width: 220 });
    const name = role === 'tenant' ? c.tenant_name : c.landlord_name;
    html(res, 200, `<!doctype html><html><head><meta charset="utf-8"><title>Notice ${escapeHtml(c.case_number)}</title>
<link rel="stylesheet" href="/app.css"></head><body class="notice">
<main class="notice-page">
  <p class="muted">Housing Court · Eviction Diversion Program</p>
  <h1>Your case may be resolved without a hearing</h1>
  <p>To: <strong>${escapeHtml(name)}</strong> (${role})<br>Case: <strong>${escapeHtml(c.case_number)}</strong><br>
  Property: ${escapeHtml(c.property_address || '—')}<br>Hearing date: ${escapeHtml(c.hearing_date || 'not yet scheduled')}</p>
  <p>Please answer a few short questions — it takes <strong>less than 5 minutes</strong>. Your answers help the court offer
  options like free mediation, payment plans, rental assistance, or more time to move.</p>
  <div class="qr">${qr}</div>
  <p>Scan the code with your phone camera, or type this address:<br><code>${escapeHtml(url)}</code></p>
  <p class="muted small">Answering is voluntary and does not replace your right to appear at your hearing. If you need an
  interpreter or a disability accommodation, you can tell us in the questionnaire.</p>
  <button class="no-print" onclick="print()">Print</button>
</main></body></html>`);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method;
    let m;

    // ---------- Public (party-facing) routes: authorized by unguessable token ----------
    if (method === 'GET' && (m = path.match(/^\/intake\/([\w-]+)$/))) return serveStatic(res, 'intake.html');
    if (method === 'GET' && path === '/app.css') return serveStatic(res, 'app.css');
    if (method === 'GET' && path === '/intake.js') return serveStatic(res, 'intake.js');

    if ((m = path.match(/^\/api\/intake\/([\w-]+)$/))) {
      const intake = store.intakeByToken(m[1]);
      if (!intake) return json(res, 404, { error: 'This link is not valid. Please contact the court clerk.' });
      if (method === 'GET') {
        return json(res, 200, {
          role: intake.role,
          case_number: intake.case_number,
          hearing_date: intake.hearing_date,
          property_address: intake.property_address,
          submitted: !!intake.submitted_at,
          answers: intake.answers_json ? JSON.parse(intake.answers_json) : null,
          questions: QUESTIONS[intake.role],
        });
      }
      if (method === 'POST') {
        const v = validateAnswers(intake.role, await readBody(req));
        if (!v.ok) return json(res, 422, { errors: v.errors });
        store.submitIntake(m[1], v.answers);
        // Show the party their own resources right away.
        const referrals = matchReferrals({ [intake.role]: v.answers }, loadPrograms())
          .filter((p) => p.audience === intake.role);
        return json(res, 200, { ok: true, referrals });
      }
    }

    // ---------- Clerk-facing routes ----------
    if (!clerkAuthorized(req)) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="Court staff"' });
      return res.end('Authentication required');
    }

    if (method === 'GET' && path === '/') return serveStatic(res, 'index.html');
    if (method === 'GET' && /^\/[\w-]+\.(html|js|css)$/.test(path)) return serveStatic(res, path.slice(1));
    if (method === 'GET' && (m = path.match(/^\/notice\/(\d+)\/(tenant|landlord)$/))) return noticePage(res, Number(m[1]), m[2]);

    if (path === '/api/cases' && method === 'GET') return json(res, 200, caseSummaries(store));
    if (path === '/api/cases' && method === 'POST') {
      const r = createCase(store, await readBody(req), baseUrl);
      return r.ok ? json(res, 201, { id: r.id }) : json(res, 422, { errors: r.errors });
    }
    if ((m = path.match(/^\/api\/cases\/(\d+)$/))) {
      const id = Number(m[1]);
      if (method === 'GET') {
        const d = caseDetail(store, id, baseUrl);
        return d ? json(res, 200, d) : json(res, 404, { error: 'Case not found' });
      }
      if (method === 'PATCH') {
        const body = await readBody(req);
        try {
          const updated = store.updateCase(id, {
            status: body.status,
            notes: typeof body.notes === 'string' ? body.notes.slice(0, 5000) : undefined,
            hearing_date: body.hearing_date,
          });
          return updated ? json(res, 200, updated) : json(res, 404, { error: 'Case not found' });
        } catch (e) {
          return json(res, 422, { errors: [e.message] });
        }
      }
    }
    if (method === 'POST' && (m = path.match(/^\/api\/cases\/(\d+)\/remind$/))) {
      const id = Number(m[1]);
      const c = store.getCase(id);
      if (!c) return json(res, 404, { error: 'Case not found' });
      const intakes = store.intakesFor(id);
      const roles = ROLES.filter((r) => intakes[r] && !intakes[r].submitted_at);
      const sent = sendIntakeInvites(store, c, intakes, baseUrl, { roles, kind: 'reminder' });
      return json(res, 200, { sent: sent.length, roles });
    }
    if (method === 'GET' && path === '/api/metrics') return json(res, 200, metrics(store));
    if (method === 'GET' && path === '/api/notifications') return json(res, 200, store.notifications());
    if (method === 'GET' && path === '/api/rules') {
      return json(res, 200, {
        thresholds: TIER_THRESHOLDS,
        rules: RULES.map(({ id, label, points, needs }) => ({ id, label, points, needs })),
        programs: loadPrograms(),
      });
    }
    json(res, 404, { error: 'Not found' });
  }

  return createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!e.status) console.error(e);
      if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
  const server = buildServer({ store: openDb(), baseUrl, clerkPassword: process.env.CLERK_PASSWORD });
  server.listen(port, () => {
    console.log(`Eviction Diversion Detector running at ${baseUrl}`);
    if (!process.env.CLERK_PASSWORD) console.log('Warning: CLERK_PASSWORD not set — clerk dashboard is unprotected (demo mode).');
  });
}
