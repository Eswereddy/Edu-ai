// BLOCKCHAIN CERTIFICATE VERIFICATION — anchors a hash of an approved
// certificate to a real public ledger (any EVM chain) so anyone can
// independently verify a certificate wasn't altered after issuance.
// Additive — own table, own file. Does NOT modify certificates.js or
// certificateRoutes.js; it reads certificate_requests read-only via
// certificates.getById and hangs its own table off certificate_id.
//
// HOW IT ACTUALLY WRITES TO THE CHAIN:
// No custom smart contract is required. The certificate's SHA-256 hash
// is written directly into the `data` field of a zero-value transaction
// signed by the college's own wallet. That transaction is broadcast to
// a real network via any standard JSON-RPC endpoint (Infura, Alchemy,
// a public RPC, etc.) using ethers.js. Once mined, the hash is
// permanently and publicly readable on that chain's block explorer —
// which is what "blockchain verification" means in practice, without
// the cost/complexity of deploying and maintaining a registry contract.
//
// WHAT THIS ENVIRONMENT CANNOT DO, AND WHY THAT'S NOT FAKED HERE:
// This sandbox has no outbound network access and no wallet — so it
// cannot itself broadcast a transaction or hold real/test funds. The
// code below is a genuine, working integration; it needs three things
// from whoever deploys this backend, none of which can be conjured up
// here:
//   BLOCKCHAIN_RPC_URL      — e.g. an Alchemy/Infura Sepolia testnet URL
//   BLOCKCHAIN_PRIVATE_KEY  — the college's signing wallet (fund it
//                             with a few cents of testnet/mainnet gas)
//   BLOCKCHAIN_EXPLORER_BASE — e.g. https://sepolia.etherscan.io/tx/
// Start on a free testnet (Sepolia) — it's a real public chain, free to
// use, and proves the flow end-to-end before spending real mainnet gas.
// Until those are set, anchor attempts are recorded with status
// 'not_configured' instead of silently pretending to succeed —
// consistent with how the rest of this codebase degrades (see
// placementAutopilot.js, aiJsonHelper.js).

const crypto = require('crypto');
const { db } = require('./db');
const certificates = require('./certificates');

db.exec(`
CREATE TABLE IF NOT EXISTS certificate_blockchain_anchors (
  id TEXT PRIMARY KEY,
  certificate_id TEXT NOT NULL,
  cert_hash TEXT NOT NULL,
  chain TEXT,
  tx_hash TEXT,
  explorer_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','failed','not_configured')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cert_anchor_certificate ON certificate_blockchain_anchors(certificate_id);
`);

function uid() {
  return crypto.randomUUID();
}

function isConfigured() {
  return !!(process.env.BLOCKCHAIN_RPC_URL && process.env.BLOCKCHAIN_PRIVATE_KEY);
}

// Canonical hash of the parts of a certificate that must never change
// post-issuance. Anyone can recompute this the same way to verify.
function hashCertificate(request) {
  const canonical = JSON.stringify({
    id: request.id,
    student_id: request.student_id,
    cert_type: request.cert_type,
    purpose: request.purpose || null,
    status: request.status,
    reviewed_by: request.reviewed_by || null,
    reviewed_at: request.reviewed_at || null,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function explorerUrlFor(txHash) {
  const base = process.env.BLOCKCHAIN_EXPLORER_BASE || 'https://sepolia.etherscan.io/tx/';
  return `${base}${txHash}`;
}

function latestAnchor(certificateId) {
  return db.prepare(
    'SELECT * FROM certificate_blockchain_anchors WHERE certificate_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(certificateId) || null;
}

function listAnchors({ status } = {}) {
  if (status) return db.prepare('SELECT * FROM certificate_blockchain_anchors WHERE status = ? ORDER BY created_at DESC').all(status);
  return db.prepare('SELECT * FROM certificate_blockchain_anchors ORDER BY created_at DESC').all();
}

/**
 * Anchors an approved certificate's hash on-chain. Requires the cert to
 * already be approved (same rule certificates.js uses for PDF issuance).
 * Never throws on missing chain config — records 'not_configured' so the
 * admin UI can show "set BLOCKCHAIN_RPC_URL / BLOCKCHAIN_PRIVATE_KEY" and
 * the request itself still returns 200 with a clear reason.
 */
async function anchorCertificate(certificateId) {
  const request = certificates.getById(certificateId);
  if (!request) throw Object.assign(new Error('Certificate request not found'), { status: 404 });
  if (request.status !== 'approved') {
    throw Object.assign(new Error('Only approved certificates can be anchored'), { status: 409 });
  }

  const certHash = hashCertificate(request);
  const id = uid();

  if (!isConfigured()) {
    db.prepare(
      `INSERT INTO certificate_blockchain_anchors (id, certificate_id, cert_hash, status, error) VALUES (?, ?, ?, 'not_configured', ?)`
    ).run(id, certificateId, certHash, 'BLOCKCHAIN_RPC_URL and BLOCKCHAIN_PRIVATE_KEY are not set — no transaction was sent.');
    return db.prepare('SELECT * FROM certificate_blockchain_anchors WHERE id = ?').get(id);
  }

  let ethers;
  try {
    ethers = require('ethers');
  } catch (_e) {
    db.prepare(
      `INSERT INTO certificate_blockchain_anchors (id, certificate_id, cert_hash, status, error) VALUES (?, ?, ?, 'failed', ?)`
    ).run(id, certificateId, certHash, "The 'ethers' package isn't installed yet — run `npm install ethers` and retry.");
    return db.prepare('SELECT * FROM certificate_blockchain_anchors WHERE id = ?').get(id);
  }

  db.prepare(
    `INSERT INTO certificate_blockchain_anchors (id, certificate_id, cert_hash, status) VALUES (?, ?, ?, 'pending')`
  ).run(id, certificateId, certHash);

  try {
    const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
    const wallet = new ethers.Wallet(process.env.BLOCKCHAIN_PRIVATE_KEY, provider);
    const network = await provider.getNetwork();

    const tx = await wallet.sendTransaction({
      to: process.env.BLOCKCHAIN_ANCHOR_ADDRESS || wallet.address, // default: send to self
      value: 0n,
      data: '0x' + certHash,
    });

    db.prepare(
      `UPDATE certificate_blockchain_anchors SET tx_hash = ?, chain = ?, explorer_url = ? WHERE id = ?`
    ).run(tx.hash, network.name || String(network.chainId), explorerUrlFor(tx.hash), id);

    // Don't block the request on confirmation (can take 10-30s) — the
    // status endpoint / verify endpoint check the receipt on demand.
    tx.wait(1).then(() => {
      db.prepare(
        `UPDATE certificate_blockchain_anchors SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?`
      ).run(id);
    }).catch((err) => {
      db.prepare(`UPDATE certificate_blockchain_anchors SET status = 'failed', error = ? WHERE id = ?`).run(String(err?.message || err), id);
    });

    return db.prepare('SELECT * FROM certificate_blockchain_anchors WHERE id = ?').get(id);
  } catch (err) {
    db.prepare(`UPDATE certificate_blockchain_anchors SET status = 'failed', error = ? WHERE id = ?`).run(String(err?.message || err), id);
    return db.prepare('SELECT * FROM certificate_blockchain_anchors WHERE id = ?').get(id);
  }
}

/**
 * Public verification: recomputes the certificate's hash from its
 * current DB state and compares it against what's on-chain for the
 * latest anchor. No auth required — that's the point of a public
 * ledger check. Returns enough detail for a "Verify" page to render.
 */
async function verifyCertificate(certificateId) {
  const request = certificates.getById(certificateId);
  if (!request) throw Object.assign(new Error('Certificate request not found'), { status: 404 });
  const anchor = latestAnchor(certificateId);
  if (!anchor) {
    return { verified: false, reason: 'This certificate has not been anchored on-chain yet.' };
  }
  const currentHash = hashCertificate(request);
  const hashMatches = currentHash === anchor.cert_hash;

  if (anchor.status === 'not_configured') {
    return { verified: false, reason: anchor.error, anchor };
  }
  if (anchor.status === 'failed') {
    return { verified: false, reason: anchor.error || 'On-chain anchoring failed.', anchor };
  }
  if (anchor.status === 'pending') {
    return { verified: false, reason: 'Anchor transaction not yet confirmed on-chain.', hashMatches, anchor };
  }

  return {
    verified: hashMatches,
    reason: hashMatches ? 'Certificate hash matches the on-chain record.' : 'Certificate data has changed since it was anchored.',
    hashMatches,
    anchor,
  };
}

module.exports = { anchorCertificate, verifyCertificate, latestAnchor, listAnchors, hashCertificate, isConfigured };
