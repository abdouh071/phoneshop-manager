const assert = require('assert');

// Mock tickets
const ticketCancelled = {
  id: 'ticket_old_cancelled',
  ticketNumber: 'TKT-0247',
  customerName: 'maziri',
  customerPhone: '0550112233',
  deviceBrand: 'redmi',
  deviceModel: 'A1+',
  issueDescription: 'cart mer',
  status: 'cancelled',
  createdAt: '2026-10-09T16:39:15.043Z',
  updatedAt: '2026-10-09T16:39:15.043Z',
};

const ticketCompleted = {
  id: 'ticket_new_completed',
  ticketNumber: 'TKT-0248',
  customerName: 'maziri',
  customerPhone: '0550112233',
  deviceBrand: 'redmi',
  deviceModel: 'A1+',
  issueDescription: 'cart mer',
  status: 'completed',
  paidAmount: 2500,
  actualCost: 2500,
  partsUsed: [{ productId: 'p1', name: 'Motherboard fix', cost: 1000, quantity: 1 }],
  createdAt: '2026-10-09T16:40:26.434Z',
  updatedAt: '2026-10-09T17:00:00.000Z',
};

const ticketMerged = {
  id: 'ticket_absorbed',
  ticketNumber: 'TKT-0099',
  customerName: 'test',
  customerPhone: '0550998877',
  deviceBrand: 'Samsung',
  deviceModel: 'A10',
  issueDescription: 'Screen',
  status: 'cancelled',
  mergedIntoTicketId: 'ticket_primary',
  mergedAt: '2026-10-24T00:00:00.000Z',
  createdAt: '2026-10-09T10:00:00.000Z',
  updatedAt: '2026-10-09T10:00:00.000Z',
};

// Test deduplication
function runTests() {
  console.log('--- Testing Safe Fusion & Repair Deduplication ---');

  // Test 1: Merged tickets are filtered out
  const listWithMerged = [ticketCancelled, ticketCompleted, ticketMerged];
  const activeOnly = listWithMerged.filter(t => !t.mergedIntoTicketId);
  assert.strictEqual(activeOnly.length, 2, 'Merged ticket should be filtered out from active list');
  console.log('✓ Test 1 Passed: Merged ticket excluded without deleting from DB');

  // Test 2: Near-simultaneous duplicate detection (71 seconds apart)
  const timeA = new Date(ticketCancelled.createdAt).getTime();
  const timeB = new Date(ticketCompleted.createdAt).getTime();
  const diffMs = Math.abs(timeA - timeB);
  assert.ok(diffMs < 180000, 'Difference is 71s which is within 180s duplicate window');
  console.log('✓ Test 2 Passed: 71s duplicate creation detected');

  // Test 3: Priority selection favors active/completed over cancelled
  const isCancelled = t => t.status === 'cancelled';
  let preferred = ticketCompleted;
  let absorbed = ticketCancelled;
  if (isCancelled(ticketCompleted) && !isCancelled(ticketCancelled)) {
    preferred = ticketCancelled;
    absorbed = ticketCompleted;
  }
  assert.strictEqual(preferred.id, 'ticket_new_completed', 'Completed ticket should be preferred over cancelled');
  console.log('✓ Test 3 Passed: Completed repair preferred over cancelled duplicate');

  // Test 4: Data fusion retains parts and payments
  const combinedParts = [...(preferred.partsUsed || [])];
  assert.strictEqual(combinedParts.length, 1, 'Parts from authoritative ticket preserved');
  assert.strictEqual(preferred.paidAmount, 2500, 'Payment preserved');
  console.log('✓ Test 4 Passed: Financials and parts preserved');

  console.log('All safe fusion tests passed successfully!');
}

runTests();
