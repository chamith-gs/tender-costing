(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const KEY = 'tender-costing:v7';

  const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const fmt2 = n => (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt4 = n => (Math.round((n + Number.EPSILON) * 10000) / 10000).toString();
  const fmtInt = n => Math.round(n).toLocaleString();
  const uid = () => 'r' + Math.random().toString(36).slice(2, 9);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Basis options for additional landed-cost items
  const BASIS = [
    { id: 'fixed',  label: 'Fixed amount (Rs)',        unit: 'Rs' },
    { id: 'pctCip', label: '% of total CIP',           unit: '%' },
    { id: 'pctLanded', label: '% of landed so far',    unit: '%' },
    { id: 'perUnit', label: 'Per unit (Rs/unit)',      unit: 'Rs/unit' },
  ];

  const state = {
    header: { title: '', supplier: '', date: '', preparedBy: '', reference: '', scenario: 'base' },
    terms: { foreignCurrency: 'USD', localCurrency: 'LKR', exchangeRate: '', crossRate: '', hsCode: '', clearingPct: 8 },
    rates: { gsMarginPct: 20, ssclPct: 1.25, vatPct: 18, wsMarginPct: 8, retailerPct: 12 },
    items: [{ id: uid(), name: '', qty: 1, price: '' }],
    extras: [], // { id, description, basis, value }
    generatedAt: null,
  };

  const HS = () => window.HS_CODES || [];
  const findHs = code => HS().find(h => h.code === code);

  function populateHsSelect() {
    const sel = $('#hsCode');
    sel.innerHTML = '<option value="">— select HS code —</option>' +
      HS().map(h => `<option value="${esc(h.code)}">${esc(h.label || h.code)}</option>`).join('');
    sel.value = state.terms.hsCode || '';
    renderHsRates();
  }
  function renderHsRates() {
    const h = findHs(state.terms.hsCode);
    const el = $('#hsRates');
    if (!h) { el.textContent = 'Pick an HS code to load its duty / tax rates.'; return; }
    el.textContent =
      `Duty ${(h.customsDuty * 100).toFixed(2)}% · PAL ${(h.pal * 100).toFixed(2)}% · Cess ${(h.cess * 100).toFixed(2)}% · ` +
      `XID ${(h.xid * 100).toFixed(2)}% · VAT ${(h.vat * 100).toFixed(2)}% · SSCL ${(h.sscl * 100).toFixed(2)}%`;
  }

  const scenarioMul = () => state.header.scenario === 'inc10' ? 1.10 : state.header.scenario === 'inc5' ? 1.05 : 1.0;

  // --- Per product ---
  // SSCL and VAT are computed on CIP and FOLDED INTO landed cost.
  // Downstream does NOT re-add them (avoids double counting).
  function calcItem(it) {
    const t = state.terms, r = state.rates;
    const h = findHs(t.hsCode);
    const fx = num(t.exchangeRate);

    const priceForeign = num(it.price) * scenarioMul();
    const cipRs = priceForeign * fx;

    const dutyRs   = h ? cipRs * h.customsDuty : 0;
    const palRs    = h ? cipRs * h.pal         : 0;
    const cessRs   = h ? cipRs * h.cess        : 0;
    const xidRs    = h ? cipRs * h.xid         : 0;
    const clearing = cipRs * (num(t.clearingPct) / 100);
    const ssclRs   = cipRs * (num(r.ssclPct) / 100);
    const vatRs    = cipRs * (num(r.vatPct)  / 100);

    const landed = cipRs + dutyRs + palRs + cessRs + xidRs + clearing + ssclRs + vatRs;

    // Downstream (no second tax layer)
    const gsPct    = num(r.gsMarginPct);
    const gsAmount = landed * (gsPct / 100);
    const gsExTax  = landed + gsAmount;

    const aPrice   = gsExTax;                            // A/Price = GS ex-tax
    const wsPct    = num(r.wsMarginPct);
    const wsPrice  = aPrice * (1 + wsPct / 100);

    const retPct   = num(r.retailerPct);
    const mrp      = wsPrice * (1 + retPct / 100);
    const mrpR     = Math.round(mrp);

    return { h, fx, priceForeign, cipRs, dutyRs, palRs, cessRs, xidRs, clearing,
             ssclRs, vatRs, landed,
             gsPct, gsAmount, gsExTax, ssclPct: num(r.ssclPct), vatPct: num(r.vatPct),
             aPrice, wsPct, wsPrice, retPct, mrp, mrpR };
  }

  // --- Tender-level totals ---
  function sumProducts() {
    let qty = 0, cip = 0, landed = 0, gs = 0, ap = 0, ws = 0, mrp = 0;
    state.items.forEach(it => {
      const c = calcItem(it), q = num(it.qty);
      qty += q; cip += c.cipRs * q; landed += c.landed * q;
      gs += c.gsExTax * q; ap += c.aPrice * q;
      ws += c.wsPrice * q; mrp += c.mrpR * q;
    });
    return { qty, cip, landed, gs, ap, ws, mrp };
  }

  // Compute each extra's amount given current product totals
  function computeExtra(ex, products) {
    const v = num(ex.value);
    switch (ex.basis) {
      case 'fixed':      return v;
      case 'pctCip':     return products.cip * (v / 100);
      case 'pctLanded':  return products.landed * (v / 100);
      case 'perUnit':    return products.qty * v;
      default:           return 0;
    }
  }

  function sumExtras() {
    const products = sumProducts();
    let total = 0;
    const rows = state.extras.map(ex => {
      const amt = computeExtra(ex, products);
      total += amt;
      return { ...ex, amount: amt };
    });
    return { rows, total, products };
  }

  // --- Storage ---
  let saveT = null;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); setPill('ok', 'Saved'); } catch (e) { setPill('bad', 'Save failed'); } }
  function queueSave() { setPill('info', 'Saving…'); clearTimeout(saveT); saveT = setTimeout(save, 350); }
  function load() {
    try {
      const raw = localStorage.getItem(KEY); if (!raw) return;
      const s = JSON.parse(raw); if (!s || typeof s !== 'object') return;
      Object.assign(state.header, s.header || {});
      Object.assign(state.terms,  s.terms  || {});
      Object.assign(state.rates,  s.rates  || {});
      if (Array.isArray(s.items) && s.items.length) state.items = s.items.map(i => ({
        id: i.id || uid(), name: i.name || '', qty: i.qty ?? 1, price: i.price || '',
      }));
      if (Array.isArray(s.extras)) state.extras = s.extras.map(e => ({
        id: e.id || uid(), description: e.description || '', basis: e.basis || 'fixed', value: e.value ?? '',
      }));
      setPill('info', 'Draft restored');
    } catch (e) {}
  }
  function setPill(kind, text) { const p = $('#saveState'); p.textContent = text; p.className = 'pill ' + kind; }

  // --- Bind header / terms / rates ---
  function bindHeader() {
    ['title', 'supplier', 'date', 'preparedBy', 'reference', 'scenario'].forEach(k => {
      const el = $('#' + k); if (!el) return;
      el.value = state.header[k] ?? '';
      const on = () => { state.header[k] = el.value; queueSave(); invalidate(); };
      el.addEventListener('input', on); el.addEventListener('change', on);
    });
  }
  function bindTerms() {
    ['foreignCurrency', 'localCurrency', 'exchangeRate', 'crossRate', 'clearingPct'].forEach(k => {
      const el = $('#' + k); if (!el) return;
      el.value = state.terms[k] ?? '';
      const on = () => { state.terms[k] = el.value; queueSave(); invalidate(); };
      el.addEventListener('input', on); el.addEventListener('change', on);
    });
    const hs = $('#hsCode');
    hs.addEventListener('change', () => {
      state.terms.hsCode = hs.value;
      // Pre-fill SSCL and VAT from the HS code (user can still override)
      const h = findHs(hs.value);
      if (h) {
        state.rates.ssclPct = (h.sscl * 100).toFixed(3).replace(/\.?0+$/, '');
        state.rates.vatPct  = (h.vat  * 100).toFixed(2).replace(/\.?0+$/, '');
        $('#ssclPct').value = state.rates.ssclPct;
        $('#vatPct').value  = state.rates.vatPct;
      }
      renderHsRates(); queueSave(); invalidate();
    });
  }
  function bindRates() {
    ['gsMarginPct', 'ssclPct', 'vatPct', 'wsMarginPct', 'retailerPct'].forEach(k => {
      const el = $('#' + k); if (!el) return;
      el.value = state.rates[k] ?? '';
      const on = () => { state.rates[k] = el.value; queueSave(); invalidate(); };
      el.addEventListener('input', on); el.addEventListener('change', on);
    });
  }

  // --- Product table ---
  function renderTable() {
    const tb = $('#itemsBody'); tb.innerHTML = '';
    state.items.forEach(it => {
      const tr = document.createElement('tr'); tr.dataset.id = it.id;
      tr.innerHTML = `
        <td><input class="in" data-k="name" value="${esc(it.name)}" placeholder="Product name"></td>
        <td><input class="in num" data-k="qty" value="${esc(it.qty)}" inputmode="decimal"></td>
        <td><input class="in num" data-k="price" value="${esc(it.price)}" inputmode="decimal" placeholder="0.00"></td>
        <td class="del"><button type="button" title="Remove">×</button></td>`;
      tb.appendChild(tr);
    });
    if (!state.items.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="4" style="text-align:center;color:var(--ink-2);padding:16px">No products yet.</td>';
      tb.appendChild(tr);
    }
    updatePill(); updateButtons();
  }

  // --- Extras table ---
  function renderExtras() {
    const tb = $('#extrasBody'); tb.innerHTML = '';
    const products = sumProducts();
    state.extras.forEach(ex => {
      const amt = computeExtra(ex, products);
      const tr = document.createElement('tr'); tr.dataset.id = ex.id;
      const basisOpts = BASIS.map(b => `<option value="${b.id}"${ex.basis === b.id ? ' selected' : ''}>${esc(b.label)}</option>`).join('');
      tr.innerHTML = `
        <td><input class="in" data-k="description" value="${esc(ex.description)}" placeholder="e.g. Additional air freight"></td>
        <td><select class="in" data-k="basis">${basisOpts}</select></td>
        <td><input class="in num" data-k="value" value="${esc(ex.value)}" inputmode="decimal" placeholder="0.00"></td>
        <td class="calc">${amt ? fmt2(amt) : '—'}</td>
        <td class="del"><button type="button" title="Remove">×</button></td>`;
      tb.appendChild(tr);
    });
    if (!state.extras.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5" style="text-align:center;color:var(--ink-2);padding:12px">No additional items.</td>';
      tb.appendChild(tr);
    }
    const total = state.extras.reduce((s, ex) => s + computeExtra(ex, products), 0);
    $('#extrasTotal').textContent = total ? fmt2(total) : '—';
  }

  function updatePill() {
    const t = state.terms; const p = $('#termsPill');
    const h = findHs(t.hsCode);
    if (!h) { p.textContent = 'No HS code selected'; p.className = 'pill warn'; return; }
    p.textContent = `${h.code} · ${t.foreignCurrency}→${t.localCurrency}`;
    p.className = 'pill ok';
  }
  function updateButtons() {
    const ready = state.items.some(it => num(it.price) > 0);
    const canOut = ready && !!state.generatedAt;
    $('#btnPrint').disabled = !canOut;
    $('#btnJson').disabled = !canOut;
    $('#btnCsv').disabled = !canOut;
  }

  // --- Product events ---
  $('#itemsBody').addEventListener('input', e => {
    const inp = e.target.closest('.in'); if (!inp) return;
    const tr = inp.closest('tr'); const it = state.items.find(i => i.id === tr.dataset.id); if (!it) return;
    it[inp.dataset.k] = inp.value; queueSave(); renderExtras(); invalidate();
  });
  $('#itemsBody').addEventListener('click', e => {
    if (e.target.closest('.del button')) {
      const tr = e.target.closest('tr');
      state.items = state.items.filter(i => i.id !== tr.dataset.id);
      queueSave(); renderTable(); renderExtras(); invalidate();
    }
  });
  $('#btnAddRow').addEventListener('click', () => {
    state.items.push({ id: uid(), name: '', qty: 1, price: '' });
    queueSave(); renderTable(); renderExtras(); invalidate();
    const rows = $('#itemsBody').querySelectorAll('tr');
    rows[rows.length - 1]?.querySelector('[data-k="name"]')?.focus();
  });

  // --- Extras events ---
  $('#extrasBody').addEventListener('input', e => {
    const inp = e.target.closest('.in'); if (!inp) return;
    const tr = inp.closest('tr'); const ex = state.extras.find(x => x.id === tr.dataset.id); if (!ex) return;
    ex[inp.dataset.k] = inp.value; queueSave(); renderExtras(); invalidate();
  });
  $('#extrasBody').addEventListener('change', e => {
    const inp = e.target.closest('select.in'); if (!inp) return;
    const tr = inp.closest('tr'); const ex = state.extras.find(x => x.id === tr.dataset.id); if (!ex) return;
    ex[inp.dataset.k] = inp.value; queueSave(); renderExtras(); invalidate();
  });
  $('#extrasBody').addEventListener('click', e => {
    if (e.target.closest('.del button')) {
      const tr = e.target.closest('tr');
      state.extras = state.extras.filter(x => x.id !== tr.dataset.id);
      queueSave(); renderExtras(); invalidate();
    }
  });
  $('#btnAddExtra').addEventListener('click', () => {
    state.extras.push({ id: uid(), description: '', basis: 'fixed', value: '' });
    queueSave(); renderExtras(); invalidate();
    const rows = $('#extrasBody').querySelectorAll('tr');
    rows[rows.length - 1]?.querySelector('[data-k="description"]')?.focus();
  });

  // --- Output ---
  function invalidate() {
    if (state.generatedAt) {
      state.generatedAt = null;
      $('#outputCard').hidden = true;
      setStatus('Inputs changed. Generate the sheet again.', '');
    }
    updateButtons();
  }
  function setStatus(msg, kind) { const p = $('#statusText'); p.textContent = msg; p.className = kind || ''; }

  $('#btnPreview').addEventListener('click', () => {
    if (!findHs(state.terms.hsCode)) { setStatus('Select an HS code first.', 'err'); return; }
    if (!state.items.some(it => num(it.price) > 0)) { setStatus('Add at least one product with a supplier price.', 'err'); return; }
    state.generatedAt = new Date().toISOString();
    renderPreview();
    $('#outputCard').hidden = false;
    $('#outputCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateButtons();
    setStatus('Costing sheet generated. Review, then print or save as PDF.', 'ok');
    toast('Generated');
  });

  function renderPreview() {
    const t = state.terms, h = state.header, r = state.rates;
    const dt = h.date ? new Date(h.date + 'T00:00:00').toLocaleDateString() : new Date().toLocaleDateString();
    const scen = h.scenario === 'inc10' ? '10% increase' : h.scenario === 'inc5' ? '5% increase' : 'Base';
    const hs = findHs(t.hsCode);
    const lc = esc(t.localCurrency);
    const fc = esc(t.foreignCurrency);

    const { rows: extraRows, total: extrasTotal, products } = sumExtras();

    const prodRows = state.items.map((it, i) => {
      const c = calcItem(it), q = num(it.qty);
      return `<tr>
        <td>${i + 1}</td>
        <td>${esc(it.name || '—')}</td>
        <td class="num">${fmtInt(q)}</td>
        <td class="num">${fmt2(c.priceForeign)} ${fc}</td>
        <td class="num">${fmt2(c.cipRs)}</td>
        <td class="num">${fmt2(c.landed)}</td>
      </tr>`;
    }).join('');

    const taxRows = (() => {
      let duty = 0, pal = 0, cess = 0, xid = 0, clearing = 0, sscl = 0, vat = 0;
      state.items.forEach(it => {
        const c = calcItem(it), q = num(it.qty);
        duty += c.dutyRs * q; pal += c.palRs * q; cess += c.cessRs * q;
        xid  += c.xidRs  * q; clearing += c.clearing * q;
        sscl += c.ssclRs * q; vat += c.vatRs * q;
      });
      const row = (label, pct, amt) => `<tr>
        <td>${label}</td>
        <td class="num">${pct !== null ? pct.toFixed(2) + '%' : '—'}</td>
        <td class="num">${fmt2(amt)}</td>
      </tr>`;
      return row('Customs Duty',             hs ? hs.customsDuty * 100 : 0, duty)
           + row('PAL',                      hs ? hs.pal         * 100 : 0, pal)
           + row('Cess Levy',                hs ? hs.cess        * 100 : 0, cess)
           + row('XID',                      hs ? hs.xid         * 100 : 0, xid)
           + row('Clearing & other charges', num(t.clearingPct),              clearing)
           + row('SSCL',                     num(r.ssclPct),                   sscl)
           + row('VAT',                      num(r.vatPct),                    vat);
    })();

    const extrasHtml = extraRows.length ? extraRows.map((ex, i) => {
      const basis = BASIS.find(b => b.id === ex.basis) || BASIS[0];
      const valStr = ex.basis === 'fixed' ? 'Rs ' + fmt2(num(ex.value))
                   : ex.basis === 'perUnit' ? 'Rs ' + fmt2(num(ex.value)) + '/unit'
                   : num(ex.value).toFixed(2) + '%';
      return `<tr>
        <td>${i + 1}</td>
        <td>${esc(ex.description || '—')}</td>
        <td>${esc(basis.label)}</td>
        <td class="num">${valStr}</td>
        <td class="num">${fmt2(ex.amount)}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" style="text-align:center;color:#777">No additional items</td></tr>';

    const chainRows = state.items.map((it, i) => {
      const c = calcItem(it);
      return `<tr>
        <td>${i + 1}. ${esc(it.name || '—')}</td>
        <td class="num">${fmt2(c.gsAmount)}</td>
        <td class="num">${fmt2(c.gsExTax)}</td>
        <td class="num">${fmt2(c.aPrice)}</td>
        <td class="num">${fmt2(c.wsPrice)}</td>
        <td class="num">${fmt2(c.mrpR)}</td>
      </tr>`;
    }).join('');

    const paramRows = `
      <tr><td>GS Margin with Prom.</td><td class="num">${num(r.gsMarginPct).toFixed(2)}%</td></tr>
      <tr><td>SSCL – ${num(r.ssclPct).toFixed(2)}%</td><td class="num">${num(r.ssclPct).toFixed(2)}%</td></tr>
      <tr><td>VAT – ${num(r.vatPct).toFixed(2)}%</td><td class="num">${num(r.vatPct).toFixed(2)}%</td></tr>
      <tr><td>W/S Margin</td><td class="num">${num(r.wsMarginPct).toFixed(2)}%</td></tr>
      <tr><td>Retailer Margin</td><td class="num">${num(r.retailerPct).toFixed(2)}%</td></tr>
    `;

    const tenderLanded = products.landed + extrasTotal;
    const tenderGS      = products.gs;
    const tenderAP      = products.ap;
    const tenderWS      = products.ws;
    const tenderMRP     = products.mrp;

    $('#preview').innerHTML = `
      <h2>${esc(h.title || 'Tender Costing Sheet')}</h2>
      <div class="ph-sub">
        ${h.supplier ? 'Supplier: ' + esc(h.supplier) + ' · ' : ''}
        ${h.reference ? 'Ref: ' + esc(h.reference) + ' · ' : ''}
        ${dt} · Scenario: ${scen}${h.preparedBy ? ' · By ' + esc(h.preparedBy) : ''}
      </div>

      <div class="ph-grid">
        <div><span class="k">HS code</span><span class="v">${esc(t.hsCode || '—')}</span></div>
        <div><span class="k">Exchange rate</span><span class="v">1 ${fc} = ${fmt4(num(t.exchangeRate))} ${lc}</span></div>
        <div><span class="k">Foreign / local currency</span><span class="v">${fc} / ${lc}</span></div>
        <div><span class="k">Cross rate</span><span class="v">${t.crossRate ? fmt4(num(t.crossRate)) : '—'}</span></div>
        <div><span class="k">Clearing &amp; other charges</span><span class="v">${num(t.clearingPct).toFixed(2)}%</span></div>
      </div>

      <h3>Products</h3>
      <table>
        <thead><tr>
          <th style="width:5%">#</th>
          <th style="width:43%">Product</th>
          <th style="width:8%">Qty</th>
          <th style="width:14%">FCA/CIP (${fc})</th>
          <th style="width:15%">CIP (${lc})</th>
          <th style="width:15%">Landed cost</th>
        </tr></thead>
        <tbody>${prodRows || '<tr><td colspan="6" style="text-align:center;color:#777">No products</td></tr>'}</tbody>
      </table>

      <h3>Additional landed-cost items</h3>
      <table>
        <thead><tr>
          <th style="width:5%">#</th>
          <th style="width:37%">Description</th>
          <th style="width:23%">Basis</th>
          <th style="width:15%">Value</th>
          <th style="width:20%">Amount (${lc})</th>
        </tr></thead>
        <tbody>${extrasHtml}</tbody>
      </table>

      <h3>Taxes &amp; duties (HS ${esc(t.hsCode || '—')})</h3>
      <table>
        <thead><tr>
          <th style="width:60%">Component</th>
          <th style="width:15%">Rate</th>
          <th style="width:25%">Amount (${lc})</th>
        </tr></thead>
        <tbody>${taxRows}</tbody>
      </table>

      <h3>Downstream chain per product</h3>
      <table>
        <thead><tr>
          <th style="width:34%">Product</th>
          <th style="width:13%">GS margin (amt)</th>
          <th style="width:13%">GS ex-tax</th>
          <th style="width:13%">A/Price</th>
          <th style="width:13%">W/S/Price</th>
          <th style="width:14%">MRP</th>
        </tr></thead>
        <tbody>${chainRows || '<tr><td colspan="6" style="text-align:center;color:#777">No products</td></tr>'}</tbody>
      </table>

      <h3>Stage parameters (Margin &amp; Taxes)</h3>
      <table>
        <thead><tr>
          <th style="width:70%">Stage</th>
          <th style="width:30%">Rate</th>
        </tr></thead>
        <tbody>${paramRows}</tbody>
      </table>

      <div class="totals">
        <div><span>Total product landed cost</span><span>${fmt2(products.landed)}</span></div>
        <div><span>Additional landed-cost items</span><span>${fmt2(extrasTotal)}</span></div>
        <div class="tender"><span>Tender landed cost (incl. extras)</span><span>${fmt2(tenderLanded)}</span></div>
        <div><span>Total GS ex-tax</span><span>${fmt2(tenderGS)}</span></div>
        <div><span>Total A/Price</span><span>${fmt2(tenderAP)}</span></div>
        <div><span>Total W/S/Price</span><span>${fmt2(tenderWS)}</span></div>
        <div class="grand"><span>Total MRP</span><span>${fmt2(tenderMRP)}</span></div>
      </div>

      <div class="notes">
        <strong>Assumptions</strong>
        <ol>
          <li>HS code <strong>${esc(t.hsCode || '—')}</strong> supplies Duty, PAL, Cess, XID; SSCL and VAT rates are pre-filled from the HS code and can be overridden in Margin &amp; Taxes.</li>
          <li>Clearing &amp; other charges = <strong>${num(t.clearingPct).toFixed(2)}%</strong> of CIP Rs (user-entered).</li>
          <li>Landed cost = CIP + Duty + PAL + Cess + XID + Clearing + SSCL + VAT.</li>
          <li>SSCL and VAT are included in landed cost. They are not re-added downstream.</li>
          <li>Supplier price on CIP / FCA basis; scenario multiplier = ${scenarioMul().toFixed(2)}×.</li>
          <li>Exchange rate ${fmt4(num(t.exchangeRate))} ${lc} per 1 ${fc}.</li>
          <li>Additional landed-cost items are tender-level and added once — not split across products.</li>
        </ol>
      </div>

      <div class="foot">
        Generated ${new Date(state.generatedAt).toLocaleString()} · All amounts in ${lc} unless stated.
      </div>
    `;
  }

  $('#btnPrint').addEventListener('click', () => { if (state.generatedAt) window.print(); });

  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  const baseName = () => (state.header.reference || state.header.title || 'costing').replace(/[^\w\-]+/g, '_').slice(0, 60);

  $('#btnJson').addEventListener('click', () => {
    if (!state.generatedAt) return;
    const ex = sumExtras();
    const payload = {
      generatedAt: state.generatedAt,
      header: state.header, terms: state.terms, rates: state.rates,
      items: state.items.map(it => ({ ...it, computed: calcItem(it) })),
      extras: ex.rows,
      totals: { products: ex.products, extras: ex.total, tenderLanded: ex.products.landed + ex.total },
    };
    download(`${baseName()}_costing.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast('JSON downloaded');
  });
  $('#btnCsv').addEventListener('click', () => {
    if (!state.generatedAt) return;
    // CSV per-product only; extras excluded until the CSV format is finalised.
    const head = ['Product', 'Qty', 'FCA/CIP foreign', 'CIP local', 'Duty', 'PAL', 'Cess', 'XID', 'Clearing', 'SSCL', 'VAT', 'Landed', 'GS margin amt', 'GS ex-tax', 'A/Price', 'W/S/Price', 'MRP'];
    const rows = [head];
    state.items.forEach(it => {
      const c = calcItem(it);
      rows.push([it.name, it.qty, c.priceForeign.toFixed(2), c.cipRs.toFixed(2), c.dutyRs.toFixed(2), c.palRs.toFixed(2), c.cessRs.toFixed(2), c.xidRs.toFixed(2), c.clearing.toFixed(2), c.ssclRs.toFixed(2), c.vatRs.toFixed(2), c.landed.toFixed(2), c.gsAmount.toFixed(2), c.gsExTax.toFixed(2), c.aPrice.toFixed(2), c.wsPrice.toFixed(2), c.mrpR]);
    });
    const csv = '\uFEFF' + rows.map(rr => rr.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(`${baseName()}_costing.csv`, csv, 'text/csv;charset=utf-8');
    toast('CSV downloaded (extras not yet in CSV)');
  });

  $('#btnClear').addEventListener('click', () => {
    if (!confirm('Clear everything and start over?')) return;
    localStorage.removeItem(KEY);
    state.header = { title: '', supplier: '', date: '', preparedBy: '', reference: '', scenario: 'base' };
    state.terms  = { foreignCurrency: 'USD', localCurrency: 'LKR', exchangeRate: '', crossRate: '', hsCode: '', clearingPct: 8 };
    state.rates  = { gsMarginPct: 20, ssclPct: 1.25, vatPct: 18, wsMarginPct: 8, retailerPct: 12 };
    state.items  = [{ id: uid(), name: '', qty: 1, price: '' }];
    state.extras = [];
    state.generatedAt = null;
    ['title', 'supplier', 'date', 'preparedBy', 'reference'].forEach(k => { const el = $('#' + k); if (el) el.value = ''; });
    $('#scenario').value = 'base';
    ['foreignCurrency', 'localCurrency', 'exchangeRate', 'crossRate', 'clearingPct'].forEach(k => { const el = $('#' + k); if (el) el.value = state.terms[k]; });
    ['gsMarginPct', 'ssclPct', 'vatPct', 'wsMarginPct', 'retailerPct'].forEach(k => { const el = $('#' + k); if (el) el.value = state.rates[k]; });
    $('#hsCode').value = ''; renderHsRates();
    $('#outputCard').hidden = true;
    setPill('info', 'Not saved');
    setStatus('Cleared.', '');
    renderTable(); renderExtras(); updateButtons();
  });

  let toastT = null;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1700);
  }

  load();
  populateHsSelect();
  bindHeader();
  bindTerms();
  bindRates();
  renderTable();
  renderExtras();
  updateButtons();
  if (state.items.some(it => num(it.price) > 0)) setStatus('Draft restored. Generate when ready.', '');
})();