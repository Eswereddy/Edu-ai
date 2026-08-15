// Live Bus GPS Tracking — additive companion to transport.js. Adds one
// new table (bus_locations) for driver/admin-reported positions, and a
// deterministic demo simulator that fills in a plausible live position
// when no real report has come in recently, so the feature is fully
// demoable without hardware. transport.js itself is untouched; this
// module only reads its exports (listStops, activeSubscriptionForStudent)
// and reads the transport_routes table it already owns.

const { db } = require('./db');
const transport = require('./transport');

db.exec(`
CREATE TABLE IF NOT EXISTS bus_locations (
  route_id TEXT PRIMARY KEY,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  speed_kmph REAL NOT NULL DEFAULT 0,
  heading_deg REAL NOT NULL DEFAULT 0,
  reported_by TEXT,
  updated_at TEXT NOT NULL
);
`);

// Demo waypoint loop (roughly around Kurnool, Andhra Pradesh) the
// simulated bus cycles through when no real driver location has been
// reported in the last few minutes. Clearly a demo/simulated position —
// never presented as a real hardware feed.
const DEMO_WAYPOINTS = [
  { lat: 15.8281, lng: 78.0373 },
  { lat: 15.8350, lng: 78.0460 },
  { lat: 15.8420, lng: 78.0520 },
  { lat: 15.8390, lng: 78.0610 },
  { lat: 15.8300, lng: 78.0580 },
  { lat: 15.8250, lng: 78.0480 },
];
const LOOP_MINUTES = 12;
const FRESH_REPORT_MINUTES = 10;

function simulatedPosition(routeId) {
  const seed = [...String(routeId)].reduce((s, c) => s + c.charCodeAt(0), 0);
  const nowMinutes = Date.now() / 60000;
  const t = ((nowMinutes + seed) % LOOP_MINUTES) / LOOP_MINUTES;
  const segCount = DEMO_WAYPOINTS.length;
  const segFloat = t * segCount;
  const segIdx = Math.floor(segFloat) % segCount;
  const segFrac = segFloat - Math.floor(segFloat);
  const a = DEMO_WAYPOINTS[segIdx];
  const b = DEMO_WAYPOINTS[(segIdx + 1) % segCount];
  const latitude = a.lat + (b.lat - a.lat) * segFrac;
  const longitude = a.lng + (b.lng - a.lng) * segFrac;
  const headingDeg = Math.round((((Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180) / Math.PI) + 360) % 360);
  const speedKmph = 26 + Math.round(Math.sin(t * Math.PI * 2) * 6);
  return { latitude, longitude, speedKmph, headingDeg, simulated: true, updatedAt: new Date().toISOString() };
}

function reportLocation(routeId, { latitude, longitude, speedKmph, headingDeg, reportedBy } = {}) {
  const route = db.prepare('SELECT id FROM transport_routes WHERE id = ?').get(routeId);
  if (!route) throw Object.assign(new Error('Route not found'), { status: 404 });
  if (latitude == null || longitude == null) {
    throw Object.assign(new Error('latitude and longitude are required'), { status: 400 });
  }
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO bus_locations (route_id, latitude, longitude, speed_kmph, heading_deg, reported_by, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(route_id) DO UPDATE SET latitude=excluded.latitude, longitude=excluded.longitude,
       speed_kmph=excluded.speed_kmph, heading_deg=excluded.heading_deg, reported_by=excluded.reported_by, updated_at=excluded.updated_at`
  ).run(routeId, Number(latitude), Number(longitude), speedKmph != null ? Number(speedKmph) : 0, headingDeg != null ? Number(headingDeg) : 0, reportedBy || null, updatedAt);
  return getLocation(routeId);
}

function getLocation(routeId) {
  const row = db.prepare('SELECT * FROM bus_locations WHERE route_id = ?').get(routeId);
  if (row) {
    const ageMinutes = (Date.now() - new Date(row.updated_at).getTime()) / 60000;
    if (ageMinutes <= FRESH_REPORT_MINUTES) {
      return {
        latitude: row.latitude, longitude: row.longitude, speedKmph: row.speed_kmph,
        headingDeg: row.heading_deg, updatedAt: row.updated_at, simulated: false,
      };
    }
  }
  return simulatedPosition(routeId);
}

function liveForRoute(routeId) {
  const route = db.prepare('SELECT * FROM transport_routes WHERE id = ?').get(routeId);
  if (!route) throw Object.assign(new Error('Route not found'), { status: 404 });
  return { route, stops: transport.listStops(routeId), location: getLocation(routeId) };
}

function liveForStudent(studentId) {
  const sub = transport.activeSubscriptionForStudent(studentId);
  if (!sub) return null;
  return liveForRoute(sub.route_id);
}

module.exports = { reportLocation, getLocation, liveForRoute, liveForStudent };
