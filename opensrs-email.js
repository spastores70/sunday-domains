'use strict';

const https = require('https');

// Cluster: 'test' | 'a' | 'b' — set OPENSRS_EMAIL_CLUSTER in env
const cluster = () => process.env.OPENSRS_EMAIL_CLUSTER || 'test';
const API_HOST = () => `admin.${cluster()}.hostedemail.com`;

function creds() {
  const user = process.env.OPENSRS_EMAIL_ADMIN;
  const pass = process.env.OPENSRS_EMAIL_PASSWORD;
  if (!user || !pass) throw new Error('OPENSRS_EMAIL_ADMIN or OPENSRS_EMAIL_PASSWORD not set');
  return { user, password: pass, client: 'SundayDomains' };
}

async function call(method, body = {}) {
  const payload = Buffer.from(JSON.stringify({ credentials: creds(), ...body }), 'utf8');
  const data = await new Promise((resolve, reject) => {
    const req = https.request({
      host:   API_HOST(),
      port:   443,
      path:   `/api/${method}`,
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': payload.length,
      },
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
  return data;
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
function connectionSettings(cluster) {
  const host = cluster === 'b' ? 'mail.b.hostedemail.com' : 'mail.hostedemail.com';
  return {
    imap: { host, port: 993, security: 'SSL/TLS' },
    smtp: { host, port: 465, security: 'SSL/TLS' },
    webmail: cluster === 'b'
      ? 'https://webmail.b.hostedemail.com'
      : 'https://webmail.hostedemail.com',
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
