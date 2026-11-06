import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidClientName } from './clientNames.ts';

test('a real name in latin or arabic is a client name', () => {
  assert.equal(isValidClientName('Karim Benali'), true);
  assert.equal(isValidClientName('أحمد'), true);
  assert.equal(isValidClientName('محمود بن علي'), true);
});

test('placeholder rows are never suggested as clients', () => {
  assert.equal(isValidClientName('Client'), false);
  assert.equal(isValidClientName('passager'), false);
  assert.equal(isValidClientName('walk-in'), false);
  assert.equal(isValidClientName('unknown'), false);
});

test('missing, short or non-string names are not clients', () => {
  assert.equal(isValidClientName(''), false);
  assert.equal(isValidClientName('  '), false);
  assert.equal(isValidClientName('Al'), false);
  assert.equal(isValidClientName('...'), false);
  assert.equal(isValidClientName(null), false);
  assert.equal(isValidClientName(undefined), false);
  assert.equal(isValidClientName(42), false);
});
