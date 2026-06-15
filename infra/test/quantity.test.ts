import { formatQuantity, parseQuantity } from '../lambda/shared/quantity';

describe('parseQuantity', () => {
  it('splits a leading amount + unit from the item', () => {
    expect(parseQuantity('200ml cream')).toEqual({ amount: '200', unit: 'ml', itemText: 'cream' });
    expect(parseQuantity('2kg potatoes')).toEqual({ amount: '2', unit: 'kg', itemText: 'potatoes' });
  });

  it('normalises unit synonyms and strips a leading "of"', () => {
    expect(parseQuantity('4 pints of milk')).toEqual({ amount: '4', unit: 'pt', itemText: 'milk' });
    expect(parseQuantity('2 tins chopped tomatoes')).toEqual({
      amount: '2',
      unit: 'tin',
      itemText: 'chopped tomatoes',
    });
  });

  it('preserves fractions', () => {
    expect(parseQuantity('1/2 cup cream')).toEqual({ amount: '1/2', unit: 'cup', itemText: 'cream' });
  });

  it('treats a non-unit word after the number as part of the item', () => {
    expect(parseQuantity('4 large eggs')).toEqual({ amount: '4', unit: null, itemText: 'large eggs' });
  });

  it('handles a bare count', () => {
    expect(parseQuantity('3 lemons')).toEqual({ amount: '3', unit: null, itemText: 'lemons' });
  });

  it('handles trailing and leading x-counts', () => {
    expect(parseQuantity('milk x2')).toEqual({ amount: '2', unit: 'x', itemText: 'milk' });
    expect(parseQuantity('2 x tins tomatoes')).toEqual({
      amount: '2',
      unit: 'x',
      itemText: 'tins tomatoes',
    });
  });

  it('returns no quantity for plain text', () => {
    expect(parseQuantity('bin bags')).toEqual({ amount: null, unit: null, itemText: 'bin bags' });
  });

  it('handles empty input', () => {
    expect(parseQuantity('   ')).toEqual({ amount: null, unit: null, itemText: '' });
  });
});

describe('formatQuantity', () => {
  it('renders tight metric units without a space', () => {
    expect(formatQuantity('200', 'ml')).toBe('200ml');
    expect(formatQuantity('2', 'kg')).toBe('2kg');
  });

  it('renders other units with a space', () => {
    expect(formatQuantity('4', 'pt')).toBe('4 pt');
    expect(formatQuantity('1/2', 'cup')).toBe('1/2 cup');
  });

  it('renders counts and x-counts', () => {
    expect(formatQuantity('3', null)).toBe('3');
    expect(formatQuantity('2', 'x')).toBe('x2');
  });

  it('returns null when there is no amount', () => {
    expect(formatQuantity(null, 'ml')).toBeNull();
  });
});
