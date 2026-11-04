// hs-codes.js — statutory rates only.
// Clearing and VAT/SSCL uplift are user inputs in the tool.
// SSCL% and VAT% pre-fill Margin & Taxes; user can override.
// All rates are decimals: 0.10 = 10%.

window.HS_CODES = [
  {
    code: "2106.90.43",
    label: "2106.90.43 — Food preparations (milk powder, dietary)",
    customsDuty: 0.00, pal: 0.10, cess: 0.00, xid: 0.00,
    vat: 0.18, sscl: 0.025, vatBaseUplift: 1.10,
  },
  {
    code: "2106.90.49",
    label: "2106.90.49 — Food preparations, other",
    customsDuty: 0.20, pal: 0.10, cess: 0.10, xid: 0.00,
    vat: 0.18, sscl: 0.025, vatBaseUplift: 1.10,
  },
  {
    code: "0402.10.00",
    label: "0402.10.00 — Milk powder, fat ≤ 1.5%",
    customsDuty: 0.00, pal: 0.10, cess: 0.00, xid: 0.00,
    vat: 0.18, sscl: 0.025, vatBaseUplift: 1.10,
  },
];