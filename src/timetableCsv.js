// Timetable CSV export. Purely additive, read-only against the existing
// timetable.js module (untouched) — reuses its listForSection/listForFaculty.
const timetable = require('./timetable');

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

function sectionCsv(classSection) {
  const rows = timetable.listForSection(classSection).map((r) => ({
    day: timetable.DAY_NAMES[r.day_of_week] || r.day_of_week,
    period: r.period_no,
    startTime: r.start_time,
    endTime: r.end_time,
    subject: r.subject,
    facultyId: r.faculty_id,
    room: r.room,
  }));
  return toCsv(rows);
}

function facultyCsv(facultyId) {
  const rows = timetable.listForFaculty(facultyId).map((r) => ({
    day: timetable.DAY_NAMES[r.day_of_week] || r.day_of_week,
    period: r.period_no,
    startTime: r.start_time,
    endTime: r.end_time,
    subject: r.subject,
    classSection: r.class_section,
    room: r.room,
  }));
  return toCsv(rows);
}

module.exports = { sectionCsv, facultyCsv };
