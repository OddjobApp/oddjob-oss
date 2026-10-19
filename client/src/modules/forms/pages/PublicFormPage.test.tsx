import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../StudioRenderer', () => ({
  StudioRenderer: ({ definition, onSubmit }: any) => (
    <div data-testid="renderer" data-fields={definition.fields.length}>
      <button onClick={() => void onSubmit({ mood: 4 }).then((r: any) => { (window as any).__results = r; }, (e: Error) => { (window as any).__error = e.message; })}>Submit answers</button>
    </div>
  ),
}));

import PublicFormPage from './PublicFormPage';

const token = 'a'.repeat(48);
const form = { name: 'Pulse survey', revision: 2, releaseNumber: 1, requireOtp: true, schema: { fields: [{ key: 'mood' }], studio: {} } };
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  (globalThis as any).fetch = fetchMock;
  window.sessionStorage.clear();
  delete (window as any).__results;
  delete (window as any).__error;
});

afterEach(cleanup);

describe('PublicFormPage', () => {
  it('asks for an email and a code, then opens the form with the session', async () => {
    fetchMock
      .mockReturnValueOnce(json(401, { status: 'otp_required', name: 'Pulse survey' }))
      .mockReturnValueOnce(json(200, { status: 'sent' }))
      .mockReturnValueOnce(json(200, { session: 'signed-session' }))
      .mockReturnValueOnce(json(200, form))
      .mockReturnValueOnce(json(201, { id: 9, results: [{ id: 'mood', title: 'Mood' }] }));

    render(<PublicFormPage params={{ token }} />);

    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'sam@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Send code/ }));
    fireEvent.change(await screen.findByLabelText('Code'), { target: { value: '123456' } });
    expect(screen.getByText('We sent a 6-digit code to sam@example.com. It works for 10 minutes.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open the form' }));

    expect(await screen.findByTestId('renderer')).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ email: 'sam@example.com', code: '123456' });
    expect(fetchMock.mock.calls[3][1].headers['x-form-session']).toBe('signed-session');

    fireEvent.click(screen.getByText('Submit answers'));
    await waitFor(() => expect((window as any).__results).toEqual({ results: [{ id: 'mood', title: 'Mood' }] }));
    expect(fetchMock.mock.calls[4][0]).toBe(`/api/form-studio/public/${token}`);
    expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({ revision: 2, inputs: { mood: 4 } });
    expect(fetchMock.mock.calls[4][1].headers['x-form-session']).toBe('signed-session');
  });

  it('opens a form that asks for no code straight away', async () => {
    fetchMock.mockReturnValueOnce(json(200, { ...form, requireOtp: false }));
    render(<PublicFormPage params={{ token }} />);
    expect(await screen.findByTestId('renderer')).toBeInTheDocument();
    expect(screen.getByText('Pulse survey')).toBeInTheDocument();
  });

  it('says a link expired, in the words the server used', async () => {
    fetchMock.mockReturnValueOnce(json(410, { success: false, error: { code: 'LINK_EXPIRED', message: 'This form link has expired. Ask the person who shared it for a new one.' } }));
    render(<PublicFormPage params={{ token }} />);
    expect(await screen.findByText('This form link has expired. Ask the person who shared it for a new one.')).toBeInTheDocument();
  });

  it('says a newer version was published instead of losing the answers silently', async () => {
    fetchMock.mockReturnValueOnce(json(200, { ...form, requireOtp: false })).mockReturnValueOnce(json(409, { message: 'stale' }));
    render(<PublicFormPage params={{ token }} />);
    fireEvent.click(await screen.findByText('Submit answers'));
    await waitFor(() => expect((window as any).__error).toBe('A new version of this form was published. Reload the page to answer the current version.'));
  });
});
