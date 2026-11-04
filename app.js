(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const KEY = 'tender-costing:v11';

  const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const fmt2 = n => (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt4 = n => (Math.round((n + Number.EPSILON) * 10000) / 10000).toString();
  const fmtInt = n => Math.round(n).toLocaleString();
  const uid = () => 'r' + Math.random().toString(36).slice(2, 9);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const BASIS = [
    { id: 'fixed',     label: 'Fixed amount (Rs)' },
    { id: 'pctCip',    label: '% of total CIP' },
    { id: 'pctLanded', label: '% of landed so far' },
    { id: 'perUnit',   label: 'Per unit (Rs/unit)' },
  ];

  const state = {
    header: { title: '', supplier: '', date: '', preparedBy: '', reference: '', validity: 30 },
    terms:  { foreignCurrency: 'USD', localCurrency: 'LKR', exchangeRate: '',
              crossRate: '', hsCode: '', clearingPct: 8, vatUplift: 1.10 },
    rates:  {
      gsMarginMode: 'pct', gsMarginPct: 20, gsMarginFixed: 0,
      nbtPct: 0, vatGsPct: 0,
      wsMarginPct: 0, retailerPct: 0,
      ssclPct: 1.25, vatPct: 18,
      aPriceInput: '', wsOutPct: 8, mrpInput: '',
    },
    items:  [{ id: uid(), name: '', qty: 1, price: '' }],
    extras: [],
    generatedAt: null,
  };

  let lastUpliftDefault = 1.10;

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

  function calcItem(it) {
    const t = state.terms, r = state.rates;
    const h = findHs(t.hsCode);
    const fx = num(t.exchangeRate);
    const uplift = num(t.vatUplift) > 0 ? num(t.vatUplift) : 1.10;

    const priceForeign = num(it.price);
    const cipRs = priceForeign * fx;

    const dutyRs   = h ? cipRs * h.customsDuty : 0;
    const palRs    = h ? cipRs * h.pal         : 0;
    const cessRs   = h ? cipRs * h.cess        : 0;
    const xidRs    = h ? cipRs * h.xid         : 0;
    const clearing = cipRs * (num(t.clearingPct) / 100);

    const vatBase  = cipRs * uplift + dutyRs + palRs + cessRs + xidRs;
    const ssclLand = vatBase * (num(r.ssclPct) / 100);
    const vatLand  = vatBase * (num(r.vatPct)  / 100);

    const landed   = cipRs + dutyRs + palRs + cessRs + xidRs + clearing + ssclLand;

    const gsAmount = r.gsMarginMode === 'fixed'
      ? num(r.gsMarginFixed)
      : landed * (num(r.gsMarginPct) / 100);
    const gsExTax  = landed + gsAmount;

    const nbtRs    = gsExTax * (num(r.nbtPct)   / 100);
    const vatGsRs  = (gsExTax + nbtRs) * (num(r.vatGsPct) / 100);

    const apCost   = gsExTax + nbtRs + vatGsRs;

    const wsRs     = apCost * (num(r.wsMarginPct) / 100);
    const wsPrice  = apCost + wsRs;

    const retRs    = wsPrice * (num(r.retailerPct) / 100);
    const mrpFwd   = wsPrice + retRs;

    const aPrice   = num(r.aPriceInput);
    const vatDown  = aPrice > 0 ? aPrice - (aPrice / 1.18) : 0;
    const ssclDown = aPrice > 0 ? aPrice - gsExTax - vatDown : 0;
    const wsOut    = aPrice * (1 + num(r.wsOutPct) / 100);
//If the user hasn't provided an MRP input, fall back to W/S/Price (Rs.)
    const mrpUserRaw = num(r.mrpInput);
    const mrpUser    = mrpUserRaw > 0 ? mrpUserRaw : wsOut;
    const backPct    = wsOut > 0 ? ((mrpUser - wsOut) / wsOut) * 100 : null;

    return {
      h, fx, uplift, priceForeign, cipRs,
      dutyRs, palRs, cessRs, xidRs, clearing,
      vatBase, ssclLand, vatLand, landed,
      gsAmount, gsExTax, nbtRs, vatGsRs, apCost,
      wsRs, wsPrice, retRs, mrpFwd,
      aPrice, vatDown, ssclDown, wsOut, mrpUser, backPct,
    };
  }

  function sumProducts() {
    let qty = 0, cip = 0, landed = 0, vatLand = 0, ssclLand = 0;
    let gsAmount = 0, gsExTax = 0, apCost = 0, wsPrice = 0, mrpFwd = 0;
    let aPriceSum = 0, wsOutSum = 0, mrpUserSum = 0;
    state.items.forEach(it => {
      const c = calcItem(it), q = num(it.qty);
      qty += q;
      cip += c.cipRs * q; landed += c.landed * q;
      vatLand += c.vatLand * q; ssclLand += c.ssclLand * q;
      gsAmount += c.gsAmount * q; gsExTax += c.gsExTax * q;
      apCost += c.apCost * q; wsPrice += c.wsPrice * q; mrpFwd += c.mrpFwd * q;
      aPriceSum += c.aPrice * q;
      wsOutSum  += c.wsOut  * q;
      mrpUserSum += c.mrpUser * q;
    });
    return { qty, cip, landed, vatLand, ssclLand, gsAmount, gsExTax, apCost,
             wsPrice, mrpFwd, aPriceSum, wsOutSum, mrpUserSum };
  }

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
      const h = findHs(state.terms.hsCode);
      if (h) lastUpliftDefault = h.vatBaseUplift || 1.10;
      setPill('info', 'Draft restored');
    } catch (e) {}
  }
  function setPill(kind, text) { const p = $('#saveState'); p.textContent = text; p.className = 'pill ' + kind; }

  function bindHeader() {
    ['title', 'supplier', 'date', 'preparedBy', 'reference', 'validity'].forEach(k => {
      const el = $('#' + k); if (!el) return;
      el.value = state.header[k] ?? '';
      const on = () => { state.header[k] = el.value; queueSave(); invalidate(); };
      el.addEventListener('input', on); el.addEventListener('change', on);
    });
  }

  function bindTerms() {
    ['foreignCurrency', 'localCurrency', 'exchangeRate', 'crossRate',
     'clearingPct', 'vatUplift'].forEach(k => {
      const el = $('#' + k); if (!el) return;
      el.value = state.terms[k] ?? '';
      const on = () => { state.terms[k] = el.value; queueSave(); invalidate(); };
      el.addEventListener('input', on); el.addEventListener('change', on);
    });

    const hs = $('#hsCode');
    hs.addEventListener('change', () => {
      state.terms.hsCode = hs.value;
      const h = findHs(hs.value);
      if (h) {
        state.rates.ssclPct = (h.sscl * 100).toFixed(3).replace(/\.?0+$/, '');
        state.rates.vatPct  = (h.vat  * 100).toFixed(2).replace(/\.?0+$/, '');
        $('#ssclPct').value = state.rates.ssclPct;
        $('#vatPct').value  = state.rates.vatPct;

        const curUplift = num(state.terms.vatUplift);
        const overridden = Math.abs(curUplift - lastUpliftDefault) > 1e-9;
        if (!overridden && h.vatBaseUplift != null) {
          state.terms.vatUplift = h.vatBaseUplift;
          $('#vatUplift').value = h.vatBaseUplift;
        }
        lastUpliftDefault = h.vatBaseUplift || 1.10;
      }
      renderHsRates(); queueSave(); invalidate();
    });
  }

  function bindRates() {
    ['gsMarginMode', 'gsMarginPct', 'gsMarginFixed', 'nbtPct', 'vatGsPct',
     'wsMarginPct', 'retailerPct', 'ssclPct', 'vatPct',
     'aPriceInput', 'wsOutPct', 'mrpInput'].forEach(k => {
      const el = $('#' + k); if (!el) return;
      el.value = state.rates[k] ?? '';
      const on = () => { state.rates[k] = el.value; queueSave(); invalidate(); };
      el.addEventListener('input', on); el.addEventListener('change', on);
    });
    const modeEl = $('#gsMarginMode');
    const syncMode = () => {
      const isPct = modeEl.value === 'pct';
      $('#gsMarginPct').closest('.field').style.opacity = isPct ? '1' : '.45';
      $('#gsMarginFixed').closest('.field').style.opacity = isPct ? '.45' : '1';
      $('#gsMarginPct').disabled = !isPct;
      $('#gsMarginFixed').disabled = isPct;
    };
    modeEl.addEventListener('change', syncMode); syncMode();
  }

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
    setStatus('Costing sheet generated.', 'ok');
    toast('Generated');
  });

  // ============== PREVIEW ==============
  function stageRow(label, rate, amount) {
    return `<tr>
      <td>${label}</td>
      <td class="num">${rate}</td>
      <td class="num">${amount}</td>
    </tr>`;
  }

  function renderPreview() {
    const t = state.terms, h = state.header, r = state.rates;
    const dt = h.date ? new Date(h.date + 'T00:00:00') : new Date();
    const validDays = Math.max(1, Math.round(num(h.validity) || 30));
    const validUntil = new Date(dt.getTime() + validDays * 86400000);
    const dtStr = dt.toLocaleDateString();
    const validStr = validUntil.toLocaleDateString();
    const hs = findHs(t.hsCode);
    const lc = esc(t.localCurrency);
    const fc = esc(t.foreignCurrency);
    const uplift = num(t.vatUplift) > 0 ? num(t.vatUplift) : 1.10;

    const { rows: extraRows, total: extrasTotal, products } = sumExtras();

    // ----- Products table -----
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

    // ----- Taxes table -----
    const taxRows = (() => {
      let duty = 0, pal = 0, cess = 0, xid = 0, clearing = 0, ssclLand = 0, vatLand = 0;
      state.items.forEach(it => {
        const c = calcItem(it), q = num(it.qty);
        duty += c.dutyRs * q; pal += c.palRs * q; cess += c.cessRs * q;
        xid  += c.xidRs  * q; clearing += c.clearing * q;
        ssclLand += c.ssclLand * q; vatLand += c.vatLand * q;
      });
      return stageRow('Customs Duty',             hs ? (hs.customsDuty * 100).toFixed(2) + '%' : '—', fmt2(duty))
           + stageRow('PAL',                      hs ? (hs.pal * 100).toFixed(2) + '%' : '—',         fmt2(pal))
           + stageRow('Cess Levy',                hs ? (hs.cess * 100).toFixed(2) + '%' : '—',        fmt2(cess))
           + stageRow('XID',                      hs ? (hs.xid * 100).toFixed(2) + '%' : '—',         fmt2(xid))
           + stageRow('SSCL (landed)',            num(r.ssclPct).toFixed(2) + '%',                    fmt2(ssclLand))
           + stageRow('VAT (landed, excluded)',   num(r.vatPct).toFixed(2) + '%',                     fmt2(vatLand))
           + stageRow('Clearing &amp; other charges', num(t.clearingPct).toFixed(2) + '%',            fmt2(clearing));
    })();

    // ----- Extras table -----
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

    // ----- Per-product breakdown: FORWARD + DOWNSTREAM, vertically -----
    const productBlocks = state.items.map((it, i) => {
      const c = calcItem(it);
      const gsRate  = r.gsMarginMode === 'fixed' ? 'Fixed: Rs ' + fmt2(num(r.gsMarginFixed))
                                                : num(r.gsMarginPct).toFixed(2) + '%';
      const fwd = `
        <table class="stage">
          <thead><tr>
            <th style="width:60%">Stage</th>
            <th style="width:18%">Rate</th>
            <th style="width:22%">Amount (${lc})</th>
          </tr></thead>
          <tbody>
            ${stageRow('GS Margin with Prom.',       gsRate,                                fmt2(c.gsAmount))}
            ${stageRow('GS Invoicing price without Tax', '—',                             fmt2(c.gsExTax))}
            ${stageRow('NBT',                        num(r.nbtPct).toFixed(2) + '%',      fmt2(c.nbtRs))}
            ${stageRow('VAT (GS stage)',             num(r.vatGsPct).toFixed(2) + '%',    fmt2(c.vatGsRs))}
            ${stageRow('AP - Cost',                  '—',                                 fmt2(c.apCost))}
            ${stageRow('WS Margin',                  num(r.wsMarginPct).toFixed(2) + '%', fmt2(c.wsRs))}
            ${stageRow('WS price',                   '—',                                 fmt2(c.wsPrice))}
            ${stageRow('Retailer Margin',            num(r.retailerPct).toFixed(2) + '%', fmt2(c.retRs))}
            ${stageRow('MRP (forward)',              '—',                                 fmt2(c.mrpFwd))}
          </tbody>
        </table>
      `;

      const wsRate    = num(r.wsOutPct).toFixed(2) + '%';
      const mrpInputStr = c.mrpUser ? fmt2(c.mrpUser) : '—';
      const backStr   = c.backPct != null ? (c.backPct >= 0 ? '+' : '') + c.backPct.toFixed(2) + '%' : '—';
      const down = `
        <table class="stage">
          <thead><tr>
            <th style="width:60%">Stage</th>
            <th style="width:18%">Rate / Input</th>
            <th style="width:22%">Amount (${lc})</th>
          </tr></thead>
          <tbody>
            ${stageRow('A/Price (Rs.) input',        'input',        fmt2(c.aPrice))}
            ${stageRow('VAT (downstream)',           '18.00%',       fmt2(c.vatDown))}
            ${stageRow('SSCL - 1.25% (50%)',         '1.25%',        fmt2(c.ssclDown))}
            ${stageRow('W/S/Price (Rs.)',            wsRate,         fmt2(c.wsOut))}
            ${stageRow('MRP (input)',                'input',        mrpInputStr)}
            ${stageRow('Backward margin %',          '—',            backStr)}
          </tbody>
        </table>
      `;

      return `
        <div class="product-block">
          <h4>${i + 1}. ${esc(it.name || 'Product ' + (i + 1))}</h4>
          <div class="two-col">
            <div>
              <div class="block-label">Forward chain — cost to MRP</div>
              ${fwd}
            </div>
            <div>
              <div class="block-label">Downstream chain — from A/Price</div>
              ${down}
            </div>
          </div>
        </div>
      `;
    }).join('');

    const tenderLanded = products.landed + extrasTotal;

    $('#preview').innerHTML = `
      <h2>${esc(h.title || 'Tender Costing Sheet')}</h2>
      <div class="ph-sub">
        ${h.supplier ? 'Supplier: ' + esc(h.supplier) + ' · ' : ''}
        ${h.reference ? 'Ref: ' + esc(h.reference) + ' · ' : ''}
        Prepared ${esc(dtStr)} · Valid until ${esc(validStr)} (${validDays} days)${h.preparedBy ? ' · By ' + esc(h.preparedBy) : ''}
      </div>

      <div class="ph-grid">
        <div><span class="k">HS code</span><span class="v">${esc(t.hsCode || '—')}</span></div>
        <div><span class="k">Exchange rate</span><span class="v">1 ${fc} = ${fmt4(num(t.exchangeRate))} ${lc}</span></div>
        <div><span class="k">Foreign / local currency</span><span class="v">${fc} / ${lc}</span></div>
        <div><span class="k">Cross rate</span><span class="v">${t.crossRate ? fmt4(num(t.crossRate)) : '—'}</span></div>
        <div><span class="k">Clearing &amp; other charges</span><span class="v">${num(t.clearingPct).toFixed(2)}%</span></div>
        <div><span class="k">VAT/SSCL base uplift</span><span class="v">${uplift.toFixed(2)}×</span></div>
      </div>

      <h3>Products</h3>
      <table>
        <thead><tr>
          <th style="width:5%">#</th>
          <th style="width:43%">Product</th>
          <th style="width:8%">Qty</th>
          <th style="width:14%">FCA/CIP (${fc})</th>
          <th style="width:15%">CIP (${lc})</th>
          <th style="width:15%">Landed (ex-VAT)</th>
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
          <th style="width:18%">Rate</th>
          <th style="width:22%">Amount (${lc})</th>
        </tr></thead>
        <tbody>${taxRows}</tbody>
      </table>

      <h3>Costing breakdown per product</h3>
      ${productBlocks || '<p style="color:#777">No products</p>'}

      <div class="totals">
        <div><span>Total product landed (ex-VAT)</span><span>${fmt2(products.landed)}</span></div>
        <div><span>Additional landed-cost items</span><span>${fmt2(extrasTotal)}</span></div>
        <div class="tender"><span>Tender landed cost (ex-VAT)</span><span>${fmt2(tenderLanded)}</span></div>
        <div><span>Total GS ex-tax</span><span>${fmt2(products.gsExTax)}</span></div>
        <div><span>Total A/Price</span><span>${fmt2(products.aPriceSum)}</span></div>
        <div class="grand"><span>Total MRP (input)</span><span>${fmt2(products.mrpUserSum)}</span></div>
      </div>

      <div class="foot">
        Generated ${new Date(state.generatedAt).toLocaleString()} · All amounts in ${lc} unless stated.
      </div>
    `;
  }

  // ============== /PREVIEW ==============

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
    const head = ['Product','Qty','FCA/CIP foreign','CIP local','Duty','PAL','Cess','XID','SSCL','Clearing','Landed',
                  'GS margin','GS ex-tax','NBT','VAT (GS)','AP cost','WS margin','WS price','Ret. margin','MRP (forward)',
                  'A/Price','VAT (down)','SSCL (down)','W/S/Price','MRP input','Backward %'];
    const rows = [head];
    state.items.forEach(it => {
      const c = calcItem(it);
      rows.push([
        it.name, it.qty, c.priceForeign.toFixed(2), c.cipRs.toFixed(2),
        c.dutyRs.toFixed(2), c.palRs.toFixed(2), c.cessRs.toFixed(2), c.xidRs.toFixed(2),
        c.ssclLand.toFixed(2), c.clearing.toFixed(2), c.landed.toFixed(2),
        c.gsAmount.toFixed(2), c.gsExTax.toFixed(2), c.nbtRs.toFixed(2), c.vatGsRs.toFixed(2),
        c.apCost.toFixed(2), c.wsRs.toFixed(2), c.wsPrice.toFixed(2), c.retRs.toFixed(2), c.mrpFwd.toFixed(2),
        c.aPrice.toFixed(2), c.vatDown.toFixed(2), c.ssclDown.toFixed(2), c.wsOut.toFixed(2),
        c.mrpUser.toFixed(2), c.backPct != null ? c.backPct.toFixed(2) : ''
      ]);
    });
    const csv = '\uFEFF' + rows.map(rr => rr.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(`${baseName()}_costing.csv`, csv, 'text/csv;charset=utf-8');
    toast('CSV downloaded');
  });

  $('#btnClear').addEventListener('click', () => {
    if (!confirm('Clear everything and start over?')) return;
    localStorage.removeItem(KEY);
    state.header = { title: '', supplier: '', date: '', preparedBy: '', reference: '', validity: 30 };
    state.terms  = { foreignCurrency: 'USD', localCurrency: 'LKR', exchangeRate: '',
                     crossRate: '', hsCode: '', clearingPct: 8, vatUplift: 1.10 };
    state.rates  = {
      gsMarginMode: 'pct', gsMarginPct: 20, gsMarginFixed: 0,
      nbtPct: 0, vatGsPct: 0,
      wsMarginPct: 0, retailerPct: 0,
      ssclPct: 1.25, vatPct: 18,
      aPriceInput: '', wsOutPct: 8, mrpInput: '',
    };
    state.items  = [{ id: uid(), name: '', qty: 1, price: '' }];
    state.extras = [];
    state.generatedAt = null;
    lastUpliftDefault = 1.10;
    ['title', 'supplier', 'date', 'preparedBy', 'reference'].forEach(k => { const el = $('#' + k); if (el) el.value = ''; });
    $('#validity').value = 30;
    ['foreignCurrency', 'localCurrency', 'exchangeRate', 'crossRate',
     'clearingPct', 'vatUplift'].forEach(k => { const el = $('#' + k); if (el) el.value = state.terms[k]; });
    ['gsMarginMode', 'gsMarginPct', 'gsMarginFixed', 'nbtPct', 'vatGsPct',
     'wsMarginPct', 'retailerPct', 'ssclPct', 'vatPct',
     'aPriceInput', 'wsOutPct', 'mrpInput'].forEach(k => {
      const el = $('#' + k); if (el) el.value = state.rates[k];
    });
    $('#gsMarginMode').dispatchEvent(new Event('change'));
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