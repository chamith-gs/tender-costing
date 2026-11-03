// hs-codes.js
// Edit this file to add/change HS codes and their tax rates.
// Rates are decimals (0.10 = 10%). Clearing is also a decimal.
// "apMarkup" is the multiplier applied to landed cost for AP price (1.10 = 10% markup).

window.HS_CODES = [
  {
    code: "2106.90.43",
    label: "2106.90.43 — Food preparations (milk powder, dietary)",
    customsDuty: 0.00,
    pal:         0.10,
    cess:        0.00,
    xid:         0.00,
    vat:         0.18,
    sscl:        0.025,
    clearing:    0.31,
    apMarkup:    1.10,
  },
  {
    code: "2106.90.49",
    label: "2106.90.49 — Food preparations, other",
    customsDuty: 0.20,
    pal:         0.10,
    cess:        0.10,
    xid:         0.00,
    vat:         0.18,
    sscl:        0.025,
    clearing:    0.08,
    apMarkup:    1.10,
  },
  {
    code: "0402.10.00",
    label: "0402.10.00 — Milk powder, fat ≤ 1.5%",
    customsDuty: 0.00,
    pal:         0.10,
    cess:        0.00,
    xid:         0.00,
    vat:         0.18,
    sscl:        0.025,
    clearing:    0.08,
    apMarkup:    1.10,
  },
  // Add as many as you need. Copy the block, change the values.
];