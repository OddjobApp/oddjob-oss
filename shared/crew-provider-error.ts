/** Display provider failures without exposing their transport payloads. */
export function crewProviderError(content: string) {
  if (!/(?:API error|model provider|configured model account|response could not be generated)/i.test(content)) return null;
  if (/credit balance.*too low|insufficient.*(?:credit|balance)|billing.*(?:limit|exhaust)|payment required/i.test(content)) {
    return { title: 'Model account needs credit', message: 'The response could not be generated because the configured model account has insufficient credit.', nextStep: 'Add credit to the provider account or choose another connected model in the agent settings.' };
  }
  if (/API error[^\n]*\{|"type"\s*:\s*"error"/i.test(content)) {
    return { title: 'Model request failed', message: 'The model provider rejected this request. No completed answer is available.', nextStep: 'Check the connected model settings and retry. Technical details are retained in the server logs.' };
  }
  if (/quota was exhausted/i.test(content)) return { title: 'Model usage limit reached', message: 'The connected model has reached its usage limit.', nextStep: 'Check the provider quota or choose another connected model, then retry.' };
  if (/rejected its credentials/i.test(content)) return { title: 'Model connection needs attention', message: 'The provider could not authenticate the configured model account.', nextStep: 'Update the model credentials in your organization settings, then retry.' };
  if (/provider was unreachable/i.test(content)) return { title: 'Model temporarily unavailable', message: 'CREW could not reach the connected model provider.', nextStep: 'Retry shortly or choose another connected model.' };
  return null;
}
