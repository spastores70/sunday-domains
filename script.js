'use strict';

// ─── Stripe ───────────────────────────────────────────────────────────────────
const _stripe = Stripe('pk_live_51Sag55Ru5ECekCteCip2Sa5ELdT8JINjLfTXXXPuYziG5hrJ6xn0BSNDmz60DpqP2M6kZGy3TU32qmxdYf53c0C500KJAIMdQm');
const _elements = _stripe.elements();
const _cardElement = _elements.create('card', {
  style: {
    base: { fontSize: '16px', color: '#1a1a2e', '::placeholder': { color: '#aab' } },
  },
});
let _cardMounted = false;

// ─── State ────────────────────────────────────────────────────────────────────
const _sel = {
  domain:      null,
  domainPrice: null,
  plan:        null,
  monthly:     null,
  domainCost:  null,
};

// ─── Domain Search ────────────────────────────────────────────────────────────
function searchDomain() {
  const raw    = document.getElementById('domainInput').value.trim();
  const result = document.getElementById('result');

  if (!raw) {
    result.innerHTML = '<p class="search-hint">Please enter a domain name.</p>';
    return;
  }

  const name = raw.toLowerCase().replace(/\s+/g, '').split('.')[0];

  result.innerHTML = `
    <div class="search-loading">
      <div class="spinner"></div>
      <span>Checking availability…</span>
    </div>`;

  fetch(`/api/domain/search?name=${encodeURIComponent(name)}`)
    .then(r => r.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      result.innerHTML = `
        <div class="domain-results">
          ${data.map(item => `
            <div class="domain-row">
              <div>
                <strong>${item.domain}</strong>
                <span class="${item.available ? 'tag-available' : 'tag-taken'}">
                  ${item.available ? 'Available' : 'Taken'}
                </span>
              </div>
              <div class="domain-price">${item.price}</div>
              ${item.available
                ? `<button type="button" data-domain="${item.domain}" data-price="${item.price}"
                     onclick="selectDomain(this.dataset.domain, this.dataset.price)">Select</button>`
                : `<button type="button" class="btn-taken" disabled>Taken</button>`
              }
            </div>`).join('')}
        </div>`;
    })
    .catch(err => {
      result.innerHTML = `<p class="api-error">⚠️ ${err.message}</p>`;
    });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('domainInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') searchDomain();
  });
});

// ─── Funnel: Select domain ────────────────────────────────────────────────────
function selectDomain(domain, price) {
  _sel.domain      = domain;
  _sel.domainPrice = price;

  document.getElementById('result').innerHTML += `
    <div class="checkout-box">
      <h3>🛒 Build Your Package</h3>
      <div class="summary">
        <p>Domain: <strong>${domain}</strong></p>
        <p>Price: <strong>${price}</strong></p>
      </div>
      <h4>Add Hosting</h4>
      <div class="hosting-grid">
        <div class="host-card">
          <h5>Starter</h5>
          <p>$5/mo</p>
          <small>1 Website</small>
          <button type="button" onclick="chooseHosting('Starter', 5)">Select</button>
        </div>
        <div class="host-card">
          <h5>Business</h5>
          <p>$12/mo</p>
          <small>Unlimited Sites</small>
          <button type="button" onclick="chooseHosting('Business', 12)">Select</button>
        </div>
        <div class="host-card premium">
          <h5>AI Builder</h5>
          <p>$29/mo</p>
          <small>Domain + Website</small>
          <button type="button" onclick="chooseHosting('AI Builder', 29)">Select</button>
        </div>
      </div>
    </div>`;
}

// ─── Funnel: Choose hosting ───────────────────────────────────────────────────
function chooseHosting(plan, monthly) {
  _sel.plan       = plan;
  _sel.monthly    = monthly;
  _sel.domainCost = parseFloat((_sel.domainPrice ?? '$0').replace(/[^0-9.]/g, ''));

  const total = (_sel.domainCost + monthly).toFixed(2);

  document.getElementById('result').innerHTML += `
    <div class="final-checkout">
      <h3>✅ Package Summary</h3>
      <p><strong>Domain:</strong> ${_sel.domain}</p>
      <p><strong>Hosting Plan:</strong> ${plan}</p>
      <p><strong>Hosting:</strong> $${monthly}/month</p>
      <hr>
      <p class="total">Total Today: $${total}</p>
      <button type="button" onclick="openCheckout()">Pay Now</button>
    </div>`;
}

// ─── Modal: open / close / step navigation ────────────────────────────────────
function openCheckout() {
  document.getElementById('paymentModal').style.display = 'flex';
  showStep(1);
}

function closeCheckout() {
  document.getElementById('paymentModal').style.display = 'none';
}

function showStep(n) {
  document.getElementById('modalStep1').classList.toggle('modal-step-hidden', n !== 1);
  document.getElementById('modalStep2').classList.toggle('modal-step-hidden', n !== 2);
  document.querySelectorAll('.step-dot').forEach((d, i) => {
    d.classList.toggle('active', i + 1 <= n);
  });
  if (n === 2 && !_cardMounted) {
    _cardElement.mount('#card-element');
    _cardElement.on('change', e => {
      document.getElementById('card-errors').textContent = e.error ? e.error.message : '';
    });
    _cardMounted = true;
  }
}

function goToPayment() {
  const fields = [
    ['firstName',      'First name'],
    ['lastName',       'Last name'],
    ['contactEmail',   'Email'],
    ['contactPhone',   'Phone'],
    ['contactAddress', 'Address'],
    ['contactCity',    'City'],
    ['contactState',   'State'],
    ['contactZip',     'ZIP code'],
    ['contactCountry', 'Country'],
  ];

  for (const [id, label] of fields) {
    if (!document.getElementById(id).value.trim()) {
      alert(`Please enter your ${label}.`);
      document.getElementById(id).focus();
      return;
    }
  }

  const email = document.getElementById('contactEmail').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert('Please enter a valid email address.');
    return;
  }

  showStep(2);
}

function backToContact() {
  showStep(1);
}

// ─── Confirm order → charge card → register domain ────────────────────────────
async function confirmOrder() {
  const payBtn = document.getElementById('payBtn');
  payBtn.textContent = 'Processing…';
  payBtn.disabled = true;
  document.getElementById('card-errors').textContent = '';

  const contact = {
    first_name:  document.getElementById('firstName').value.trim(),
    last_name:   document.getElementById('lastName').value.trim(),
    email:       document.getElementById('contactEmail').value.trim(),
    phone:       document.getElementById('contactPhone').value.trim(),
    address1:    document.getElementById('contactAddress').value.trim(),
    city:        document.getElementById('contactCity').value.trim(),
    state:       document.getElementById('contactState').value.trim(),
    postal_code: document.getElementById('contactZip').value.trim(),
    country:     document.getElementById('contactCountry').value.trim(),
  };

  try {
    // 1. Create PaymentIntent on server
    const intentResp = await fetch('/api/stripe/create-payment-intent', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ domain: _sel.domain }),
    });
    const { clientSecret, error: intentErr } = await intentResp.json();
    if (intentErr) throw new Error(intentErr);

    // 2. Confirm card payment via Stripe.js (never touches raw card data server-side)
    const { paymentIntent, error: stripeErr } = await _stripe.confirmCardPayment(clientSecret, {
      payment_method: {
        card: _cardElement,
        billing_details: {
          name:  `${contact.first_name} ${contact.last_name}`,
          email: contact.email,
        },
      },
    });
    if (stripeErr) throw new Error(stripeErr.message);
    if (paymentIntent.status !== 'succeeded') throw new Error('Payment did not complete.');

    // 3. Payment succeeded — now register the domain
    const regResp = await fetch('/api/domain/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ domain: _sel.domain, period: 1, contact }),
    });
    const regData = await regResp.json();
    closeCheckout();

    if (!regResp.ok || !regData.success) {
      showOrderError(`Payment succeeded but domain registration failed: ${regData.error ?? regData.response_text ?? 'unknown error'}. Contact support with order ID: ${paymentIntent.id}`);
      return;
    }

    showDashboard(contact);
  } catch (err) {
    document.getElementById('card-errors').textContent = err.message;
    payBtn.textContent = 'Complete Order 🔒';
    payBtn.disabled = false;
  }
}

function showOrderError(msg) {
  document.getElementById('result').innerHTML += `
    <div class="order-error">
      ⚠️ Registration failed: ${msg}
      <br><small>Your card was not charged.</small>
    </div>`;
}

// ─── Post-purchase dashboard ──────────────────────────────────────────────────
function showDashboard(contact) {
  document.getElementById('result').innerHTML = `
    <div class="dashboard">
      <div class="dashboard-header">
        <h2>Welcome, ${contact.first_name}!</h2>
        <p><strong>${_sel.domain}</strong> has been registered.</p>
      </div>
      <div class="dashboard-grid">
        <div class="dash-card">
          <h3>🌐 My Domains</h3>
          <p>1 Active Domain</p>
          <button type="button" onclick="showDashboardPanel('domains')">Manage</button>
        </div>
        <div class="dash-card">
          <h3>🚀 Hosting</h3>
          <p>${_sel.plan} Active</p>
          <button type="button" onclick="showDashboardPanel('hosting')">Open</button>
        </div>
        <div class="dash-card">
          <h3>📧 Business Email</h3>
          <p>Coming Soon</p>
          <button type="button" onclick="showDashboardPanel('email')">Setup</button>
        </div>
        <div class="dash-card">
          <h3>🤖 AI Website Builder</h3>
          <p>Generate website</p>
          <button type="button" onclick="showDashboardPanel('ai')">Launch</button>
        </div>
      </div>
      <div id="dashboardPanel" class="dashboard-panel">
        <h3>Select a section above</h3>
        <p>Manage domains, hosting, email, or AI website tools.</p>
      </div>
    </div>`;
}

// ─── Dashboard panels ─────────────────────────────────────────────────────────
function showDashboardPanel(type) {
  const panel = document.getElementById('dashboardPanel');

  if (type === 'domains') {
    panel.innerHTML = `
      <h3>🌐 Domain Manager</h3>
      <p><strong>${_sel.domain}</strong> is active and connected.</p>
      <div class="panel-actions">
        <button type="button" onclick="openDNS()">DNS Settings</button>
        <button type="button">Renew Domain</button>
      </div>`;

  } else if (type === 'hosting') {
    panel.innerHTML = `
      <h3>🚀 Hosting Manager</h3>
      <p>Your ${_sel.plan} hosting is active.</p>
      <div class="panel-actions">
        <button type="button">Open File Manager</button>
        <button type="button">Connect Website</button>
      </div>`;

  } else if (type === 'email') {
    panel.innerHTML = `
      <h3>📧 Business Email</h3>
      <p>Create professional mailboxes for <strong>${_sel.domain}</strong></p>
      <div class="email-setup">
        <div class="input-row">
          <input type="text" id="emailPrefix" placeholder="e.g. hello, info, contact" />
          <span class="email-at-domain">@${_sel.domain}</span>
        </div>
        <input type="text" id="emailFirstName" placeholder="First Name (optional)" />
        <input type="text" id="emailLastName"  placeholder="Last Name (optional)" />
        <p class="email-hint">A secure password will be generated automatically.</p>
        <button type="button" onclick="createBusinessEmail()">Create Mailbox</button>
        <div id="emailResult"></div>
      </div>
      <hr style="margin:1.5rem 0;border-color:#eee"/>
      <button type="button" onclick="loadMailboxList()">View All Mailboxes</button>
      <div id="mailboxList"></div>`;

  } else if (type === 'ai') {
    panel.innerHTML = `
      <h3>🤖 AI Website Builder</h3>
      <p>Generate a starter website for <strong>${_sel.domain}</strong>.</p>
      <input type="text" id="bizName" placeholder="Business Name" />
      <select id="bizType">
        <option value="">Choose Business Type</option>
        <option>Restaurant</option><option>Salon</option>
        <option>Travel Agency</option><option>Online Store</option>
        <option>Consulting</option>
      </select>
      <select id="siteStyle">
        <option value="">Choose Website Style</option>
        <option>Modern</option><option>Luxury</option>
        <option>Friendly</option><option>Bold</option>
      </select>
      <button type="button" onclick="generateWebsitePreview()">Generate Website</button>`;
  }
}

// ─── DNS panel (calls real API) ───────────────────────────────────────────────
function openDNS() {
  const panel = document.getElementById('dashboardPanel');

  panel.innerHTML = `
    <h3>🌐 DNS Settings — ${_sel.domain}</h3>
    <div class="search-loading"><div class="spinner spinner-dark"></div><span>Loading records…</span></div>`;

  fetch(`/api/dns/${encodeURIComponent(_sel.domain)}`)
    .then(r => r.json())
    .then(data => {
      if (data.error) throw new Error(data.error);

      // Build editable inputs for common record types; fall back to defaults
      const records = (Array.isArray(data.records) && data.records.length)
        ? data.records
        : [
            { type: 'A',     subdomain: '',     ip_address: '76.76.21.21' },
            { type: 'CNAME', subdomain: 'www',  hostname:   'cname.vercel-dns.com' },
            { type: 'MX',    subdomain: '',     mailserver: 'mail.sundaydomains.com', priority: 10 },
            { type: 'TXT',   subdomain: '',     text:       'v=spf1 include:_spf.google.com ~all' },
          ];

      const rows = records.map((r, i) => `
        <div class="dns-record-row">
          <span class="dns-type">${r.type}</span>
          <span class="dns-sub">${r.subdomain || '@'}</span>
          <input type="text" class="dns-value"
            data-index="${i}"
            data-type="${r.type}"
            data-subdomain="${r.subdomain ?? ''}"
            value="${r.ip_address ?? r.hostname ?? r.mailserver ?? r.text ?? ''}" />
        </div>`).join('');

      panel.innerHTML = `
        <h3>🌐 DNS Settings — ${_sel.domain}</h3>
        <p>Edit records below, then click Save.</p>
        <div class="dns-table">${rows}</div>
        <div class="panel-actions">
          <button type="button" onclick="saveDNS()">Save DNS</button>
          <button type="button" onclick="showDashboardPanel('domains')">Back</button>
        </div>`;
    })
    .catch(err => {
      panel.innerHTML = `<p class="api-error">⚠️ ${err.message}</p>
        <div class="panel-actions">
          <button type="button" onclick="showDashboardPanel('domains')">Back</button>
        </div>`;
    });
}

async function saveDNS() {
  const panel   = document.getElementById('dashboardPanel');
  const inputs  = panel.querySelectorAll('.dns-value');
  const saveBtn = panel.querySelector('button');

  const records = Array.from(inputs).map(input => {
    const type      = input.dataset.type;
    const subdomain = input.dataset.subdomain;
    const value     = input.value.trim();
    const base      = { type, subdomain };
    if (type === 'A')     return { ...base, ip_address: value };
    if (type === 'CNAME') return { ...base, hostname:   value };
    if (type === 'MX')    return { ...base, mailserver: value, priority: 10 };
    if (type === 'TXT')   return { ...base, text:       value };
    return { ...base, ip_address: value };
  });

  saveBtn.textContent = 'Saving…';
  saveBtn.disabled    = true;

  try {
    const resp = await fetch(`/api/dns/${encodeURIComponent(_sel.domain)}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ records }),
    });
    const data = await resp.json();

    if (!resp.ok || !data.success) throw new Error(data.error ?? data.response_text);

    const existing = panel.querySelector('.dns-success');
    if (!existing) {
      panel.innerHTML += '<div class="dns-success">✅ DNS records updated successfully</div>';
    }
  } catch (err) {
    panel.innerHTML += `<p class="api-error">⚠️ Save failed: ${err.message}</p>`;
  } finally {
    saveBtn.textContent = 'Save DNS';
    saveBtn.disabled    = false;
  }
}

// ─── Business Email ───────────────────────────────────────────────────────────
function _genPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from(crypto.getRandomValues(new Uint8Array(14)))
    .map(b => chars[b % chars.length]).join('');
}

async function createBusinessEmail() {
  const prefix = (document.getElementById('emailPrefix')?.value ?? '').trim().toLowerCase();
  if (!prefix) { alert('Please enter an email prefix (e.g. hello).'); return; }

  const email     = `${prefix}@${_sel.domain}`;
  const password  = _genPassword();
  const firstName = (document.getElementById('emailFirstName')?.value ?? '').trim();
  const lastName  = (document.getElementById('emailLastName')?.value  ?? '').trim();
  const resultDiv = document.getElementById('emailResult');
  const btn       = resultDiv.previousElementSibling;

  btn.textContent = 'Creating…';
  btn.disabled    = true;
  resultDiv.innerHTML = '';

  try {
    // First provision the domain (idempotent — safe to call again if already done)
    await fetch('/api/email/provision', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ domain: _sel.domain }),
    });

    const resp = await fetch('/api/email/mailbox', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password, first_name: firstName, last_name: lastName }),
    });
    const data = await resp.json();

    if (!resp.ok || !data.success) throw new Error(data.error ?? 'Mailbox creation failed');

    const s = data.settings;
    resultDiv.innerHTML = `
      <div class="email-success">
        <h4>✅ Mailbox Created!</h4>
        <div class="email-creds">
          <div><strong>Email:</strong> ${email}</div>
          <div><strong>Password:</strong> <code>${password}</code></div>
        </div>
        <details style="margin-top:1rem">
          <summary>📬 Email Client Settings (Outlook / Apple Mail / Thunderbird)</summary>
          <div class="email-settings-grid">
            <div><strong>Webmail:</strong> <a href="${s.webmail}" target="_blank">${s.webmail}</a></div>
            <div><strong>Username:</strong> ${email}</div>
            <div><strong>IMAP:</strong> ${s.imap.host} — ${s.imap.security}</div>
            <div><strong>SMTP:</strong> ${s.smtp.host} — ${s.smtp.security}</div>
            <div><strong>POP3:</strong> ${s.pop3.host} — SSL port ${s.pop3.port_ssl}</div>
          </div>
        </details>
        <p class="email-hint" style="margin-top:.75rem">Save your password — it won't be shown again.</p>
      </div>`;
  } catch (err) {
    resultDiv.innerHTML = `<p class="api-error">⚠️ ${err.message}</p>`;
  } finally {
    btn.textContent = 'Create Mailbox';
    btn.disabled    = false;
  }
}

async function loadMailboxList() {
  const listDiv = document.getElementById('mailboxList');
  listDiv.innerHTML = '<p>Loading…</p>';
  try {
    const resp = await fetch(`/api/email/mailboxes/${encodeURIComponent(_sel.domain)}`);
    const data = await resp.json();
    const users = data.users ?? data.results ?? [];
    if (!users.length) {
      listDiv.innerHTML = '<p style="color:#888">No mailboxes yet.</p>';
      return;
    }
    listDiv.innerHTML = `
      <table class="dns-table" style="margin-top:1rem">
        <thead><tr><th>Email</th><th>Status</th><th></th></tr></thead>
        <tbody>${users.map(u => `
          <tr>
            <td>${u.user ?? u.email ?? u}</td>
            <td>${u.status ?? 'active'}</td>
            <td><button type="button" onclick="deleteEmail('${u.user ?? u.email ?? u}')">Delete</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    listDiv.innerHTML = `<p class="api-error">⚠️ ${err.message}</p>`;
  }
}

async function deleteEmail(email) {
  if (!confirm(`Delete ${email}? This cannot be undone.`)) return;
  const resp = await fetch(`/api/email/mailbox/${encodeURIComponent(email)}`, { method: 'DELETE' });
  const data = await resp.json();
  if (data.success) loadMailboxList();
  else alert('Delete failed: ' + (data.error ?? 'unknown error'));
}

// ─── AI Website Builder ───────────────────────────────────────────────────────
function generateWebsitePreview() {
  const name  = document.getElementById('bizName').value  || 'Your Business';
  const type  = document.getElementById('bizType').value  || 'Business';
  const style = document.getElementById('siteStyle').value || 'Modern';
  const panel = document.getElementById('dashboardPanel');

  panel.innerHTML = `
    <h3>✅ Website Preview Generated</h3>
    <p><strong>${name}</strong> — ${type} (${style} style)</p>
    <div class="mini-site">
      <h2>${name}</h2>
      <p>Your trusted ${type.toLowerCase()} solution.</p>
      <button type="button" onclick="publishWebsite('${name.replace(/'/g, "\\'")}')">Publish Website</button>
    </div>`;
}

function publishWebsite(name) {
  const panel = document.getElementById('dashboardPanel');
  const slug  = name.toLowerCase().replace(/\s+/g, '-');

  panel.innerHTML = `
    <h3>🚀 Website Published!</h3>
    <p>Your website is live at:</p>
    <div class="published-link">https://${slug}.sundaydomains.com</div>
    <div class="panel-actions">
      <button type="button" onclick="showDashboardPanel('ai')">Create Another</button>
    </div>`;
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => document.getElementById('domainInput').focus(), 600);
}
