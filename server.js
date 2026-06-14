'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const opensrs = require('./opensrs');

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

// ─── Boot ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const env = process.env.OPENSRS_ENV === 'production' ? 'PRODUCTION ⚠️' : 'sandbox (test)';
  console.log(`\n🌐  Sunday Domains  →  http://localhost:${PORT}`);
  console.log(`    OpenSRS env : ${env}`);
  console.log(`    Username    : ${process.env.OPENSRS_API_USERNAME ?? '(not set)'}\n`);
});
