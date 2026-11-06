import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PATH = fileURLToPath(new URL('../data/court.db', import.meta.url));

// Clerk-managed workflow status for each case.
export const CASE_STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'referred_mediation', label: 'Referred to mediation' },
  { value: 'mediation_scheduled', label: 'Mediation scheduled' },
  { value: 'settled', label: 'Settled (payment plan / dismissal)' },
  { value: 'move_out_agreement', label: 'Move-out agreement reached' },
  { value: 'not_settled', label: 'Mediation — not settled' },
  { value: 'set_for_hearing', label: 'Set for hearing' },
  { value: 'dismissed', label: 'Dismissed' },
];
const STATUS_VALUES = new Set(CASE_STATUSES.map((s) => s.value));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY,
  case_number TEXT NOT NULL UNIQUE,
  filed_date TEXT NOT NULL,
  hearing_date TEXT,
  property_address TEXT,
  tenant_name TEXT NOT NULL,
  tenant_phone TEXT,
  tenant_email TEXT,
  landlord_name TEXT NOT NULL,
  landlord_phone TEXT,
  landlord_email TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS intakes (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('tenant','landlord')),
  token TEXT NOT NULL UNIQUE,
  answers_json TEXT,
  submitted_at TEXT,
  UNIQUE (case_id, role)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  body TEXT NOT NULL,
  delivery TEXT NOT NULL DEFAULT 'simulated',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function openDb(path = process.env.DB_PATH || DEFAULT_PATH) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return new Store(db);
}

const newToken = () => randomBytes(18).toString('base64url');

export class Store {
  constructor(db) {
    this.db = db;
  }

  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  createCase(c) {
    return this.transaction(() => {
      const { lastInsertRowid } = this.db.prepare(`
        INSERT INTO cases (case_number, filed_date, hearing_date, property_address,
          tenant_name, tenant_phone, tenant_email, landlord_name, landlord_phone, landlord_email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        c.case_number, c.filed_date, c.hearing_date || null, c.property_address || null,
        c.tenant_name, c.tenant_phone || null, c.tenant_email || null,
        c.landlord_name, c.landlord_phone || null, c.landlord_email || null,
      );
      const id = Number(lastInsertRowid);
      const ins = this.db.prepare('INSERT INTO intakes (case_id, role, token) VALUES (?, ?, ?)');
      ins.run(id, 'tenant', newToken());
      ins.run(id, 'landlord', newToken());
      this.addEvent(id, 'case_created', `Case ${c.case_number} entered`);
      return id;
    });
  }

  listCases() {
    return this.db.prepare('SELECT * FROM cases ORDER BY hearing_date IS NULL, hearing_date, id').all()
      .map((row) => ({ ...row }));
  }

  getCase(id) {
    const row = this.db.prepare('SELECT * FROM cases WHERE id = ?').get(id);
    return row ? { ...row } : null;
  }

  updateCase(id, { status, notes, hearing_date }) {
    const existing = this.getCase(id);
    if (!existing) return null;
    if (status !== undefined && !STATUS_VALUES.has(status)) throw new Error(`Invalid status: ${status}`);
    const next = {
      status: status ?? existing.status,
      notes: notes ?? existing.notes,
      hearing_date: hearing_date === undefined ? existing.hearing_date : hearing_date || null,
    };
    this.db.prepare(`UPDATE cases SET status = ?, notes = ?, hearing_date = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(next.status, next.notes, next.hearing_date, id);
    if (next.status !== existing.status) {
      const label = CASE_STATUSES.find((s) => s.value === next.status).label;
      this.addEvent(id, 'status_changed', `Status → ${label}`);
    }
    if (next.hearing_date !== existing.hearing_date) {
      this.addEvent(id, 'hearing_changed', `Hearing date → ${next.hearing_date || 'unscheduled'}`);
    }
    return this.getCase(id);
  }

  /** Returns { tenant, landlord } where each is { token, answers, submitted_at }. */
  intakesFor(caseId) {
    const out = { tenant: null, landlord: null };
    for (const r of this.db.prepare('SELECT * FROM intakes WHERE case_id = ?').all(caseId)) {
      out[r.role] = {
        token: r.token,
        answers: r.answers_json ? JSON.parse(r.answers_json) : null,
        submitted_at: r.submitted_at,
      };
    }
    return out;
  }

  allIntakes() {
    const map = new Map();
    for (const r of this.db.prepare('SELECT case_id, role, answers_json, submitted_at FROM intakes').all()) {
      if (!map.has(r.case_id)) map.set(r.case_id, { tenant: null, landlord: null });
      map.get(r.case_id)[r.role] = r.answers_json ? JSON.parse(r.answers_json) : null;
    }
    return map;
  }

  intakeByToken(token) {
    const r = this.db.prepare(`
      SELECT i.*, c.case_number, c.hearing_date, c.property_address
      FROM intakes i JOIN cases c ON c.id = i.case_id WHERE i.token = ?`).get(token);
    return r ? { ...r } : null;
  }

  submitIntake(token, answers) {
    const intake = this.intakeByToken(token);
    if (!intake) return null;
    this.db.prepare(`UPDATE intakes SET answers_json = ?, submitted_at = datetime('now') WHERE token = ?`)
      .run(JSON.stringify(answers), token);
    this.addEvent(intake.case_id, 'intake_submitted',
      `${intake.role === 'tenant' ? 'Tenant' : 'Landlord'} intake ${intake.submitted_at ? 'updated' : 'submitted'}`);
    return intake;
  }

  addNotification(n) {
    this.db.prepare('INSERT INTO notifications (case_id, role, channel, recipient, body) VALUES (?, ?, ?, ?, ?)')
      .run(n.case_id, n.role, n.channel, n.recipient, n.body);
  }

  notifications(caseId) {
    const sql = caseId
      ? 'SELECT n.*, c.case_number FROM notifications n JOIN cases c ON c.id = n.case_id WHERE n.case_id = ? ORDER BY n.id DESC'
      : 'SELECT n.*, c.case_number FROM notifications n JOIN cases c ON c.id = n.case_id ORDER BY n.id DESC LIMIT 200';
    return (caseId ? this.db.prepare(sql).all(caseId) : this.db.prepare(sql).all()).map((r) => ({ ...r }));
  }

  addEvent(caseId, type, detail = '') {
    this.db.prepare('INSERT INTO events (case_id, type, detail) VALUES (?, ?, ?)').run(caseId, type, detail);
  }

  events(caseId) {
    return this.db.prepare('SELECT * FROM events WHERE case_id = ? ORDER BY id DESC').all(caseId).map((r) => ({ ...r }));
  }
}
