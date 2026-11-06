// LV Spices — Allergen & Cross-Contamination Control Register
// Exact UI & Functionality Controller matching reference design

import { MASTER_PRODUCTS } from './products-master.js';
import { getPreviousWorkingDate, generateEntriesForDate } from './generator.js';
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
  allergenText: p.allergenText.replace(/^[⚠️!\s]+/, ''),
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
  document.getElementById('btn-print-sheet').addEventListener('click', openPrintModal);
  document.getElementById('btn-export-excel').addEventListener('click', exportToExcel);
  document.getElementById('btn-save-record').addEventListener('click', handleSaveRecord);
  document.getElementById('btn-execute-print').addEventListener('click', executePrintRange);

  // Print scope radio change listeners
  document.querySelectorAll('input[name="print-scope"]').forEach(radio => {
    radio.addEventListener('change', updatePrintScopeUI);
  });

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
    // Strip any emoji so allergen text is clean
    const cleanAllergen = (r.allergenPresent || '').replace(/^[⚠️!\s]+/, '');
    const allergenHtml = r.hasAllergen
      ? `<span class="pill-allergen-yes">${escapeHtml(cleanAllergen)}</span>`
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

// ── PRINT REGISTER MODAL & DATE RANGE ──
function openPrintModal() {
  const modal = document.getElementById('print-modal');
  const dateDisplay = document.getElementById('print-modal-date-display');
  if (dateDisplay) dateDisplay.textContent = formatDateDisplay(state.currentDate);

  // Set default range values
  const fromInput = document.getElementById('print-from-date');
  const toInput = document.getElementById('print-to-date');
  const monthInput = document.getElementById('print-month-picker');

  if (fromInput) fromInput.value = state.currentDate;
  if (toInput) toInput.value = state.currentDate;
  if (monthInput) monthInput.value = state.currentDate.slice(0, 7);

  document.getElementById('scope-single').checked = true;
  updatePrintScopeUI();

  if (modal) modal.classList.add('open');
}

window.closePrintModal = function() {
  const modal = document.getElementById('print-modal');
  if (modal) modal.classList.remove('open');
};

function updatePrintScopeUI() {
  const selectedScope = document.querySelector('input[name="print-scope"]:checked')?.value || 'single';
  const rangeBox = document.getElementById('print-range-fields');
  const monthBox = document.getElementById('print-month-fields');

  if (rangeBox) rangeBox.style.display = selectedScope === 'range' ? 'grid' : 'none';
  if (monthBox) monthBox.style.display = selectedScope === 'month' ? 'block' : 'none';
}

async function executePrintRange() {
  const selectedScope = document.querySelector('input[name="print-scope"]:checked')?.value || 'single';
  const padRows = document.getElementById('print-pad-rows')?.checked;
  const printSheet = document.getElementById('printable-register-sheet');

  let datesToPrint = [];

  if (selectedScope === 'single') {
    datesToPrint = [state.currentDate];
  } else if (selectedScope === 'range') {
    const fromDateStr = document.getElementById('print-from-date')?.value;
    const toDateStr = document.getElementById('print-to-date')?.value;
    if (!fromDateStr || !toDateStr) {
      showToast('Please select both From Date and To Date', 'error');
      return;
    }
    if (fromDateStr > toDateStr) {
      showToast('From Date cannot be after To Date', 'error');
      return;
    }

    let cur = new Date(fromDateStr + 'T12:00:00Z');
    const end = new Date(toDateStr + 'T12:00:00Z');
    while (cur <= end) {
      if (cur.getUTCDay() !== 0) { // skip Sundays
        datesToPrint.push(cur.toISOString().split('T')[0]);
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  } else if (selectedScope === 'month') {
    const monthVal = document.getElementById('print-month-picker')?.value; // YYYY-MM
    if (!monthVal) {
      showToast('Please select a Month to print', 'error');
      return;
    }
    const [y, m] = monthVal.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const dStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const d = new Date(dStr + 'T12:00:00Z');
      if (d.getUTCDay() !== 0) { // skip Sundays
        datesToPrint.push(dStr);
      }
    }
  }

  if (!datesToPrint.length) {
    showToast('No working dates found in the selected range', 'error');
    return;
  }

  showToast(`Preparing ${datesToPrint.length} page(s) for printing...`, 'info');

  let pagesHtml = '';

  for (const dateStr of datesToPrint) {
    const records = await getRecordsForDate(dateStr);
    const { month, year } = formatMonthYear(dateStr);

    let rowsHtml = records.map(r => {
      const cleanAllergen = (r.allergenPresent || '').replace(/^[⚠️!\s]+/, '');
      return `
        <tr>
          <td class="td-center" style="font-weight: 700;">${escapeHtml(r.date)}</td>
          <td style="font-weight: 700;">${escapeHtml(r.productName)}</td>
          <td class="td-center" style="font-family: monospace; font-weight: 700; white-space: nowrap;">${escapeHtml(r.batchNo)}</td>
          <td style="font-weight: 600; color: ${r.hasAllergen ? '#B91C1C' : '#047857'}; text-align: center;">${escapeHtml(cleanAllergen)}</td>
          <td style="font-weight: 600;">${escapeHtml(r.previousProduct)}</td>
          <td class="td-center" style="font-weight: 700;">Yes</td>
          <td class="td-center" style="font-weight: 700; color: #047857;">Pass</td>
          <td class="td-center sig-cell">${escapeHtml(r.checkedBy)}</td>
        </tr>
      `;
    }).join('');

    if (padRows) {
      const rowsNeeded = Math.max(0, 10 - records.length);
      for (let i = 0; i < rowsNeeded; i++) {
        rowsHtml += `
          <tr style="height: 30px;">
            <td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
          </tr>
        `;
      }
    }

    pagesHtml += `
      <div class="print-page">
        <div class="print-header-container">
          <div class="print-brand-box">
            <img src="assets/lv_spices_logo.jpg" alt="L V Spices" class="print-logo-img" />
            <div>
              <div class="print-brand-title">L V SPICES</div>
              <div class="print-brand-subtitle">Spices & Seasonings</div>
            </div>
          </div>

          <div class="print-divider-line"></div>

          <div class="print-title-box">
            <div class="print-main-title">Allergen & Cross-Contamination Control Register</div>
            <div class="print-subtitle-pill">Daily Production & Packing Record</div>
          </div>

          <div class="print-date-frame">
            <div>Month : <span style="text-decoration: underline; font-weight: 800;">${escapeHtml(month)}</span></div>
            <div style="margin-top: 4px;">Year &nbsp;: <span style="text-decoration: underline; font-weight: 800;">${escapeHtml(year)}</span></div>
          </div>
        </div>

        <table class="print-table">
          <thead>
            <tr>
              <th style="width: 10%;">Date<small>(DD/MM/YY)</small></th>
              <th style="width: 22%;">Product Name<small>(Masala / Seasoning)</small></th>
              <th style="width: 11%; white-space: nowrap;">Batch No.</th>
              <th style="width: 19%;">Allergen Present<small>(If Yes, specify: Milk, Peanut, Tree Nuts, Sesame, Mustard, Soy, etc.)</small></th>
              <th style="width: 17%;">Previous Product<small>(Last product processed)</small></th>
              <th style="width: 9%;">Equipment Cleaned<small>(Blender, Vibro Sifter, Trays, etc.)</small></th>
              <th style="width: 6%;">Cross-Contamination Check<small>(Pass / Fail)</small></th>
              <th style="width: 6%;">Checked By<small>(Name / Signature)</small></th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;
  }

  printSheet.innerHTML = pagesHtml;
  closePrintModal();
  setTimeout(() => {
    window.print();
  }, 250);
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
    const cleanAllergen = (r.allergenPresent || '').replace(/^[⚠️!\s]+/, '');
    rows.push([
      r.date,
      r.productName,
      r.batchNo,
      cleanAllergen,
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
    
    const cleanPresent = (r.allergenPresent || '').replace(/^[⚠️!\s]+/, '');
    const spec = cleanPresent.startsWith('Yes (') 
      ? cleanPresent.slice(5, -1) 
      : (r.hasAllergen ? cleanPresent.replace(/^Yes\s*[-:]?\s*/i, '') : '');
    document.getElementById('m-allergen-spec').value = spec;

    document.getElementById('m-prev-product').value = r.previousProduct;
    document.getElementById('m-equipment-cleaned').value = r.equipmentCleaned || 'Yes';
    document.getElementById('m-cross-check').value = r.crossContaminationCheck || 'Pass';
    document.getElementById('m-checked-by').value = r.checkedBy || 'Vishal';
  } else {
    // New Record: Added to TOP, so its previous product is the current top row!
    title.textContent = 'Add New Production Record';
    document.getElementById('m-record-id').value = '';
    document.getElementById('m-date').value = state.currentDate;
    document.getElementById('m-batch-no').value = `NEW-${mmyy}`;
    document.getElementById('m-product-name').value = '';
    document.getElementById('m-has-allergen').value = 'no';
    document.getElementById('m-allergen-spec').value = '';
    
    // The previous product for this new top record is the currently top product of the day
    const topProduct = state.records.length > 0 
      ? state.records[0].productName 
      : 'JEERA POWDER';
    document.getElementById('m-prev-product').value = topProduct;
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
    seq: 0 // New manual entries placed at top
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
          ${p.hasAllergen ? escapeHtml(p.allergens.join(', ')) : '✓ Allergen Free'}
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
