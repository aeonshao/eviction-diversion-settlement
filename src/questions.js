// Single source of truth for intake questionnaires.
// The intake page renders these, and the server validates submissions against them.

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];
const YES_NO_UNSURE = [...YES_NO, { value: 'unsure', label: 'Not sure' }];

export const QUESTIONS = {
  tenant: [
    {
      section: 'Rent owed',
      items: [
        { id: 'rent_owed', type: 'money', label: 'About how much rent do you currently owe?', required: true },
        { id: 'can_pay_30', type: 'choice', options: YES_NO, label: 'Could you pay any amount within the next 30 days?', required: true },
        { id: 'amount_can_pay', type: 'money', label: 'About how much could you pay within 30 days?', showIf: { can_pay_30: 'yes' }, required: true },
        { id: 'third_party_help', type: 'choice', options: YES_NO_UNSURE, label: 'Could family, friends, or an assistance program help you pay?', required: true },
        { id: 'employed', type: 'choice', options: YES_NO, label: 'Does anyone in your household currently have income from work?', required: true },
      ],
    },
    {
      section: 'Housing goals',
      items: [
        { id: 'wants_to_stay', type: 'choice', options: YES_NO_UNSURE, label: 'Do you want to stay in your home?', required: true },
        { id: 'move_with_time', type: 'choice', options: YES_NO_UNSURE, label: 'Would you consider moving out if you were given more time?', required: true },
        { id: 'disputes_claim', type: 'choice', options: YES_NO_UNSURE, label: 'Do you disagree with the landlord’s case (for example, the amount owed, repairs, or who owns the property)?', required: true },
      ],
    },
    {
      section: 'Help you already have',
      items: [
        { id: 'applied_assistance', type: 'choice', options: YES_NO, label: 'Have you applied for rental assistance?', required: true },
        { id: 'has_legal_aid', type: 'choice', options: YES_NO, label: 'Are you working with a lawyer or legal aid?', required: true },
      ],
    },
    {
      section: 'Next steps',
      items: [
        { id: 'willing_mediation', type: 'choice', options: YES_NO_UNSURE, label: 'Would you be willing to meet with a free, neutral mediator to try to work things out?', required: true },
        { id: 'interpreter', type: 'choice', options: YES_NO, label: 'Do you need an interpreter?', required: true },
        { id: 'interpreter_language', type: 'text', label: 'Which language?', showIf: { interpreter: 'yes' }, required: true },
        { id: 'accommodation', type: 'choice', options: YES_NO, label: 'Do you need a disability accommodation to take part in court or mediation?', required: true },
      ],
    },
  ],
  landlord: [
    {
      section: 'Flexibility',
      items: [
        { id: 'accepts_payment_plan', type: 'choice', options: YES_NO_UNSURE, label: 'Would you accept a payment plan for the overdue rent?', required: true },
        { id: 'accepts_partial', type: 'choice', options: YES_NO_UNSURE, label: 'Would you accept a partial payment now?', required: true },
        { id: 'extend_moveout', type: 'choice', options: YES_NO_UNSURE, label: 'Would you consider giving the tenant more time to move out?', required: true },
      ],
    },
    {
      section: 'Settlement preferences',
      items: [
        { id: 'dismiss_if_paid', type: 'choice', options: YES_NO_UNSURE, label: 'If the overdue rent were paid, would you dismiss the case?', required: true },
        { id: 'willing_mediation', type: 'choice', options: YES_NO_UNSURE, label: 'Would you participate in mediation?', required: true },
      ],
    },
    {
      section: 'Goals',
      items: [
        {
          id: 'primary_goal', type: 'choice', required: true, label: 'What is your primary goal?',
          options: [
            { value: 'rent', label: 'Recovering rent' },
            { value: 'possession', label: 'Getting the unit back' },
            { value: 'both', label: 'Both' },
          ],
        },
        { id: 'interpreter', type: 'choice', options: YES_NO, label: 'Do you need an interpreter?', required: true },
        { id: 'interpreter_language', type: 'text', label: 'Which language?', showIf: { interpreter: 'yes' }, required: true },
      ],
    },
  ],
};

export const ROLES = Object.keys(QUESTIONS);

function isVisible(item, answers) {
  if (!item.showIf) return true;
  return Object.entries(item.showIf).every(([k, v]) => answers[k] === v);
}

/**
 * Validate and normalize a submission. Returns { ok, answers, errors }.
 * Hidden conditional questions are dropped; unknown keys are ignored.
 */
export function validateAnswers(role, raw) {
  const sections = QUESTIONS[role];
  if (!sections) return { ok: false, errors: [`Unknown role: ${role}`] };
  const answers = {};
  const errors = [];
  const input = raw && typeof raw === 'object' ? raw : {};

  for (const item of sections.flatMap((s) => s.items)) {
    if (!isVisible(item, answers)) continue;
    let v = input[item.id];
    if (v === undefined || v === null || v === '') {
      if (item.required) errors.push(`${item.id} is required`);
      continue;
    }
    if (item.type === 'money') {
      const n = Number(String(v).replace(/[$,\s]/g, ''));
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
        errors.push(`${item.id} must be a dollar amount`);
        continue;
      }
      v = Math.round(n * 100) / 100;
    } else if (item.type === 'choice') {
      if (!item.options.some((o) => o.value === v)) {
        errors.push(`${item.id} has an invalid value`);
        continue;
      }
    } else if (item.type === 'text') {
      v = String(v).trim().slice(0, 100);
      if (!v && item.required) {
        errors.push(`${item.id} is required`);
        continue;
      }
    }
    answers[item.id] = v;
  }
  return { ok: errors.length === 0, answers, errors };
}
