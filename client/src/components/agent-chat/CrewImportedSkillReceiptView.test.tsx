import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CrewImportedSkillReceiptView } from './CrewImportedSkillReceiptView';
afterEach(cleanup);
it('shows failures and source provenance without claiming completed execution', () => {
  render(<CrewImportedSkillReceiptView receipt={{ type: 'crew_imported_skill_receipt', version: 1, selectionStatus: 'checked', entries: [{ reviewId: 8, augmentationId: 9, skillId: 4, name: 'Cashflow forecast', contractHash: 'abc', reviewedAt: null, requiredTools: ['forecast'], missingTools: [], status: 'tool_failure', calls: [{ name: 'forecast', ok: false }] }] }} />);
  expect(screen.getByText(/Tool failure/)).toBeTruthy();
  expect(screen.getByText('forecast: Failed')).toBeTruthy();
  expect(screen.getByText(/does not establish completion/)).toBeTruthy();
});
it('shows selection service failures separately from an empty skill catalog', () => {
  render(<CrewImportedSkillReceiptView receipt={{ type: 'crew_imported_skill_receipt', version: 1, selectionStatus: 'unavailable', entries: [] }} />);
  expect(screen.getByText(/does not mean no skills are available/)).toBeTruthy();
});
