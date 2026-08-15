// Security & Visitor Management: QR-code visitor entry passes with
// check-in/check-out, a CCTV camera registry (metadata only — this is
// software plumbing for an NVR/DVR integration to call into later, not
// a live video feed), and campus parking slot allocation + entry/exit
// logs. Additive-only — new tables, own file.
//
// NOTE on "CCTV integration": there's no video pipeline here — that's
// hardware/NVR software. What this gives you is a camera registry
// (location, status, feed URL for a viewer to embed) an actual NVR
// system can sync into.
//
// Roles: there's no dedicated "security" account role in this system
// (users.role is capped at student/faculty/parent/admin/ai-admin), so
// gate/security-desk operations here are performed by admin/ai-admin
// users, same convention used by hostelMess.js for staff-only actions.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS visitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  purpose TEXT,
  host_user_id TEXT REFERENCES users(id),
  expected_at TEXT,
  qr_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','checked_in','checked_out','cancelled')),
  checked_in_at TEXT,
  checked_out_at TEXT,
  checked_in_by TEXT,
  checked_out_by TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_visitors_status ON visitors(status);
CREATE INDEX IF NOT EXISTS idx_visitors_host ON visitors(host_user_id);

CREATE TABLE IF NOT EXISTS cctv_cameras (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  feed_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','maintenance')),
  installed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parking_slots (
  id TEXT PRIMARY KEY,
  slot_number TEXT NOT NULL UNIQUE,
  vehicle_type TEXT NOT NULL DEFAULT 'car' CHECK(vehicle_type IN ('car','bike','other')),
  status TEXT NOT NULL DEFAULT 'free' CHECK(status IN ('free','occupied','reserved')),
  reserved_for TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parking_logs (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES parking_slots(id),
  vehicle_number TEXT NOT NULL,
  driver_name TEXT,
  entry_at TEXT NOT NULL DEFAULT (datetime('now')),
  exit_at TEXT,
  logged_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_parking_logs_slot ON parking_logs(slot_id);
`);

function uid() {
  return crypto.randomUUID();
}
function fail(message, status) {
  return Object.assign(new Error(message), { status: status || 400 });
}

// ------------------------------------------------------------- Visitors

function createVisitorPass({ name, phone, purpose, hostUserId, expectedAt, createdBy }) {
  if (!name || !String(name).trim()) throw fail('name is required');
  const id = uid();
  const qrCode = crypto.randomBytes(16).toString('hex');
  db.prepare(
    `INSERT INTO visitors (id, name, phone, purpose, host_user_id, expected_at, qr_code, created_by)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, String(name).trim(), phone || null, purpose || null, hostUserId || null, expectedAt || null, qrCode, createdBy || null);
  return getVisitor(id);
}

function getVisitor(id) {
  return db.prepare('SELECT * FROM visitors WHERE id = ?').get(id) || null;
}

function getVisitorByQr(qrCode) {
  return db.prepare('SELECT * FROM visitors WHERE qr_code = ?').get(qrCode) || null;
}

function listVisitors({ status, hostUserId, from, to } = {}) {
  let sql = 'SELECT * FROM visitors WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (hostUserId) { sql += ' AND host_user_id = ?'; params.push(hostUserId); }
  if (from) { sql += ' AND date(created_at) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(created_at) <= date(?)'; params.push(to); }
  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params);
}

function myVisitors(hostUserId) {
  return listVisitors({ hostUserId });
}

function checkInVisitor({ id, qrCode, checkedInBy }) {
  const row = id ? getVisitor(id) : getVisitorByQr(qrCode);
  if (!row) throw fail('Visitor pass not found', 404);
  if (row.status === 'checked_in') throw fail('Visitor is already checked in', 409);
  if (row.status === 'checked_out') throw fail('Visitor has already checked out', 409);
  if (row.status === 'cancelled') throw fail('This visitor pass was cancelled', 409);
  db.prepare(
    `UPDATE visitors SET status = 'checked_in', checked_in_at = datetime('now'), checked_in_by = ? WHERE id = ?`
  ).run(checkedInBy || null, row.id);
  return getVisitor(row.id);
}

function checkOutVisitor({ id, checkedOutBy }) {
  const row = getVisitor(id);
  if (!row) throw fail('Visitor pass not found', 404);
  if (row.status !== 'checked_in') throw fail('Visitor has not checked in', 409);
  db.prepare(
    `UPDATE visitors SET status = 'checked_out', checked_out_at = datetime('now'), checked_out_by = ? WHERE id = ?`
  ).run(checkedOutBy || null, id);
  return getVisitor(id);
}

function cancelVisitorPass(id) {
  const row = getVisitor(id);
  if (!row) throw fail('Visitor pass not found', 404);
  if (row.status !== 'pending') throw fail(`Cannot cancel a pass that is ${row.status}`, 409);
  db.prepare(`UPDATE visitors SET status = 'cancelled' WHERE id = ?`).run(id);
  return getVisitor(id);
}

// --------------------------------------------------------------- CCTV

function addCamera({ name, location, feedUrl, installedAt }) {
  if (!name || !String(name).trim()) throw fail('name is required');
  if (!location || !String(location).trim()) throw fail('location is required');
  const id = uid();
  db.prepare(
    `INSERT INTO cctv_cameras (id, name, location, feed_url, installed_at) VALUES (?,?,?,?,?)`
  ).run(id, String(name).trim(), String(location).trim(), feedUrl || null, installedAt || null);
  return db.prepare('SELECT * FROM cctv_cameras WHERE id = ?').get(id);
}

function listCameras({ status, location } = {}) {
  let sql = 'SELECT * FROM cctv_cameras WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (location) { sql += ' AND location LIKE ?'; params.push(`%${location}%`); }
  sql += ' ORDER BY location';
  return db.prepare(sql).all(...params);
}

function updateCameraStatus({ id, status }) {
  const row = db.prepare('SELECT * FROM cctv_cameras WHERE id = ?').get(id);
  if (!row) throw fail('Camera not found', 404);
  const VALID = ['active', 'inactive', 'maintenance'];
  if (!VALID.includes(status)) throw fail(`status must be one of ${VALID.join(', ')}`);
  db.prepare(`UPDATE cctv_cameras SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  return db.prepare('SELECT * FROM cctv_cameras WHERE id = ?').get(id);
}

// ------------------------------------------------------------- Parking

function addParkingSlot({ slotNumber, vehicleType, reservedFor }) {
  if (!slotNumber || !String(slotNumber).trim()) throw fail('slotNumber is required');
  const VALID_TYPES = ['car', 'bike', 'other'];
  const type = VALID_TYPES.includes(vehicleType) ? vehicleType : 'car';
  const id = uid();
  try {
    db.prepare(
      `INSERT INTO parking_slots (id, slot_number, vehicle_type, status, reserved_for) VALUES (?,?,?,?,?)`
    ).run(id, String(slotNumber).trim(), type, reservedFor ? 'reserved' : 'free', reservedFor || null);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw fail('A slot with that number already exists', 409);
    throw e;
  }
  return db.prepare('SELECT * FROM parking_slots WHERE id = ?').get(id);
}

function listParkingSlots({ status, vehicleType } = {}) {
  let sql = 'SELECT * FROM parking_slots WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (vehicleType) { sql += ' AND vehicle_type = ?'; params.push(vehicleType); }
  sql += ' ORDER BY slot_number';
  return db.prepare(sql).all(...params);
}

function logEntry({ slotId, vehicleNumber, driverName, loggedBy }) {
  const slot = db.prepare('SELECT * FROM parking_slots WHERE id = ?').get(slotId);
  if (!slot) throw fail('Parking slot not found', 404);
  if (slot.status === 'occupied') throw fail('Slot is already occupied', 409);
  if (!vehicleNumber || !String(vehicleNumber).trim()) throw fail('vehicleNumber is required');

  const id = uid();
  db.prepare(
    `INSERT INTO parking_logs (id, slot_id, vehicle_number, driver_name, logged_by) VALUES (?,?,?,?,?)`
  ).run(id, slotId, String(vehicleNumber).trim().toUpperCase(), driverName || null, loggedBy || null);
  db.prepare(`UPDATE parking_slots SET status = 'occupied' WHERE id = ?`).run(slotId);
  return db.prepare('SELECT * FROM parking_logs WHERE id = ?').get(id);
}

function logExit(logId) {
  const row = db.prepare('SELECT * FROM parking_logs WHERE id = ?').get(logId);
  if (!row) throw fail('Parking log entry not found', 404);
  if (row.exit_at) throw fail('This vehicle has already exited', 409);
  db.prepare(`UPDATE parking_logs SET exit_at = datetime('now') WHERE id = ?`).run(logId);
  db.prepare(`UPDATE parking_slots SET status = 'free' WHERE id = ?`).run(row.slot_id);
  return db.prepare('SELECT * FROM parking_logs WHERE id = ?').get(logId);
}

function listParkingLogs({ slotId, active } = {}) {
  let sql = 'SELECT pl.*, ps.slot_number FROM parking_logs pl JOIN parking_slots ps ON ps.id = pl.slot_id WHERE 1=1';
  const params = [];
  if (slotId) { sql += ' AND pl.slot_id = ?'; params.push(slotId); }
  if (active) { sql += ' AND pl.exit_at IS NULL'; }
  sql += ' ORDER BY pl.entry_at DESC';
  return db.prepare(sql).all(...params);
}

module.exports = {
  createVisitorPass, getVisitor, getVisitorByQr, listVisitors, myVisitors,
  checkInVisitor, checkOutVisitor, cancelVisitorPass,
  addCamera, listCameras, updateCameraStatus,
  addParkingSlot, listParkingSlots, logEntry, logExit, listParkingLogs,
};
