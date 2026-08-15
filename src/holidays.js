// Holiday calendar with ICS export. Fully additive — own table, own file.

const crypto = require('crypto');
const { db } = require('./db');
const { buildIcs } = require('./icsHelper');

db.exec(`
CREATE TABLE IF NOT EXISTS holidays (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  holiday_date TEXT NOT NULL,
  end_date TEXT,
  description TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(holiday_date);
`);

function uid() {
  return crypto.randomUUID();
}

function addHoliday({ name, date, endDate, description, createdBy }) {
  if (!name || !date) throw Object.assign(new Error('name and date are required'), { status: 400 });
  const id = uid();
  db.prepare(
    `INSERT INTO holidays (id, name, holiday_date, end_date, description, created_by) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name, date, endDate || null, description || null, createdBy || null);
  return db.prepare('SELECT * FROM holidays WHERE id = ?').get(id);
}

function listHolidays({ year } = {}) {
  if (year) {
    return db.prepare("SELECT * FROM holidays WHERE strftime('%Y', holiday_date) = ? ORDER BY holiday_date ASC").all(String(year));
  }
  return db.prepare('SELECT * FROM holidays ORDER BY holiday_date ASC').all();
}

function deleteHoliday(id) {
  const row = db.prepare('SELECT id FROM holidays WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
  db.prepare('DELETE FROM holidays WHERE id = ?').run(id);
  return { deleted: true };
}

function holidaysIcs({ year } = {}) {
  const rows = listHolidays({ year });
  return buildIcs('Holiday Calendar', rows.map((r) => ({
    uid: r.id,
    title: r.name,
    date: r.holiday_date,
    endDate: r.end_date || r.holiday_date,
    description: r.description,
  })));
}

module.exports = { addHoliday, listHolidays, deleteHoliday, holidaysIcs };
