'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Flash } from './ui';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [ok, setOk] = useState<string>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setOk(undefined);
    if (mode === 'signup' && password.length < 10) return setError('Use at least 10 characters for your password.');
    setBusy(true);
    const supabase = createClient();
    if (mode === 'login') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) {
        setBusy(false);
        return setError('Incorrect email or password.');
      }
      window.location.href = '/';
    } else {
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      setBusy(false);
      if (err) return setError(err.message);
      if (data.session) window.location.href = '/';
      else setOk('Check your email to confirm your account, then sign in.');
    }
  }

  return (
    <main className="login">
      <div className="card">
        <div className="brand">Kosh</div>
        <p className="sub">{mode === 'login' ? 'Sign in to your private ledger.' : 'Create your private ledger.'}</p>
        <form className="stack" onSubmit={submit}>
          <Flash error={error} ok={ok} />
          <label className="field">
            <span>Email</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Account password</span>
            <input
              type="password"
              required
              minLength={mode === 'signup' ? 10 : undefined}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
          {mode === 'signup' && (
            <p className="sub">
              Next you will choose a separate <strong>vault passphrase</strong>. It encrypts your data on your device, so
              nobody else, including the server, can read it.
            </p>
          )}
          <p className="sub">
            {mode === 'login' ? (
              <>New here? <Link href="/signup">Create an account</Link></>
            ) : (
              <>Already have an account? <Link href="/login">Sign in</Link></>
            )}
          </p>
        </form>
      </div>
    </main>
  );
}
