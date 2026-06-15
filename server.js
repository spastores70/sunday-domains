'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const opensrs      = require('./opensrs');
const opensrsEmail = require('./opensrs-email');
const stripe       = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

app.use(cors());
app.use(express.json());
// Serve the frontend from the same directory
app.use(express.static(path.join(__dirname)));

// ─── Helpers ──────────────────────────────────────────────────────────────────
const TLD_PRICES = {
  '.com': '$14.99/year',
  '.net': '$16.99/year',
  '.org': '$15.99/year',
  '.co':  '$24.99/year',
  '.ai':  '$79.99/year',
};
const TLDS = Object.keys(TLD_PRICES);

// ─── GET /api/domain/search?name=mybrand ─────────────────────────────────────
// Checks all five TLDs in parallel; returns availability + price for each.
app.get('/api/domain/search', async (req, res) => {
  const name = (req.query.name ?? '').toLowerCase().trim();
  if (!name) return res.status(400).json({ error: '"name" query param is required' });

  const checks = await Promise.allSettled(
    TLDS.map(ext => opensrs.lookupDomain(name + ext))
  );

  res.json(
    TLDS.map((ext, i) => {
      const r = checks[i];
      return {
        domain:    name + ext,
        ext,
        price:     TLD_PRICES[ext],
        available: r.status === 'fulfilled' ? r.value.available : false,
        error:     r.status === 'rejected'  ? r.reason.message  : null,
      };
    })
  );
});

// ─── GET /api/domain/check?name=example.com ───────────────────────────────────
app.get('/api/domain/check', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: '"name" query param is required' });
  try {
    res.json(await opensrs.lookupDomain(name));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── GET /api/debug/rawreq ────────────────────────────────────────────────────
// Sends the OpenSRS request using raw Node https (bypasses axios) for diagnostics.
app.get('/api/debug/rawreq', async (req, res) => {
  const crypto = require('crypto');
  const https  = require('https');
  const md5    = str => crypto.createHash('md5').update(str, 'utf8').digest('hex');
  const key    = process.env.OPENSRS_PRIVATE_KEY ?? '';
  const user   = process.env.OPENSRS_API_USERNAME ?? '';
  const isProd = process.env.OPENSRS_ENV === 'production';
  const host   = isProd ? 'rr-n1-tor.opensrs.net' : 'horizon.opensrs.net';

  const body = `<?xml version='1.0' encoding='UTF-8' standalone='no'?>
<!DOCTYPE OPS_envelope SYSTEM 'ops.dtd'>
<OPS_envelope>
  <header><version>0.9</version></header>
  <body><data_block><dt_assoc>
    <item key="protocol">XCP</item>
    <item key="action">LOOKUP</item>
    <item key="object">DOMAIN</item>
    <item key="attributes"><dt_assoc>
      <item key="domain">testrawreq123.com</item>
    </dt_assoc></item>
  </dt_assoc></data_block></body>
</OPS_envelope>`;

  const sig     = md5(md5(body + key) + key);
  const bodyBuf = Buffer.from(body, 'utf8');

  const raw = await new Promise((resolve, reject) => {
    const opts = {
      host, port: 55443, path: '/cgi/ORS', method: 'POST',
      headers: {
        'Content-Type':   'text/xml',
        'X-Username':     user,
        'X-Signature':    sig,
        'Content-Length': bodyBuf.length,
      },
    };
    const req2 = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve(d));
    });
    req2.on('error', reject);
    req2.write(bodyBuf);
    req2.end();
  });

  res.json({ host, signature: sig, response: raw.slice(0, 600) });
});

// ─── GET /api/debug/auth ──────────────────────────────────────────────────────
// Shows the exact XML body + signature being sent — helps diagnose signing issues.
app.get('/api/debug/auth', async (req, res) => {
  const crypto = require('crypto');
  const md5 = str => crypto.createHash('md5').update(str, 'utf8').digest('hex');
  const key  = process.env.OPENSRS_PRIVATE_KEY ?? '';
  const user = process.env.OPENSRS_API_USERNAME ?? '';
  const env  = process.env.OPENSRS_ENV === 'production' ? 'production' : 'test';

  const xmlBody = `<?xml version='1.0' encoding='UTF-8' standalone='no'?>
<!DOCTYPE OPS_envelope SYSTEM 'ops.dtd'>
<OPS_envelope>
  <header><version>0.9</version></header>
  <body>
    <data_block>
      <dt_assoc>
        <item key="protocol">XCP</item>
        <item key="action">LOOKUP</item>
        <item key="object">DOMAIN</item>
        <item key="attributes">
          <dt_assoc>
        <item key="domain">testdiagnostic123.com</item>
  </dt_assoc>
        </item>
      </dt_assoc>
    </data_block>
  </body>
</OPS_envelope>`;

  const inner = md5(xmlBody + key);
  const sig   = md5(inner + key);

  res.json({
    env,
    username: user,
    key_length: key.length,
    key_first8: key.slice(0, 8),
    xml_byte_length: Buffer.byteLength(xmlBody, 'utf8'),
    inner_md5: inner,
    signature: sig,
    api_url: env === 'production'
      ? 'https://rr-n1-tor.opensrs.net:55443/cgi/ORS'
      : 'https://horizon.opensrs.net:55443/cgi/ORS',
  });
});

// ─── GET /api/debug/lookup?name=example.com ────────────────────────────────────
// Returns the raw parsed OpenSRS response — remove before going to production.
app.get('/api/debug/lookup', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: '"name" required' });
  try {
    res.json(await opensrs.rawLookup(name));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── GET /api/debug/ip ────────────────────────────────────────────────────────
// Returns this server's outbound public IP from multiple sources.
app.get('/api/debug/ip', async (req, res) => {
  const axios = require('axios');
  const net   = require('net');

  // Check via HTTP (port 443)
  let httpIp = null;
  try {
    const r = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
    httpIp = r.data.ip;
  } catch (_) {}

  // Also check via plain HTTP (port 80)
  let http80Ip = null;
  try {
    const r = await axios.get('http://api.ipify.org?format=json', { timeout: 5000 });
    http80Ip = r.data.ip;
  } catch (_) {}

  // Check via icanhazip (different service)
  let altIp = null;
  try {
    const r = await axios.get('https://icanhazip.com', { timeout: 5000 });
    altIp = r.data.trim();
  } catch (_) {}

  res.json({ https_ip: httpIp, http_ip: http80Ip, alt_ip: altIp });
});

// ─── POST /api/stripe/create-payment-intent ──────────────────────────────────
// Creates a PaymentIntent for the domain price. Client confirms payment,
// then calls /api/domain/register only on success.
app.post('/api/stripe/create-payment-intent', async (req, res) => {
  const { domain } = req.body ?? {};
  if (!domain) return res.status(400).json({ error: '"domain" is required' });

  const TLD_CENTS = {
    '.com': 1499, '.net': 1699, '.org': 1599, '.co': 2499, '.ai': 7999,
  };
  const ext = Object.keys(TLD_CENTS).find(e => domain.endsWith(e));
  if (!ext) return res.status(400).json({ error: 'Unsupported TLD' });

  try {
    const intent = await stripe.paymentIntents.create({
      amount:   TLD_CENTS[ext],
      currency: 'usd',
      metadata: { domain },
      description: `Domain registration: ${domain}`,
    });
    res.json({ clientSecret: intent.client_secret });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── POST /api/domain/register ───────────────────────────────────────────────
// Body: { domain, period?, contact: { first_name, last_name, email, phone,
//          address1, city, state, country, postal_code, org_name? } }
//
// NOTE: OpenSRS bills the reseller account directly. Wire up Stripe (or similar)
// to charge the customer BEFORE calling this endpoint in production.
app.post('/api/domain/register', async (req, res) => {
  const { domain, period, contact } = req.body ?? {};

  if (!domain)         return res.status(400).json({ error: '"domain" is required' });
  if (!contact?.email) return res.status(400).json({ error: '"contact.email" is required' });

  const required = ['first_name', 'last_name', 'phone', 'address1', 'city', 'state', 'country', 'postal_code'];
  const missing  = required.filter(f => !contact[f]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing contact fields: ${missing.join(', ')}` });
  }

  try {
    res.json(await opensrs.registerDomain({ domain, period: period ?? 1, contact }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── GET /api/dns/:domain ────────────────────────────────────────────────────
app.get('/api/dns/:domain', async (req, res) => {
  try {
    res.json(await opensrs.getDnsZone(req.params.domain));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── PUT /api/dns/:domain ────────────────────────────────────────────────────
// Body: { records: [{ type, subdomain, ip_address?, hostname?, ... }] }
app.put('/api/dns/:domain', async (req, res) => {
  const { records } = req.body ?? {};
  if (!Array.isArray(records) || !records.length) {
    return res.status(400).json({ error: '"records" array is required' });
  }
  try {
    res.json(await opensrs.updateDnsZone(req.params.domain, records));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── GET /api/debug/email ─────────────────────────────────────────────────────
app.get('/api/debug/email', async (req, res) => {
  const https = require('https');
  const admin = process.env.OPENSRS_EMAIL_ADMIN ?? '';
  const pass  = process.env.OPENSRS_EMAIL_PASSWORD ?? '';

  // Try authenticate method on cluster A and B
  async function tryCluster(cl) {
    const host    = `admin.${cl}.hostedemail.com`;
    const payload = Buffer.from(JSON.stringify({
      credentials: { user: admin, password: pass, client: 'SundayDomains' },
    }), 'utf8');
    return new Promise((resolve) => {
      const req = https.request({
        host, port: 443, path: '/api/authenticate', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      }, r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => {
          try { resolve({ cl, ...JSON.parse(d) }); }
          catch (e) { resolve({ cl, parse_error: d.slice(0, 100) }); }
        });
      });
      req.on('error', e => resolve({ cl, network_error: e.message }));
      req.write(payload); req.end();
    });
  }

  const [a, b] = await Promise.all([tryCluster('a'), tryCluster('b')]);
  res.json({ admin_user: admin, password_length: pass.length, cluster_a: a, cluster_b: b });
});

// ─── POST /api/email/provision ───────────────────────────────────────────────
// Registers a domain with OpenSRS email hosting + returns MX record to set.
app.post('/api/email/provision', async (req, res) => {
  const { domain } = req.body ?? {};
  if (!domain) return res.status(400).json({ error: '"domain" is required' });
  try {
    const result = await opensrsEmail.provisionDomain(domain);
    res.json({
      success: result.success ?? false,
      domain,
      mx_hostname: opensrsEmail.mxHostname(),
      mx_priority: 10,
      error: result.error ?? null,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── POST /api/email/mailbox ──────────────────────────────────────────────────
// Creates a mailbox. Body: { email, password, first_name?, last_name? }
app.post('/api/email/mailbox', async (req, res) => {
  const { email, password, first_name, last_name } = req.body ?? {};
  if (!email)    return res.status(400).json({ error: '"email" is required' });
  if (!password) return res.status(400).json({ error: '"password" is required' });
  try {
    const result = await opensrsEmail.createMailbox({ email, password, firstName: first_name, lastName: last_name });
    const cl = opensrsEmail.cluster();
    res.json({
      success:  result.success ?? false,
      email,
      settings: opensrsEmail.connectionSettings(cl),
      error:    result.error ?? null,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── GET /api/email/mailboxes/:domain ────────────────────────────────────────
app.get('/api/email/mailboxes/:domain', async (req, res) => {
  try {
    res.json(await opensrsEmail.listMailboxes(req.params.domain));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── DELETE /api/email/mailbox/:email ────────────────────────────────────────
app.delete('/api/email/mailbox/:email', async (req, res) => {
  try {
    res.json(await opensrsEmail.deleteMailbox(req.params.email));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const env = process.env.OPENSRS_ENV === 'production' ? 'PRODUCTION ⚠️' : 'sandbox (test)';
  console.log(`\n🌐  Sunday Domains  →  http://localhost:${PORT}`);
  console.log(`    OpenSRS env : ${env}`);
  console.log(`    Username    : ${process.env.OPENSRS_API_USERNAME ?? '(not set)'}\n`);
});
