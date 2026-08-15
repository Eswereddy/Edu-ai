// Admin approvals inbox: a single read-only aggregation of every
// "pending, waiting on a human" item across the platform's existing
// approval workflows — leave requests, certificate requests, admission
// applications, and parent-child link requests. Every one of those
// already has its own listPending()/listAll({status}) export (see
// leave.js, certificates.js, admissions.js, parentChildren.js); this
// module only calls them and reshapes the results into one unified,
// sortable list. It doesn't add a new approval mechanism and doesn't
// touch any of those modules — reviewing an item still happens through
// its own existing route (POST /api/leave/:id/review,
// /api/certificates/:id/review, /api/admissions/:id/review,
// /api/parent/children/:id/review), unchanged.

const leave = require('./leave');
const certificates = require('./certificates');
const admissions = require('./admissions');
const parentChildren = require('./parentChildren');

function safeList(fn, fallback = []) {
  try {
    return fn();
  } catch (_e) {
    return fallback;
  }
}

function inbox() {
  const leaveItems = safeList(() => leave.listPending()).map((r) => ({
    kind: 'leave_request',
    id: r.id,
    summary: `${r.user_role} leave: ${r.from_date} to ${r.to_date}`,
    requestedBy: r.user_id,
    createdAt: r.created_at,
  }));

  const certItems = safeList(() => certificates.listAll({ status: 'pending' })).map((r) => ({
    kind: 'certificate_request',
    id: r.id,
    summary: `${r.cert_type} certificate — ${r.purpose || 'no purpose given'}`,
    requestedBy: r.student_id,
    createdAt: r.created_at,
  }));

  const admissionItems = safeList(() => admissions.listApplications({ status: 'submitted' })).map((r) => ({
    kind: 'admission_application',
    id: r.id,
    summary: `${r.applicant_name} applied for ${r.course_applied}${r.class_section ? ` (${r.class_section})` : ''}`,
    requestedBy: r.email,
    createdAt: r.created_at,
  }));

  const parentLinkItems = safeList(() => parentChildren.listPending()).map((r) => ({
    kind: 'parent_child_link',
    id: r.id,
    summary: `Parent requests link to student ${r.student_id}`,
    requestedBy: r.parent_id,
    createdAt: r.created_at,
  }));

  const all = [...leaveItems, ...certItems, ...admissionItems, ...parentLinkItems].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );

  return {
    total: all.length,
    byKind: {
      leaveRequests: leaveItems.length,
      certificateRequests: certItems.length,
      admissionApplications: admissionItems.length,
      parentChildLinks: parentLinkItems.length,
    },
    items: all,
  };
}

module.exports = { inbox };
