// Seeds the database with fictional demo cases. Usage: npm run seed  (wipes existing data)
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createCase } from './service.js';
import { validateAnswers } from './questions.js';

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const dbPath = process.env.DB_PATH || fileURLToPath(new URL('../data/court.db', import.meta.url));
for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
const store = openDb(dbPath);

// Shorthand tenant/landlord answer builders with sensible defaults.
const T = (o) => ({
  rent_owed: 1400, can_pay_30: 'no', third_party_help: 'no', employed: 'yes',
  wants_to_stay: 'yes', move_with_time: 'no', disputes_claim: 'no',
  applied_assistance: 'no', has_legal_aid: 'no', willing_mediation: 'yes',
  interpreter: 'no', accommodation: 'no', ...o,
});
const L = (o) => ({
  accepts_payment_plan: 'yes', accepts_partial: 'yes', extend_moveout: 'no',
  dismiss_if_paid: 'yes', willing_mediation: 'yes', primary_goal: 'rent', interpreter: 'no', ...o,
});

const CASES = [
  // --- The three examples from the product brief ---
  {
    case_number: 'EV-2026-101', tenant_name: 'Maria Alvarez', landlord_name: 'Oakview Properties LLC',
    property_address: '12 Elm St, Apt 3', hearing_date: '2026-12-02', status: 'referred_mediation',
    tenant: T({ rent_owed: 1400, can_pay_30: 'yes', amount_can_pay: 1000, applied_assistance: 'yes' }),
    landlord: L({}),
  },
  {
    case_number: 'EV-2026-102', tenant_name: 'Darnell Brooks', landlord_name: 'R. Patel',
    property_address: '88 River Rd, Unit B', hearing_date: '2026-12-03',
    tenant: T({ rent_owed: 2400, can_pay_30: 'yes', amount_can_pay: 300, wants_to_stay: 'unsure', move_with_time: 'yes', willing_mediation: 'unsure' }),
    landlord: L({ accepts_payment_plan: 'no', accepts_partial: 'unsure', extend_moveout: 'yes', dismiss_if_paid: 'no', willing_mediation: 'unsure', primary_goal: 'possession' }),
  },
  {
    case_number: 'EV-2026-103', tenant_name: 'Kevin Huang', landlord_name: 'Summit Holdings Inc.',
    property_address: '401 Main St, Apt 9', hearing_date: '2026-12-03', status: 'set_for_hearing',
    tenant: T({ rent_owed: 5200, disputes_claim: 'yes', willing_mediation: 'no' }),
    landlord: L({ accepts_payment_plan: 'no', accepts_partial: 'no', extend_moveout: 'no', dismiss_if_paid: 'no', willing_mediation: 'no', primary_goal: 'possession' }),
  },
  // --- Additional variety ---
  {
    case_number: 'EV-2026-104', tenant_name: 'Ana Souza', landlord_name: 'Greenway Apartments',
    property_address: '5 Birch Ct, Apt 12', hearing_date: '2026-12-04',
    tenant: T({ rent_owed: 1800, can_pay_30: 'yes', amount_can_pay: 600, third_party_help: 'yes', interpreter: 'yes', interpreter_language: 'Portuguese' }),
    landlord: L({ accepts_partial: 'unsure' }),
  },
  {
    case_number: 'EV-2026-105', tenant_name: 'James O’Connor', landlord_name: 'Lakeside Rentals',
    property_address: '230 Lake Ave', hearing_date: '2026-12-04',
    tenant: null, landlord: L({ extend_moveout: 'yes' }),
  },
  {
    case_number: 'EV-2026-106', tenant_name: 'Fatima Noor', landlord_name: 'B. Thompson',
    property_address: '17 Cedar Ln', hearing_date: '2026-12-05',
    tenant: T({ rent_owed: 950, can_pay_30: 'yes', amount_can_pay: 950, accommodation: 'yes' }),
    landlord: null,
  },
  {
    case_number: 'EV-2026-107', tenant_name: 'Luis Ramirez', landlord_name: 'Oakview Properties LLC',
    property_address: '12 Elm St, Apt 7', hearing_date: '2026-11-20', status: 'settled',
    tenant: T({ rent_owed: 1100, can_pay_30: 'yes', amount_can_pay: 500, applied_assistance: 'yes', interpreter: 'yes', interpreter_language: 'Spanish' }),
    landlord: L({}),
  },
  {
    case_number: 'EV-2026-108', tenant_name: 'Tasha Wright', landlord_name: 'Summit Holdings Inc.',
    property_address: '401 Main St, Apt 2', hearing_date: '2026-11-21', status: 'move_out_agreement',
    tenant: T({ rent_owed: 3900, wants_to_stay: 'no', move_with_time: 'yes', third_party_help: 'unsure' }),
    landlord: L({ accepts_payment_plan: 'no', extend_moveout: 'yes', dismiss_if_paid: 'no', primary_goal: 'possession' }),
  },
  {
    case_number: 'EV-2026-109', tenant_name: 'Peter Kowalski', landlord_name: 'Lakeside Rentals',
    property_address: '230 Lake Ave, Unit 4', hearing_date: '2026-11-22', status: 'not_settled',
    tenant: T({ rent_owed: 2600, can_pay_30: 'yes', amount_can_pay: 400, wants_to_stay: 'yes', willing_mediation: 'unsure' }),
    landlord: L({ accepts_payment_plan: 'unsure', dismiss_if_paid: 'unsure', primary_goal: 'both', willing_mediation: 'unsure' }),
  },
  {
    case_number: 'EV-2026-110', tenant_name: 'Grace Kim', landlord_name: 'Greenway Apartments',
    property_address: '5 Birch Ct, Apt 3', hearing_date: '2026-12-08', status: 'mediation_scheduled',
    tenant: T({ rent_owed: 2100, can_pay_30: 'yes', amount_can_pay: 1200, has_legal_aid: 'yes' }),
    landlord: L({ accepts_partial: 'no' }),
  },
  {
    case_number: 'EV-2026-111', tenant_name: 'Robert Diaz', landlord_name: 'M. Chen',
    property_address: '64 Willow Way', hearing_date: '2026-12-09',
    tenant: null, landlord: null,
  },
  {
    case_number: 'EV-2026-112', tenant_name: 'Hannah Lee', landlord_name: 'R. Patel',
    property_address: '90 River Rd', hearing_date: '2026-12-10', status: 'dismissed',
    tenant: T({ rent_owed: 700, can_pay_30: 'yes', amount_can_pay: 700, employed: 'yes' }),
    landlord: L({}),
  },
];

for (const c of CASES) {
  const { tenant, landlord, status, ...fields } = c;
  const slug = fields.tenant_name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
  const r = createCase(store, {
    ...fields,
    filed_date: '2026-10-28',
    tenant_phone: '(555) 555-01' + fields.case_number.slice(-2),
    tenant_email: `${slug}@example.com`,
    landlord_email: `office+${fields.case_number.slice(-3)}@example.com`,
  }, BASE_URL);
  if (!r.ok) throw new Error(`${c.case_number}: ${r.errors.join(', ')}`);
  const intakes = store.intakesFor(r.id);
  for (const [role, answers] of [['tenant', tenant], ['landlord', landlord]]) {
    if (!answers) continue;
    const v = validateAnswers(role, answers);
    if (!v.ok) throw new Error(`${c.case_number} ${role}: ${v.errors.join(', ')}`);
    store.submitIntake(intakes[role].token, v.answers);
  }
  if (status) store.updateCase(r.id, { status });
}

console.log(`Seeded ${CASES.length} demo cases into ${dbPath}`);
