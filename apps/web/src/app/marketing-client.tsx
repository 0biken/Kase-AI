'use client';

import { FormEvent, useState } from 'react';

type IntakeKind = 'waitlist' | 'request' | 'security-report';

export function IntakeForm() {
  const [kind, setKind] = useState<IntakeKind>('waitlist');
  const [status, setStatus] = useState<string>('');
  const [isError, setIsError] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setStatus('');
    const form = new FormData(formElement);
    try {
      const response = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          name: form.get('name'),
          email: form.get('email'),
          company: form.get('company'),
          message: form.get('message'),
        }),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? 'Your request could not be sent.');
      formElement.reset();
      setStatus('Received. The Kase team will follow up shortly.');
      setIsError(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Your request could not be sent.');
      setIsError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="bezel" onSubmit={submit}>
      <div className="bezel-inner intake-form">
        <div className="form-grid">
          <div className="field full">
            <label htmlFor="kind">How can we help?</label>
            <select id="kind" value={kind} onChange={(event) => setKind(event.target.value as IntakeKind)}>
              <option value="waitlist">Join the waitlist</option>
              <option value="request">Request a product conversation</option>
              <option value="security-report">Report a security concern</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" autoComplete="name" required placeholder="Your name…" />
          </div>
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input id="email" name="email" type="email" autoComplete="email" spellCheck={false} required placeholder="you@company.com…" />
          </div>
          <div className="field full">
            <label htmlFor="company">Company</label>
            <input id="company" name="company" autoComplete="organization" placeholder="Company or team…" />
          </div>
          <div className="field full">
            <label htmlFor="message">Context</label>
            <textarea id="message" name="message" required placeholder={kind === 'security-report' ? 'Describe the concern. Do not include sensitive credentials…' : 'Tell us what you want Kase to help verify…'} />
          </div>
        </div>
        <div className="button-row">
          <button className="button button-primary" type="submit" disabled={pending}>
            {pending ? 'Sending request…' : kind === 'waitlist' ? 'Join waitlist' : 'Send request'}
            <span className="button-arrow" aria-hidden="true">↗</span>
          </button>
        </div>
        <p className={`form-note${isError ? ' error' : status ? ' success' : ''}`} aria-live="polite">{status}</p>
      </div>
    </form>
  );
}
