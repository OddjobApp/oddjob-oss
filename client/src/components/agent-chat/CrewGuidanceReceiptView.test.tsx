import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CrewGuidanceReceiptView } from './CrewGuidanceReceiptView';
afterEach(cleanup);
it('labels prompt provenance without claiming the skill or a tool ran', () => {
  render(<CrewGuidanceReceiptView receipt={{ type: 'crew_guidance_receipt', version: 1, status: 'loaded_into_prompt', entries: [{ id: 'financial', label: 'Financial calculation', version: 1, contentHash: 'abc123', reason: 'Financial request' }] }} />);
  expect(screen.getByText('Guidance loaded · 1 procedures')).toBeTruthy();
  expect(screen.getByText(/does not establish tool execution/)).toBeTruthy();
  expect(screen.getByText('Financial calculation')).toBeTruthy();
});
