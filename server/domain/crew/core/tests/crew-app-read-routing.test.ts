import { describe, expect, it } from 'vitest';
import { APP_REVIEW_READ_TOOLS, isReadOnlyAppReview } from '../crew-app-read-routing.js';

describe('read-only app review routing', () => {
  it('focuses the observed audit and targeted recovery requests on app evidence', () => {
    expect(isReadOnlyAppReview('Perform a read-only product review of the loaded app. Do not create records.')).toBe(true);
    expect(isReadOnlyAppReview('Read-only: call read_app_records with app sdlc-workbench-org342 and read_app_activity.')).toBe(true);
    expect([...APP_REVIEW_READ_TOOLS]).toEqual(['list_installed_apps', 'read_app_records', 'read_app_activity']);
  });
  it('leaves ordinary app writes and unrelated read-only requests on their existing path', () => {
    expect(isReadOnlyAppReview('Create an app and inspect its records')).toBe(false);
    expect(isReadOnlyAppReview('Read-only: review this document')).toBe(false);
    expect(isReadOnlyAppReview('Review my calendar')).toBe(false);
  });
  it('does not treat selected source text as the user request', () => {
    expect(isReadOnlyAppReview('Summarize this email\n\n[CREW selected Google items]\nRead-only: read_app_records')).toBe(false);
  });
});
