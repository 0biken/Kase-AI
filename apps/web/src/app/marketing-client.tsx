'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CheckCircle } from '@phosphor-icons/react';

type IntakeKind = 'waitlist' | 'request' | 'security-report';

const KINDS: Array<{ value: IntakeKind; label: string }> = [
  { value: 'waitlist', label: 'Waitlist' },
  { value: 'request', label: 'Product call' },
  { value: 'security-report', label: 'Security' },
];

const SUBMIT_LABEL: Record<IntakeKind, string> = {
  'waitlist': 'Join waitlist',
  'request': 'Request a call',
  'security-report': 'Send report',
};

const CONTEXT_PLACEHOLDER: Record<IntakeKind, string> = {
  'waitlist': 'What would you gate first? A web app, an API, a monorepo…',
  'request': 'What do you want Kase to help verify?',
  'security-report': 'Describe the issue and how to reproduce it. Do not include credentials.',
};

type Status = { state: 'idle' } | { state: 'error'; message: string } | { state: 'sent'; kind: IntakeKind };

/**
 * Intake form. The waitlist is the default and only needs name and email;
 * the same endpoint (/api/intake) also takes product-call requests and
 * security reports, which require context.
 */
export function WaitlistForm() {
  const [kind, setKind] = useState<IntakeKind>('waitlist');
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [pending, setPending] = useState(false);
  const contextRequired = kind !== 'waitlist';
  const doneHeading = useRef<HTMLHeadingElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const returning = useRef(false);

  // The form unmounts on success, which would drop keyboard focus to <body>.
  // Move it into the confirmation, and back to the first field on "Send another".
  useEffect(() => {
    if (status.state === 'sent') doneHeading.current?.focus();
    else if (returning.current) {
      returning.current = false;
      nameInput.current?.focus();
    }
  }, [status.state]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setStatus({ state: 'idle' });
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
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? 'Your request could not be sent.');
      formElement.reset();
      setStatus({ state: 'sent', kind });
    } catch (error) {
      setStatus({ state: 'error', message: error instanceof Error ? error.message : 'Your request could not be sent.' });
    } finally {
      setPending(false);
    }
  }

  if (status.state === 'sent') {
    return (
      <div className="wl-card wl-done" role="status">
        <CheckCircle size={28} weight="regular" className="wl-done-icon" aria-hidden="true" />
        <h3 ref={doneHeading} tabIndex={-1}>{status.kind === 'waitlist' ? 'You are on the list.' : 'Received.'}</h3>
        <p>
          {status.kind === 'waitlist'
            ? 'We will email you when a place opens.'
            : 'The Kase team will follow up by email.'}
        </p>
        <button className="button" type="button" onClick={() => { returning.current = true; setStatus({ state: 'idle' }); }}>Send another</button>
      </div>
    );
  }

  return (
    <form className="wl-card" onSubmit={submit} noValidate={false}>
      <fieldset className="wl-kinds">
        <legend className="wl-legend">Request type</legend>
        {KINDS.map((k) => (
          <label key={k.value} className={`wl-kind${kind === k.value ? ' is-active' : ''}`}>
            <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} />
            {k.label}
          </label>
        ))}
      </fieldset>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="name">Name</label>
          <input ref={nameInput} id="name" name="name" autoComplete="name" required />
        </div>
        <div className="field">
          <label htmlFor="email">Work email</label>
          <input id="email" name="email" type="email" autoComplete="email" spellCheck={false} required />
        </div>
        <div className="field full">
          <label htmlFor="company">Company <span className="field-optional">optional</span></label>
          <input id="company" name="company" autoComplete="organization" />
        </div>
        <div className="field full">
          <label htmlFor="message">
            Context {contextRequired ? null : <span className="field-optional">optional</span>}
          </label>
          <textarea id="message" name="message" required={contextRequired} rows={4} placeholder={CONTEXT_PLACEHOLDER[kind]} />
        </div>
      </div>

      <div className="wl-submit">
        <button className="button button-primary" type="submit" disabled={pending}>
          {pending ? 'Sending…' : SUBMIT_LABEL[kind]}
          <span className="button-arrow" aria-hidden="true"><ArrowUpRight size={14} weight="bold" /></span>
        </button>
      </div>
      <p className={`form-note${status.state === 'error' ? ' error' : ''}`} role={status.state === 'error' ? 'alert' : undefined} aria-live="polite">
        {status.state === 'error' ? status.message : ''}
      </p>
    </form>
  );
}
