// Shared, dependency-free ICS (iCalendar) text builder used by the
// syllabus/exam-schedule module and the holidays module. No new package
// needed — the format is plain text.

function foldLine(line) {
  // RFC5545 75-octet line folding (kept simple; fine for our short lines).
  if (line.length <= 75) return line;
  let out = '';
  let rest = line;
  while (rest.length > 75) {
    out += rest.slice(0, 75) + '\r\n ';
    rest = rest.slice(75);
  }
  return out + rest;
}

function escapeText(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function toIcsDate(dateStr) {
  // Accepts 'YYYY-MM-DD' -> all-day VALUE=DATE event.
  return String(dateStr).replace(/-/g, '');
}

/**
 * @param {string} calName
 * @param {Array<{uid:string, title:string, date:string, endDate?:string, description?:string, location?:string}>} events
 */
function buildIcs(calName, events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EduAI Platform//EN',
    `X-WR-CALNAME:${escapeText(calName)}`,
    'CALSCALE:GREGORIAN',
  ];
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.uid}@eduai-platform`);
    lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`);
    lines.push(`DTSTART;VALUE=DATE:${toIcsDate(ev.date)}`);
    lines.push(`DTEND;VALUE=DATE:${toIcsDate(ev.endDate || ev.date)}`);
    lines.push(foldLine(`SUMMARY:${escapeText(ev.title)}`));
    if (ev.description) lines.push(foldLine(`DESCRIPTION:${escapeText(ev.description)}`));
    if (ev.location) lines.push(foldLine(`LOCATION:${escapeText(ev.location)}`));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

module.exports = { buildIcs };
