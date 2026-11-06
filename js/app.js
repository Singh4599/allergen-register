// LV Spices — Allergen & Cross-Contamination Control Register
// Main Application Controller & UI Logic

import { MASTER_PRODUCTS } from './products-master.js';
import { getPreviousWorkingDate } from './generator.js';
import { 
  getRecordsForDate, 
  saveRecord, 
  deleteRecord, 
  subscribeToDate 
} from './data-store.js';

// Application State
const state = {
  currentDate: getTodayDateISO(),
  records: [],
  filteredRecords: [],
  unsubListener: null
};

// Autocomplete product cache
const productNames = MASTER_PRODUCTS.map(p => ({
  name: p.name,
  code: p.code,
  hasAllergen: p.hasAllergen,
  allergens: p.allergens,
  allergenText: p.allergenText,
  category: p.category
}));

function getTodayDateISO() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLong(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function formatMonthYear(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const month = d.toLocaleDateString('en-GB', { month: 'long' });
  const year = d.getFullYear();
  return { month, year };
}

// ── INITIALIZATION ──
document.addEventListener('DOMContentLoaded', () => {
  initUI();
  loadDate(state.currentDate);
});

function initUI() {
  const datePicker = document.getElementById('date-picker');
  datePicker.value = state.currentDate;

  // Date Navigation
  datePicker.addEventListener('change', (e) => {
    if (e.target.value) {
      loadDate(e.target.value);
    }
  });

  document.getElementById('btn-prev-day').addEventListener('click', () => {
    const prevDate = getPreviousWorkingDate(state.currentDate);
    loadDate(prevDate);
  });

  document.getElementById('btn-next-day').addEventListener('click', () => {
    let d = new Date(state.currentDate + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() === 0) { // skip Sunday
      d.setUTCDate(d.getUTCDate() + 1);
    }
    const nextDate = d.toISOString().split('T')[0];
    loadDate(nextDate);
  });

  document.getElementById('btn-today').addEventListener('click', () => {
    loadDate(getTodayDateISO());
  });

  // Search & Filter
  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('filter-allergen').addEventListener('change', applyFilters);
  document.getElementById('filter-checker').addEventListener('change', applyFilters);

  // Actions
  document.getElementById('btn-new-entry').addEventListener('click', () => openRecordModal());
  document.getElementById('btn-print-sheet').addEventListener('click', printRegisterSheet);
  document.getElementById('btn-export-excel').addEventListener('click', exportToExcel);
  document.getElementById('btn-save-record').addEventListener('click', handleSaveRecord);

  // Setup modal autocomplete
  setupProductAutocomplete('m-product-name', 'product-autocomplete', (prod) => {
    const [year, month] = state.currentDate.split('-');
    const mmyy = `${month}${year.slice(-2)}`;
    document.getElementById('m-batch-no').value = `${prod.code}-${mmyy}`;
    
    // Set allergen info automatically based on product
    const allergenSelect = document.getElementById('m-has-allergen');
    const allergenSpec = document.getElementById('m-allergen-spec');
    if (prod.hasAllergen) {
      allergenSelect.value = 'yes';
      allergenSpec.value = prod.allergens.join(', ');
    } else {
      allergenSelect.value = 'no';
      allergenSpec.value = '';
    }
  });

  setupProductAutocomplete('m-prev-product', 'prev-product-autocomplete');
}

// ── LOAD DATE & SUBSCRIBE TO FIRESTORE ──
async function loadDate(dateStr) {
  state.currentDate = dateStr;
  const datePicker = document.getElementById('date-picker');
  if (datePicker) datePicker.value = dateStr;

  const dateBadge = document.getElementById('date-display-badge');
  if (dateBadge) dateBadge.textContent = formatDateLong(dateStr);

  // Unsubscribe previous Firestore listener if active
  if (state.unsubListener) {
    state.unsubListener();
    state.unsubListener = null;
  }

  // Load records immediately
  const initialRecords = await getRecordsForDate(dateStr);
  state.records = initialRecords;
  applyFilters();

  // Setup real-time listener for this date
  state.unsubListener = subscribeToDate(dateStr, (updatedRecords) => {
    state.records = updatedRecords;
    applyFilters();
  });
}

// ── FILTERING & RENDERING ──
function applyFilters() {
  const query = (document.getElementById('search-input')?.value || '').trim().toLowerCase();
  const allergenFilter = document.getElementById('filter-allergen')?.value || 'all';
  const checkerFilter = document.getElementById('filter-checker')?.value || 'all';

  state.filteredRecords = state.records.filter(r => {
    // Search query
    if (query) {
      const matchName = (r.productName || '').toLowerCase().includes(query);
      const matchBatch = (r.batchNo || '').toLowerCase().includes(query);
      const matchAllergen = (r.allergenPresent || '').toLowerCase().includes(query);
      const matchPrev = (r.previousProduct || '').toLowerCase().includes(query);
      if (!matchName && !matchBatch && !matchAllergen && !matchPrev) return false;
    }

    // Allergen filter
    if (allergenFilter === 'yes' && !r.hasAllergen) return false;
    if (allergenFilter === 'no' && r.hasAllergen) return false;

    // Checker filter
    if (checkerFilter !== 'all' && r.checkedBy !== checkerFilter) return false;

    return true;
  });

  renderTable(state.filteredRecords);
  updateStats(state.records);
}

function renderTable(records) {
  const tbody = document.getElementById('register-tbody');
  const countBadge = document.getElementById('table-record-count');
  if (countBadge) countBadge.textContent = `${records.length} Records`;

  if (!records.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 40px; color: var(--text-muted); font-size: 14px;">
          No production records found for this date. Click <strong>+ New Record</strong> to log a batch.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = records.map((r, idx) => {
    const allergenHtml = r.hasAllergen
      ? `<span class="allergen-badge-yes">⚠️ ${escapeHtml(r.allergenPresent)}</span>`
      : `<span class="allergen-badge-no">✓ No</span>`;

    return `
      <tr data-id="${escapeHtml(r.id)}">
        <td class="td-center td-bold" style="color: var(--navy-primary);">${escapeHtml(r.date)}</td>
        <td>
          <div class="product-name-cell">${escapeHtml(r.productName)}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(r.category || 'Seasoning')}</div>
        </td>
        <td class="td-center">
          <span class="batch-code-badge">${escapeHtml(r.batchNo)}</span>
        </td>
        <td>${allergenHtml}</td>
        <td>
          <div style="font-weight: 600; color: var(--text-secondary); font-size: 12.5px;">${escapeHtml(r.previousProduct)}</div>
        </td>
        <td class="td-center">
          <span class="pass-badge">✓ Yes</span>
        </td>
        <td class="td-center">
          <span class="pass-badge">✓ Pass</span>
        </td>
        <td class="td-center">
          <div class="sig-cell">${escapeHtml(r.checkedBy)}</div>
          <span class="sig-name-print">(${escapeHtml(r.checkedBy)})</span>
        </td>
        <td class="td-center no-print">
          <div class="row-actions">
            <button class="btn-icon" title="Edit Record" onclick="window.editRecord('${escapeHtml(r.id)}')">✏️</button>
            <button class="btn-icon btn-delete" title="Delete Record" onclick="window.confirmDeleteRecord('${escapeHtml(r.id)}')">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function updateStats(records) {
  const total = records.length;
  const allergenYes = records.filter(r => r.hasAllergen).length;
  const allergenNo = total - allergenYes;
  const allergenPct = total > 0 ? Math.round((allergenYes / total) * 100) : 0;

  const checkers = [...new Set(records.map(r => r.checkedBy).filter(Boolean))];
  const checkerDisplay = checkers.length > 0 ? checkers.join(' / ') : 'Vishal';

  document.getElementById('stat-total-batches').textContent = total;
  document.getElementById('stat-allergen-yes').textContent = allergenYes;
  document.getElementById('stat-allergen-pct').textContent = `${allergenPct}% of total`;
  document.getElementById('stat-allergen-no').textContent = allergenNo;
  document.getElementById('stat-active-checker').textContent = checkerDisplay;
}

// ── PRINT REGISTER SHEET (MATCHES PHOTO EXACTLY) ──
function printRegisterSheet() {
  const { month, year } = formatMonthYear(state.currentDate);
  document.getElementById('print-month-val').textContent = month;
  document.getElementById('print-year-val').textContent = year;

  const printTbody = document.getElementById('print-sheet-tbody');
  const records = state.filteredRecords;

  // Build rows from records
  let rowsHtml = records.map(r => `
    <tr>
      <td class="td-center" style="font-weight: 700;">${escapeHtml(r.date)}</td>
      <td style="font-weight: 700;">${escapeHtml(r.productName)}</td>
      <td class="td-center" style="font-family: monospace; font-weight: 700;">${escapeHtml(r.batchNo)}</td>
      <td style="font-weight: 600; color: ${r.hasAllergen ? '#B91C1C' : '#047857'};">${escapeHtml(r.allergenPresent)}</td>
      <td style="font-weight: 500;">${escapeHtml(r.previousProduct)}</td>
      <td class="td-center" style="font-weight: 700;">Yes</td>
      <td class="td-center" style="font-weight: 700; color: #047857;">Pass</td>
      <td class="td-center sig-cell">${escapeHtml(r.checkedBy)}</td>
    </tr>
  `).join('');

  // If fewer than 10 rows, pad with empty rows to match physical register format
  const rowsNeeded = Math.max(0, 10 - records.length);
  for (let i = 0; i < rowsNeeded; i++) {
    rowsHtml += `
      <tr style="height: 32px;">
        <td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
      </tr>
    `;
  }

  printTbody.innerHTML = rowsHtml;
  window.print();
}

// ── EXPORT TO EXCEL ──
function exportToExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('SheetJS library is loading, please try again in a second', 'error');
    return;
  }

  const { month, year } = formatMonthYear(state.currentDate);
  const rows = [
    ['L V SPICES — ALLERGEN & CROSS-CONTAMINATION CONTROL REGISTER'],
    ['Daily Production & Packing Record — FSSAI & Quality Assurance Compliance'],
    [`Month: ${month}`, `Year: ${year}`, `Generated Date: ${state.currentDate}`],
    [], // empty row
    [
      'Date (DD/MM/YY)',
      'Product Name (Masala / Seasoning)',
      'Batch No.',
      'Allergen Present (If Yes, specify: Milk, Peanut, Tree Nuts, Sesame, Mustard, Soy, etc.)',
      'Previous Product (Last product processed)',
      'Equipment Cleaned (Blender, Vibro Sifter, Trays, Scoops, Packing Tools, etc.)',
      'Cross-Contamination Check (Pass / Fail)',
      'Checked By (Name / Signature)'
    ]
  ];

  state.filteredRecords.forEach(r => {
    rows.push([
      r.date,
      r.productName,
      r.batchNo,
      r.allergenPresent,
      r.previousProduct,
      r.equipmentCleaned || 'Yes',
      r.crossContaminationCheck || 'Pass',
      r.checkedBy
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  ws['!cols'] = [
    { wch: 14 }, // Date
    { wch: 38 }, // Product Name
    { wch: 16 }, // Batch No
    { wch: 35 }, // Allergen Present
    { wch: 35 }, // Previous Product
    { wch: 22 }, // Equipment Cleaned
    { wch: 16 }, // Cross-Contamination
    { wch: 16 }  // Checked By
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Allergen Register');

  const fileName = `LV_Spices_Allergen_Register_${state.currentDate}.xlsx`;
  XLSX.writeFile(wb, fileName);
  showToast(`✓ Exported ${fileName} successfully!`, 'success');
}

// ── MODAL: ADD / EDIT RECORD ──
function openRecordModal(recordId = null) {
  const modal = document.getElementById('record-modal');
  const title = document.getElementById('modal-title');
  const [yearStr, monthStr, dayStr] = state.currentDate.split('-');
  const mmyy = `${monthStr}${yearStr.slice(-2)}`;

  if (recordId) {
    const r = state.records.find(x => x.id === recordId);
    if (!r) return;
    title.textContent = 'Edit Production Record';
    document.getElementById('m-record-id').value = r.id;
    document.getElementById('m-date').value = r.dateISO || state.currentDate;
    document.getElementById('m-batch-no').value = r.batchNo;
    document.getElementById('m-product-name').value = r.productName;
    document.getElementById('m-has-allergen').value = r.hasAllergen ? 'yes' : 'no';
    
    // Extract allergen spec
    const spec = r.allergenPresent.startsWith('Yes (') 
      ? r.allergenPresent.slice(5, -1) 
      : (r.hasAllergen ? r.allergenPresent.replace(/^Yes\s*[-:]?\s*/i, '') : '');
    document.getElementById('m-allergen-spec').value = spec;

    document.getElementById('m-prev-product').value = r.previousProduct;
    document.getElementById('m-equipment-cleaned').value = r.equipmentCleaned || 'Yes';
    document.getElementById('m-cross-check').value = r.crossContaminationCheck || 'Pass';
    document.getElementById('m-checked-by').value = r.checkedBy || 'Vishal';
  } else {
    // New Record
    title.textContent = 'Add New Production Record';
    document.getElementById('m-record-id').value = '';
    document.getElementById('m-date').value = state.currentDate;
    document.getElementById('m-batch-no').value = `NEW-${mmyy}`;
    document.getElementById('m-product-name').value = '';
    document.getElementById('m-has-allergen').value = 'no';
    document.getElementById('m-allergen-spec').value = '';
    
    // Set previous product to the last product of the day
    const lastProduct = state.records.length > 0 
      ? state.records[state.records.length - 1].productName 
      : 'JEERA POWDER';
    document.getElementById('m-prev-product').value = lastProduct;
    document.getElementById('m-equipment-cleaned').value = 'Yes';
    document.getElementById('m-cross-check').value = 'Pass';
    document.getElementById('m-checked-by').value = 'Vishal';
  }

  modal.classList.add('open');
}

window.editRecord = function(recordId) {
  openRecordModal(recordId);
};

window.confirmDeleteRecord = async function(recordId) {
  if (!confirm('Are you sure you want to delete this record from the register?')) return;
  await deleteRecord(recordId, state.currentDate);
  showToast('✓ Record deleted successfully', 'success');
  // Refresh view
  loadDate(state.currentDate);
};

window.closeModal = function() {
  const modal = document.getElementById('record-modal');
  if (modal) modal.classList.remove('open');
};

async function handleSaveRecord() {
  const recordId = document.getElementById('m-record-id').value || `${state.currentDate}_manual_${Date.now()}`;
  const dateISO = document.getElementById('m-date').value;
  const [yearStr, monthStr, dayStr] = dateISO.split('-');
  const formattedDate = `${dayStr}/${monthStr}/${yearStr.slice(-2)}`;

  const productName = (document.getElementById('m-product-name').value || '').trim().toUpperCase();
  const batchNo = (document.getElementById('m-batch-no').value || '').trim().toUpperCase();
  if (!productName || !batchNo) {
    showToast('Please enter both Product Name and Batch Number', 'error');
    return;
  }

  const hasAllergen = document.getElementById('m-has-allergen').value === 'yes';
  const allergenSpec = (document.getElementById('m-allergen-spec').value || '').trim();
  const allergenPresent = hasAllergen 
    ? (allergenSpec ? `Yes (${allergenSpec})` : 'Yes') 
    : 'No';

  const previousProduct = (document.getElementById('m-prev-product').value || '').trim().toUpperCase();
  const equipmentCleaned = document.getElementById('m-equipment-cleaned').value;
  const crossContaminationCheck = document.getElementById('m-cross-check').value;
  const checkedBy = document.getElementById('m-checked-by').value;

  const recordPayload = {
    id: recordId,
    date: formattedDate,
    dateISO: dateISO,
    productName: productName,
    batchNo: batchNo,
    hasAllergen: hasAllergen,
    allergenPresent: allergenPresent,
    previousProduct: previousProduct,
    isManualOverridePrev: true,
    equipmentCleaned: equipmentCleaned,
    crossContaminationCheck: crossContaminationCheck,
    checkedBy: checkedBy,
    seq: state.records.length + 1
  };

  await saveRecord(recordPayload);
  closeModal();
  showToast('✓ Record saved and synced to cloud!', 'success');
  loadDate(state.currentDate);
}

// ── AUTOCOMPLETE HELPER ──
function setupProductAutocomplete(inputId, dropdownId, onSelect = null) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  if (!input || !dropdown) return;

  input.addEventListener('input', () => {
    const val = input.value.trim().toLowerCase();
    if (!val || val.length < 2) {
      dropdown.style.display = 'none';
      return;
    }

    const matches = productNames.filter(p => p.name.toLowerCase().includes(val)).slice(0, 12);
    if (!matches.length) {
      dropdown.style.display = 'none';
      return;
    }

    dropdown.innerHTML = matches.map(p => `
      <div class="autocomplete-item" data-name="${escapeHtml(p.name)}">
        <div>
          <strong>${escapeHtml(p.name)}</strong>
          <span style="font-size: 11px; color: var(--text-muted); margin-left: 6px;">(${escapeHtml(p.category)})</span>
        </div>
        <span style="font-size: 11px; font-weight: 700; color: ${p.hasAllergen ? '#DC2626' : '#059669'};">
          ${p.hasAllergen ? '⚠️ ' + escapeHtml(p.allergens.join(', ')) : '✓ Allergen Free'}
        </span>
      </div>
    `).join('');

    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const selectedName = item.dataset.name;
        input.value = selectedName.toUpperCase();
        dropdown.style.display = 'none';
        const found = productNames.find(p => p.name === selectedName);
        if (found && onSelect) onSelect(found);
      });
    });
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

// ── TOAST HELPER ──
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-box';
  if (type === 'error') toast.style.background = '#DC2626';
  else if (type === 'success') toast.style.background = '#059669';

  toast.innerHTML = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
