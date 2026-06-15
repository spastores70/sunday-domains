'use strict';

const https = require('https');

// Cluster: 'a' | 'b' | 'test' — auto-detected on first call if not set
let _detectedCluster = null;

const cluster = () => _detectedCluster || process.env.OPENSRS_EMAIL_CLUSTER || 'a';
const API_HOST = (cl) => `admin.${cl}.hostedemail.com`;

function creds() {
  const user = process.env.OPENSRS_EMAIL_ADMIN;
  const pass = process.env.OPENSRS_EMAIL_PASSWORD;
  if (!user || !pass) throw new Error('OPENSRS_EMAIL_ADMIN or OPENSRS_EMAIL_PASSWORD not set');
  return { user, password: pass, client: 'SundayDomains' };
}

async function rawCall(host, method, body = {}) {
  const payload = Buffer.from(JSON.stringify({ credentials: creds(), ...body }), 'utf8');
  return new Promise((resolve, reject) => {
    const req = https.request({
      host, port: 443, path: `/api/${method}`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`OpenSRS Email parse error: ${raw.slice(0, 300)}`)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Auto-detects cluster on first authenticated call (tries a then b).
async function call(method, body = {}) {
  if (_detectedCluster || process.env.OPENSRS_EMAIL_CLUSTER) {
    return rawCall(API_HOST(cluster()), method, body);
  }
  for (const cl of ['a', 'b']) {
    try {
      const result = await rawCall(API_HOST(cl), method, body);
      if (result.success !== false || result.error_number !== 1) {
        _detectedCluster = cl;
        console.log(`OpenSRS Email: detected cluster ${cl}`);
        return result;
      }
    } catch (_) {}
  }
  throw new Error('Could not reach OpenSRS Email API on cluster A or B — check credentials');
}

// ─── Domain ──────────────────────────────────────────────────────────────────
// Provisions a domain for email hosting. Must be called before creating mailboxes.
async function provisionDomain(domain) {
  return call('change_domain', {
    domain,
    attributes: { max_aliases: 100, max_lists: 10 },
  });
}

async function getDomain(domain) {
  return call('get_domain', { domain });
}

// ─── Mailboxes ────────────────────────────────────────────────────────────────
async function createMailbox({ email, password, firstName = '', lastName = '' }) {
  return call('change_user', {
    user: email,
    attributes: { password, first_name: firstName, last_name: lastName },
  });
}

async function getMailbox(email) {
  return call('get_user', { user: email });
}

async function deleteMailbox(email) {
  return call('delete_user', { user: email });
}

async function listMailboxes(domain) {
  return call('search_users', { domain, attributes: { limit: 50, page: 1 } });
}

// ─── MX record helper ─────────────────────────────────────────────────────────
// Returns the MX hostname for the configured cluster.
function mxHostname() {
  const c = cluster();
  if (c === 'b') return 'mx.b.hostedemail.com';
  if (c === 'test') return 'mx.test.hostedemail.com';
  return 'mx.hostedemail.com'; // cluster a
}

// IMAP/SMTP settings to show the customer after mailbox creation
function connectionSettings(cl) {
  const isB  = cl === 'b';
  const host = isB ? 'mail.b.hostedemail.com' : 'mail.hostedemail.com';
  return {
    imap:    { host, port_ssl: 993, port_plain: 143, security: 'SSL on port 993' },
    pop3:    { host, port_ssl: 995, port_plain: 110 },
    smtp:    { host, port_ssl: 465, port_tls: 587, security: 'SSL on 465 or TLS on 587' },
    webmail: isB ? 'https://mail.b.hostedemail.com' : 'https://mail.hostedemail.com',
  };
}

module.exports = {
  provisionDomain,
  getDomain,
  createMailbox,
  getMailbox,
  deleteMailbox,
  listMailboxes,
  mxHostname,
  connectionSettings,
  cluster,
};
