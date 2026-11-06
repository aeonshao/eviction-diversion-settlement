// Referrals engine: matches intake answers against a court-editable program
// directory (config/referral-programs.json) and raises staff alerts.
import { readFileSync } from 'node:fs';

const DIRECTORY_PATH = new URL('../config/referral-programs.json', import.meta.url);

export function loadPrograms(path = DIRECTORY_PATH) {
  return JSON.parse(readFileSync(path, 'utf8')).programs;
}

const OPS = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
  lt: (a, b) => typeof a === 'number' && a < b,
  lte: (a, b) => typeof a === 'number' && a <= b,
  gt: (a, b) => typeof a === 'number' && a > b,
  gte: (a, b) => typeof a === 'number' && a >= b,
};

function conditionHolds(cond, intakes) {
  const [role, key] = cond.field.split('.');
  const answers = intakes[role];
  if (!answers) return false; // can't match on an intake we don't have
  const op = OPS[cond.op];
  if (!op) throw new Error(`Unknown referral op: ${cond.op}`);
  return op(answers[key], cond.value);
}

/** Returns programs whose conditions all hold. intakes = { tenant, landlord } (either may be null). */
export function matchReferrals(intakes, programs = loadPrograms()) {
  return programs
    .filter((p) => p.conditions.every((c) => conditionHolds(c, intakes)))
    .map(({ conditions, ...p }) => p);
}

/** Alerts that court staff should act on regardless of settlement potential. */
export function staffAlerts({ tenant, landlord }) {
  const alerts = [];
  if (tenant?.interpreter === 'yes') {
    alerts.push({ type: 'interpreter', party: 'tenant', message: `Tenant needs an interpreter (${tenant.interpreter_language || 'language not given'})` });
  }
  if (landlord?.interpreter === 'yes') {
    alerts.push({ type: 'interpreter', party: 'landlord', message: `Landlord needs an interpreter (${landlord.interpreter_language || 'language not given'})` });
  }
  if (tenant?.accommodation === 'yes') {
    alerts.push({ type: 'accommodation', party: 'tenant', message: 'Tenant requested a disability accommodation — notify ADA coordinator' });
  }
  return alerts;
}
