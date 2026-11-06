import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { buildServer } from '../src/server.js';

let server;
let base;

before(async () => {
  server = buildServer({ store: openDb(':memory:'), baseUrl: 'http://test' });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (path, method = 'GET', body) => {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('end-to-end: create case → invitations → both intakes → High → workflow → metrics', async () => {
  const created = await call('/api/cases', 'POST', {
    case_number: 'EV-T-1', filed_date: '2026-11-01', hearing_date: '2026-12-01', property_address: '1 Test St',
    tenant_name: 'Ten Ant', tenant_phone: '555-0100', landlord_name: 'Land Lord', landlord_email: 'll@example.com',
  });
  assert.equal(created.status, 201);
  const id = created.body.id;

  let d = (await call(`/api/cases/${id}`)).body;
  assert.equal(d.assessment.intakeStatus, 'awaiting_both');
  // tenant: sms + paper; landlord: email + paper
  assert.deepEqual(d.notifications.map((n) => `${n.role}:${n.channel}`).sort(),
    ['landlord:email', 'landlord:paper', 'tenant:paper', 'tenant:sms']);
  const tokenOf = (role) => d.intakes[role].url.split('/').pop();

  // Duplicate case number rejected
  assert.equal((await call('/api/cases', 'POST', { case_number: 'EV-T-1', filed_date: '2026-11-01', tenant_name: 'a', tenant_phone: '1', landlord_name: 'b' })).status, 422);

  // Public intake endpoint shows minimal info + questions
  const form = (await call(`/api/intake/${tokenOf('tenant')}`)).body;
  assert.equal(form.role, 'tenant');
  assert.equal(form.case_number, 'EV-T-1');
  assert.ok(form.questions.length > 0);
  assert.equal((await call('/api/intake/not-a-real-token')).status, 404);

  // Invalid submission rejected
  assert.equal((await call(`/api/intake/${tokenOf('tenant')}`, 'POST', { rent_owed: 5 })).status, 422);

  const tSub = await call(`/api/intake/${tokenOf('tenant')}`, 'POST', {
    rent_owed: '1400', can_pay_30: 'yes', amount_can_pay: '1000', third_party_help: 'unsure', employed: 'yes',
    wants_to_stay: 'yes', move_with_time: 'no', disputes_claim: 'no', applied_assistance: 'yes', has_legal_aid: 'no',
    willing_mediation: 'yes', interpreter: 'yes', interpreter_language: 'Spanish', accommodation: 'no',
  });
  assert.equal(tSub.status, 200);
  assert.ok(tSub.body.referrals.every((p) => p.audience === 'tenant'));
  assert.ok(tSub.body.referrals.some((p) => p.id === 'short_term_era'));

  const lSub = await call(`/api/intake/${tokenOf('landlord')}`, 'POST', {
    accepts_payment_plan: 'yes', accepts_partial: 'yes', extend_moveout: 'no', dismiss_if_paid: 'yes',
    willing_mediation: 'yes', primary_goal: 'rent', interpreter: 'no',
  });
  assert.equal(lSub.status, 200);

  d = (await call(`/api/cases/${id}`)).body;
  assert.equal(d.assessment.tier, 'High');
  assert.equal(d.alerts[0].type, 'interpreter');

  const list = (await call('/api/cases')).body;
  assert.equal(list[0].primaryAction, 'Mediation');
  assert.deepEqual(list[0].alerts, ['interpreter']);

  // Workflow
  assert.equal((await call(`/api/cases/${id}`, 'PATCH', { status: 'bogus' })).status, 422);
  assert.equal((await call(`/api/cases/${id}`, 'PATCH', { status: 'settled', notes: 'Plan: $200/mo' })).status, 200);

  const m = (await call('/api/metrics')).body;
  assert.equal(m.totalCases, 1);
  assert.equal(m.tiers.High, 1);
  assert.equal(m.diversionSuitableRate, 100);
  assert.equal(m.settlementSuccessRate, 100);
  assert.equal(m.resolvedWithoutHearing, 1);
});

test('reminders only go to parties who have not responded', async () => {
  const { body: { id } } = await call('/api/cases', 'POST', {
    case_number: 'EV-T-2', filed_date: '2026-11-01', tenant_name: 'A', tenant_email: 'a@example.com', landlord_name: 'B', landlord_email: 'b@example.com',
  });
  const r = (await call(`/api/cases/${id}/remind`, 'POST')).body;
  assert.deepEqual(r.roles, ['tenant', 'landlord']);
  assert.equal(r.sent, 2); // email only, no paper on reminders
});

test('clerk routes require password when configured; intake routes do not', async () => {
  const s = buildServer({ store: openDb(':memory:'), baseUrl: 'http://test', clerkPassword: 's3cret' });
  await new Promise((r) => s.listen(0, r));
  const b = `http://127.0.0.1:${s.address().port}`;
  try {
    assert.equal((await fetch(`${b}/api/cases`)).status, 401);
    const auth = { authorization: `Basic ${Buffer.from('clerk:s3cret').toString('base64')}` };
    assert.equal((await fetch(`${b}/api/cases`, { headers: auth })).status, 200);
    assert.equal((await fetch(`${b}/api/intake/whatever`)).status, 404); // reachable, just invalid token
  } finally {
    s.close();
  }
});
