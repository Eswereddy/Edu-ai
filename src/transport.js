// Transport management: bus routes, stops, and student subscriptions.
// Additive — new tables only.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS transport_routes (
  id TEXT PRIMARY KEY,
  route_name TEXT NOT NULL,
  vehicle_number TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  capacity INTEGER NOT NULL DEFAULT 40,
  subscribed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transport_stops (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES transport_routes(id),
  stop_name TEXT NOT NULL,
  stop_order INTEGER NOT NULL DEFAULT 0,
  pickup_time TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transport_stops_route ON transport_stops(route_id);

CREATE TABLE IF NOT EXISTS transport_subscriptions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  route_id TEXT NOT NULL REFERENCES transport_routes(id),
  stop_id TEXT REFERENCES transport_stops(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
  subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_transport_sub_student ON transport_subscriptions(student_id);
`);

function uid() {
  return crypto.randomUUID();
}

function addRoute({ routeName, vehicleNumber, driverName, driverPhone, capacity }) {
  if (!routeName) throw Object.assign(new Error('routeName is required'), { status: 400 });
  const id = uid();
  db.prepare(
    'INSERT INTO transport_routes (id, route_name, vehicle_number, driver_name, driver_phone, capacity) VALUES (?,?,?,?,?,?)'
  ).run(id, routeName, vehicleNumber || null, driverName || null, driverPhone || null, capacity ? Number(capacity) : 40);
  return db.prepare('SELECT * FROM transport_routes WHERE id = ?').get(id);
}

function listRoutes() {
  return db.prepare('SELECT * FROM transport_routes ORDER BY route_name').all();
}

function addStop({ routeId, stopName, stopOrder, pickupTime }) {
  const route = db.prepare('SELECT * FROM transport_routes WHERE id = ?').get(routeId);
  if (!route) throw Object.assign(new Error('Route not found'), { status: 404 });
  if (!stopName) throw Object.assign(new Error('stopName is required'), { status: 400 });
  const id = uid();
  db.prepare('INSERT INTO transport_stops (id, route_id, stop_name, stop_order, pickup_time) VALUES (?,?,?,?,?)')
    .run(id, routeId, stopName, stopOrder != null ? Number(stopOrder) : 0, pickupTime || null);
  return db.prepare('SELECT * FROM transport_stops WHERE id = ?').get(id);
}

function listStops(routeId) {
  return db.prepare('SELECT * FROM transport_stops WHERE route_id = ? ORDER BY stop_order').all(routeId);
}

function activeSubscriptionForStudent(studentId) {
  return db.prepare("SELECT * FROM transport_subscriptions WHERE student_id = ? AND status = 'active'").get(studentId);
}

function subscribe({ studentId, routeId, stopId }) {
  const route = db.prepare('SELECT * FROM transport_routes WHERE id = ?').get(routeId);
  if (!route) throw Object.assign(new Error('Route not found'), { status: 404 });
  if (activeSubscriptionForStudent(studentId)) {
    throw Object.assign(new Error('Student already has an active transport subscription'), { status: 409 });
  }
  if (route.subscribed_count >= route.capacity) throw Object.assign(new Error('This route is full'), { status: 409 });
  const id = uid();
  db.prepare('INSERT INTO transport_subscriptions (id, student_id, route_id, stop_id) VALUES (?,?,?,?)')
    .run(id, studentId, routeId, stopId || null);
  db.prepare('UPDATE transport_routes SET subscribed_count = subscribed_count + 1 WHERE id = ?').run(routeId);
  return db.prepare('SELECT * FROM transport_subscriptions WHERE id = ?').get(id);
}

function cancelSubscription(id, studentId) {
  const row = db.prepare('SELECT * FROM transport_subscriptions WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Subscription not found'), { status: 404 });
  if (studentId && row.student_id !== studentId) throw Object.assign(new Error('Not authorized'), { status: 403 });
  if (row.status !== 'active') throw Object.assign(new Error('Subscription already cancelled'), { status: 409 });
  db.prepare(`UPDATE transport_subscriptions SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?`).run(id);
  db.prepare('UPDATE transport_routes SET subscribed_count = MAX(subscribed_count - 1, 0) WHERE id = ?').run(row.route_id);
  return db.prepare('SELECT * FROM transport_subscriptions WHERE id = ?').get(id);
}

function listSubscriptions({ status, routeId } = {}) {
  let sql = 'SELECT * FROM transport_subscriptions WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (routeId) { sql += ' AND route_id = ?'; params.push(routeId); }
  sql += ' ORDER BY subscribed_at DESC';
  return db.prepare(sql).all(...params);
}

module.exports = {
  addRoute, listRoutes, addStop, listStops,
  subscribe, cancelSubscription, activeSubscriptionForStudent, listSubscriptions,
};
