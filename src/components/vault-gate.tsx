'use client';

import { useState, type ReactNode } from 'react';
import { MIN_PASSPHRASE_LENGTH } from '@/lib/crypto/vault';
import { Flash } from './ui';
import { useVault } from './vault-context';

function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="lock-screen">
      <div className="card stack">{children}</div>
    </main>
  );
}

function Setup({ onKey }: { onKey: (key: string) => void }) {
  const { setup, signOut } = useVault();
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (pass.length < MIN_PASSPHRASE_LENGTH) return setError(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    if (pass !== confirm) return setError('The two passphrases do not match.');
    setBusy(true);
    try {
      onKey(await setup(pass));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <h1>Create your vault</h1>
      <p className="sub">
        Choose a passphrase that encrypts everything on this device before it is uploaded. It is never sent to the server and
        cannot be recovered without your recovery key.
      </p>
      <form className="stack" onSubmit={submit}>
        <Flash error={error} />
        <label className="field">
          <span>Vault passphrase</span>
          <input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
        </label>
        <label className="field">
          <span>Confirm passphrase</span>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <p className="sub">A few random words work well, e.g. “lantern maple orbit cactus”.</p>
        <button disabled={busy}>{busy ? 'Creating vault… (takes a few seconds)' : 'Create vault'}</button>
        <button type="button" className="ghost" onClick={signOut}>Sign out</button>
      </form>
    </Screen>
  );
}

function RecoveryScreen({ recoveryKey, onDone }: { recoveryKey: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <Screen>
      <h1>Save your recovery key</h1>
      <p className="sub">
        This is the <strong>only</strong> way back in if you forget your passphrase. Kosh cannot reset it for you, because
        your data is encrypted on your device.
      </p>
      <div className="recovery">{recoveryKey}</div>
      <div className="form-row">
        <button type="button" className="ghost small" onClick={() => navigator.clipboard?.writeText(recoveryKey)}>
          Copy
        </button>
        <button type="button" className="ghost small" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <p className="notice">Store it in a password manager or on paper. Anyone with this key and your account login can read your data.</p>
      <label className="check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I have saved my recovery key somewhere safe
      </label>
      <button disabled={!saved} onClick={onDone}>
        Continue
      </button>
    </Screen>
  );
}

function Unlock() {
  const { unlock, unlockWithRecovery, signOut, email } = useVault();
  const [mode, setMode] = useState<'pass' | 'recovery'>('pass');
  const [pass, setPass] = useState('');
  const [recovery, setRecovery] = useState('');
  const [newPass, setNewPass] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (mode === 'recovery' && newPass.length < MIN_PASSPHRASE_LENGTH) {
      return setError(`New passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    }
    setBusy(true);
    try {
      if (mode === 'pass') await unlock(pass, remember);
      else await unlockWithRecovery(recovery, newPass, remember);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <Screen>
      <h1>Unlock your vault</h1>
      <p className="sub">Signed in as {email}. Your data stays encrypted until you unlock it here.</p>
      <form className="stack" onSubmit={submit}>
        <Flash error={error} />
        {mode === 'pass' ? (
          <label className="field">
            <span>Vault passphrase</span>
            <input type="password" autoFocus autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </label>
        ) : (
          <>
            <label className="field">
              <span>Recovery key</span>
              <input value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="XXXX-XXXX-XXXX-…" autoComplete="off" />
            </label>
            <label className="field">
              <span>New vault passphrase</span>
              <input type="password" autoComplete="new-password" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
            </label>
          </>
        )}
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep unlocked on this device (only on a device you trust)
        </label>
        <button disabled={busy}>{busy ? 'Unlocking… (takes a few seconds)' : 'Unlock'}</button>
        <button type="button" className="ghost" onClick={() => { setMode(mode === 'pass' ? 'recovery' : 'pass'); setError(undefined); }}>
          {mode === 'pass' ? 'Forgot passphrase? Use recovery key' : 'Back to passphrase'}
        </button>
        <button type="button" className="ghost" onClick={signOut}>Sign out</button>
      </form>
    </Screen>
  );
}

export function VaultGate({ children }: { children: ReactNode }) {
  const { status, error } = useVault();
  // Held here (not in Setup) because creating the vault flips status to "unlocked",
  // which unmounts Setup before the user has saved their recovery key.
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  if (recoveryKey) return <RecoveryScreen recoveryKey={recoveryKey} onDone={() => setRecoveryKey(null)} />;
  if (status === 'loading') return <Screen><p className="sub">Loading…</p></Screen>;
  if (status === 'error') return <Screen><Flash error={error ?? 'Something went wrong.'} /></Screen>;
  if (status === 'needs-setup') return <Setup onKey={setRecoveryKey} />;
  if (status === 'locked') return <Unlock />;
  return <>{children}</>;
}
