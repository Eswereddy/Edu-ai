// Inventory / asset management: stock items + issue-return tracking
// (lab equipment, sports gear, library-adjacent assets, etc — separate
// from the book-specific library module). Additive — new tables only.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'unit',
  total_qty INTEGER NOT NULL DEFAULT 0,
  available_qty INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_issues (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES inventory_items(id),
  issued_to TEXT NOT NULL,
  qty INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','returned')),
  issued_by TEXT,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  returned_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_inv_issues_to ON inventory_issues(issued_to);
CREATE INDEX IF NOT EXISTS idx_inv_issues_item ON inventory_issues(item_id);
`);

function uid() {
  return crypto.randomUUID();
}

function addItem({ name, category, unit, totalQty }) {
  if (!name) throw Object.assign(new Error('name is required'), { status: 400 });
  const id = uid();
  const qty = totalQty != null ? Number(totalQty) : 0;
  db.prepare(
    'INSERT INTO inventory_items (id, name, category, unit, total_qty, available_qty) VALUES (?,?,?,?,?,?)'
  ).run(id, name, category || null, unit || 'unit', qty, qty);
  return db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id);
}

function restock(itemId, qty) {
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(itemId);
  if (!item) throw Object.assign(new Error('Item not found'), { status: 404 });
  const addQty = Number(qty);
  if (!addQty || addQty <= 0) throw Object.assign(new Error('qty must be a positive number'), { status: 400 });
  db.prepare('UPDATE inventory_items SET total_qty = total_qty + ?, available_qty = available_qty + ? WHERE id = ?')
    .run(addQty, addQty, itemId);
  return db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(itemId);
}

function listItems() {
  return db.prepare('SELECT * FROM inventory_items ORDER BY name').all();
}

function issueItem({ itemId, issuedTo, qty, issuedBy }) {
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(itemId);
  if (!item) throw Object.assign(new Error('Item not found'), { status: 404 });
  const issueQty = Number(qty) || 1;
  if (item.available_qty < issueQty) throw Object.assign(new Error('Not enough stock available'), { status: 409 });
  if (!issuedTo) throw Object.assign(new Error('issuedTo is required'), { status: 400 });
  const id = uid();
  db.prepare('INSERT INTO inventory_issues (id, item_id, issued_to, qty, issued_by) VALUES (?,?,?,?,?)')
    .run(id, itemId, issuedTo, issueQty, issuedBy || null);
  db.prepare('UPDATE inventory_items SET available_qty = available_qty - ? WHERE id = ?').run(issueQty, itemId);
  return db.prepare('SELECT * FROM inventory_issues WHERE id = ?').get(id);
}

function returnItem(issueId) {
  const row = db.prepare('SELECT * FROM inventory_issues WHERE id = ?').get(issueId);
  if (!row) throw Object.assign(new Error('Issue record not found'), { status: 404 });
  if (row.status !== 'issued') throw Object.assign(new Error('Already returned'), { status: 409 });
  db.prepare(`UPDATE inventory_issues SET status = 'returned', returned_at = datetime('now') WHERE id = ?`).run(issueId);
  db.prepare('UPDATE inventory_items SET available_qty = available_qty + ? WHERE id = ?').run(row.qty, row.item_id);
  return db.prepare('SELECT * FROM inventory_issues WHERE id = ?').get(issueId);
}

function listIssues({ status } = {}) {
  if (status) return db.prepare('SELECT * FROM inventory_issues WHERE status = ? ORDER BY issued_at DESC').all(status);
  return db.prepare('SELECT * FROM inventory_issues ORDER BY issued_at DESC').all();
}

function myIssues(userId) {
  return db.prepare('SELECT * FROM inventory_issues WHERE issued_to = ? ORDER BY issued_at DESC').all(userId);
}

module.exports = { addItem, restock, listItems, issueItem, returnItem, listIssues, myIssues };
