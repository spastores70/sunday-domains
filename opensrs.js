'use strict';

const crypto = require('crypto');
const axios  = require('axios');
const { parseStringPromise } = require('xml2js');

// ─── Transport URL ────────────────────────────────────────────────────────────
const API_URL = process.env.OPENSRS_ENV === 'production'
  ? 'https://rr-n1-tor.opensrs.net:55443/cgi/ORS'
  : 'https://horizon.opensrs.net:55443/cgi/ORS';

// ─── Crypto ───────────────────────────────────────────────────────────────────
function md5(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

// OpenSRS signature: md5( md5(body + privateKey) + privateKey )
function sign(body) {
  const key = process.env.OPENSRS_PRIVATE_KEY;
  if (!key) throw new Error('OPENSRS_PRIVATE_KEY is not set in environment');
  return md5(md5(body + key) + key);
}

// ─── XML helpers ──────────────────────────────────────────────────────────────
function esc(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function envelope(action, object, attrsXml) {
  return `<?xml version='1.0' encoding='UTF-8' standalone='no'?>
<!DOCTYPE OPS_envelope SYSTEM 'ops.dtd'>
<OPS_envelope>
  <header><version>0.9</version></header>
  <body>
    <data_block>
      <dt_assoc>
        <item key="protocol">XCP</item>
        <item key="action">${action}</item>
        <item key="object">${object}</item>
        <item key="attributes">
          <dt_assoc>${attrsXml}</dt_assoc>
        </item>
      </dt_assoc>
    </data_block>
  </body>
</OPS_envelope>`;
}

// ─── Response parser ──────────────────────────────────────────────────────────
// Recursively converts OpenSRS dt_assoc / dt_array items into plain JS objects.
function parseAssoc(items) {
  const obj = {};
  const list = Array.isArray(items) ? items : [items].filter(Boolean);
  for (const item of list) {
    const key = item?.$?.key;
    if (key == null) continue;
    if (item.dt_assoc) {
      obj[key] = parseAssoc(item.dt_assoc.item);
    } else if (item.dt_array) {
      const rows = item.dt_array.item;
      obj[key] = rows
        ? (Array.isArray(rows) ? rows : [rows]).map(r =>
            r.dt_assoc ? parseAssoc(r.dt_assoc.item) : (r._ ?? r)
          )
        : [];
    } else {
      obj[key] = item._ ?? null;
    }
  }
  return obj;
}

async function parseResponse(xmlText) {
  const parsed = await parseStringPromise(xmlText, { explicitArray: false, trim: true });
  const items = parsed?.OPS_envelope?.body?.data_block?.dt_assoc?.item;
  return parseAssoc(items);
}

// ─── HTTP transport ───────────────────────────────────────────────────────────
async function send(xmlBody) {
  if (!process.env.OPENSRS_API_USERNAME) {
    throw new Error('OPENSRS_API_USERNAME is not set in environment');
  }
  const signature = sign(xmlBody);
  const { data } = await axios.post(API_URL, xmlBody, {
    headers: {
      'Content-Type':   'text/xml',
      'X-Username':     process.env.OPENSRS_API_USERNAME,
      'X-Signature':    signature,
      'Content-Length': Buffer.byteLength(xmlBody, 'utf8').toString(),
    },
    responseType: 'text',
    timeout: 20000,
  });
  return parseResponse(data);
}

// ─── Domain availability ──────────────────────────────────────────────────────
async function lookupDomain(domain) {
  const result = await send(envelope('LOOKUP', 'DOMAIN', `
    <item key="domain">${esc(domain)}</item>
  `));
  const code   = parseInt(result.response_code, 10);
  // OpenSRS returns 210 for available OR puts status in attributes block
  const status = result.attributes?.status ?? '';
  const available = code === 210 || status === 'available';
  const taken     = code === 211 || status === 'taken';
  return {
    domain,
    available,
    taken,
    response_code: code,
    response_text: result.response_text,
  };
}

// Returns the full raw parsed response for debugging
async function rawLookup(domain) {
  return send(envelope('LOOKUP', 'DOMAIN', `
    <item key="domain">${esc(domain)}</item>
  `));
}

// ─── Domain registration ──────────────────────────────────────────────────────
async function registerDomain({ domain, period = 1, contact, nameservers }) {
  const ns = (nameservers ?? [
    { name: 'ns1.opensrs.net', sortorder: 1 },
    { name: 'ns2.opensrs.net', sortorder: 2 },
  ]).map((n, i) => `
    <item key="${i}">
      <dt_assoc>
        <item key="name">${esc(n.name)}</item>
        <item key="sortorder">${n.sortorder ?? i + 1}</item>
      </dt_assoc>
    </item>`).join('');

  const contactBlock = (role) => `
    <item key="${role}">
      <dt_assoc>
        <item key="first_name">${esc(contact.first_name)}</item>
        <item key="last_name">${esc(contact.last_name)}</item>
        <item key="email">${esc(contact.email)}</item>
        <item key="phone">${esc(contact.phone)}</item>
        <item key="address1">${esc(contact.address1)}</item>
        <item key="city">${esc(contact.city)}</item>
        <item key="state">${esc(contact.state)}</item>
        <item key="country">${esc(contact.country)}</item>
        <item key="postal_code">${esc(contact.postal_code)}</item>
        <item key="org_name">${esc(contact.org_name || `${contact.first_name} ${contact.last_name}`)}</item>
      </dt_assoc>
    </item>`;

  // Generate a stable reg_username from email (OpenSRS requires one per registrant)
  const regUser = contact.email.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 20) || 'customer';
  const regPass = `Tmp${crypto.randomBytes(6).toString('hex')}!`;

  const result = await send(envelope('SW_REGISTER', 'DOMAIN', `
    <item key="domain">${esc(domain)}</item>
    <item key="auto_renew">1</item>
    <item key="period">${parseInt(period, 10)}</item>
    <item key="reg_username">${esc(regUser)}</item>
    <item key="reg_password">${esc(regPass)}</item>
    <item key="contact_set">
      <dt_assoc>
        ${contactBlock('owner')}
        ${contactBlock('admin')}
        ${contactBlock('billing')}
        ${contactBlock('tech')}
      </dt_assoc>
    </item>
    <item key="nameserver_list">
      <dt_array>${ns}</dt_array>
    </item>
  `));

  const code = parseInt(result.response_code, 10);
  return {
    success:         code === 200 || code === 201,
    domain,
    response_code:   code,
    response_text:   result.response_text,
    registration_id: result.id ?? null,
  };
}

// ─── DNS — read ───────────────────────────────────────────────────────────────
async function getDnsZone(domain) {
  const result = await send(envelope('GET_DNS_ZONE', 'DOMAIN', `
    <item key="domain">${esc(domain)}</item>
  `));
  return {
    domain,
    records:       result.attributes?.records_list ?? [],
    response_code: result.response_code,
    response_text: result.response_text,
  };
}

// ─── DNS — write ──────────────────────────────────────────────────────────────
// records: [{ type, subdomain, ip_address?, hostname?, mailserver?, text?, priority? }]
async function updateDnsZone(domain, records) {
  const recordsXml = records.map((r, i) => `
    <item key="${i}">
      <dt_assoc>
        <item key="type">${esc(r.type)}</item>
        <item key="subdomain">${esc(r.subdomain ?? '')}</item>
        ${r.ip_address  != null ? `<item key="ip_address">${esc(r.ip_address)}</item>`  : ''}
        ${r.hostname    != null ? `<item key="hostname">${esc(r.hostname)}</item>`      : ''}
        ${r.mailserver  != null ? `<item key="mailserver">${esc(r.mailserver)}</item>`  : ''}
        ${r.text        != null ? `<item key="text">${esc(r.text)}</item>`              : ''}
        ${r.priority    != null ? `<item key="priority">${r.priority}</item>`           : ''}
      </dt_assoc>
    </item>`).join('');

  const result = await send(envelope('ADVANCED_UPDATEALL_DNS_ZONE', 'DOMAIN', `
    <item key="domain">${esc(domain)}</item>
    <item key="records_list">
      <dt_array>${recordsXml}</dt_array>
    </item>
  `));

  const code = parseInt(result.response_code, 10);
  return {
    success:       code === 200,
    response_code: code,
    response_text: result.response_text,
  };
}

module.exports = { lookupDomain, rawLookup, registerDomain, getDnsZone, updateDnsZone };
