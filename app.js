(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const KEY = 'tender-costing:v12';
  const OLD_KEY = 'tender-costing:v11';

  const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
  const fmt2 = n => (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt4 = n => (Math.round((n + Number.EPSILON) * 10000) / 10000).toString();
  const fmtInt = n => Math.round(n).toLocaleString();
  const uid = () => 'r' + Math.random().toString(36).slice(2, 9);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const INCO = ['FOB', 'FCA', 'CIF', 'CIP', 'CFR', 'CPT', 'EXW', 'DDP', 'DAP'];

  // Basis ids: fixed | perUnit | pctTerm:<INCO> | pctLanded
  function basisLabel(id) {
    if (!id) return '';
    if (id.indexOf('pctTerm:') === 0) return '% of total ' + id.slice('pctTerm:'.length);
    switch (id) {
      case 'fixed':     return 'Fixed amount (Rs)';
      case 'perUnit':   return 'Per unit (Rs/unit)';
      case 'pctLanded': return '% of total landed so far';
      default:          return id;
    }
  }

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
    items:  [{ id: uid(), name: '', inco: 'FOB', qty: 1, price: '' }],
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

  // ---- engine ----------------------------------------------------------------

  function lineBase(it) {
    const fx = num(state.terms.exchangeRate);
    return num(it.price) * fx * num(it.qty);
  }

  function sumBase() {
    let qty = 0, base = 0;
    state.items.forEach(it => { qty += num(it.qty); base += lineBase(it); });
    return { qty, base };
  }

  // Sum of base values grouped by INCO term
  function baseByTerm() {
    const fx = num(state.terms.exchangeRate);
    const out = {};
    INCO.forEach(t => out[t] = 0);
    state.items.forEach(it => {
      const term = it.inco || 'FOB';
      out[term] = (out[term] || 0) + num(it.price) * fx * num(it.qty);
    });
    return out;
  }

  function computeExtra(ex, ctx) {
    const v = num(ex.value);
    if (ex.basis === 'fixed')     return v;
    if (ex.basis === 'perUnit')   return ctx.qty * v;
    if (ex.basis === 'pctLanded') return ctx.base * (v / 100); // "landed so far" = base total
    if (ex.basis.indexOf('pctTerm:') === 0) {
      const term = ex.basis.slice('pctTerm:'.length);
      return (ctx.byTerm[term] || 0) * (v / 100);
    }
    return 0;
  }

  function sumExtras() {
    const ctx = Object.assign(sumBase(), { byTerm: baseByTerm() });
    let total = 0;
    const rows = state.extras.map(ex => {
      const amt = computeExtra(ex, ctx);
      total += amt;
      return Object.assign({}, ex, { amount: amt });
    });
    return { rows, total, baseCtx: ctx };
  }

  function computeTender() {
    const t = state.terms, r = state.rates, h = findHs(t.hsCode);
    const uplift = num(t.vatUplift) > 0 ? num(t.vatUplift) : 1.10;
    const ex = sumExtras();
    const base = ex.baseCtx.base;
    const extras = ex.total;
    const landed = base + extras; // << TOTAL LANDED COST

    // HS taxes on the TOTAL landed cost
    const duty     = h ? landed * h.customsDuty : 0;
    const pal      = h ? landed * h.pal         : 0;
    const cess     = h ? landed * h.cess        : 0;
    const xid      = h ? landed * h.xid         : 0;
    const clearing = landed * (num(t.clearingPct) / 100);

    const vatBase  = landed * uplift + duty + pal + cess + xid;
    const ssclLand = vatBase * (num(r.ssclPct) / 100);
    const vatLand  = vatBase * (num(r.vatPct)  / 100);

    const landedTaxed = landed + duty + pal + cess + xid + clearing + ssclLand;

    const gsAmount = r.gsMarginMode === 'fixed'
      ? num(r.gsMarginFixed)
      : landedTaxed * (num(r.gsMarginPct) / 100);
    const gsExTax  = landedTaxed + gsAmount;

    const nbtRs   = gsExTax * (num(r.nbtPct) / 100);
    const vatGsRs = (gsExTax + nbtRs) * (num(r.vatGsPct) / 100);
    const apCost  = gsExTax + nbtRs + vatGsRs;

    const wsRs    = apCost * (num(r.wsMarginPct) / 100);
    const wsPrice = apCost + wsRs;

    const retRs   = wsPrice * (num(r.retailerPct) / 100);
    const mrpFwd  = wsPrice + retRs;

    const aPrice   = num(r.aPriceInput);
    const vatDown  = aPrice > 0 ? aPrice - (aPrice / 1.18) : 0;
    const ssclDown = aPrice > 0 ? aPrice - gsExTax - vatDown : 0;
    const wsOut    = aPrice * (1 + num(r.wsOutPct) / 100);
    const mrpUser  = num(r.mrpInput) > 0 ? num(r.mrpInput) : wsOut;
    const backPct  = wsOut > 0 ? ((mrpUser - wsOut) / wsOut) * 100 : null;

    return {
      h, uplift, base, extras, landed,
      duty, pal, cess, xid, clearing,
      vatBase, ssclLand, vatLand, landedTaxed,
      gsAmount, gsExTax, nbtRs, vatGsRs, apCost,
      wsRs, wsPrice, retRs, mrpFwd,
      aPrice, vatDown, ssclDown, wsOut, mrpUser, backPct,
      extraRows: ex.rows,
    };
  }

  // ---- persistence -----------------------------------------------------------

  let saveT = null;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); setPill('ok', 'Saved'); } catch (e) { setPill('bad', 'Save failed'); } }
  function queueSave() { setPill('info', 'Saving…'); clearTimeout(saveT); saveT = setTimeout(save, 350); }

  function load() {
    try {
      const raw = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY);
      if (!raw) return;
      const s = JSON.parse(raw); if (!s || typeof s !== 'object') return;
      Object.assign(state.header, s.header || {});
      Object.assign(state.terms,  s.terms  || {});
      Object.assign(state.rates,  s.rates  || {});
      if (Array.isArray(s.items) && s.items.length) state.items = s.items.map(i => ({
        id: i.id || uid(), name: i.name || '', inco: i.inco || 'FOB', qty: i.qty ?? 1, price: i.price || '',
      }));
      if (Array.isArray(s.extras)) state.extras = s.extras.map(e => {
        let basis = e.basis || 'fixed';
        // migrate old ids
        if (basis === 'pctFob')    basis = 'pctTerm:FOB';
        if (basis === 'pctCip')    basis = 'pctTerm:CIP';
        if (basis !== 'fixed' && basis !== 'perUnit' && basis !== 'pctLanded' &&
            basis.indexOf('pctTerm:') !== 0) basis = 'fixed';
        return { id: e.id || uid(), description: e.description || '', basis, value: e.value ?? '' };
      });
      const h = findHs(state.terms.hsCode);
      if (h) lastUpliftDefault = h.vatBaseUplift || 1.10;
      setPill('info', 'Draft restored');
    } catch (e) {}
  }
  function setPill(kind, text) { const p = $('#saveState'); p.textContent = text; p.className = 'pill ' + kind; }

  // ---- bindings --------------------------------------------------------------

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

  // ---- product table ---------------------------------------------------------

  function renderTable() {
    const tb = $('#itemsBody'); tb.innerHTML = '';
    state.items.forEach(it => {
      const tr = document.createElement('tr'); tr.dataset.id = it.id;
      const incoOpts = INCO.map(t => `<option value="${t}"${it.inco === t ? ' selected' : ''}>${t}</option>`).join('');
      tr.innerHTML = `
        <td><input class="in" data-k="name" value="${esc(it.name)}" placeholder="Product name"></td>
        <td><select class="in" data-k="inco">${incoOpts}</select></td>
        <td><input class="in num" data-k="qty" value="${esc(it.qty)}" inputmode="decimal"></td>
        <td><input class="in num" data-k="price" value="${esc(it.price)}" inputmode="decimal" placeholder="0.00"></td>
        <td class="del"><button type="button" title="Remove">×</button></td>`;
      tb.appendChild(tr);
    });
    if (!state.items.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5" style="text-align:center;color:var(--ink-2);padding:16px">No products yet.</td>';
      tb.appendChild(tr);
    }
    updatePill(); updateButtons();
  }

  // ---- extras table ----------------------------------------------------------

  function currentBasisOptions() {
    const terms = new Set(state.items.map(i => i.inco || 'FOB'));
    const opts = ['fixed', 'perUnit'];
    INCO.forEach(t => { if (terms.has(t)) opts.push('pctTerm:' + t); });
    opts.push('pctLanded');
    return opts;
  }

  function renderExtras() {
    const tb = $('#extrasBody'); tb.innerHTML = '';
    const ctx = Object.assign(sumBase(), { byTerm: baseByTerm() });
    const allowed = currentBasisOptions();
    state.extras.forEach(ex => {
      const amt = computeExtra(ex, ctx);
      const basis = allowed.includes(ex.basis) ? ex.basis : 'fixed';
      const tr = document.createElement('tr'); tr.dataset.id = ex.id;
      const basisOpts = allowed.map(b => `<option value="${b}"${basis === b ? ' selected' : ''}>${esc(basisLabel(b))}</option>`).join('');
      tr.innerHTML = `
        <td><input class="in" data-k="description" value="${esc(ex.description)}" placeholder="e.g. Sea freight, insurance"></td>
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
    const total = state.extras.reduce((s, ex) => s + computeExtra(ex, ctx), 0);
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
  $('#itemsBody').addEventListener('change', e => {
    const sel = e.target.closest('select.in'); if (!sel) return;
    const tr = sel.closest('tr'); const it = state.items.find(i => i.id === tr.dataset.id); if (!it) return;
    it[sel.dataset.k] = sel.value; queueSave(); renderExtras(); invalidate();
  });
  $('#itemsBody').addEventListener('click', e => {
    if (e.target.closest('.del button')) {
      const tr = e.target.closest('tr');
      state.items = state.items.filter(i => i.id !== tr.dataset.id);
      queueSave(); renderTable(); renderExtras(); invalidate();
    }
  });
  $('#btnAddRow').addEventListener('click', () => {
    state.items.push({ id: uid(), name: '', inco: 'FOB', qty: 1, price: '' });
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

  // ---- preview ---------------------------------------------------------------

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

    const T = computeTender();

    // Products table — landed cost allocated pro-rata by base value
    const totalBase = T.base || 0;
    const taxTotal  = T.duty + T.pal + T.cess + T.xid + T.clearing + T.ssclLand; // VAT excluded (recoverable)
    const prodRows = state.items.map((it, i) => {
      const base  = lineBase(it);
      const share = totalBase > 0 ? base / totalBase : 0;
      const lineExtras = T.extras * share;
      const lineTax    = taxTotal * share;
      const lineLanded = base + lineExtras + lineTax;
      return `<tr>
        <td>${i + 1}</td>
        <td>${esc(it.name || '—')}</td>
        <td>${esc(it.inco || 'FOB')}</td>
        <td class="num">${fmtInt(num(it.qty))}</td>
        <td class="num">${fmt2(num(it.price))} ${fc}</td>
        <td class="num">${fmt2(base)}</td>
        <td class="num">${fmt2(lineLanded)}</td>
      </tr>`;
    }).join('');

    // Extras table
    const extrasHtml = T.extraRows.length ? T.extraRows.map((ex, i) => {
      const label = basisLabel(ex.basis);
      const valStr = ex.basis === 'fixed' ? 'Rs ' + fmt2(num(ex.value))
                   : ex.basis === 'perUnit' ? 'Rs ' + fmt2(num(ex.value)) + '/unit'
                   : num(ex.value).toFixed(2) + '%';
      return `<tr>
        <td>${i + 1}</td>
        <td>${esc(ex.description || '—')}</td>
        <td>${esc(label)}</td>
        <td class="num">${valStr}</td>
        <td class="num">${fmt2(ex.amount)}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" style="text-align:center;color:#777">No additional items</td></tr>';

    // Taxes (on total landed cost)
    const taxRows = stageRow('Customs Duty',             hs ? (hs.customsDuty * 100).toFixed(2) + '%' : '—', fmt2(T.duty))
      + stageRow('PAL',                                  hs ? (hs.pal * 100).toFixed(2) + '%' : '—',         fmt2(T.pal))
      + stageRow('Cess Levy',                            hs ? (hs.cess * 100).toFixed(2) + '%' : '—',        fmt2(T.cess))
      + stageRow('XID',                                  hs ? (hs.xid * 100).toFixed(2) + '%' : '—',         fmt2(T.xid))
      + stageRow('SSCL (landed)',                        num(r.ssclPct).toFixed(2) + '%',                    fmt2(T.ssclLand))
      + stageRow('VAT (landed, excluded)',               num(r.vatPct).toFixed(2) + '%',                     fmt2(T.vatLand))
      + stageRow('Clearing &amp; other charges',         num(t.clearingPct).toFixed(2) + '%',                fmt2(T.clearing));

    // Forward chain
    const gsRate = r.gsMarginMode === 'fixed' ? 'Fixed: Rs ' + fmt2(num(r.gsMarginFixed))
                                              : num(r.gsMarginPct).toFixed(2) + '%';
    const fwd = `
      <table class="stage">
        <thead><tr><th style="width:60%">Stage</th><th style="width:18%">Rate</th><th style="width:22%">Amount (${lc})</th></tr></thead>
        <tbody>
          ${stageRow('GS Margin with Prom.',           gsRate,                             fmt2(T.gsAmount))}
          ${stageRow('GS Invoicing price without Tax', '—',                                fmt2(T.gsExTax))}
          ${stageRow('NBT',                            num(r.nbtPct).toFixed(2) + '%',     fmt2(T.nbtRs))}
          ${stageRow('VAT (GS stage)',                 num(r.vatGsPct).toFixed(2) + '%',   fmt2(T.vatGsRs))}
          ${stageRow('AP - Cost',                      '—',                                fmt2(T.apCost))}
          ${stageRow('WS Margin',                      num(r.wsMarginPct).toFixed(2) + '%',fmt2(T.wsRs))}
          ${stageRow('WS price',                       '—',                                fmt2(T.wsPrice))}
          ${stageRow('Retailer Margin',                num(r.retailerPct).toFixed(2) + '%',fmt2(T.retRs))}
          ${stageRow('MRP (forward)',                  '—',                                fmt2(T.mrpFwd))}
        </tbody>
      </table>`;

    // Downstream chain
    const wsRate = num(r.wsOutPct).toFixed(2) + '%';
    const backStr = T.backPct != null ? (T.backPct >= 0 ? '+' : '') + T.backPct.toFixed(2) + '%' : '—';
    const down = `
      <table class="stage">
        <thead><tr><th style="width:60%">Stage</th><th style="width:18%">Rate / Input</th><th style="width:22%">Amount (${lc})</th></tr></thead>
        <tbody>
          ${stageRow('A/Price (Rs.) input', 'input', fmt2(T.aPrice))}
          ${stageRow('VAT (downstream)',    '18.00%', fmt2(T.vatDown))}
          ${stageRow('SSCL - 1.25% (50%)',  '1.25%',  fmt2(T.ssclDown))}
          ${stageRow('W/S/Price (Rs.)',     wsRate,   fmt2(T.wsOut))}
          ${stageRow('MRP (input)',         'input',  T.mrpUser ? fmt2(T.mrpUser) : '—')}
          ${stageRow('Backward margin %',   '—',      backStr)}
        </tbody>
      </table>`;

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
        <div><span class="k">VAT/SSCL base uplift</span><span class="v">${T.uplift.toFixed(2)}×</span></div>
      </div>

      <h3>Products</h3>
      <table>
        <thead><tr>
          <th style="width:5%">#</th>
          <th style="width:36%">Product</th>
          <th style="width:10%">INCO</th>
          <th style="width:8%">Qty</th>
          <th style="width:15%">Price (${fc})</th>
          <th style="width:13%">Base value (${lc})</th>
          <th style="width:13%">Landed cost (${lc})</th>
        </tr></thead>
        <tbody>${prodRows || '<tr><td colspan="7" style="text-align:center;color:#777">No products</td></tr>'}</tbody>
        <tfoot><tr>
          <td colspan="5" style="text-align:right;font-weight:600">Total</td>
          <td class="num" style="font-weight:600">${fmt2(T.base)}</td>
          <td class="num" style="font-weight:600">${fmt2(T.base + T.extras + taxTotal)}</td>
        </tr></tfoot>
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

      <h3>Taxes &amp; duties (HS ${esc(t.hsCode || '—')}) — on total landed cost</h3>
      <table>
        <thead><tr>
          <th style="width:60%">Component</th>
          <th style="width:18%">Rate</th>
          <th style="width:22%">Amount (${lc})</th>
        </tr></thead>
        <tbody>${taxRows}</tbody>
      </table>

      <h3>Costing breakdown (tender level)</h3>
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

      <div class="totals">
        <div><span>Total base value</span><span>${fmt2(T.base)}</span></div>
        <div><span>Additional landed-cost items</span><span>${fmt2(T.extras)}</span></div>
        <div class="tender"><span>Total landed cost</span><span>${fmt2(T.landed)}</span></div>
        <div><span>Total landed + taxes</span><span>${fmt2(T.landedTaxed)}</span></div>
        <div><span>Total GS ex-tax</span><span>${fmt2(T.gsExTax)}</span></div>
        <div><span>A/Price</span><span>${fmt2(T.aPrice)}</span></div>
        <div class="grand"><span>MRP (input)</span><span>${fmt2(T.mrpUser)}</span></div>
      </div>

      <div class="foot">
        Generated ${new Date(state.generatedAt).toLocaleString()} · All amounts in ${lc} unless stated.
      </div>
    `;
  }

  // ---- exports ---------------------------------------------------------------

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
    const T = computeTender();
    const payload = {
      generatedAt: state.generatedAt,
      header: state.header, terms: state.terms, rates: state.rates,
      items: state.items.map(it => Object.assign({}, it, { baseValue: lineBase(it) })),
      extras: T.extraRows,
      totals: {
        base: T.base, extras: T.extras, landed: T.landed,
        duty: T.duty, pal: T.pal, cess: T.cess, xid: T.xid,
        ssclLand: T.ssclLand, vatLand: T.vatLand, clearing: T.clearing,
        landedTaxed: T.landedTaxed,
        gsAmount: T.gsAmount, gsExTax: T.gsExTax,
        nbt: T.nbtRs, vatGs: T.vatGsRs, apCost: T.apCost,
        wsPrice: T.wsPrice, mrpFwd: T.mrpFwd,
        aPrice: T.aPrice, wsOut: T.wsOut, mrpUser: T.mrpUser, backPct: T.backPct,
      },
    };
    download(`${baseName()}_costing.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast('JSON downloaded');
  });

  $('#btnCsv').addEventListener('click', () => {
    if (!state.generatedAt) return;
    const T = computeTender();
    const hs = findHs(state.terms.hsCode);
    const lines = [
      ['Product','INCO','Qty','Price foreign','Base LKR'],
      ...state.items.map(it => [it.name, it.inco || 'FOB', it.qty, num(it.price).toFixed(2), lineBase(it).toFixed(2)]),
      [],
      ['Total base','','','',T.base.toFixed(2)],
      ['Extras total','','','',T.extras.toFixed(2)],
      ['Total landed','','','',T.landed.toFixed(2)],
      [],
      ['Tax component','Rate','Amount'],
      ['Duty',     hs ? (hs.customsDuty * 100).toFixed(2) + '%' : '', T.duty.toFixed(2)],
      ['PAL',      hs ? (hs.pal * 100).toFixed(2) + '%' : '',         T.pal.toFixed(2)],
      ['Cess',     hs ? (hs.cess * 100).toFixed(2) + '%' : '',        T.cess.toFixed(2)],
      ['XID',      hs ? (hs.xid * 100).toFixed(2) + '%' : '',         T.xid.toFixed(2)],
      ['SSCL',     num(state.rates.ssclPct).toFixed(2) + '%',         T.ssclLand.toFixed(2)],
      ['VAT',      num(state.rates.vatPct).toFixed(2) + '%',          T.vatLand.toFixed(2)],
      ['Clearing', num(state.terms.clearingPct).toFixed(2) + '%',     T.clearing.toFixed(2)],
      [],
      ['Forward','Rate','Amount'],
      ['GS margin', state.rates.gsMarginMode === 'fixed' ? 'fixed' : num(state.rates.gsMarginPct).toFixed(2) + '%', T.gsAmount.toFixed(2)],
      ['GS ex-tax','', T.gsExTax.toFixed(2)],
      ['NBT', num(state.rates.nbtPct).toFixed(2) + '%', T.nbtRs.toFixed(2)],
      ['VAT GS', num(state.rates.vatGsPct).toFixed(2) + '%', T.vatGsRs.toFixed(2)],
      ['AP cost','', T.apCost.toFixed(2)],
      ['WS margin', num(state.rates.wsMarginPct).toFixed(2) + '%', T.wsRs.toFixed(2)],
      ['WS price','', T.wsPrice.toFixed(2)],
      ['Retailer', num(state.rates.retailerPct).toFixed(2) + '%', T.retRs.toFixed(2)],
      ['MRP forward','', T.mrpFwd.toFixed(2)],
      [],
      ['Downstream','',''],
      ['A/Price','', T.aPrice.toFixed(2)],
      ['VAT down','', T.vatDown.toFixed(2)],
      ['SSCL down','', T.ssclDown.toFixed(2)],
      ['W/S/Price','', T.wsOut.toFixed(2)],
      ['MRP input','', T.mrpUser.toFixed(2)],
      ['Backward %','', T.backPct != null ? T.backPct.toFixed(2) : ''],
    ];
    const csv = '\uFEFF' + lines.map(rr => rr.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(`${baseName()}_costing.csv`, csv, 'text/csv;charset=utf-8');
    toast('CSV downloaded');
  });

  $('#btnClear').addEventListener('click', () => {
    if (!confirm('Clear everything and start over?')) return;
    localStorage.removeItem(KEY); localStorage.removeItem(OLD_KEY);
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
    state.items  = [{ id: uid(), name: '', inco: 'FOB', qty: 1, price: '' }];
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