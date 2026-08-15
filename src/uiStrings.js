// Shared UI-string dictionary — the common chrome text that appears in
// every portal (Student/Faculty/Parent/Admin/AI-Admin): nav labels,
// buttons, status words. A portal's frontend fetches this once per
// language (GET /api/i18n/strings/:lang) and swaps text client-side,
// instead of round-tripping every individual label through /translate.
// Additive — own file, translated via i18n.js, cached there too.

const BASE_STRINGS = {
  dashboard: 'Dashboard',
  profile: 'Profile',
  settings: 'Settings',
  logout: 'Logout',
  login: 'Login',
  save: 'Save',
  cancel: 'Cancel',
  submit: 'Submit',
  delete: 'Delete',
  edit: 'Edit',
  search: 'Search',
  notifications: 'Notifications',
  attendance: 'Attendance',
  grades: 'Grades',
  timetable: 'Timetable',
  assignments: 'Assignments',
  fees: 'Fees',
  exams: 'Exams',
  library: 'Library',
  events: 'Events',
  messages: 'Messages',
  forum: 'Forum',
  certificates: 'Certificates',
  placements: 'Placements',
  jobTracker: 'Job Tracker',
  wellness: 'Wellness',
  gamification: 'Rewards',
  hostel: 'Hostel',
  transport: 'Transport',
  leave: 'Leave',
  syllabus: 'Syllabus',
  studyPlanner: 'Study Planner',
  backlog: 'Backlog',
  gradebook: 'Gradebook',
  classAnalytics: 'Class Analytics',
  facultyTasks: 'Tasks',
  facultyNotes: 'Notes',
  parentMeetings: 'Meetings',
  childProfile: "Child's Profile",
  payroll: 'Payroll',
  admissions: 'Admissions',
  inventory: 'Inventory',
  security: 'Security',
  maintenance: 'Maintenance',
  aiAdminPortal: 'AI Admin Portal',
  aiFunctionHub: 'AI Function Hub',
  vectorDatabase: 'Vector Database',
  jobCenter: 'Job Center',
  loading: 'Loading...',
  error: 'Something went wrong',
  success: 'Success',
  areYouSure: 'Are you sure?',
  yes: 'Yes',
  no: 'No',
  welcome: 'Welcome',
  home: 'Home',
  helpAndSupport: 'Help & Support',
  language: 'Language',
  changeLanguage: 'Change Language',
  today: 'Today',
  upcoming: 'Upcoming',
  status: 'Status',
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  present: 'Present',
  absent: 'Absent',
  viewAll: 'View All',
  download: 'Download',
  upload: 'Upload',
  send: 'Send',
  close: 'Close',
};

async function getTranslatedStrings(lang, opts) {
  const i18n = require('./i18n');
  const keys = Object.keys(BASE_STRINGS);
  const values = keys.map((k) => BASE_STRINGS[k]);
  const translated = await i18n.translateBatch(values, lang, opts);
  const dict = {};
  keys.forEach((k, i) => { dict[k] = translated[i].text; });
  return dict;
}

module.exports = { BASE_STRINGS, getTranslatedStrings };
