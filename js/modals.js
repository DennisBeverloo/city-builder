/**
 * @module modals
 * Generic modal engine + stat-specific modal builders.
 * Wired to clickable HUD stats via initModalTriggers().
 */

// ── Generic modal engine ──────────────────────────────────────────────────────

const _overlay = document.getElementById('modal-overlay');
const _box     = document.getElementById('modal-box');
const _header  = document.getElementById('modal-header');
const _body    = document.getElementById('modal-body');

export function openModal(title, html) {
  _header.textContent = title;
  _body.innerHTML     = html;
  _overlay.classList.remove('hidden');
}

export function closeModal() {
  _overlay.classList.add('hidden');
}

// Close on overlay background click
_overlay?.addEventListener('click', e => {
  if (e.target === _overlay) closeModal();
});

// Close on Escape
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) { return `€${Math.round(n).toLocaleString()}`; }
function pct(n) { return `${Math.round(n)}%`; }

function tableRow(label, value, cls = '') {
  return `<tr class="${cls}"><td class="modal-label">${label}</td><td class="modal-value">${value}</td></tr>`;
}

function modifierRow(m) {
  const cls = m.good ? 'mod-good' : 'mod-bad';
  const val = typeof m.value === 'number'
    ? (m.value >= 0 ? `+${m.value}` : `${m.value}`)
    : m.value;
  return `
    <tr class="modifier-row ${cls}">
      <td class="modal-label">${m.label}</td>
      <td class="modal-value">${val}</td>
      <td class="modal-note">${m.note ?? ''}</td>
    </tr>`;
}

// ── Financial modal ───────────────────────────────────────────────────────────

export function showFinancialModal(city) {
  const d = city.getFinancialDetails();
  const { income: inc, expenses: exp } = d;

  const incRows = [
    tableRow('Residential taxes', fmt(inc.residential), 'zone-r'),
    tableRow('Commercial taxes',  fmt(inc.commercial),  'zone-c'),
    tableRow('Industrial taxes',  fmt(inc.industrial),  'zone-i'),
    tableRow('Total income',      fmt(inc.total),       'total-row'),
  ].join('');

  const expRows = Object.values(exp)
    .filter(g => g.count > 0)
    .map(g => tableRow(`${g.label} ×${g.count}`, `−${fmt(g.amount)}`))
    .join('') || `<tr><td colspan="2" class="modal-note">No upkeep costs yet</td></tr>`;

  const netCls  = d.net >= 0 ? 'net-positive' : 'net-negative';
  const dayCls  = d.lastDayNet >= 0 ? 'net-positive' : 'net-negative';

  const html = `
    <section class="modal-section">
      <h3>Income (per day)</h3>
      <table class="modal-table">${incRows}</table>
    </section>
    <section class="modal-section">
      <h3>Expenses (per day)</h3>
      <table class="modal-table">${expRows}
        <tr class="total-row"><td class="modal-label">Total expenses</td>
          <td class="modal-value">−${fmt(d.totalExpenses)}</td></tr>
      </table>
    </section>
    <div class="modal-net ${netCls}">
      Net per day: ${d.net >= 0 ? '+' : ''}${fmt(d.net)}
    </div>
    <div class="modal-sub">
      Yesterday: <span class="${dayCls}">${d.lastDayNet >= 0 ? '+' : ''}${fmt(d.lastDayNet)}</span>
      &nbsp;·&nbsp; Balance: <strong>${fmt(d.balance)}</strong>
    </div>`;

  openModal('💰 Financial Overview', html);
}

// ── Population modal ──────────────────────────────────────────────────────────

export function showPopulationModal(city) {
  const d = city.getPopulationDetails();

  // Zone occupation percentages
  const occ = (bldg, zones) => zones > 0 ? Math.round(bldg / zones * 100) : 0;
  const rOcc = occ(d.residential.buildings, d.residential.zones);
  const cOcc = occ(d.commercial.buildings,  d.commercial.zones);
  const iOcc = occ(d.industrial.buildings,  d.industrial.zones);

  // Zone occupation bar helper
  const zoneBar = (label, colorCls, fillCls, occ, bldg, zones) => `
    <div class="zone-occ-row">
      <span class="zone-occ-label ${colorCls}">${label}</span>
      <div class="zone-occ-track">
        <div class="zone-occ-fill ${fillCls}" style="width:${occ}%"></div>
      </div>
      <span class="zone-occ-count">${bldg}&thinsp;/&thinsp;${zones} (${occ}%)</span>
    </div>`;

  const html = `
    <section class="modal-section">
      <h3>Overview</h3>
      <table class="modal-table">
        ${tableRow('Total population', d.total)}
        ${tableRow('Adult workers',    d.workers,  'modal-sub-row')}
        ${tableRow('Shoppers',         d.shoppers, 'modal-sub-row')}
        ${tableRow('Total jobs',       d.totalJobs)}
      </table>
    </section>
    <section class="modal-section">
      <h3>Employment</h3>
      <div class="emp-bar-track">
        <div class="emp-bar-employed"   style="width:${d.empRate}%"></div>
        <div class="emp-bar-unemployed" style="width:${100 - d.empRate}%"></div>
      </div>
      <div class="emp-bar-labels">
        <span class="emp-label-good">▶ ${d.employed} employed (${pct(d.empRate)})</span>
        <span class="emp-label-bad">◀ ${d.unemployed} unemployed</span>
      </div>
    </section>
    <section class="modal-section">
      <h3>Zone occupation</h3>
      ${zoneBar('Residential', 'rci-r-txt', 'zone-occ-r', rOcc, d.residential.buildings, d.residential.zones)}
      ${zoneBar('Commercial',  'rci-c-txt', 'zone-occ-c', cOcc, d.commercial.buildings,  d.commercial.zones)}
      ${zoneBar('Industrial',  'rci-i-txt', 'zone-occ-i', iOcc, d.industrial.buildings,  d.industrial.zones)}
    </section>`;

  openModal('👥 Population', html);
}

// ── Happiness modal ───────────────────────────────────────────────────────────

export function showHappinessModal(city) {
  const d = city.getHappinessDetails();

  const rows = d.modifiers.map(modifierRow).join('');

  const html = `
    <div class="modal-net ${d.current >= 50 ? 'net-positive' : 'net-negative'}">
      Current happiness: ${pct(d.current)}
    </div>
    <section class="modal-section">
      <h3>Modifiers</h3>
      <table class="modal-table mod-table">
        <thead><tr>
          <th class="modal-label">Factor</th>
          <th class="modal-value">Effect</th>
          <th class="modal-note">Notes</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
    <p class="modal-hint">Happiness is the average across all residential tiles that have road access.</p>`;

  openModal('😊 Happiness', html);
}

// ── RCI modal ─────────────────────────────────────────────────────────────────

function rciBlock(letter, label, colorClass, data) {
  const rows = data.modifiers.map(modifierRow).join('');
  return `
    <section class="modal-section rci-demand-block">
      <h3><span class="rci-letter ${colorClass}">${letter}</span> ${label}
        <span class="rci-demand-val">Demand: ${Math.round(data.demand)}%</span>
      </h3>
      <table class="modal-table mod-table">
        <thead><tr>
          <th class="modal-label">Factor</th>
          <th class="modal-value">Good?</th>
          <th class="modal-note">Notes</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

export function showRCIModal(city) {
  const d = city.getRCIDetails();

  const html =
    rciBlock('R', 'Residential', 'rci-r-txt', d.R) +
    rciBlock('C', 'Commercial',  'rci-c-txt', d.C) +
    rciBlock('I', 'Industrial',  'rci-i-txt', d.I);

  openModal('📊 RCI Demand', html);
}

// ── Wire up click triggers ────────────────────────────────────────────────────

export function initModalTriggers(city) {
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('clickable-stat');
    el.addEventListener('click', () => fn(city));
  };

  bind('stat-money',    showFinancialModal);
  bind('stat-pop',      showPopulationModal);
  bind('stat-happiness',showHappinessModal);

  // RCI bars container
  const rciEl = document.querySelector('.rci-bars');
  if (rciEl) {
    rciEl.classList.add('clickable-stat');
    rciEl.addEventListener('click', () => showRCIModal(city));
  }
}
