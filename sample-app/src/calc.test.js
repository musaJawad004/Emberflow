import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, multiply, divide } from './calc.js';

test('add sums two numbers', () => {
  assert.equal(add(2, 3), 5);
});

test('multiply multiplies two numbers', () => {
  assert.equal(multiply(4, 5), 20);
});

test('divide divides two numbers', () => {
  assert.equal(divide(10, 2), 5);
});

test('divide throws on zero', () => {
  assert.throws(() => divide(1, 0), /division by zero/);
});
