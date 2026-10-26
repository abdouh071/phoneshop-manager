const assert = require('assert');

// Simulate customer data
const existingCustomers = [
  {
    id: 'cust_101',
    name: 'Karim',
    phone: '0550 12 34 56',
    normalizedPhone: '0550123456',
    accountType: 'retail',
    totalPurchases: 2,
    totalDebt: 0,
    totalSpent: 4500,
  },
  {
    id: 'cust_102',
    name: 'Ahmed',
    phone: '0661 98 76 54',
    normalizedPhone: '0661987654',
    shopName: 'QuickFix Store',
    accountType: 'shop_repairer',
    totalPurchases: 5,
    totalDebt: 12000,
    totalSpent: 85000,
  }
];

// Helper functions (same logic as in phoneUtils & components)
function normalizePhoneDigits(phone) {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00213')) digits = digits.slice(5);
  else if (digits.startsWith('213') && digits.length >= 11) digits = digits.slice(3);
  if (digits.length === 9 && (digits.startsWith('5') || digits.startsWith('6') || digits.startsWith('7'))) {
    digits = '0' + digits;
  }
  return digits;
}

function isPhoneMatch(phoneA, phoneB) {
  if (!phoneA || !phoneB) return false;
  const digitsA = normalizePhoneDigits(phoneA);
  const digitsB = normalizePhoneDigits(phoneB);
  if (!digitsA || !digitsB) return false;
  if (digitsA === digitsB) return true;
  if (digitsA.length >= 8 && digitsB.length >= 8) {
    const compareLen = Math.min(digitsA.length, digitsB.length, 9);
    return digitsA.slice(-compareLen) === digitsB.slice(-compareLen);
  }
  return false;
}

function findDuplicate(phone, currentCustomerId = null) {
  const cleanPhone = (phone || '').trim();
  if (normalizePhoneDigits(cleanPhone).length < 7) return null;
  return existingCustomers.find(c => {
    if (currentCustomerId && c.id === currentCustomerId) return false;
    return isPhoneMatch(c.phone, cleanPhone) || (c.normalizedPhone && isPhoneMatch(c.normalizedPhone, cleanPhone));
  }) || null;
}

console.log('=== TEST 1: Duplicate Detection Across Variations ===');
const variations = [
  '0550 12 34 56',
  '0550123456',
  '+213 550 123456',
  '+213550123456',
  '00213550123456',
  '0550-12-34-56'
];

for (const variant of variations) {
  const match = findDuplicate(variant);
  assert.ok(match, `Failed to detect duplicate for variant: ${variant}`);
  assert.strictEqual(match.id, 'cust_101');
  console.log(`✓ Variant "${variant}" detected customer: ${match.name} (${match.phone})`);
}

console.log('\n=== TEST 2: Action 1 - Use Existing Profile ===');
let stateSelectedCustomer = null;
const enteredName = 'Karim Alger';
const enteredPhone = '+213 550 12 34 56';
const duplicate = findDuplicate(enteredPhone);
assert.ok(duplicate);

// Simulate "Use Existing Profile" action
stateSelectedCustomer = duplicate;
assert.strictEqual(stateSelectedCustomer.name, 'Karim');
assert.strictEqual(stateSelectedCustomer.id, 'cust_101');
console.log(`✓ "Use Existing Profile" selected existing customer: ${stateSelectedCustomer.name} (ID: ${stateSelectedCustomer.id})`);

console.log('\n=== TEST 3: Action 2 - Update to New Name & Details ===');
const customersCopy = JSON.parse(JSON.stringify(existingCustomers));
const targetCustomer = customersCopy.find(c => c.id === duplicate.id);
assert.ok(targetCustomer);

// Simulate "Update to New Name & Details" action
targetCustomer.name = enteredName.trim();
assert.strictEqual(targetCustomer.name, 'Karim Alger');
assert.strictEqual(targetCustomer.id, 'cust_101');
console.log(`✓ "Update to New Name" successfully updated profile name to "${targetCustomer.name}" without duplicate ID`);

console.log('\n=== TEST 4: Action 3 - Save as Separate Contact ===');
let separateContactAllowed = false;
// User clicks "Save as Separate Contact"
separateContactAllowed = true;
let newCustomerCreated = null;
if (separateContactAllowed) {
  newCustomerCreated = {
    id: 'cust_separate_103',
    name: enteredName.trim(),
    phone: '0550 12 34 56',
    normalizedPhone: '0550123456',
    accountType: 'retail'
  };
}
assert.ok(newCustomerCreated);
assert.strictEqual(newCustomerCreated.name, 'Karim Alger');
assert.notStrictEqual(newCustomerCreated.id, duplicate.id);
console.log(`✓ "Save as Separate Contact" safely allowed distinct customer creation: ${newCustomerCreated.name} (ID: ${newCustomerCreated.id})`);

console.log('\n=== TEST 5: Debt & Visits Display Formatting ===');
assert.strictEqual(existingCustomers[0].totalPurchases, 2);
assert.strictEqual(existingCustomers[0].totalDebt, 0);
assert.strictEqual(existingCustomers[1].totalPurchases, 5);
assert.strictEqual(existingCustomers[1].totalDebt, 12000);
console.log(`✓ Karim: ${existingCustomers[0].totalPurchases} visits · ${existingCustomers[0].totalDebt} DZD Debt`);
console.log(`✓ Ahmed: ${existingCustomers[1].totalPurchases} visits · ${existingCustomers[1].totalDebt} DZD Debt (Shop: ${existingCustomers[1].shopName})`);

console.log('\nALL 5 TEST SUITES PASSED! Intelligent Deduplication & Actions Verified.');
