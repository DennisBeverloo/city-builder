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

  const html = `
    <section class="modal-section">
      <h3>Overview</h3>
      <table class="modal-table">
        ${tableRow('Total population', d.total)}
        ${tableRow('Employed',         `${d.employed} (${pct(d.empRate)})`)}
        ${tableRow('Unemployed',       d.unemployed)}
        ${tableRow('Total jobs',       d.totalJobs)}
      </table>
    </section>
    <section class="modal-section">
      <h3>Zone breakdown</h3>
      <table class="modal-table">
        <thead><tr>
          <th class="modal-label">Zone</th>
          <th class="modal-value">Tiles zoned</th>
          <th class="modal-value">Occupied</th>
        </tr></thead>
        <tbody>
          <tr class="zone-r"><td>Residential</td>
            <td class="modal-value">${d.residential.zones}</td>
            <td class="modal-value">${d.residential.buildings}</td></tr>
          <tr class="zone-c"><td>Commercial</td>
            <td class="modal-value">${d.commercial.zones}</td>
            <td class="modal-value">${d.commercial.buildings}</td></tr>
          <tr class="zone-i"><td>Industrial</td>
            <td class="modal-value">${d.industrial.zones}</td>
            <td class="modal-value">${d.industrial.buildings}</td></tr>
        </tbody>
      </table>
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
