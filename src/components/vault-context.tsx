'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  changePassphrase as changePass,
  createVault,
  resetPassphraseWithRecoveryKey,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  type KeyBundle,
  type Unlocked,
} from '@/lib/crypto/vault';
import { clearDeviceKeys, loadDeviceKeys, saveDeviceKeys } from '@/lib/crypto/device';

type Status = 'loading' | 'needs-setup' | 'locked' | 'unlocked' | 'error';

interface VaultApi {
  status: Status;
  userId: string;
  email: string;
  keys: Unlocked | null;
  error: string | null;
  setup(passphrase: string): Promise<string>;
  unlock(passphrase: string, remember: boolean): Promise<void>;
  unlockWithRecovery(recoveryKey: string, newPassphrase: string, remember: boolean): Promise<void>;
  changePassphrase(oldPass: string, newPass: string): Promise<void>;
  lock(): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<VaultApi | null>(null);
export const useVault = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVault outside VaultProvider');
  return v;
};

export function VaultProvider({ userId, email, children }: { userId: string; email: string; children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<Status>('loading');
  const [bundle, setBundle] = useState<KeyBundle | null>(null);
  const [keys, setKeys] = useState<Unlocked | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error: err } = await supabase.from('user_keys').select('*').eq('user_id', userId).maybeSingle();
      if (!live) return;
      if (err) {
        setError('Could not reach the server. Check your connection and reload.');
        return setStatus('error');
      }
      if (!data) return setStatus('needs-setup');
      setBundle(data as KeyBundle);
      const remembered = await loadDeviceKeys(userId);
      if (!live) return;
      if (remembered) {
        setKeys(remembered);
        setStatus('unlocked');
      } else setStatus('locked');
    })();
    return () => {
      live = false;
    };
  }, [supabase, userId]);

  const persist = useCallback(
    async (next: KeyBundle) => {
      const { error: err } = await supabase.from('user_keys').update({
        kdf: next.kdf,
        wrapped_dk: next.wrapped_dk,
      }).eq('user_id', userId);
      if (err) throw new Error('Could not save your new passphrase. Nothing was changed.');
      setBundle(next);
    },
    [supabase, userId],
  );

  const api: VaultApi = {
    status,
    userId,
    email,
    keys,
    error,

    async setup(passphrase) {
      const { bundle: b, recoveryKey, unlocked } = await createVault(userId, passphrase);
      const { error: err } = await supabase.from('user_keys').insert({ user_id: userId, ...b });
      if (err) throw new Error('Could not save your vault. Please try again.');
      setBundle(b);
      setKeys(unlocked);
      setStatus('unlocked');
      return recoveryKey;
    },

    async unlock(passphrase, remember) {
      if (!bundle) throw new Error('No vault found.');
      const u = await unlockWithPassphrase(bundle, userId, passphrase);
      if (remember) await saveDeviceKeys(userId, u);
      setKeys(u);
      setStatus('unlocked');
    },

    async unlockWithRecovery(recoveryKey, newPassphrase, remember) {
      if (!bundle) throw new Error('No vault found.');
      const u = await unlockWithRecoveryKey(bundle, userId, recoveryKey);
      await persist(await resetPassphraseWithRecoveryKey(bundle, userId, recoveryKey, newPassphrase));
      if (remember) await saveDeviceKeys(userId, u);
      setKeys(u);
      setStatus('unlocked');
    },

    async changePassphrase(oldPass, newPass) {
      if (!bundle) throw new Error('No vault found.');
      await persist(await changePass(bundle, userId, oldPass, newPass));
    },

    async lock() {
      await clearDeviceKeys(userId);
      setKeys(null);
      setStatus('locked');
    },

    async signOut() {
      await clearDeviceKeys();
      setKeys(null);
      await supabase.auth.signOut();
      window.location.href = '/login';
    },
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
