import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CalculationItemView } from './CalculationItemView';
afterEach(cleanup);
it('shows currency-separated executed totals and an expandable method', () => {
  render(<CalculationItemView item={{ id:'sum', kind:'accounting', title:'Calculation', calculation:{ operation:'SUM',entity:'Invoice',field:'Balance',filter:'Outstanding balances',matchedRecords:21,complete:true,totals:[{currency:'USD',value:'5281.52',count:20},{currency:'EUR',value:'10.00',count:1}] } }} />);
  expect(screen.getByText('$5,281.52')).toBeTruthy();
  expect(screen.getByText('€10.00')).toBeTruthy();
  expect(screen.queryByText(/SUM\(Invoice.Balance\)/)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Show calculation'}));
  expect(screen.getByText(/SUM\(Invoice.Balance\)/)).toBeTruthy();
  expect(screen.getByText(/Remaining amount owed/)).toBeTruthy();
});
