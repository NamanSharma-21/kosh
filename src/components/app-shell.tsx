'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { reviewQueue } from '@/lib/domain/selectors';
import { useData } from './data-context';
import { Flash } from './ui';
import { useVault } from './vault-context';

const LINKS = [
  ['/', 'Overview'],
  ['/transactions', 'Transactions'],
  ['/budgets', 'Budgets'],
  ['/bills', 'Bills'],
  ['/goals', 'Goals'],
  ['/accounts', 'Accounts'],
  ['/capture', 'Auto-capture'],
  ['/settings', 'Settings'],
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { lock, signOut } = useVault();
  const { data, loading, error } = useData();
  const review = reviewQueue(data.transactions).length;

  return (
    <div className="shell">
      <header className="top">
        <span className="brand">Kosh</span>
        <nav className="nav" aria-label="Main">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} aria-current={(href === '/' ? path === '/' : path.startsWith(href)) ? 'page' : undefined}>
              {label}
              {href === '/transactions' && review > 0 && <span className="badge">{review}</span>}
            </Link>
          ))}
        </nav>
        <div className="right-actions">
          <button className="ghost small" onClick={lock} title="Lock the vault on this device">Lock</button>
          <button className="ghost small" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main>
        {error && <Flash error={error} />}
        {loading ? <p className="sub">Decrypting your data…</p> : children}
      </main>
    </div>
  );
}
