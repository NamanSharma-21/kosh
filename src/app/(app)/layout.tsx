import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { DataProvider } from '@/components/data-context';
import { VaultGate } from '@/components/vault-gate';
import { VaultProvider } from '@/components/vault-context';
import { createClient } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <VaultProvider userId={user.id} email={user.email ?? ''}>
      <VaultGate>
        <DataProvider>
          <AppShell>{children}</AppShell>
        </DataProvider>
      </VaultGate>
    </VaultProvider>
  );
}
