'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
// Holds the current selection through the funnel so we never pass data
// through fragile inline onclick strings.
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

// ─── Confirm order → register domain ─────────────────────────────────────────
async function confirmOrder() {
  const card   = document.getElementById('cardNumber').value.trim();
  const expiry = document.getElementById('cardExpiry').value.trim();
  const cvc    = document.getElementById('cardCvc').value.trim();

  if (!card || !expiry || !cvc) {
    alert('Please fill in all payment fields.');
    return;
  }

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

  // Show loading state inside modal
  const payBtn = document.querySelector('#modalStep2 .btn-pay');
  payBtn.textContent = 'Processing…';
  payBtn.disabled = true;

  // NOTE: In production, charge the card via Stripe here first, then register.
  // OpenSRS bills the reseller account — it does not process customer payments.
  try {
    const resp = await fetch('/api/domain/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ domain: _sel.domain, period: 1, contact }),
    });

    const data = await resp.json();
    closeCheckout();

    if (!resp.ok || !data.success) {
      showOrderError(data.error ?? data.response_text ?? 'Registration failed.');
      return;
    }

    showDashboard(contact);
  } catch (err) {
    closeCheckout();
    showOrderError(err.message);
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
      <p>Create a professional email like hello@${_sel.domain}</p>
      <div class="panel-actions">
        <button type="button">Create Email</button>
      </div>`;

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
