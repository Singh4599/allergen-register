// LV Spices — Data Store & Synchronizer
// Merges deterministic auto-generated records with real-time Firebase Firestore overrides

import { generateEntriesForDate } from './generator.js';
import { 
  db, 
  collection, 
  doc, 
  getDocs, 
  setDoc, 
  deleteDoc, 
  query, 
  where, 
  onSnapshot 
} from './firebase-config.js';

const LOCAL_STORAGE_KEY = 'lv_allergen_records_cache_v1';

// Read local cache
function getLocalCache() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch(e) {
    return {};
  }
}

// Write local cache
function saveLocalCache(cache) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cache));
  } catch(e) {}
}

/**
 * Get merged records for a single date (YYYY-MM-DD).
 */
export async function getRecordsForDate(dateStr) {
  const baseEntries = generateEntriesForDate(dateStr);
  const cache = getLocalCache();
  const dateCache = cache[dateStr] || {};

  // Fetch Firestore overrides for this date
  let firestoreEntries = {};
  try {
    const q = query(collection(db, 'allergen_records'), where('dateISO', '==', dateStr));
    const snap = await getDocs(q);
    snap.forEach(d => {
      firestoreEntries[d.id] = d.data();
    });
    // Merge into local cache
    cache[dateStr] = firestoreEntries;
    saveLocalCache(cache);
  } catch(err) {
    console.warn('Firestore fetch failed, using local/base records:', err.message);
    firestoreEntries = dateCache;
  }

  return mergeRecords(baseEntries, firestoreEntries, dateStr);
}

/**
 * Merge base generated entries with Firestore overrides.
 */
function mergeRecords(baseEntries, overrides, dateStr) {
  const recordMap = new Map();

  // 1. Add base entries
  baseEntries.forEach((entry, idx) => {
    recordMap.set(entry.id, { ...entry, seq: idx + 1 });
  });

  // 2. Apply overrides & deletions
  Object.keys(overrides).forEach(id => {
    const override = overrides[id];
    if (override.status === 'deleted') {
      recordMap.delete(id);
    } else if (recordMap.has(id)) {
      recordMap.set(id, { ...recordMap.get(id), ...override, isManual: true });
    } else if (override.dateISO === dateStr) {
      // Manual entry added by user
      recordMap.set(id, { ...override, isManual: true });
    }
  });

  // 3. Sort entries by sequence
  const result = Array.from(recordMap.values()).sort((a, b) => (a.seq || 999) - (b.seq || 999));

  // 4. Ensure previousProduct chain: each row's previous product is the row directly BELOW it
  for (let i = 0; i < result.length - 1; i++) {
    if (!result[i].isManualOverridePrev) {
      result[i].previousProduct = result[i + 1].productName;
    }
  }

  return result;
}

/**
 * Save / Update a record to Firestore & local cache.
 */
export async function saveRecord(record) {
  const dateStr = record.dateISO;
  const docRef = doc(db, 'allergen_records', record.id);
  
  const payload = {
    ...record,
    updatedAt: new Date().toISOString(),
    status: 'active'
  };

  // Update local cache immediately
  const cache = getLocalCache();
  if (!cache[dateStr]) cache[dateStr] = {};
  cache[dateStr][record.id] = payload;
  saveLocalCache(cache);

  // Write to Firestore
  try {
    await setDoc(docRef, payload, { merge: true });
  } catch(err) {
    console.error('Failed to sync record to Firestore:', err);
  }

  return payload;
}

/**
 * Delete a record from Firestore & local cache.
 */
export async function deleteRecord(recordId, dateStr) {
  const docRef = doc(db, 'allergen_records', recordId);
  const cache = getLocalCache();

  if (cache[dateStr] && cache[dateStr][recordId]) {
    cache[dateStr][recordId].status = 'deleted';
    saveLocalCache(cache);
  }

  try {
    await setDoc(docRef, { id: recordId, dateISO: dateStr, status: 'deleted', updatedAt: new Date().toISOString() }, { merge: true });
  } catch(err) {
    console.error('Failed to mark record deleted in Firestore:', err);
  }
}

/**
 * Reset a day's records back to the default auto-generated set.
 */
export async function resetDayToDefault(dateStr) {
  const cache = getLocalCache();
  delete cache[dateStr];
  saveLocalCache(cache);

  try {
    const q = query(collection(db, 'allergen_records'), where('dateISO', '==', dateStr));
    const snap = await getDocs(q);
    const promises = [];
    snap.forEach(d => {
      promises.push(deleteDoc(d.ref));
    });
    await Promise.all(promises);
  } catch(err) {
    console.error('Failed to reset day in Firestore:', err);
  }
}

/**
 * Subscribe to real-time changes for a date.
 */
export function subscribeToDate(dateStr, onUpdate) {
  const q = query(collection(db, 'allergen_records'), where('dateISO', '==', dateStr));
  return onSnapshot(q, (snapshot) => {
    const overrides = {};
    snapshot.forEach(d => {
      overrides[d.id] = d.data();
    });
    const baseEntries = generateEntriesForDate(dateStr);
    const merged = mergeRecords(baseEntries, overrides, dateStr);
    onUpdate(merged);
  }, (err) => {
    console.warn('Realtime listener error:', err.message);
  });
}

