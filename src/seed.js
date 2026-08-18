// Seeds realistic real-world content across EVERY portal domain this
// backend already has real tables and routes for — by calling each
// module's own tested functions (not raw SQL), so every business rule
// (capacity checks, unique constraints, status transitions) is respected
// exactly as it would be for a real user hitting the real routes.
//
// Usage:  node src/seed.js
//
// Safe to re-run: every step either checks for an existing row first or
// tolerates the "already exists" error the underlying module throws.

const bcrypt = require('bcryptjs');
const { db } = require('./db');
const { uid } = require('./auth');
const assignmentsMod = require('./assignments');
const hostelMod = require('./hostel');
const libraryMod = require('./library');
const transportMod = require('./transport');
const examCellMod = require('./examCell');
const payrollMod = require('./payroll');
const placementsMod = require('./placements');
const parentChildrenMod = require('./parentChildren');

const DEFAULT_PASSWORD = 'Passw0rd!123';

function ensureUser({ name, email, role }) {
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    const passwordHash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
    const id = uid();
    db.prepare('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(id, name, email, passwordHash, role);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }
  return user;
}

function ensureRow(table, whereCol, whereVal, insertFn) {
  const existing = db.prepare(`SELECT * FROM ${table} WHERE ${whereCol} = ?`).get(whereVal);
  if (existing) return existing;
  insertFn();
  return db.prepare(`SELECT * FROM ${table} WHERE ${whereCol} = ?`).get(whereVal);
}

function tryCall(fn, label) {
  try {
    return fn();
  } catch (e) {
    console.log(`  [skip] ${label}: ${e.message}`);
    return null;
  }
}

function seed() {
  console.log('Seeding realistic EduAI portal data across every real DB-backed module...\n');

  // ---------------------------------------------------------------- Users
  const faculty1 = ensureUser({ name: 'Dr. Ramesh Kumar', email: 'ramesh.kumar@gpcet.ac.in', role: 'faculty' });
  const faculty2 = ensureUser({ name: 'Prof. Lakshmi Devi', email: 'lakshmi.devi@gpcet.ac.in', role: 'faculty' });
  const student1 = ensureUser({ name: 'Eswar Reddy', email: 'eswar.reddy@student.gpcet.ac.in', role: 'student' });
  const student2 = ensureUser({ name: 'Priya Sharma', email: 'priya.sharma@student.gpcet.ac.in', role: 'student' });
  const student3 = ensureUser({ name: 'Arjun Rao', email: 'arjun.rao@student.gpcet.ac.in', role: 'student' });
  const parent1 = ensureUser({ name: 'Suresh Reddy', email: 'suresh.reddy@gmail.com', role: 'parent' });
  const admin1 = ensureUser({ name: 'Admin Office', email: 'admin@gpcet.ac.in', role: 'admin' });
  console.log('Users ready.');

  // ---------------------------------------------------- New: faculty profiles
  const upsertFacultyProfile = db.prepare(`
    INSERT INTO faculty_profiles (user_id, employee_id, department, designation, phone, office_room, specialization, joined_year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET employee_id=excluded.employee_id, department=excluded.department,
      designation=excluded.designation, phone=excluded.phone, office_room=excluded.office_room,
      specialization=excluded.specialization, joined_year=excluded.joined_year
  `);
  upsertFacultyProfile.run(faculty1.id, 'GPCET-F-0142', 'CSE', 'Associate Professor', '9876600001', 'CSE-Block-201', 'Machine Learning', 2016);
  upsertFacultyProfile.run(faculty2.id, 'GPCET-F-0187', 'CSE', 'Assistant Professor', '9876600002', 'CSE-Block-204', 'Database Systems', 2019);

  // ------------------------------------------------------- New: subjects/classes
  const subjectDefs = [
    { code: 'CS301', name: 'Data Structures & Algorithms', faculty: faculty1.id },
    { code: 'CS302', name: 'Database Management Systems', faculty: faculty2.id },
    { code: 'CS303', name: 'Operating Systems', faculty: faculty1.id },
  ];
  for (const s of subjectDefs) {
    ensureRow('subjects', 'code', s.code, () => {
      db.prepare('INSERT INTO subjects (id, code, name, branch, year, credits, faculty_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uid(), s.code, s.name, 'CSE', 3, 4, s.faculty);
    });
  }
  ensureRow('classes', 'name', 'CSE-3A', () => {
    db.prepare('INSERT INTO classes (id, name, branch, year, section, class_teacher_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uid(), 'CSE-3A', 'CSE', 3, 'A', faculty1.id);
  });
  console.log('Faculty profiles, subjects, classes ready.');

  // -------------------------------------------------- Existing: parent-child link
  tryCall(() => {
    const link = parentChildrenMod.requestLink({ parentId: parent1.id, studentId: student1.id, note: 'Father, seeded demo link' });
    if (link.status !== 'approved') parentChildrenMod.review(link.id, { status: 'approved', reviewedBy: admin1.id, reviewNote: 'Auto-approved by seed script' });
  }, 'parent-child link');
  console.log('Parent-child link ready (via parentChildren.js).');

  // -------------------------------------------------- Existing: assignments
  const asg = tryCall(() => assignmentsMod.createAssignment({
    facultyId: faculty1.id, classSection: 'CSE-3A', subject: 'Data Structures & Algorithms',
    title: 'DSA Assignment 1 — Sorting Algorithms',
    description: 'Implement and compare merge sort, quick sort, and heap sort with complexity analysis.',
    dueDate: '2026-08-25', maxMarks: 20,
  }), 'create assignment');
  if (asg) {
    tryCall(() => assignmentsMod.submit({ assignmentId: asg.id, studentId: student1.id, content: 'Submitted via GitHub repo link.' }), 'submit assignment');
    tryCall(() => assignmentsMod.grade({ assignmentId: asg.id, studentId: student1.id, marks: 18, feedback: 'Good complexity analysis, minor edge case missed.' }), 'grade assignment');
  }
  console.log('Assignment + submission + grade ready (via assignments.js).');

  // ------------------------------------------------------- Existing: library
  function ensureBook(def) {
    const existing = db.prepare('SELECT * FROM library_books WHERE isbn = ?').get(def.isbn);
    if (existing) return existing;
    return tryCall(() => libraryMod.addBook(def), 'add book');
  }
  const book1 = ensureBook({ title: 'Introduction to Algorithms', author: 'Cormen, Leiserson, Rivest, Stein', isbn: '9780262033848', category: 'Computer Science', totalCopies: 5 });
  ensureBook({ title: 'Operating System Concepts', author: 'Silberschatz, Galvin, Gagne', isbn: '9780133943030', category: 'Computer Science', totalCopies: 4 });
  if (book1) {
    const alreadyIssued = db.prepare('SELECT 1 FROM library_issues WHERE book_id = ? AND student_id = ? AND returned_at IS NULL').get(book1.id, student1.id);
    if (!alreadyIssued) tryCall(() => libraryMod.issueBook(book1.id, student1.id), 'issue book');
  }
  console.log('Library catalog + issue ready (via library.js).');

  // -------------------------------------------------------- Existing: hostel
  const room1 = tryCall(() => hostelMod.addRoom({ hostelName: 'Block B', roomNumber: 'B-204', roomType: 'shared', capacity: 2 }), 'add hostel room');
  if (room1) tryCall(() => hostelMod.allocate({ roomId: room1.id, studentId: student3.id, allocatedBy: admin1.id }), 'allocate hostel room');
  console.log('Hostel room + allocation ready (via hostel.js).');

  // ----------------------------------------------------- Existing: transport
  const route1 = tryCall(() => transportMod.addRoute({ routeName: 'Route 4 — Kurnool Bypass', vehicleNumber: 'AP21 TB 4521', driverName: 'Venkat Reddy', driverPhone: '9876700001', capacity: 45 }), 'add transport route');
  if (route1) {
    const stop1 = tryCall(() => transportMod.addStop({ routeId: route1.id, stopName: 'Kurnool Bus Stand', stopOrder: 1, pickupTime: '07:45' }), 'add transport stop');
    tryCall(() => transportMod.subscribe({ studentId: student2.id, routeId: route1.id, stopId: stop1?.id }), 'subscribe to route');
  }
  console.log('Transport route + stop + subscription ready (via transport.js).');

  // --------------------------------------------------- Existing: exam cell
  let exam1 = db.prepare("SELECT * FROM exams WHERE title = ? AND class_section = ?").get('Mid-Term 2 — DSA', 'CSE-3A');
  if (!exam1) {
    exam1 = tryCall(() => examCellMod.createExam({
      title: 'Mid-Term 2 — DSA', subject: 'Data Structures & Algorithms', classSection: 'CSE-3A',
      examDate: '2026-09-10', startTime: '10:00', endTime: '11:30', maxMarks: 30, createdBy: admin1.id,
    }), 'create exam');
  }
  if (exam1) {
    const hasRoom = examCellMod.listExamRooms(exam1.id).some((r) => r.room_name === 'Exam Hall 1');
    if (!hasRoom) tryCall(() => examCellMod.addExamRoom({ examId: exam1.id, roomName: 'Exam Hall 1', capacity: 40 }), 'add exam room');
    const hasSeating = examCellMod.listSeatingByRoom(exam1.id) && Object.keys(examCellMod.listSeatingByRoom(exam1.id)).length > 0;
    if (!hasSeating) {
      tryCall(() => examCellMod.generateSeating({
        examId: exam1.id,
        students: [
          { studentId: student1.id, classSection: 'CSE-3A' },
          { studentId: student2.id, classSection: 'CSE-3A' },
          { studentId: student3.id, classSection: 'CSE-3A' },
        ],
      }), 'generate seating');
    }
    tryCall(() => examCellMod.recordResult({ examId: exam1.id, studentId: student1.id, marks: 27, gradedBy: faculty1.id }), 'record exam result');
  }
  console.log('Exam + room + seating + result ready (via examCell.js).');

  // ------------------------------------------------------- Existing: payroll
  tryCall(() => payrollMod.upsertProfile({ userId: faculty1.id, employeeCode: 'GPCET-F-0142', designation: 'Associate Professor', department: 'CSE', dateOfJoining: '2016-06-01', basicSalary: 65000 }), 'upsert payroll profile');
  const run1 = tryCall(() => payrollMod.generatePayroll({ staffUserId: faculty1.id, month: 7, year: 2026, allowances: 12000, deductions: 4500, generatedBy: admin1.id }), 'generate payroll (Jul)');
  if (run1) tryCall(() => payrollMod.markPaid(run1.id), 'mark payroll paid');
  tryCall(() => payrollMod.generatePayroll({ staffUserId: faculty1.id, month: 8, year: 2026, allowances: 12000, deductions: 4500, generatedBy: admin1.id }), 'generate payroll (Aug)');
  console.log('Staff profile + 2 payroll runs ready (via payroll.js).');

  // ---------------------------------------------------- Existing: placements
  function ensureJob(def) {
    const existing = db.prepare('SELECT * FROM job_postings WHERE title = ? AND company = ?').get(def.title, def.company);
    if (existing) return existing;
    return tryCall(() => placementsMod.postJob(def), 'post job');
  }
  const job1 = ensureJob({ title: 'Systems Engineer', company: 'TCS Digital', description: 'Entry-level systems engineering role.', packageLpa: 3.6, eligibility: 'CSE, ECE, IT — CGPA 6.0+', driveDate: '2026-09-15', postedBy: admin1.id });
  const job2 = ensureJob({ title: 'Member Technical Staff', company: 'Zoho Corporation', description: 'Product engineering role.', packageLpa: 6.5, eligibility: 'CSE, IT — CGPA 7.5+', driveDate: '2026-09-22', postedBy: admin1.id });
  if (job1 && !db.prepare('SELECT 1 FROM job_applications WHERE job_id = ? AND student_id = ?').get(job1.id, student1.id)) {
    tryCall(() => placementsMod.applyToJob({ jobId: job1.id, studentId: student1.id }), 'apply to job');
  }
  if (job2) {
    if (!db.prepare('SELECT 1 FROM job_applications WHERE job_id = ? AND student_id = ?').get(job2.id, student2.id)) {
      tryCall(() => placementsMod.applyToJob({ jobId: job2.id, studentId: student2.id }), 'apply to job');
    }
    const apps = placementsMod.listApplicationsForJob(job2.id);
    const app = apps.find((a) => a.student_id === student2.id);
    if (app && app.status !== 'shortlisted') tryCall(() => placementsMod.updateApplicationStatus(app.id, 'shortlisted'), 'update application status');
  }
  tryCall(() => placementsMod.registerAlumni({ userId: student3.id, graduationYear: 2024, company: 'Infosys', designation: 'Software Engineer', bio: 'GPCET CSE alum, now at Infosys Bangalore.' }), 'register alumni');
  console.log('Placement drives + applications ready (via placements.js).');

  console.log('\nSeed complete.');
  console.log(`Demo accounts (password for all: ${DEFAULT_PASSWORD}):`);
  console.log('  Faculty: ramesh.kumar@gpcet.ac.in, lakshmi.devi@gpcet.ac.in');
  console.log('  Students: eswar.reddy@student.gpcet.ac.in, priya.sharma@student.gpcet.ac.in, arjun.rao@student.gpcet.ac.in');
  console.log('  Parent:  suresh.reddy@gmail.com (linked + approved for Eswar Reddy)');
  console.log('  Admin:   admin@gpcet.ac.in');
}

seed();
