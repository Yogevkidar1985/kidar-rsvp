import { EventProvider } from '@/components/admin/EventContext';
import Shell from '@/components/admin/Shell';
import { ToastProvider } from '@/components/admin/ui';

export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ToastProvider>
      <EventProvider id={id}><Shell>{children}</Shell></EventProvider>
    </ToastProvider>
  );
}
