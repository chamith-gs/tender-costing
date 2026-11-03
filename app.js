(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const KEY = 'tender-costing:v2';

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
    terms: { foreignCurrency: 'USD', localCurrency: 'LKR', exchangeRate: '', crossRate: '', hsCode: '', apMarkup: '' },
    items: [{ id: uid(), name: '', hsCode: '', qty: 1, price: '', unitSize: 0, gsMarginPct: 0, wsMarginPct: 0, retailerPct: 0 }],
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
      `XID ${(h.xid * 100).toFixed(2)}% · VAT ${(h.vat * 100).toFixed(2)}% · SSCL ${(h.sscl * 100).toFixed(2)}% · Clearing ${(h.clearing * 100).toFixed(2)}%`;
  }

  // ---------- calculation ----------
  // Mirrors the per-product sheet:
  // CIP/FCA Rs = price(foreign) × FX × scenario
  // Duty/PAL/Cess/XID = CIP Rs × rate
  // VAT/SSCL base = CIP Rs × AP markup + duty + PAL + cess + XID
  // Total tax (excl VAT) = duty + PAL + cess + XID + SSCL
  // Landed = CIP Rs + total tax + clearing
  // GS price = landed × (1 + GS margin%)
  // AP cost = GS price
  // WS price = AP × (1 + WS margin%)
  // MRP = WS × (1 + retailer%) rounded
  const scenarioMul = () => state.header.scenario === 'inc10' ? 1.10 : state.header.scenario === 'inc5' ? 1.05 : 1.0;

  function calcItem(it) {
    const t = state.terms;
    const h = findHs(it.hsCode || t.hsCode); // per-line HS overrides global
    const fx = num(t.exchangeRate);
    const apMul = num(t.apMarkup) > 0 ? num(t.apMarkup) : (h ? h.apMarkup : 1.10);

    const priceForeign = num(it.price) * scenarioMul();
    const cipRs = priceForeign * fx;

    const dutyRs = cipRs * (h ? h.customsDuty : 0);
    const palRs  = cipRs * (h ? h.pal : 0);
    const cessRs = cipRs * (h ? h.cess : 0);
    const xidRs  = cipRs * (h ? h.xid : 0);

    const vatBase = cipRs * apMul + dutyRs + palRs + cessRs + xidRs;
    const vatRs   = vatBase * (h ? h.vat : 0);
    const ssclRs  = vatBase * (h ? h.sscl : 0);

    const totalTax = dutyRs + palRs + cessRs + xidRs + ssclRs; // VAT excluded
    const clearing = cipRs * (h ? h.clearing : 0);
    const landed   = cipRs + totalTax + clearing;

    const gsPct    = num(it.gsMarginPct);
    const gsPrice  = landed * (1 + gsPct / 100);
    const gsExTax  = (gsPrice / 1.18) * 0.9875; // kept for reference (not printed)

    const apCost   = gsPrice;
    const wsPct    = num(it.wsMarginPct);
    const wsPrice  = apCost * (1 + wsPct / 100);
    const retPct   = num(it.retailerPct);
    const mrp      = wsPrice * (1 + retPct / 100);
    const mrpR     = Math.round(mrp);

    return { h, fx, apMul, priceForeign, cipRs, dutyRs, palRs, cessRs, xidRs, vatRs, ssclRs, totalTax, clearing, landed, gsPct, gsPrice, gsExTax, apCost, wsPct, wsPrice, retPct, mrp, mrpR };
  }

  function totals() {
    let landed = 0, gs = 0, ap = 0, mrp = 0;
    state.items.forEach(it => {
      const c = calcItem(it);
      landed += c.landed * num(it.qty);
      gs     += c.gsPrice * num(it.qty);
      ap     += c.apCost * num(it.qty);
      mrp    += c.mrpR * num(it.qty);
    });
    return { landed, gs, ap, mrp };
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
      Object.assign(state.terms, s.terms || {});
      if (Array.isArray(s.items) && s.items.length) state.items = s.items.map(i => ({
        id: i.id || uid(), name: i.name || '', hsCode: i.hsCode || '', qty: i.qty ?? 1,
        price: i.price || '', unitSize: i.unitSize || 0,
        gsMarginPct: i.gsMarginPct || 0, wsMarginPct: i.wsMarginPct || 0, retailerPct: i.retailerPct || 0,
      }));
      setPill('info', 'Draft restored');
    } catch (e) {}
  }
  function setPill(kind, text) { const p = $('#saveState'); p.textContent = text; p.className = 'pill ' + kind; }

  // ---------- bind header + terms ----------
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
      const h = findHs(hs.value);
      if (h) { state.terms.apMarkup = h.apMarkup; $('#apMarkup').value = h.apMarkup; }
      renderHsRates(); queueSave(); invalidate();
    });
  }

  // ---------- items table ----------
  function renderTable() {
    const tb = $('#itemsBody'); tb.innerHTML = '';
    state.items.forEach(it => {
      const tr = document.createElement('tr'); tr.dataset.id = it.id;
      const hsOptions = '<option value="">—</option>' + HS().map(h => `<option value="${esc(h.code)}"${it.hsCode === h.code ? ' selected' : ''}>${esc(h.code)}</option>`).join('');
      tr.innerHTML = `
        <td><input class="in" data-k="name" value="${esc(it.name)}" placeholder="Product name"></td>
        <td><select class="in" data-k="hsCode">${hsOptions}</select></td>
        <td><input class="in num" data-k="qty" value="${esc(it.qty)}" inputmode="decimal"></td>
        <td><input class="in num" data-k="price" value="${esc(it.price)}" inputmode="decimal" placeholder="0.00"></td>
        <td><input class="in num" data-k="unitSize" value="${esc(it.unitSize)}" inputmode="decimal"></td>
        <td><input class="in num" data-k="gsMarginPct" value="${esc(it.gsMarginPct)}" inputmode="decimal"></td>
        <td><input class="in num" data-k="wsMarginPct" value="${esc(it.wsMarginPct)}" inputmode="decimal"></td>
        <td><input class="in num" data-k="retailerPct" value="${esc(it.retailerPct)}" inputmode="decimal"></td>
        <td class="del"><button type="button" title="Remove">×</button></td>`;
      tb.appendChild(tr);
    });
    if (!state.items.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="9" style="text-align:center;color:var(--ink-2);padding:16px">No products yet.</td>';
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
  $('#itemsBody').addEventListener('change', e => {
    const inp = e.target.closest('.in'); if (!inp || inp.tagName !== 'SELECT') return;
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
    state.items.push({ id: uid(), name: '', hsCode: '', qty: 1, price: '', unitSize: 0, gsMarginPct: 0, wsMarginPct: 0, retailerPct: 0 });
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
    if (!state.items.some(it => num(it.price) > 0)) { setStatus('Add at least one product with a supplier price.', 'err'); return; }
    if (!findHs(state.terms.hsCode) && !state.items.some(it => findHs(it.hsCode))) { setStatus('Select an HS code (globally or per line).', 'err'); return; }
    state.generatedAt = new Date().toISOString();
    renderPreview();
    $('#outputCard').hidden = false;
    $('#outputCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateButtons();
    setStatus('Costing sheet generated. Review, then print or save as PDF.', 'ok');
    toast('Generated');
  });

  function renderPreview() {
    const t = state.terms, h = state.header;
    const dt = h.date ? new Date(h.date + 'T00:00:00').toLocaleDateString() : new Date().toLocaleDateString();
    const scen = h.scenario === 'inc10' ? '10% increase' : h.scenario === 'inc5' ? '5% increase' : 'Base';

    const rows = state.items.map(it => {
      const c = calcItem(it);
      return `<tr>
        <td>${esc(it.name || '—')}</td>
        <td>${esc(it.hsCode || t.hsCode || '—')}</td>
        <td class="num">${fmtInt(num(it.qty))}</td>
        <td class="num">${fmt2(c.priceForeign)} ${esc(t.foreignCurrency)}</td>
        <td class="num">${fmt2(c.cipRs)}</td>
        <td class="num">${fmt2(c.landed)}</td>
        <td class="num">${fmt2(c.gsPrice)}</td>
        <td class="num">${fmt2(c.apCost)}</td>
        <td class="num">${fmt2(c.wsPrice)}</td>
        <td class="num">${fmtInt(c.mrpR)}</td>
      </tr>`;
    }).join('');

    const build = state.items.map((it, i) => {
      const c = calcItem(it);
      return `<tr class="grp"><td colspan="10">${esc(it.name || 'Product ' + (i + 1))} — landed cost build-up (${esc(t.localCurrency)})</td></tr>
        <tr>
          <td>CIP/FCA Rs ${fmt2(c.cipRs)}</td>
          <td>Duty ${fmt2(c.dutyRs)}</td>
          <td>PAL ${fmt2(c.palRs)}</td>
          <td>Cess ${fmt2(c.cessRs)}</td>
          <td>XID ${fmt2(c.xidRs)}</td>
          <td>VAT ${fmt2(c.vatRs)}</td>
          <td>SSCL ${fmt2(c.ssclRs)}</td>
          <td>Clearing ${fmt2(c.clearing)}</td>
          <td colspan="2" class="num"><strong>Landed ${fmt2(c.landed)}</strong></td>
        </tr>`;
    }).join('');

    const tt = totals();
    const activeHs = findHs(t.hsCode);

    $('#preview').innerHTML = `
      <h2>${esc(h.title || 'Tender Costing Sheet')}</h2>
      <div class="ph-sub">
        ${h.supplier ? 'Supplier: ' + esc(h.supplier) + ' · ' : ''}
        ${h.reference ? 'Ref: ' + esc(h.reference) + ' · ' : ''}
        ${dt} · Scenario: ${scen}${h.preparedBy ? ' · By ' + esc(h.preparedBy) : ''}
      </div>

      <div class="ph-grid">
        <div><span class="k">Foreign currency</span><span class="v">${esc(t.foreignCurrency)}</span></div>
        <div><span class="k">Local currency</span><span class="v">${esc(t.localCurrency)}</span></div>
        <div><span class="k">Exchange rate</span><span class="v">1 ${esc(t.foreignCurrency)} = ${fmt4(num(t.exchangeRate))} ${esc(t.localCurrency)}</span></div>
        <div><span class="k">Cross rate</span><span class="v">${t.crossRate ? fmt4(num(t.crossRate)) : '—'}</span></div>
        <div><span class="k">HS code</span><span class="v">${esc(t.hsCode || '—')}</span></div>
        <div><span class="k">AP markup</span><span class="v">${fmt4(num(t.apMarkup) || (activeHs ? activeHs.apMarkup : 1.10))}×</span></div>
      </div>

      <table>
        <thead><tr>
          <th style="width:24%">Product</th>
          <th style="width:10%">HS code</th>
          <th style="width:5%">Qty</th>
          <th style="width:10%">CIP/FCA ${esc(t.foreignCurrency)}</th>
          <th style="width:10%">CIP/FCA ${esc(t.localCurrency)}</th>
          <th style="width:10%">Landed</th>
          <th style="width:9%">GS price</th>
          <th style="width:8%">AP</th>
          <th style="width:8%">WS</th>
          <th style="width:6%">MRP</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="10" style="text-align:center;color:#777">No products</td></tr>'}</tbody>
      </table>

      <table>
        <thead><tr><th colspan="10">Landed cost build-up</th></tr></thead>
        <tbody>${build || ''}</tbody>
      </table>

      <div class="totals">
        <div><span>Total landed cost</span><span>${fmt2(tt.landed)}</span></div>
        <div><span>Total GS price</span><span>${fmt2(tt.gs)}</span></div>
        <div><span>Total AP cost</span><span>${fmt2(tt.ap)}</span></div>
        <div class="grand"><span>Total MRP</span><span>${fmt2(tt.mrp)}</span></div>
      </div>

      <div class="notes">
        <strong>Assumptions</strong>
        <ol>
          <li>Supplier price on CIP / FCA basis; scenario multiplier = ${scenarioMul().toFixed(2)}×.</li>
          <li>HS code drives duty, PAL, Cess, XID, VAT, SSCL, clearing and AP markup.</li>
          <li>Exchange rate ${fmt4(num(t.exchangeRate))} ${esc(t.localCurrency)} per 1 ${esc(t.foreignCurrency)}.</li>
          <li>Total tax excludes VAT; VAT is carried separately in AP cost.</li>
          <li>GS margin on landed; WS margin on AP; retailer margin on WS. MRP rounded.</li>
        </ol>
      </div>

      <div class="foot">
        Generated ${new Date(state.generatedAt).toLocaleString()} · All amounts in ${esc(t.localCurrency)} unless stated.
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
    const payload = { generatedAt: state.generatedAt, header: state.header, terms: state.terms, items: state.items.map(it => ({ ...it, computed: calcItem(it) })), totals: totals() };
    download(`${baseName()}_costing.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast('JSON downloaded');
  });
  $('#btnCsv').addEventListener('click', () => {
    if (!state.generatedAt) return;
    const head = ['Product', 'HS code', 'Qty', 'CIP/FCA foreign', 'CIP/FCA local', 'Duty', 'PAL', 'Cess', 'XID', 'VAT', 'SSCL', 'Clearing', 'Landed', 'GS price', 'AP', 'WS', 'MRP'];
    const rows = [head];
    state.items.forEach(it => {
      const c = calcItem(it);
      rows.push([it.name, it.hsCode || state.terms.hsCode, it.qty, c.priceForeign.toFixed(2), c.cipRs.toFixed(2), c.dutyRs.toFixed(2), c.palRs.toFixed(2), c.cessRs.toFixed(2), c.xidRs.toFixed(2), c.vatRs.toFixed(2), c.ssclRs.toFixed(2), c.clearing.toFixed(2), c.landed.toFixed(2), c.gsPrice.toFixed(2), c.apCost.toFixed(2), c.wsPrice.toFixed(2), c.mrpR]);
    });
    const csv = '\uFEFF' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(`${baseName()}_costing.csv`, csv, 'text/csv;charset=utf-8');
    toast('CSV downloaded');
  });

  // ---------- clear ----------
  $('#btnClear').addEventListener('click', () => {
    if (!confirm('Clear everything and start over?')) return;
    localStorage.removeItem(KEY);
    state.header = { title: '', supplier: '', date: '', preparedBy: '', reference: '', scenario: 'base' };
    state.terms = { foreignCurrency: 'USD', localCurrency: 'LKR', exchangeRate: '', crossRate: '', hsCode: '', apMarkup: '' };
    state.items = [{ id: uid(), name: '', hsCode: '', qty: 1, price: '', unitSize: 0, gsMarginPct: 0, wsMarginPct: 0, retailerPct: 0 }];
    state.generatedAt = null;
    ['title', 'supplier', 'date', 'preparedBy', 'reference'].forEach(k => { const el = $('#' + k); if (el) el.value = ''; });
    $('#scenario').value = 'base';
    ['foreignCurrency', 'localCurrency', 'exchangeRate', 'crossRate', 'apMarkup'].forEach(k => { const el = $('#' + k); if (el) el.value = state.terms[k]; });
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
  renderTable();
  updateButtons();
  if (state.items.some(it => num(it.price) > 0)) setStatus('Draft restored. Generate when ready.', '');
})();