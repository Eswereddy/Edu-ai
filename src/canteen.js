// Canteen: menu management + order placement/tracking. Additive — new
// tables only.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS canteen_menu (
  id TEXT PRIMARY KEY,
  item_name TEXT NOT NULL,
  category TEXT,
  price REAL NOT NULL,
  available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS canteen_orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  items_json TEXT NOT NULL,
  total_amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'placed' CHECK(status IN ('placed','preparing','ready','completed','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_canteen_orders_user ON canteen_orders(user_id);
`);

function uid() {
  return crypto.randomUUID();
}

function addMenuItem({ itemName, category, price }) {
  if (!itemName || price == null) throw Object.assign(new Error('itemName and price are required'), { status: 400 });
  const id = uid();
  db.prepare('INSERT INTO canteen_menu (id, item_name, category, price) VALUES (?,?,?,?)')
    .run(id, itemName, category || null, Number(price));
  return db.prepare('SELECT * FROM canteen_menu WHERE id = ?').get(id);
}

function listMenu({ availableOnly } = {}) {
  if (availableOnly) return db.prepare('SELECT * FROM canteen_menu WHERE available = 1 ORDER BY category, item_name').all();
  return db.prepare('SELECT * FROM canteen_menu ORDER BY category, item_name').all();
}

function setAvailability(id, available) {
  const item = db.prepare('SELECT * FROM canteen_menu WHERE id = ?').get(id);
  if (!item) throw Object.assign(new Error('Menu item not found'), { status: 404 });
  db.prepare('UPDATE canteen_menu SET available = ? WHERE id = ?').run(available ? 1 : 0, id);
  return db.prepare('SELECT * FROM canteen_menu WHERE id = ?').get(id);
}

function placeOrder({ userId, items }) {
  if (!Array.isArray(items) || items.length === 0) throw Object.assign(new Error('items must be a non-empty array'), { status: 400 });
  let total = 0;
  const resolved = [];
  for (const line of items) {
    const menuItem = db.prepare('SELECT * FROM canteen_menu WHERE id = ?').get(line.itemId);
    if (!menuItem || !menuItem.available) {
      throw Object.assign(new Error(`Menu item ${line.itemId} is not available`), { status: 409 });
    }
    const qty = Number(line.qty) || 1;
    total += menuItem.price * qty;
    resolved.push({ itemId: menuItem.id, itemName: menuItem.item_name, price: menuItem.price, qty });
  }
  const id = uid();
  db.prepare('INSERT INTO canteen_orders (id, user_id, items_json, total_amount) VALUES (?,?,?,?)')
    .run(id, userId, JSON.stringify(resolved), Math.round(total * 100) / 100);
  return getOrder(id);
}

function getOrder(id) {
  const row = db.prepare('SELECT * FROM canteen_orders WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, items: JSON.parse(row.items_json) };
}

function myOrders(userId) {
  return db.prepare('SELECT * FROM canteen_orders WHERE user_id = ? ORDER BY created_at DESC').all(userId)
    .map((r) => ({ ...r, items: JSON.parse(r.items_json) }));
}

function listOrders({ status } = {}) {
  const rows = status
    ? db.prepare('SELECT * FROM canteen_orders WHERE status = ? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM canteen_orders ORDER BY created_at DESC').all();
  return rows.map((r) => ({ ...r, items: JSON.parse(r.items_json) }));
}

function updateStatus(id, status) {
  if (!['placed', 'preparing', 'ready', 'completed', 'cancelled'].includes(status)) {
    throw Object.assign(new Error('Invalid status'), { status: 400 });
  }
  const row = db.prepare('SELECT * FROM canteen_orders WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Order not found'), { status: 404 });
  db.prepare(`UPDATE canteen_orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  return getOrder(id);
}

module.exports = { addMenuItem, listMenu, setAvailability, placeOrder, getOrder, myOrders, listOrders, updateStatus };
