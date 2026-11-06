// Notification sender. In the MVP every message is written to the
// `notifications` table (the "outbox") instead of being sent. Swap
// `deliver()` for Twilio / SendGrid / a print vendor to go live.

export function intakeUrl(baseUrl, token) {
  return `${baseUrl.replace(/\/$/, '')}/intake/${token}`;
}

function message(role, c, url, kind) {
  const who = role === 'tenant' ? c.tenant_name : c.landlord_name;
  const lead = kind === 'reminder' ? 'Reminder: ' : '';
  return `${lead}Hello ${who}. An eviction case (${c.case_number}) was filed for ${c.property_address || 'your property'}. ` +
    `Please answer a few short questions (under 5 minutes) so the court can offer options like mediation, ` +
    `payment plans, or rental assistance before your hearing: ${url}`;
}

/** Queue intake invitations for the given roles. Returns the messages created. */
export function sendIntakeInvites(store, caseRow, intakes, baseUrl, { roles = ['tenant', 'landlord'], kind = 'invite' } = {}) {
  const sent = [];
  for (const role of roles) {
    const intake = intakes[role];
    if (!intake) continue;
    const url = intakeUrl(baseUrl, intake.token);
    const body = message(role, caseRow, url, kind);
    const channels = [
      ['sms', caseRow[`${role}_phone`]],
      ['email', caseRow[`${role}_email`]],
    ];
    if (kind === 'invite') channels.push(['paper', `Mailed notice (QR) — ${caseRow.property_address || 'address on file'}`]);
    for (const [channel, recipient] of channels) {
      if (!recipient) continue;
      const n = { case_id: caseRow.id, role, channel, recipient, body };
      store.addNotification(n);
      sent.push(n);
    }
  }
  if (sent.length) store.addEvent(caseRow.id, kind === 'invite' ? 'invites_sent' : 'reminders_sent',
    `${sent.length} ${kind === 'invite' ? 'invitation' : 'reminder'} message(s) queued`);
  return sent;
}
