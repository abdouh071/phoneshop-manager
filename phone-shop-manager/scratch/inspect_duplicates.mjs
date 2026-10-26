import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  projectId: "phoneshop-mgr-pro-2026",
  appId: "1:382569044952:web:3081c612d39e1f7fc2f0ad",
  storageBucket: "phoneshop-mgr-pro-2026.firebasestorage.app",
  apiKey: "AIzaSyCYQopJt3Ppyd8BV-o0c1pd-AONwEqBFXw",
  authDomain: "phoneshop-mgr-pro-2026.firebaseapp.com",
  messagingSenderId: "382569044952",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function inspect() {
  console.log('Fetching customers and repairs from Firestore...');
  
  const [custSnap, repairSnap] = await Promise.all([
    getDocs(collection(db, 'customers')),
    getDocs(collection(db, 'repairs')),
  ]);

  console.log(`Found ${custSnap.size} customers and ${repairSnap.size} repairs.`);

  const customers = custSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const repairs = repairSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Print all customers
  console.log('\n--- CUSTOMERS ---');
  customers.forEach(c => {
    console.log(`[${c.id}] Name: "${c.name}", Phone: "${c.phone}", Shop: "${c.shopName || ''}", Type: ${c.accountType}, MergedInto: ${c.mergedIntoId || 'none'}`);
  });

  // Print all repairs
  console.log('\n--- REPAIRS ---');
  repairs.forEach(r => {
    console.log(`[${r.id}] #${r.ticketNumber || 'NO_NUM'} Cust: "${r.customerName}" (${r.customerPhone || 'NO_PHONE'}) Device: "${r.deviceBrand} ${r.deviceModel}" Status: ${r.status} Cost: ${r.actualCost || r.estimatedCost} MergedInto: ${r.mergedIntoId || 'none'}`);
  });
}

inspect().catch(console.error);
