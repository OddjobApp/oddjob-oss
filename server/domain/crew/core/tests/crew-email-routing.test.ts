import { describe, expect, it } from 'vitest';
import { isEmailSendRequest, emailReadDirective, isNamedGmailRead, googleWorkspaceDirective } from '../crew-email-routing.js';
describe('Email reading and sending intent', () => {
  it('routes Google Calendar and Drive to their own tools', () => {
    expect(googleWorkspaceDirective('Show my Google Calendar')).toContain('gcal_list_events');
    expect(googleWorkspaceDirective('List Drive files')).toContain('gdrive_list_files');
    expect(googleWorkspaceDirective('Hello')).toBe('');
  });
  it('excludes AgentMail lookup tools for a named Gmail mailbox without blocking explicit AgentMail requests', () => {
    expect(isNamedGmailRead("List today's emails in admin@oddjob.app account")).toBe(true);
    expect(isNamedGmailRead('Read oddjobapp@agentmail.to inbox')).toBe(false);
    expect(isNamedGmailRead('Send an email to customer@example.com')).toBe(false);
  });
  it.each([
    "Can you list out today's emails in admin@oddjob.app account.",
    'Read the inbox for admin@oddjob.app',
    'Search emails from vendor@example.com',
    'Show my Gmail messages',
  ])('never treats mailbox lookup as permission to send: %s', message => {
    expect(isEmailSendRequest(message)).toBe(false);
    expect(emailReadDirective(message)).toContain('gmail_get_profile');
    expect(emailReadDirective(message)).toContain('Never substitute AgentMail');
  });
  it.each(['Send an email to customer@example.com', 'Email customer@example.com about the invoice'])('recognizes an explicit send: %s', message => {
    expect(isEmailSendRequest(message)).toBe(true);
    expect(emailReadDirective(message)).toBe('');
  });
});
