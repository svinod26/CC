import { getServerAuthSession } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerAuthSession();
  if (!session) {
    redirect('/signin');
  }
  return <>{children}</>;
}
