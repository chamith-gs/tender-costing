(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const KEY = 'tender-costing:v4';

  // ---------- helpers ----------
  const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const fmt2 = n => (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt4 = n => (Math.round((n + Number.EPSILON) * 10000) / 10000).toString();
  const fmtInt = n => Math.round(n).toLocaleString();
  const uid = () => 'r' + Math.random().toString(36).slice(2, 9);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- state ----------
  const state = {
    header: { title: '', supplier: '', date: '', preparedBy: '', reference: '', scenario: 'base' },
    terms: { foreignCurrency: 'USD', localCurrency: 'LKR', exchangeRate: '', crossRate: '', hsCode: '', apMarkup: 1.00 },
    rates: { gsMarginPct: 20, ssclPct: 1.25, vatPct: 18, wsMarginPct: 8, retailerPct: 12 },
    items: [{ id: uid(), name: '', qty: 1, price: '' }],
    generatedAt: null,
  };

  const HS = () => window.HS_CODES || [];
  const findHs = code => HS().find(h => h.code === code);

  // ---------- HS dropdown ----------
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
      `XID ${(h.xid * 100).toFixed(2)}% · Clearing ${(h.clearing * 100).toFixed(2)}%`;
  }

  // ---------- calculation ----------
  const scenarioMul = () => state.header.scenario === 'inc10' ? 1.10 : state.header.scenario === 'inc5' ? 1.05 : 1.0;

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
    const clearing = h ? cipRs * h.clearing    : 0;

    const landed = cipRs + dutyRs + palRs + cessRs + xidRs + clearing;

    const gsPct    = num(r.gsMarginPct);
    const gsAmount = landed * (gsPct / 100);
    const gsExTax  = landed + gsAmount;

    const ssclPct  = num(r.ssclPct);
    const ssclRs   = gsExTax * (ssclPct / 100);

    const vatPct   = num(r.vatPct);
    const vatRs    = (gsExTax + ssclRs) * (vatPct / 100);

    const aPrice   = gsExTax + ssclRs + vatRs;

    const wsPct    = num(r.wsMarginPct);
    const wsPrice  = aPrice * (1 + wsPct / 100);

    const retPct   = num(r.retailerPct);
    const mrp      = wsPrice * (1 + retPct / 100);
    const mrpR     = Math.round(mrp);

    return { h, fx, priceForeign, cipRs, dutyRs, palRs, cessRs, xidRs, clearing, landed,
             gsPct, gsAmount, gsExTax, ssclPct, ssclRs, vatPct, vatRs, aPrice,
             wsPct, wsPrice, retPct, mrp, mrpR };
  }

  function totals() {
    let landed = 0, gs = 0, sscl = 0, vat = 0, ap = 0, ws = 0, mrp = 0;
    state.items.forEach(it => {
      const c = calcItem(it), q = num(it.qty);
      landed += c.landed   * q;
      gs     += c.gsExTax  * q;
      sscl   += c.ssclRs   * q;
      vat    += c.vatRs    * q;
      ap     += c.aPrice   * q;
      ws     += c.wsPrice  * q;
      mrp    += c.mrpR     * q;
    });
    return { landed, gs, sscl, vat, ap, ws, mrp };
  }

  // ---------- storage ----------
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
      setPill('info', 'Draft restored');
    } catch (e) {}
  }
  function setPill(kind, text) { const p = $('#saveState'); p.textContent = text; p.className = 'pill ' + kind; }

  // ---------- bind header + terms + rates ----------
  function bindHeader() {
    ['title', 'supplier', 'date', 'preparedBy', 'reference', 'scenario'].forEach(k => {
      const el = $('#' + k); if (!el) return;
      el.value = state.header[k] ?? '';
      const on = () => { state.header[k] = el.value; queueSave(); invalidate(); };
      el.addEventListener('input', on); el.addEventListener('change', on);
    });
  }
  function bindTerms() {
    ['foreignCurrency', 'localCurrency', 'exchangeRate', 'crossRate', 'apMarkup'].forEach(k => {
      const el = $('#' + k); if (!el) return;
      el.value = state.terms[k] ?? '';
      const on = () => { state.terms[k] = el.value; queueSave(); invalidate(); };
      el.addEventListener('input', on); el.addEventListener('change', on);
    });
    const hs = $('#hsCode');
    hs.addEventListener('change', () => {
      state.terms.hsCode = hs.value;
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

  // ---------- items table (only name / qty / price) ----------
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

  $('#itemsBody').addEventListener('input', e => {
    const inp = e.target.closest('.in'); if (!inp) return;
    const tr = inp.closest('tr'); const it = state.items.find(i => i.id === tr.dataset.id); if (!it) return;
    it[inp.dataset.k] = inp.value; queueSave(); invalidate();
  });
  $('#itemsBody').addEventListener('click', e => {
    if (e.target.closest('.del button')) {
      const tr = e.target.closest('tr');
      state.items = state.items.filter(i => i.id !== tr.dataset.id);
      queueSave(); renderTable(); invalidate();
    }
  });
  $('#btnAddRow').addEventListener('click', () => {
    state.items.push({ id: uid(), name: '', qty: 1, price: '' });
    queueSave(); renderTable(); invalidate();
    const rows = $('#itemsBody').querySelectorAll('tr');
    rows[rows.length - 1]?.querySelector('[data-k="name"]')?.focus();
  });

  // ---------- output ----------
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

    // Section A: products (name / qty / price / cip / landed)
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

    // Section B: taxes & duties (vertical rows)
    const taxRows = (() => {
      let duty = 0, pal = 0, cess = 0, xid = 0, clearing = 0;
      state.items.forEach(it => {
        const c = calcItem(it), q = num(it.qty);
        duty += c.dutyRs * q; pal += c.palRs * q; cess += c.cessRs * q;
        xid  += c.xidRs  * q; clearing += c.clearing * q;
      });
      const row = (label, pct, amt) => `<tr>
        <td>${label}</td>
        <td class="num">${pct !== null ? pct.toFixed(2) + '%' : '—'}</td>
        <td class="num">${fmt2(amt)}</td>
      </tr>`;
      return row('Customs Duty',           hs ? hs.customsDuty * 100 : 0, duty)
           + row('PAL',                    hs ? hs.pal         * 100 : 0, pal)
           + row('Cess Levy',              hs ? hs.cess        * 100 : 0, cess)
           + row('XID',                    hs ? hs.xid         * 100 : 0, xid)
           + row('Clearing & other charges', hs ? hs.clearing  * 100 : 0, clearing);
    })();

    // Section C: downstream chain per product
    const chainRows = state.items.map((it, i) => {
      const c = calcItem(it);
      return `<tr>
        <td>${i + 1}. ${esc(it.name || '—')}</td>
        <td class="num">${fmt2(c.gsAmount)}</td>
        <td class="num">${fmt2(c.gsExTax)}</td>
        <td class="num">${fmt2(c.ssclRs)}</td>
        <td class="num">${fmt2(c.vatRs)}</td>
        <td class="num">${fmt2(c.aPrice)}</td>
        <td class="num">${fmt2(c.wsPrice)}</td>
        <td class="num">${fmt2(c.mrpR)}</td>
      </tr>`;
    }).join('');

    // Section D: stage parameters (from global rates)
    const paramRows = `
      <tr><td>GS Margin with Prom.</td><td class="num">${num(r.gsMarginPct).toFixed(2)}%</td><td class="num">—</td></tr>
      <tr><td>GS Invoicing price without Tax</td><td class="num">—</td><td class="num">—</td></tr>
      <tr><td>SSCL – ${num(r.ssclPct).toFixed(2)}% (50%)</td><td class="num">${num(r.ssclPct).toFixed(2)}%</td><td class="num">—</td></tr>
      <tr><td>VAT – ${num(r.vatPct).toFixed(2)}%</td><td class="num">${num(r.vatPct).toFixed(2)}%</td><td class="num">—</td></tr>
      <tr><td>A/Price (Rs.)</td><td class="num">—</td><td class="num">—</td></tr>
      <tr><td>W/S/Price (Rs.)</td><td class="num">${num(r.wsMarginPct).toFixed(2)}%</td><td class="num">—</td></tr>
      <tr><td>MRP (Rs.)</td><td class="num">${num(r.retailerPct).toFixed(2)}%</td><td class="num">—</td></tr>
    `;

    const tt = totals();

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
          <th style="width:24%">Product</th>
          <th style="width:11%">GS margin (amt)</th>
          <th style="width:11%">GS ex-tax</th>
          <th style="width:10%">SSCL</th>
          <th style="width:10%">VAT</th>
          <th style="width:11%">A/Price</th>
          <th style="width:11%">W/S/Price</th>
          <th style="width:12%">MRP</th>
        </tr></thead>
        <tbody>${chainRows || '<tr><td colspan="8" style="text-align:center;color:#777">No products</td></tr>'}</tbody>
      </table>

      <h3>Stage parameters (global)</h3>
      <table>
        <thead><tr>
          <th style="width:60%">Stage</th>
          <th style="width:15%">Rate</th>
          <th style="width:25%">Amount (${lc})</th>
        </tr></thead>
        <tbody>${paramRows}</tbody>
      </table>

      <div class="totals">
        <div><span>Total landed cost</span><span>${fmt2(tt.landed)}</span></div>
        <div><span>Total GS ex-tax</span><span>${fmt2(tt.gs)}</span></div>
        <div><span>Total SSCL</span><span>${fmt2(tt.sscl)}</span></div>
        <div><span>Total VAT</span><span>${fmt2(tt.vat)}</span></div>
        <div><span>Total A/Price</span><span>${fmt2(tt.ap)}</span></div>
        <div><span>Total W/S/Price</span><span>${fmt2(tt.ws)}</span></div>
        <div class="grand"><span>Total MRP</span><span>${fmt2(tt.mrp)}</span></div>
      </div>

      <div class="notes">
        <strong>Assumptions</strong>
        <ol>
          <li>HS code <strong>${esc(t.hsCode || '—')}</strong> applies to every product line.</li>
          <li>Supplier price on CIP / FCA basis; scenario multiplier = ${scenarioMul().toFixed(2)}×.</li>
          <li>Exchange rate ${fmt4(num(t.exchangeRate))} ${lc} per 1 ${fc}.</li>
          <li>Landed cost = CIP + Duty + PAL + Cess + XID + Clearing.</li>
          <li>GS margin, SSCL, VAT, W/S margin and retailer margin are global rates applied to every line.</li>
        </ol>
      </div>

      <div class="foot">
        Generated ${new Date(state.generatedAt).toLocaleString()} · All amounts in ${lc} unless stated.
      </div>
    `;
  }

  // ---------- print ----------
  $('#btnPrint').addEventListener('click', () => { if (state.generatedAt) window.print(); });

  // ---------- downloads ----------
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
    const payload = { generatedAt: state.generatedAt, header: state.header, terms: state.terms, rates: state.rates, items: state.items.map(it => ({ ...it, computed: calcItem(it) })), totals: totals() };
    download(`${baseName()}_costing.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast('JSON downloaded');
  });
  $('#btnCsv').addEventListener('click', () => {
    if (!state.generatedAt) return;
    const head = ['Product', 'Qty', 'FCA/CIP foreign', 'CIP local', 'Duty', 'PAL', 'Cess', 'XID', 'Clearing', 'Landed', 'GS margin amt', 'GS ex-tax', 'SSCL', 'VAT', 'A/Price', 'W/S/Price', 'MRP'];
    const rows = [head];
    state.items.forEach(it => {
      const c = calcItem(it);
      rows.push([it.name, it.qty, c.priceForeign.toFixed(2), c.cipRs.toFixed(2), c.dutyRs.toFixed(2), c.palRs.toFixed(2), c.cessRs.toFixed(2), c.xidRs.toFixed(2), c.clearing.toFixed(2), c.landed.toFixed(2), c.gsAmount.toFixed(2), c.gsExTax.toFixed(2), c.ssclRs.toFixed(2), c.vatRs.toFixed(2), c.aPrice.toFixed(2), c.wsPrice.toFixed(2), c.mrpR]);
    });
    const csv = '\uFEFF' + rows.map(rr => rr.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(`${baseName()}_costing.csv`, csv, 'text/csv;charset=utf-8');
    toast('CSV downloaded');
  });

  // ---------- clear ----------
  $('#btnClear').addEventListener('click', () => {
    if (!confirm('Clear everything and start over?')) return;
    localStorage.removeItem(KEY);
    state.header = { title: '', supplier: '', date: '', preparedBy: '', reference: '', scenario: 'base' };
    state.terms  = { foreignCurrency: 'USD', localCurrency: 'LKR', exchangeRate: '', crossRate: '', hsCode: '', apMarkup: 1.00 };
    state.rates  = { gsMarginPct: 20, ssclPct: 1.25, vatPct: 18, wsMarginPct: 8, retailerPct: 12 };
    state.items  = [{ id: uid(), name: '', qty: 1, price: '' }];
    state.generatedAt = null;
    ['title', 'supplier', 'date', 'preparedBy', 'reference'].forEach(k => { const el = $('#' + k); if (el) el.value = ''; });
    $('#scenario').value = 'base';
    ['foreignCurrency', 'localCurrency', 'exchangeRate', 'crossRate', 'apMarkup'].forEach(k => { const el = $('#' + k); if (el) el.value = state.terms[k]; });
    ['gsMarginPct', 'ssclPct', 'vatPct', 'wsMarginPct', 'retailerPct'].forEach(k => { const el = $('#' + k); if (el) el.value = state.rates[k]; });
    $('#hsCode').value = ''; renderHsRates();
    $('#outputCard').hidden = true;
    setPill('info', 'Not saved');
    setStatus('Cleared.', '');
    renderTable(); updateButtons();
  });

  // ---------- toast ----------
  let toastT = null;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1700);
  }

  // ---------- init ----------
  load();
  populateHsSelect();
  bindHeader();
  bindTerms();
  bindRates();
  renderTable();
  updateButtons();
  if (state.items.some(it => num(it.price) > 0)) setStatus('Draft restored. Generate when ready.', '');
})();