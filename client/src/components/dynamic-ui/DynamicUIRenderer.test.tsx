import { describe, it, expect, vi } from 'vitest';
import { evaluateExpression } from './DynamicUIContext';

describe('evaluateExpression', () => {
  const mockState = {
    state: {
      userName: 'Alice',
      counter: 42,
      user: { role: 'admin' },
      items: ['apple', 'banana'],
    },
    queries: {
      fetchUsers: {
        data: [{ id: 1, name: 'Alice' }],
        isLoading: false,
        error: null,
      },
    },
  };

  it('evaluates exact string matches', () => {
    expect(evaluateExpression('{{state.userName}}', mockState)).toBe('Alice');
    expect(evaluateExpression('{{state.counter}}', mockState)).toBe(42);
    expect(evaluateExpression('{{state.user.role}}', mockState)).toBe('admin');
  });

  it('evaluates inline templates', () => {
    expect(evaluateExpression('Hello {{state.userName}}!', mockState)).toBe('Hello Alice!');
    expect(evaluateExpression('Count: {{state.counter}}', mockState)).toBe('Count: 42');
  });

  it('handles missing values gracefully', () => {
    expect(evaluateExpression('{{state.unknown}}', mockState)).toBeUndefined();
    expect(evaluateExpression('Hello {{state.unknown}}', mockState)).toBe('Hello ');
  });

  it('evaluates arrays', () => {
    const input = ['{{state.userName}}', '{{state.counter}}'];
    expect(evaluateExpression(input, mockState)).toEqual(['Alice', 42]);
  });

  it('evaluates nested objects', () => {
    const input = {
      name: '{{state.userName}}',
      meta: {
        role: '{{state.user.role}}',
        title: 'User Profile for {{state.userName}}',
      },
    };
    expect(evaluateExpression(input, mockState)).toEqual({
      name: 'Alice',
      meta: {
        role: 'admin',
        title: 'User Profile for Alice',
      },
    });
  });

  it('evaluates query data access', () => {
    expect(evaluateExpression('{{queries.fetchUsers.data.0.name}}', mockState)).toBe('Alice');
  });
});
