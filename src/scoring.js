// Transparent, rules-based settlement scoring.
//
// Every rule is a plain object: what it needs, a human-readable explanation,
// a point value, and a condition. Court staff can read this file (or the
// /rules page) and see exactly why a case got its score. No machine learning.

export const TIER_THRESHOLDS = { High: 60, Medium: 30 }; // score >= threshold

const yes = (v) => v === 'yes';
const open = (v) => v === 'yes' || v === 'unsure';
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const canPaySome = (t) => yes(t.can_pay_30) && num(t.amount_can_pay) > 0;
const payRatio = (t) => {
  const owed = num(t.rent_owed);
  if (owed <= 0) return 1;
  return canPaySome(t) ? num(t.amount_can_pay) / owed : 0;
};
const hasFundingPath = (t) => yes(t.applied_assistance) || yes(t.third_party_help);

/**
 * needs: which intakes must be present for the rule to be evaluated.
 * group: used to pick a pathway (payment plan vs. move-out) for recommendations.
 */
export const RULES = [
  // ---- Positive signals ----
  {
    id: 'payment_plan_fit',
    needs: 'both',
    group: 'payment',
    points: 40,
    label: 'Tenant wants to stay, can pay something, and landlord accepts payment plans',
    when: (t, l) => yes(t.wants_to_stay) && yes(l.accepts_payment_plan) && canPaySome(t),
  },
  {
    id: 'mutual_mediation',
    needs: 'both',
    points: 30,
    label: 'Both parties are willing to mediate',
    when: (t, l) => yes(t.willing_mediation) && yes(l.willing_mediation),
  },
  {
    id: 'mediation_open',
    needs: 'both',
    points: 10,
    label: 'Both parties are open to mediation (at least one is unsure)',
    when: (t, l) =>
      open(t.willing_mediation) && open(l.willing_mediation) &&
      !(yes(t.willing_mediation) && yes(l.willing_mediation)),
  },
  {
    id: 'dismiss_if_paid_reachable',
    needs: 'both',
    group: 'payment',
    points: 20,
    label: 'Landlord would dismiss if paid, and tenant can cover half or more or has a funding source',
    when: (t, l) => yes(l.dismiss_if_paid) && (payRatio(t) >= 0.5 || hasFundingPath(t)),
  },
  {
    id: 'partial_payment_match',
    needs: 'both',
    group: 'payment',
    points: 10,
    label: 'Landlord accepts partial payment and tenant can pay something within 30 days',
    when: (t, l) => yes(l.accepts_partial) && canPaySome(t),
  },
  {
    id: 'move_out_fit',
    needs: 'both',
    group: 'move_out',
    points: 35,
    label: 'Tenant would move with more time and landlord would extend the move-out date',
    when: (t, l) => yes(t.move_with_time) && yes(l.extend_moveout),
  },
  {
    id: 'assistance_applied',
    needs: 'tenant',
    points: 10,
    label: 'Tenant has already applied for rental assistance',
    when: (t) => yes(t.applied_assistance),
  },
  {
    id: 'strong_payment_capacity',
    needs: 'tenant',
    points: 10,
    label: 'Tenant can pay at least half of what is owed within 30 days',
    when: (t) => canPaySome(t) && payRatio(t) >= 0.5,
  },
  {
    id: 'outside_help',
    needs: 'tenant',
    points: 5,
    label: 'Family, friends, or a program could help the tenant pay',
    when: (t) => yes(t.third_party_help),
  },

  // ---- Negative signals ----
  {
    id: 'tenant_disputes',
    needs: 'tenant',
    points: -25,
    label: 'Tenant disputes the landlord’s claim (amount, conditions, or ownership)',
    when: (t) => yes(t.disputes_claim),
  },
  {
    id: 'no_payment_path',
    needs: 'tenant',
    points: -15,
    label: 'Tenant cannot pay anything, has no outside help, and has not applied for assistance',
    when: (t) => !canPaySome(t) && t.third_party_help === 'no' && t.applied_assistance === 'no',
  },
  {
    id: 'landlord_inflexible',
    needs: 'landlord',
    points: -40,
    label: 'Landlord declined every option (payment plan, partial payment, extension, dismissal, mediation)',
    when: (_t, l) =>
      ['accepts_payment_plan', 'accepts_partial', 'extend_moveout', 'dismiss_if_paid', 'willing_mediation']
        .every((k) => l[k] === 'no'),
  },
  {
    id: 'mediation_refused',
    needs: 'both',
    points: -10,
    label: 'At least one party declined mediation',
    when: (t, l) => t.willing_mediation === 'no' || l.willing_mediation === 'no',
  },
  {
    id: 'goal_conflict',
    needs: 'both',
    points: -15,
    label: 'Landlord only wants possession, tenant wants to stay, and landlord won’t extend move-out',
    when: (t, l) => l.primary_goal === 'possession' && yes(t.wants_to_stay) && !yes(l.extend_moveout),
  },
];

export function tierFor(score) {
  if (score >= TIER_THRESHOLDS.High) return 'High';
  if (score >= TIER_THRESHOLDS.Medium) return 'Medium';
  return 'Low';
}

/**
 * Assess a case. Either intake may be null (not yet submitted).
 * Returns a fully explained result; nothing here is a judicial determination.
 */
export function assess(tenant, landlord) {
  const have = { tenant: !!tenant, landlord: !!landlord };
  const intakeStatus =
    have.tenant && have.landlord ? 'complete'
      : have.tenant ? 'awaiting_landlord'
        : have.landlord ? 'awaiting_tenant'
          : 'awaiting_both';

  const t = tenant || {};
  const l = landlord || {};
  const applicable = RULES.filter((r) =>
    r.needs === 'both' ? have.tenant && have.landlord : have[r.needs]);
  const fired = applicable.filter((r) => r.when(t, l));

  const raw = fired.reduce((sum, r) => sum + r.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  const complete = intakeStatus === 'complete';
  const tier = complete ? tierFor(score) : null;

  const groups = new Set(fired.map((r) => r.group).filter(Boolean));
  const firedIds = new Set(fired.map((r) => r.id));
  const rec = recommend({ intakeStatus, tier, groups, firedIds, t, l });

  return {
    intakeStatus,
    complete,
    score: have.tenant || have.landlord ? score : null,
    rawScore: raw,
    tier,
    provisional: !complete,
    rules: fired.map(({ id, label, points }) => ({ id, label, points })),
    pathway: rec.pathway,
    primaryAction: rec.primaryAction,
    actions: rec.actions,
  };
}

function recommend({ intakeStatus, tier, groups, firedIds, t, l }) {
  if (intakeStatus === 'awaiting_both') {
    return {
      pathway: 'pending',
      primaryAction: 'Awaiting intake',
      actions: ['Send intake reminders to both parties'],
    };
  }
  if (intakeStatus === 'awaiting_tenant') {
    return {
      pathway: 'pending',
      primaryAction: 'Tenant outreach',
      actions: [
        'Tenant has not completed intake — follow up by phone or text (non-response is a leading indicator of default judgment)',
        'Include rental assistance and legal aid information in the follow-up',
      ],
    };
  }
  if (intakeStatus === 'awaiting_landlord') {
    return {
      pathway: 'pending',
      primaryAction: 'Landlord follow-up',
      actions: ['Landlord has not completed intake — send reminder to landlord or counsel'],
    };
  }

  const actions = [];
  const mediationOpen = open(t.willing_mediation) && open(l.willing_mediation);

  if (tier === 'Low') {
    actions.push('Proceed through the normal hearing process');
    if (firedIds.has('tenant_disputes') && t.has_legal_aid !== 'yes') {
      actions.push('Tenant disputes the claim and has no counsel — provide legal aid referral before the hearing');
    }
    return { pathway: 'hearing', primaryAction: 'Standard hearing', actions };
  }

  if (groups.has('payment')) {
    actions.push(mediationOpen ? 'Refer to mediation to negotiate a payment plan' : 'Facilitate a payment-plan discussion between the parties');
    if (t.applied_assistance !== 'yes') actions.push('Connect tenant to rental assistance before the mediation date');
    else actions.push('Confirm status of the tenant’s pending rental assistance application');
    if (tier === 'High') actions.push('Consider delaying hearing scheduling if local rules permit');
    if (groups.has('move_out')) actions.push('Backup option: voluntary move-out agreement (both parties open to it)');
    return {
      pathway: 'payment',
      primaryAction: mediationOpen ? 'Mediation' : 'Payment plan discussion',
      actions,
    };
  }

  if (groups.has('move_out')) {
    actions.push('Offer the voluntary move-out agreement program');
    if (mediationOpen) actions.push('Schedule mediation to set the move-out date and terms');
    actions.push('Refer tenant to housing search / relocation assistance');
    return { pathway: 'move_out', primaryAction: 'Move-out discussion', actions };
  }

  // Medium/High without a specific pathway: some openness, unclear terms.
  actions.push(mediationOpen ? 'Refer to mediation for a screening session' : 'Mediation coordinator screening call');
  actions.push('Clarify settlement terms with each party before scheduling a hearing');
  return { pathway: 'mediation', primaryAction: 'Mediation screening', actions };
}
