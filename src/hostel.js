// Hostel management: room inventory + student allocation/vacate workflow.
// Additive — new tables only.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS hostel_rooms (
  id TEXT PRIMARY KEY,
  hostel_name TEXT NOT NULL,
  room_number TEXT NOT NULL,
  room_type TEXT NOT NULL DEFAULT 'shared',
  capacity INTEGER NOT NULL DEFAULT 1,
  occupied INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(hostel_name, room_number)
);

CREATE TABLE IF NOT EXISTS hostel_allocations (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES hostel_rooms(id),
  student_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','vacated')),
  allocated_by TEXT,
  allocated_at TEXT NOT NULL DEFAULT (datetime('now')),
  vacated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hostel_alloc_student ON hostel_allocations(student_id);
CREATE INDEX IF NOT EXISTS idx_hostel_alloc_room ON hostel_allocations(room_id);
`);

function uid() {
  return crypto.randomUUID();
}

function addRoom({ hostelName, roomNumber, roomType, capacity }) {
  if (!hostelName || !roomNumber) throw Object.assign(new Error('hostelName and roomNumber are required'), { status: 400 });
  const id = uid();
  db.prepare(
    'INSERT INTO hostel_rooms (id, hostel_name, room_number, room_type, capacity) VALUES (?,?,?,?,?)'
  ).run(id, hostelName, roomNumber, roomType || 'shared', capacity ? Number(capacity) : 1);
  return db.prepare('SELECT * FROM hostel_rooms WHERE id = ?').get(id);
}

function listRooms({ hostelName } = {}) {
  if (hostelName) return db.prepare('SELECT * FROM hostel_rooms WHERE hostel_name = ? ORDER BY room_number').all(hostelName);
  return db.prepare('SELECT * FROM hostel_rooms ORDER BY hostel_name, room_number').all();
}

function activeAllocationForStudent(studentId) {
  return db.prepare("SELECT * FROM hostel_allocations WHERE student_id = ? AND status = 'active'").get(studentId);
}

function allocate({ roomId, studentId, allocatedBy }) {
  const room = db.prepare('SELECT * FROM hostel_rooms WHERE id = ?').get(roomId);
  if (!room) throw Object.assign(new Error('Room not found'), { status: 404 });
  if (room.occupied >= room.capacity) throw Object.assign(new Error('Room is at full capacity'), { status: 409 });
  if (activeAllocationForStudent(studentId)) {
    throw Object.assign(new Error('Student already has an active hostel allocation'), { status: 409 });
  }
  const id = uid();
  db.prepare('INSERT INTO hostel_allocations (id, room_id, student_id, allocated_by) VALUES (?,?,?,?)')
    .run(id, roomId, studentId, allocatedBy || null);
  db.prepare('UPDATE hostel_rooms SET occupied = occupied + 1 WHERE id = ?').run(roomId);
  return db.prepare('SELECT * FROM hostel_allocations WHERE id = ?').get(id);
}

function vacate(allocationId) {
  const row = db.prepare('SELECT * FROM hostel_allocations WHERE id = ?').get(allocationId);
  if (!row) throw Object.assign(new Error('Allocation not found'), { status: 404 });
  if (row.status !== 'active') throw Object.assign(new Error('Allocation is already vacated'), { status: 409 });
  db.prepare(`UPDATE hostel_allocations SET status = 'vacated', vacated_at = datetime('now') WHERE id = ?`).run(allocationId);
  db.prepare('UPDATE hostel_rooms SET occupied = MAX(occupied - 1, 0) WHERE id = ?').run(row.room_id);
  return db.prepare('SELECT * FROM hostel_allocations WHERE id = ?').get(allocationId);
}

function listAllocations({ status } = {}) {
  if (status) return db.prepare('SELECT * FROM hostel_allocations WHERE status = ? ORDER BY allocated_at DESC').all(status);
  return db.prepare('SELECT * FROM hostel_allocations ORDER BY allocated_at DESC').all();
}

module.exports = { addRoom, listRooms, allocate, vacate, listAllocations, activeAllocationForStudent };
