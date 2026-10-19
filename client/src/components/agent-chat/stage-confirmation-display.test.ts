import { describe, expect, it } from 'vitest';
import { stageConfirmationDisplay } from './stage-confirmation-display';

describe('stage confirmation display', () => {
  it('summarizes old stored confirmations without configuration or tracing data', () => {
    const message = 'I confirmed stage "stage-intake" with configuration: ' + JSON.stringify({
      selectedPacks: ['core-node-express', 'auth-jwt', 'data-postgres-drizzle', 'ui-oddjob-design-system'],
      _trace: { traceparent: 'internal-trace' }, metrics: { totalRamMb: 85 },
    });
    expect(stageConfirmationDisplay(message)).toBe('Confirmed architecture with 4 selected packs.');
  });
  it('leaves ordinary messages and malformed JSON untouched', () => {
    expect(stageConfirmationDisplay('Please explain {"inputs": "data"}')).toBeNull();
    expect(stageConfirmationDisplay('I confirmed stage "intake" with configuration: {broken')).toBeNull();
  });
  it('handles other stage submissions without exposing their payload', () => {
    expect(stageConfirmationDisplay('I confirmed stage "review" with configuration: {"approved":true}'))
      .toBe('Confirmed stage configuration.');
  });
  it('reads a completed stage the same way as a confirmed one', () => {
    expect(stageConfirmationDisplay('I completed stage "build" with configuration: {"selectedPackIds":["a"]}'))
      .toBe('Completed architecture with 1 selected pack.');
    expect(stageConfirmationDisplay('I completed stage "review" with configuration: {"ok":true}')).toBe('Completed stage configuration.');
  });
  it('summarizes a form submission as its fields, never its JSON', () => {
    const shown = stageConfirmationDisplay('I submitted the "New customer" form with: ' + JSON.stringify({
      display_name: 'Acme Ltd', email: 'ap@acme.io', tags: ['vip', 'net30'], address: { city: 'X' }, _trace: 't',
    }));
    expect(shown).toBe('Submitted “New customer”: Display name: Acme Ltd · Email: ap@acme.io · Tags: vip, net30');
    expect(shown).not.toContain('{');
  });
  it('handles the draft form variant with an instruction after the JSON', () => {
    const message = 'I submitted the "Email draft" with: {"to":"dana@northwind.io","subject":"Hi {there}","body":"x","body_format":"markdown"}. Prepare the proposed action for my review; do not send without approval.';
    expect(stageConfirmationDisplay(message)).toBe('Submitted “Email draft”: To: dana@northwind.io · Subject: Hi {there} · Body: x');
  });
  it('caps long values and many fields', () => {
    const shown = stageConfirmationDisplay('I submitted the "Big" form with: ' + JSON.stringify({ a: 'x'.repeat(100), b: 1, c: 2, d: 3, e: 4, f: 5 }))!;
    expect(shown).toContain('A: ' + 'x'.repeat(59) + '…');
    expect(shown.endsWith('+2 more')).toBe(true);
  });
  it('shows a playbook intake as its label and direction', () => {
    const message = [
      '[DIVERSE PRIMITIVE INTAKE: CUSTOMER ONBOARDING]',
      '• Direction (D): Onboard Acme with SSO',
      '• Intent (I): x',
      '• Variables & Inputs (V): {"a":1}',
    ].join('\n');
    expect(stageConfirmationDisplay(message)).toBe('Started Customer onboarding setup: Onboard Acme with SSO');
  });
  it('leaves a form message with broken JSON as written', () => {
    expect(stageConfirmationDisplay('I submitted the "X" form with: {nope')).toBeNull();
  });
});
