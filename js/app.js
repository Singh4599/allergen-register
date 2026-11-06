// LV Spices — Allergen & Cross-Contamination Control Register
// Exact UI & Functionality Controller matching reference design

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
  currentPage: 1,
  pageSize: 10,
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

function formatDateDisplay(dateStr) {
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
  const hiddenPicker = document.getElementById('date-picker-hidden');
  const dateSelectorWrap = document.getElementById('date-selector-wrap');
  if (hiddenPicker) hiddenPicker.value = state.currentDate;

  // Open native picker on click
  if (dateSelectorWrap && hiddenPicker) {
    dateSelectorWrap.addEventListener('click', (e) => {
      if (e.target !== hiddenPicker) {
        try {
          hiddenPicker.showPicker();
        } catch(err) {
          hiddenPicker.focus();
        }
      }
    });

    hiddenPicker.addEventListener('change', (e) => {
      if (e.target.value) {
        loadDate(e.target.value);
      }
    });
  }

  // Prev / Next / Today
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
  document.getElementById('search-input').addEventListener('input', () => {
    state.currentPage = 1;
    applyFilters();
  });
  document.getElementById('filter-allergen').addEventListener('change', () => {
    state.currentPage = 1;
    applyFilters();
  });
  document.getElementById('filter-checker').addEventListener('change', () => {
    state.currentPage = 1;
    applyFilters();
  });

  // Actions
  document.getElementById('btn-new-entry').addEventListener('click', () => openRecordModal());
  document.getElementById('btn-print-sheet').addEventListener('click', printRegisterSheet);
  document.getElementById('btn-export-excel').addEventListener('click', exportToExcel);
  document.getElementById('btn-save-record').addEventListener('click', handleSaveRecord);

  // Pagination buttons
  document.getElementById('prev-page-btn').addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      renderTable();
    }
  });

  document.getElementById('next-page-btn').addEventListener('click', () => {
    const maxPage = Math.ceil(state.filteredRecords.length / state.pageSize) || 1;
    if (state.currentPage < maxPage) {
      state.currentPage++;
      renderTable();
    }
  });

  // Autocomplete Setup
  setupProductAutocomplete('m-product-name', 'product-autocomplete', (prod) => {
    const [year, month] = state.currentDate.split('-');
    const mmyy = `${month}${year.slice(-2)}`;
    document.getElementById('m-batch-no').value = `${prod.code}-${mmyy}`;
    
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
  state.currentPage = 1;

  const hiddenPicker = document.getElementById('date-picker-hidden');
  if (hiddenPicker) hiddenPicker.value = dateStr;

  const dateText = document.getElementById('date-text-display');
  if (dateText) dateText.textContent = formatDateDisplay(dateStr);

  if (state.unsubListener) {
    state.unsubListener();
    state.unsubListener = null;
  }

  // Load records
  const initialRecords = await getRecordsForDate(dateStr);
  state.records = initialRecords;
  applyFilters();

  // Firestore live listener
  state.unsubListener = subscribeToDate(dateStr, (updatedRecords) => {
    state.records = updatedRecords;
    applyFilters();
  });
}

// ── FILTERING & PAGINATION ──
function applyFilters() {
  const query = (document.getElementById('search-input')?.value || '').trim().toLowerCase();
  const allergenFilter = document.getElementById('filter-allergen')?.value || 'all';
  const checkerFilter = document.getElementById('filter-checker')?.value || 'all';

  state.filteredRecords = state.records.filter(r => {
    if (query) {
      const matchName = (r.productName || '').toLowerCase().includes(query);
      const matchBatch = (r.batchNo || '').toLowerCase().includes(query);
      const matchAllergen = (r.allergenPresent || '').toLowerCase().includes(query);
      const matchPrev = (r.previousProduct || '').toLowerCase().includes(query);
      if (!matchName && !matchBatch && !matchAllergen && !matchPrev) return false;
    }

    if (allergenFilter === 'yes' && !r.hasAllergen) return false;
    if (allergenFilter === 'no' && r.hasAllergen) return false;

    if (checkerFilter !== 'all' && r.checkedBy !== checkerFilter) return false;

    return true;
  });

  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('register-tbody');
  const countBadge = document.getElementById('records-count-badge');
  const paginationInfo = document.getElementById('pagination-info');
  const curPageBox = document.getElementById('cur-page-num');

  const total = state.filteredRecords.length;
  if (countBadge) countBadge.textContent = `${total} Records`;

  if (!total) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 40px; color: var(--text-muted); font-size: 13.5px;">
          No production records found for this date. Click <strong>+ New Record</strong> to log a batch.
        </td>
      </tr>
    `;
    if (paginationInfo) paginationInfo.textContent = 'Showing 0-0 of 0 records';
    if (curPageBox) curPageBox.textContent = '1';
    return;
  }

  const maxPage = Math.ceil(total / state.pageSize) || 1;
  if (state.currentPage > maxPage) state.currentPage = maxPage;

  const startIdx = (state.currentPage - 1) * state.pageSize;
  const endIdx = Math.min(startIdx + state.pageSize, total);
  const pageRecords = state.filteredRecords.slice(startIdx, endIdx);

  if (paginationInfo) {
    paginationInfo.textContent = `Showing ${startIdx + 1}-${endIdx} of ${total} records`;
  }
  if (curPageBox) {
    curPageBox.textContent = state.currentPage;
  }

  tbody.innerHTML = pageRecords.map(r => {
    const allergenHtml = r.hasAllergen
      ? `<span class="pill-allergen-yes">⚠️ ${escapeHtml(r.allergenPresent)}</span>`
      : `<span class="pill-allergen-no">✓ No</span>`;

    return `
      <tr data-id="${escapeHtml(r.id)}">
        <td class="td-center td-date">${escapeHtml(r.date)}</td>
        <td>
          <div class="product-title">${escapeHtml(r.productName)}</div>
          <div class="product-cat-sub">${escapeHtml(r.category || 'Seasoning')}</div>
        </td>
        <td class="td-center">
          <span class="batch-badge">${escapeHtml(r.batchNo)}</span>
        </td>
        <td class="td-center">${allergenHtml}</td>
        <td>
          <span class="prev-product-text">${escapeHtml(r.previousProduct)}</span>
        </td>
        <td class="td-center">
          <span class="pill-green-check">✓ Yes</span>
        </td>
        <td class="td-center">
          <span class="pill-green-check">✓ Pass</span>
        </td>
        <td class="td-center">
          <span class="signature-name">${escapeHtml(r.checkedBy)}</span>
        </td>
        <td class="td-center">
          <div class="action-buttons-wrap">
            <button class="action-btn edit-btn" title="Edit" onclick="window.editRecord('${escapeHtml(r.id)}')">✏️</button>
            <button class="action-btn delete-btn" title="Delete" onclick="window.confirmDeleteRecord('${escapeHtml(r.id)}')">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ── PRINT REGISTER SHEET ──
function printRegisterSheet() {
  const { month, year } = formatMonthYear(state.currentDate);
  const mEl = document.getElementById('print-month-val');
  const yEl = document.getElementById('print-year-val');
  if (mEl) mEl.textContent = month;
  if (yEl) yEl.textContent = year;

  const printTbody = document.getElementById('print-sheet-tbody');
  const records = state.filteredRecords;

  let rowsHtml = records.map(r => `
    <tr>
      <td class="td-center" style="font-weight: 700;">${escapeHtml(r.date)}</td>
      <td style="font-weight: 700;">${escapeHtml(r.productName)}</td>
      <td class="td-center" style="font-family: monospace; font-weight: 700;">${escapeHtml(r.batchNo)}</td>
      <td style="font-weight: 600; color: ${r.hasAllergen ? '#B91C1C' : '#047857'};">${escapeHtml(r.allergenPresent)}</td>
      <td style="font-weight: 600;">${escapeHtml(r.previousProduct)}</td>
      <td class="td-center" style="font-weight: 700;">Yes</td>
      <td class="td-center" style="font-weight: 700; color: #047857;">Pass</td>
      <td class="td-center sig-cell">${escapeHtml(r.checkedBy)}</td>
    </tr>
  `).join('');

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

// ── EXCEL EXPORT ──
function exportToExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('SheetJS library is loading, please try again in a moment', 'error');
    return;
  }

  const { month, year } = formatMonthYear(state.currentDate);
  const rows = [
    ['L V SPICES — ALLERGEN & CROSS-CONTAMINATION CONTROL REGISTER'],
    ['Daily Production & Packing Record — FSSAI & Quality Assurance Compliance'],
    [`Month: ${month}`, `Year: ${year}`, `Generated Date: ${state.currentDate}`],
    [],
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
  ws['!cols'] = [
    { wch: 14 },
    { wch: 38 },
    { wch: 16 },
    { wch: 35 },
    { wch: 35 },
    { wch: 22 },
    { wch: 16 },
    { wch: 16 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Allergen Register');

  const fileName = `LV_Spices_Allergen_Register_${state.currentDate}.xlsx`;
  XLSX.writeFile(wb, fileName);
  showToast(`✓ Exported ${fileName} successfully!`, 'success');
}

// ── MODAL: ADD / EDIT ──
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
    
    const spec = r.allergenPresent.startsWith('Yes (') 
      ? r.allergenPresent.slice(5, -1) 
      : (r.hasAllergen ? r.allergenPresent.replace(/^Yes\s*[-:]?\s*/i, '') : '');
    document.getElementById('m-allergen-spec').value = spec;

    document.getElementById('m-prev-product').value = r.previousProduct;
    document.getElementById('m-equipment-cleaned').value = r.equipmentCleaned || 'Yes';
    document.getElementById('m-cross-check').value = r.crossContaminationCheck || 'Pass';
    document.getElementById('m-checked-by').value = r.checkedBy || 'Vishal';
  } else {
    title.textContent = 'Add New Production Record';
    document.getElementById('m-record-id').value = '';
    document.getElementById('m-date').value = state.currentDate;
    document.getElementById('m-batch-no').value = `NEW-${mmyy}`;
    document.getElementById('m-product-name').value = '';
    document.getElementById('m-has-allergen').value = 'no';
    document.getElementById('m-allergen-spec').value = '';
    
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

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

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
