// Real-time layer on top of the existing busTracking.js / transportRoutes.
// Purely additive — busTracking.js, transportRoutes.js and
// busTrackingRoutes.js are all untouched. This file only *calls* their
// exported functions and adds two new things on top:
//
//   1. A "real GPS ping" entry point a driver's phone can hit repeatedly
//      (e.g. every 5-10s from navigator.geolocation.watchPosition) that
//      stores the position via the existing bus.reportLocation() — same
//      validation, same table — and then broadcasts it live.
//   2. Broadcasting: every parent/student subscribed to that route gets
//      the new position pushed instantly over the WebSocket connection
//      that already exists (src/ws.js + src/notify.js), via
//      notify.pushRaw so this never spams the persisted notifications
//      table with a row per GPS tick.
//
// If nobody has GOOGLE_TTS_API_KEY-style GPS hardware wired up yet, this
// still works today: any admin/faculty/driver account can POST here and
// the frontend map updates live instead of needing a manual refresh.

const { db } = require('./db');
const bus = require('./busTracking');
const transport = require('./transport');
const notify = require('./notify');

/** Every user who should see this route's live position: the students
 * subscribed to it, plus any parent linked to one of those students
 * (via the original users.linked_student_id field or an approved
 * parent_child_links row — both existing, both read-only here). */
function subscriberUserIds(routeId) {
  const ids = new Set();
  const subs = transport.listSubscriptions({ routeId, status: 'active' });
  if (subs.length === 0) return [];
  const studentIds = subs.map((s) => s.student_id);
  for (const id of studentIds) ids.add(id);

  const placeholders = studentIds.map(() => '?').join(',');
  try {
    const viaLinkedField = db
      .prepare(`SELECT id FROM users WHERE role = 'parent' AND linked_student_id IN (${placeholders})`)
      .all(...studentIds);
    for (const row of viaLinkedField) ids.add(row.id);
  } catch (_e) { /* users table always has this column; ignore if schema differs */ }

  try {
    const viaLinksTable = db
      .prepare(`SELECT parent_id FROM parent_child_links WHERE status = 'approved' AND student_id IN (${placeholders})`)
      .all(...studentIds);
    for (const row of viaLinksTable) ids.add(row.parent_id);
  } catch (_e) { /* parent_child_links may not have been touched yet; ignore */ }

  return [...ids];
}

/** Push a location update to every subscriber currently online. Offline
 * users simply get the next poll's REST response (unchanged) — this is
 * a live-only speedup, not a new source of truth. */
function broadcastLiveLocation(routeId, location) {
  const ids = subscriberUserIds(routeId);
  const payload = { kind: 'bus_location', routeId, location, at: new Date().toISOString() };
  let delivered = 0;
  for (const uid of ids) {
    if (notify.pushRaw(uid, payload)) delivered += 1;
  }
  return { targeted: ids.length, delivered };
}

/** Real GPS entry point. Same shape/validation as bus.reportLocation
 * (it calls it directly), plus the broadcast above. */
function reportRealGps(routeId, { latitude, longitude, speedKmph, headingDeg, reportedBy } = {}) {
  const location = bus.reportLocation(routeId, { latitude, longitude, speedKmph, headingDeg, reportedBy });
  broadcastLiveLocation(routeId, location);
  return location;
}

module.exports = { subscriberUserIds, broadcastLiveLocation, reportRealGps };
