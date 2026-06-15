import { describe, expect, it } from 'vitest';
import { formatQuantity } from './quantity';

describe('formatQuantity', () => {
  it('renders tight metric units without a space', () => {
    expect(formatQuantity('200', 'ml')).toBe('200ml');
    expect(formatQuantity('2', 'kg')).toBe('2kg');
  });

  it('renders other units with a space', () => {
    expect(formatQuantity('4', 'pt')).toBe('4 pt');
    expect(formatQuantity('1/2', 'cup')).toBe('1/2 cup');
  });

  it('renders counts and x-counts, and null when empty', () => {
    expect(formatQuantity('3', null)).toBe('3');
    expect(formatQuantity('2', 'x')).toBe('x2');
    expect(formatQuantity(null, 'ml')).toBeNull();
  });
});
