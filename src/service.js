// Application logic shared by the HTTP server and the seed script.
import { assess } from './scoring.js';
import { matchReferrals, staffAlerts, loadPrograms } from './referrals.js';
import { CASE_STATUSES } from './db.js';
import { sendIntakeInvites } from './notify.js';
import { QUESTIONS } from './questions.js';

const REQUIRED_CASE_FIELDS = ['case_number', 'filed_date', 'tenant_name', 'landlord_name'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateNewCase(body) {
  const errors = [];
  const c = {};
  for (const k of ['case_number', 'filed_date', 'hearing_date', 'property_address',
    'tenant_name', 'tenant_phone', 'tenant_email', 'landlord_name', 'landlord_phone', 'landlord_email']) {
    const v = body?.[k];
    c[k] = typeof v === 'string' ? v.trim().slice(0, 200) : '';
  }
  for (const k of REQUIRED_CASE_FIELDS) if (!c[k]) errors.push(`${k} is required`);
  for (const k of ['filed_date', 'hearing_date']) if (c[k] && !ISO_DATE.test(c[k])) errors.push(`${k} must be YYYY-MM-DD`);
  if (!c.tenant_phone && !c.tenant_email && !c.property_address) errors.push('Need at least one way to reach the tenant (phone, email, or address)');
  return { ok: errors.length === 0, errors, value: c };
}

export function createCase(store, body, baseUrl) {
  const v = validateNewCase(body);
  if (!v.ok) return v;
  let id;
  try {
    id = store.createCase(v.value);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return { ok: false, errors: ['case_number already exists'] };
    throw e;
  }
  sendIntakeInvites(store, store.getCase(id), store.intakesFor(id), baseUrl);
  return { ok: true, id };
}

export function caseSummaries(store) {
  const intakes = store.allIntakes();
  return store.listCases().map((c) => {
    const i = intakes.get(c.id) || { tenant: null, landlord: null };
    const a = assess(i.tenant, i.landlord);
    return {
      id: c.id,
      case_number: c.case_number,
      tenant_name: c.tenant_name,
      landlord_name: c.landlord_name,
      property_address: c.property_address,
      filed_date: c.filed_date,
      hearing_date: c.hearing_date,
      status: c.status,
      intakeStatus: a.intakeStatus,
      score: a.score,
      tier: a.tier,
      primaryAction: a.primaryAction,
      alerts: staffAlerts(i).map((x) => x.type),
    };
  });
}

export function caseDetail(store, id, baseUrl) {
  const c = store.getCase(id);
  if (!c) return null;
  const intakes = store.intakesFor(id);
  const answers = { tenant: intakes.tenant?.answers || null, landlord: intakes.landlord?.answers || null };
  const programs = loadPrograms();
  return {
    case: c,
    intakes: Object.fromEntries(Object.entries(intakes).map(([role, i]) => [role, i && {
      submitted_at: i.submitted_at,
      answers: i.answers,
      url: `${baseUrl}/intake/${i.token}`,
    }])),
    assessment: assess(answers.tenant, answers.landlord),
    referrals: matchReferrals(answers, programs),
    alerts: staffAlerts(answers),
    notifications: store.notifications(id),
    events: store.events(id),
    statuses: CASE_STATUSES,
    questions: QUESTIONS,
  };
}

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

export function metrics(store) {
  const rows = caseSummaries(store);
  const total = rows.length;
  const complete = rows.filter((r) => r.intakeStatus === 'complete');
  const tiers = { High: 0, Medium: 0, Low: 0 };
  for (const r of complete) tiers[r.tier]++;

  const byStatus = Object.fromEntries(CASE_STATUSES.map((s) => [s.value, 0]));
  for (const r of rows) byStatus[r.status]++;

  const referred = ['referred_mediation', 'mediation_scheduled', 'settled', 'move_out_agreement', 'not_settled']
    .reduce((s, k) => s + byStatus[k], 0);
  const participated = ['mediation_scheduled', 'settled', 'move_out_agreement', 'not_settled']
    .reduce((s, k) => s + byStatus[k], 0);
  const mediationConcluded = byStatus.settled + byStatus.move_out_agreement + byStatus.not_settled;
  const resolvedWithoutHearing = byStatus.settled + byStatus.move_out_agreement + byStatus.dismissed;

  return {
    totalCases: total,
    intakeCompletionRate: pct(complete.length, total),
    tenantResponseRate: pct(rows.filter((r) => ['complete', 'awaiting_landlord'].includes(r.intakeStatus)).length, total),
    tiers,
    diversionSuitableRate: pct(tiers.High + tiers.Medium, complete.length),
    referredToMediation: referred,
    mediationParticipationRate: pct(participated, referred),
    settlementSuccessRate: pct(byStatus.settled + byStatus.move_out_agreement, mediationConcluded),
    resolvedWithoutHearing,
    byStatus,
    statuses: CASE_STATUSES,
  };
}
