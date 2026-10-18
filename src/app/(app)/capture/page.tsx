'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '@/components/data-context';
import { Flash } from '@/components/ui';
import { useVault } from '@/components/vault-context';
import { randomBytes, sha256Hex, toB64 } from '@/lib/crypto/base64';
import { createClient } from '@/lib/supabase/client';

interface Token {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const SAMPLE = 'Sent Rs.1.00 From HDFC Bank A/C *0000 To TEST MERCHANT On 01/01/25 Ref 000000000001';

export default function Capture() {
  const supabase = useMemo(() => createClient(), []);
  const { userId } = useVault();
  const { data, refreshInbox } = useData();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [origin, setOrigin] = useState('');

  const load = useCallback(async () => {
    const { data: rows } = await supabase
      .from('ingest_tokens')
      .select('id,label,created_at,last_used_at,revoked_at')
      .order('created_at', { ascending: false });
    setTokens((rows as Token[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, [load]);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const label = String(new FormData(e.currentTarget).get('label')).trim() || 'Phone';
    setMsg({});
    const token = `kosh_${toB64(randomBytes(32))}`;
    const { error } = await supabase
      .from('ingest_tokens')
      .insert({ user_id: userId, label, token_hash: await sha256Hex(token) });
    if (error) return setMsg({ error: 'Could not create the token.' });
    setFresh(token);
    void load();
  }

  async function revoke(id: string) {
    await supabase.from('ingest_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', id);
    void load();
  }

  async function sendTest() {
    if (!fresh) return;
    setMsg({});
    const res = await fetch('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fresh}` },
      body: JSON.stringify({ text: SAMPLE }),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: string };
    if (!res.ok) return setMsg({ error: `Webhook said: ${body.status ?? res.status}` });
    const n = await refreshInbox();
    setMsg({ ok: n ? `Test payment received and imported (${body.status}).` : `Webhook accepted it (${body.status}). Add an account if you haven't — events wait until you have one.` });
  }

  const url = `${origin}/api/ingest`;
  const active = tokens.filter((t) => !t.revoked_at);

  return (
    <div className="stack">
      <div className="page-head"><h1>Auto-capture UPI payments</h1></div>
      <Flash {...msg} />

      <section className="card stack">
        <h2>How it works</h2>
        <p className="sub">
          UPI apps don’t offer a personal API, but every payment sends you a bank SMS or app notification. A small forwarder
          app on your Android phone posts that message to your private Kosh webhook. The server reads the amount and
          merchant, <strong>immediately encrypts the result so only your unlocked vault can open it</strong>, and discards the
          text. Your browser then decrypts, de-duplicates and auto-categorises it.
        </p>
        <p className="notice">
          Be aware: the webhook briefly sees the message text in memory while parsing it, before encrypting. It is not logged
          or stored in the clear. If that is not acceptable, use statement import on the Transactions page instead.
        </p>
      </section>

      <section className="card stack">
        <h2>1 · Create a token for your phone</h2>
        <form className="form-row" onSubmit={create}>
          <label className="field"><span>Label</span><input name="label" maxLength={60} placeholder="My Android" /></label>
          <button>Create token</button>
        </form>
        {fresh && (
          <div className="stack">
            <p className="notice">Copy this token now. It is shown once and only a hash is stored.</p>
            <div className="recovery">{fresh}</div>
            <div className="form-row">
              <button className="ghost small" onClick={() => navigator.clipboard?.writeText(fresh)}>Copy token</button>
              <button className="small" onClick={sendTest} disabled={data.accounts.length === 0}>Send a test payment</button>
            </div>
            {data.accounts.length === 0 && <p className="sub">Add an account first to enable the test.</p>}
          </div>
        )}
        {active.length > 0 && (
          <ul className="rows">
            {active.map((t) => (
              <li key={t.id}>
                <span>{t.label} <span className="muted">· {t.last_used_at ? `last used ${new Date(t.last_used_at).toLocaleString()}` : 'never used'}</span></span>
                <button className="danger small" onClick={() => revoke(t.id)}>Revoke</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack">
        <h2>2 · Set up the forwarder (Android)</h2>
        <ol className="steps">
          <li>Install an SMS-forwarding app that can send an HTTP POST (for example “SMS Forwarder”, “HTTP SMS”, or MacroDroid/Tasker).</li>
          <li>Create a rule: when an SMS arrives from your bank’s sender (e.g. contains “UPI” or “debited”), send a webhook.</li>
          <li>URL: <span className="mono">{url}</span> · Method: POST · Header <span className="mono">Authorization: Bearer &lt;your token&gt;</span> · Header <span className="mono">Content-Type: application/json</span></li>
          <li>Body: <span className="mono">{`{"text": "<the SMS body placeholder your app provides>"}`}</span></li>
          <li>For GPay / PhonePe / Paytm, also forward their payment notifications if your app supports notification forwarding.</li>
          <li>Add each bank account’s last 4 digits on the Accounts page so payments land in the right account.</li>
        </ol>
        <p className="sub">Forward only transaction messages. OTPs and “failed” messages are dropped automatically and never stored.</p>
      </section>

      <section className="card stack">
        <h2>Testing from a terminal</h2>
        <div className="recovery" style={{ fontSize: '0.85rem' }}>{`curl -X POST ${url} \\\n  -H "Authorization: Bearer YOUR_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"text":"Paid ₹120 to Chai Point using UPI"}'`}</div>
      </section>
    </div>
  );
}
