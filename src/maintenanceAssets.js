// Maintenance & Assets: a fixed-asset register (buildings, equipment —
// distinct from inventory.js, which tracks consumable/issuable stock)
// with straight-line/declining-balance depreciation, plus work orders
// that anyone can raise and staff can assign and resolve.
// Additive-only — new tables, own file.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS fixed_assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  location TEXT,
  purchase_cost REAL NOT NULL,
  purchase_date TEXT NOT NULL,
  depreciation_method TEXT NOT NULL DEFAULT 'straight_line' CHECK(depreciation_method IN ('straight_line','declining_balance')),
  useful_life_years REAL NOT NULL DEFAULT 5,
  salvage_value REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','under_maintenance','disposed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assets_status ON fixed_assets(status);

CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  asset_id TEXT REFERENCES fixed_assets(id),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'other' CHECK(category IN ('electrical','plumbing','civil','it','other')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','assigned','in_progress','completed','cancelled')),
  raised_by TEXT NOT NULL REFERENCES users(id),
  assigned_to TEXT REFERENCES users(id),
  resolution_notes TEXT,
  cost REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  assigned_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wo_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_wo_raised_by ON work_orders(raised_by);
CREATE INDEX IF NOT EXISTS idx_wo_assigned_to ON work_orders(assigned_to);
`);

function uid() {
  return crypto.randomUUID();
}
function fail(message, status) {
  return Object.assign(new Error(message), { status: status || 400 });
}

// ---------------------------------------------------------------- Assets

function addAsset({ name, category, location, purchaseCost, purchaseDate, depreciationMethod, usefulLifeYears, salvageValue }) {
  if (!name || !String(name).trim()) throw fail('name is required');
  const cost = Number(purchaseCost);
  if (!Number.isFinite(cost) || cost < 0) throw fail('purchaseCost must be a non-negative number');
  if (!purchaseDate || Number.isNaN(Date.parse(purchaseDate))) throw fail('purchaseDate must be a valid date');
  const method = ['straight_line', 'declining_balance'].includes(depreciationMethod) ? depreciationMethod : 'straight_line';
  const life = Number(usefulLifeYears) > 0 ? Number(usefulLifeYears) : 5;
  const salvage = Number(salvageValue) >= 0 ? Number(salvageValue) : 0;

  const id = uid();
  db.prepare(
    `INSERT INTO fixed_assets (id, name, category, location, purchase_cost, purchase_date, depreciation_method, useful_life_years, salvage_value)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(id, String(name).trim(), category || null, location || null, cost, purchaseDate, method, life, salvage);
  return getAsset(id);
}

function getAsset(id) {
  return db.prepare('SELECT * FROM fixed_assets WHERE id = ?').get(id) || null;
}

function listAssets({ status, category } = {}) {
  let sql = 'SELECT * FROM fixed_assets WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params);
}

function updateAssetStatus({ id, status }) {
  const row = getAsset(id);
  if (!row) throw fail('Asset not found', 404);
  const VALID = ['active', 'under_maintenance', 'disposed'];
  if (!VALID.includes(status)) throw fail(`status must be one of ${VALID.join(', ')}`);
  db.prepare(`UPDATE fixed_assets SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  return getAsset(id);
}

// Depreciation as of a given date (defaults to today). Straight-line:
// even write-off over the useful life. Declining-balance: a fixed
// percentage (2/life, i.e. double-declining) of remaining book value
// each year. Both are floored at the salvage value.
function calculateDepreciation(id, asOfDate) {
  const asset = getAsset(id);
  if (!asset) throw fail('Asset not found', 404);
  const asOf = asOfDate ? new Date(asOfDate) : new Date();
  if (Number.isNaN(asOf.getTime())) throw fail('asOfDate must be a valid date');

  const purchased = new Date(asset.purchase_date);
  const yearsElapsed = Math.max(0, (asOf - purchased) / (365.25 * 24 * 3600 * 1000));
  const cost = asset.purchase_cost;
  const salvage = asset.salvage_value;
  const life = asset.useful_life_years;

  let bookValue;
  let accumulatedDepreciation;

  if (asset.depreciation_method === 'declining_balance') {
    const rate = Math.min(1, 2 / life);
    bookValue = cost * Math.pow(1 - rate, Math.min(yearsElapsed, life));
    bookValue = Math.max(bookValue, salvage);
    accumulatedDepreciation = cost - bookValue;
  } else {
    const annualDepreciation = (cost - salvage) / life;
    accumulatedDepreciation = Math.min(annualDepreciation * yearsElapsed, cost - salvage);
    bookValue = cost - accumulatedDepreciation;
  }

  return {
    assetId: id,
    asOfDate: asOf.toISOString().slice(0, 10),
    method: asset.depreciation_method,
    purchaseCost: cost,
    salvageValue: salvage,
    yearsElapsed: Math.round(yearsElapsed * 100) / 100,
    accumulatedDepreciation: Math.round(accumulatedDepreciation * 100) / 100,
    bookValue: Math.round(bookValue * 100) / 100,
  };
}

// ------------------------------------------------------------ Work orders

const CATEGORIES = ['electrical', 'plumbing', 'civil', 'it', 'other'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['open', 'assigned', 'in_progress', 'completed', 'cancelled'];

function raiseWorkOrder({ assetId, title, description, category, priority, raisedBy }) {
  if (!title || !String(title).trim()) throw fail('title is required');
  if (!raisedBy) throw fail('raisedBy is required');
  if (assetId && !getAsset(assetId)) throw fail('Asset not found', 404);
  const cleanCategory = CATEGORIES.includes(category) ? category : 'other';
  const cleanPriority = PRIORITIES.includes(priority) ? priority : 'medium';

  const id = uid();
  db.prepare(
    `INSERT INTO work_orders (id, asset_id, title, description, category, priority, raised_by)
     VALUES (?,?,?,?,?,?,?)`
  ).run(id, assetId || null, String(title).trim(), description || null, cleanCategory, cleanPriority, raisedBy);
  return getWorkOrder(id);
}

function getWorkOrder(id) {
  return db.prepare('SELECT * FROM work_orders WHERE id = ?').get(id) || null;
}

function assignWorkOrder({ id, assignedTo }) {
  const row = getWorkOrder(id);
  if (!row) throw fail('Work order not found', 404);
  if (['completed', 'cancelled'].includes(row.status)) throw fail(`Cannot assign a work order that is ${row.status}`, 409);
  if (!assignedTo) throw fail('assignedTo is required');
  db.prepare(
    `UPDATE work_orders SET assigned_to = ?, status = 'assigned', assigned_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).run(assignedTo, id);
  return getWorkOrder(id);
}

function updateWorkOrderStatus({ id, status, resolutionNotes, cost }) {
  const row = getWorkOrder(id);
  if (!row) throw fail('Work order not found', 404);
  if (['completed', 'cancelled'].includes(row.status)) throw fail(`Work order is already ${row.status}`, 409);
  if (!STATUSES.includes(status)) throw fail(`status must be one of ${STATUSES.join(', ')}`);
  if (status === 'completed' && !resolutionNotes) throw fail('resolutionNotes is required to mark a work order completed');

  const completedAtClause = status === 'completed' ? "datetime('now')" : 'completed_at';
  db.prepare(
    `UPDATE work_orders SET status = ?, resolution_notes = ?, cost = ?, updated_at = datetime('now'),
     completed_at = ${completedAtClause} WHERE id = ?`
  ).run(status, resolutionNotes || row.resolution_notes, cost != null ? Number(cost) : row.cost, id);

  if (status === 'completed' && row.asset_id) {
    db.prepare(`UPDATE fixed_assets SET status = 'active', updated_at = datetime('now') WHERE id = ? AND status = 'under_maintenance'`)
      .run(row.asset_id);
  }
  return getWorkOrder(id);
}

function listWorkOrders({ status, priority, category, assetId } = {}) {
  let sql = 'SELECT * FROM work_orders WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (priority) { sql += ' AND priority = ?'; params.push(priority); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (assetId) { sql += ' AND asset_id = ?'; params.push(assetId); }
  sql += ' ORDER BY CASE priority WHEN \'urgent\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END, created_at DESC';
  return db.prepare(sql).all(...params);
}

function myWorkOrders(userId) {
  return db.prepare(
    'SELECT * FROM work_orders WHERE raised_by = ? OR assigned_to = ? ORDER BY created_at DESC'
  ).all(userId, userId);
}

module.exports = {
  CATEGORIES, PRIORITIES, STATUSES,
  addAsset, getAsset, listAssets, updateAssetStatus, calculateDepreciation,
  raiseWorkOrder, getWorkOrder, assignWorkOrder, updateWorkOrderStatus, listWorkOrders, myWorkOrders,
};
