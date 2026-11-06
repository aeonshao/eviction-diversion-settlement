import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, RULES } from '../src/scoring.js';
import { matchReferrals, staffAlerts, loadPrograms } from '../src/referrals.js';
import { validateAnswers } from '../src/questions.js';

const T = (o) => ({
  rent_owed: 1400, can_pay_30: 'no', third_party_help: 'no', employed: 'yes', wants_to_stay: 'yes',
  move_with_time: 'no', disputes_claim: 'no', applied_assistance: 'no', has_legal_aid: 'no',
  willing_mediation: 'yes', interpreter: 'no', accommodation: 'no', ...o,
});
const L = (o) => ({
  accepts_payment_plan: 'yes', accepts_partial: 'yes', extend_moveout: 'no', dismiss_if_paid: 'yes',
  willing_mediation: 'yes', primary_goal: 'rent', interpreter: 'no', ...o,
});
const ids = (a) => a.rules.map((r) => r.id);

test('brief example: High — wants to stay, can pay $1,000 of $1,400, applied; landlord flexible', () => {
  const a = assess(T({ can_pay_30: 'yes', amount_can_pay: 1000, applied_assistance: 'yes' }), L({}));
  assert.equal(a.tier, 'High');
  assert.equal(a.primaryAction, 'Mediation');
  assert.ok(ids(a).includes('payment_plan_fit'));
  assert.ok(ids(a).includes('mutual_mediation'));
  assert.ok(a.actions.some((x) => /delay/i.test(x)));
});

test('brief example: Medium — partial payment, landlord negotiates move-out but no payment plan', () => {
  const a = assess(
    T({ rent_owed: 2400, can_pay_30: 'yes', amount_can_pay: 300, wants_to_stay: 'unsure', move_with_time: 'yes', willing_mediation: 'unsure' }),
    L({ accepts_payment_plan: 'no', accepts_partial: 'unsure', extend_moveout: 'yes', dismiss_if_paid: 'no', willing_mediation: 'unsure', primary_goal: 'possession' }),
  );
  assert.equal(a.tier, 'Medium');
  assert.equal(a.pathway, 'move_out');
  assert.ok(a.actions.some((x) => /move-out agreement/i.test(x)));
});

test('brief example: Low — tenant contests, cannot pay; landlord refuses everything', () => {
  const a = assess(
    T({ disputes_claim: 'yes', willing_mediation: 'no' }),
    L({ accepts_payment_plan: 'no', accepts_partial: 'no', extend_moveout: 'no', dismiss_if_paid: 'no', willing_mediation: 'no', primary_goal: 'possession' }),
  );
  assert.equal(a.tier, 'Low');
  assert.equal(a.score, 0);
  assert.equal(a.primaryAction, 'Standard hearing');
  assert.ok(ids(a).includes('landlord_inflexible'));
  assert.ok(a.actions.some((x) => /legal aid/i.test(x)));
});

test('spec rule weights: payment plan fit +40, mutual mediation +30', () => {
  const byId = Object.fromEntries(RULES.map((r) => [r.id, r.points]));
  assert.equal(byId.payment_plan_fit, 40);
  assert.equal(byId.mutual_mediation, 30);
});

test('incomplete intake: no tier, provisional score, outreach recommendations', () => {
  assert.equal(assess(null, null).intakeStatus, 'awaiting_both');
  assert.equal(assess(null, null).score, null);

  const onlyLandlord = assess(null, L({}));
  assert.equal(onlyLandlord.intakeStatus, 'awaiting_tenant');
  assert.equal(onlyLandlord.tier, null);
  assert.equal(onlyLandlord.primaryAction, 'Tenant outreach');
  // Joint rules must not fire with only one side present.
  assert.ok(!ids(onlyLandlord).includes('mutual_mediation'));

  const onlyTenant = assess(T({ applied_assistance: 'yes' }), null);
  assert.equal(onlyTenant.intakeStatus, 'awaiting_landlord');
  assert.deepEqual(ids(onlyTenant), ['assistance_applied']);
  assert.ok(onlyTenant.provisional);
});

test('score is clamped to 0..100', () => {
  const hi = assess(T({ can_pay_30: 'yes', amount_can_pay: 1400, applied_assistance: 'yes', third_party_help: 'yes', move_with_time: 'yes' }), L({ extend_moveout: 'yes' }));
  assert.equal(hi.score, 100);
  assert.ok(hi.rawScore > 100);
});

test('referrals: owes < $2,000, employed, wants to stay → assistance, mediation, legal aid', () => {
  const tenant = T({ rent_owed: 1500, employed: 'yes', wants_to_stay: 'yes' });
  const names = matchReferrals({ tenant, landlord: null }, loadPrograms()).map((p) => p.id);
  assert.ok(names.includes('short_term_era'));
  assert.ok(names.includes('court_mediation'));
  assert.ok(names.includes('legal_aid'));
  assert.ok(!names.includes('court_mediation_landlord'));
});

test('referrals: no short-term assistance above $2,000', () => {
  const names = matchReferrals({ tenant: T({ rent_owed: 2500 }) }, loadPrograms()).map((p) => p.id);
  assert.ok(!names.includes('short_term_era'));
  assert.ok(names.includes('emergency_era'));
});

test('staff alerts for interpreter and accommodation', () => {
  const alerts = staffAlerts({
    tenant: T({ interpreter: 'yes', interpreter_language: 'Haitian Creole', accommodation: 'yes' }),
    landlord: L({ interpreter: 'yes', interpreter_language: 'Mandarin' }),
  });
  assert.equal(alerts.length, 3);
  assert.match(alerts[0].message, /Haitian Creole/);
});

test('validation: required fields, conditional fields, money parsing', () => {
  const bad = validateAnswers('tenant', { rent_owed: 'abc' });
  assert.equal(bad.ok, false);

  const good = validateAnswers('tenant', { ...T({ can_pay_30: 'yes' }), rent_owed: '$1,250.50', amount_can_pay: '500' });
  assert.equal(good.ok, true);
  assert.equal(good.answers.rent_owed, 1250.5);
  assert.equal(good.answers.amount_can_pay, 500);

  // Hidden conditional answers are dropped.
  const hidden = validateAnswers('tenant', { ...T({ can_pay_30: 'no' }), amount_can_pay: '500' });
  assert.equal(hidden.ok, true);
  assert.equal(hidden.answers.amount_can_pay, undefined);

  // Conditional answer required when shown.
  assert.equal(validateAnswers('tenant', T({ can_pay_30: 'yes' })).ok, false);
  assert.equal(validateAnswers('tenant', T({ ...{}, interpreter: 'yes' })).ok, false);
  assert.equal(validateAnswers('landlord', L({ primary_goal: 'revenge' })).ok, false);
});
