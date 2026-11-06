// LV Spices — Firebase Initialization & Firestore Configuration
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy,
  onSnapshot, 
  enableIndexedDbPersistence 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBa02TOma1H0yjfy5oZ_JJzMFrTxyThJfY",
  authDomain: "allergen-68188.firebaseapp.com",
  projectId: "allergen-68188",
  storageBucket: "allergen-68188.firebasestorage.app",
  messagingSenderId: "225645436025",
  appId: "1:225645436025:web:edee818fae9d3db72148a8"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Enable offline persistence if supported
try {
  enableIndexedDbPersistence(db).catch(err => {
    if (err.code === 'failed-precondition') {
      console.warn('Firestore offline persistence failed: Multiple tabs open');
    } else if (err.code === 'unimplemented') {
      console.warn('Firestore offline persistence is not supported by browser');
    }
  });
} catch(e) {}

export { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy,
  onSnapshot 
};

