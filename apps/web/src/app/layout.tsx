import type { ReactNode } from 'react';
import './globals.css';
import { isDevelopment } from '@/lib/application-environment';

export const metadata = { title: isDevelopment ? 'SCRT Control [DEV]' : 'SCRT Control', description: 'Керування Discord-серверами' };
export default function RootLayout({ children }: { children: ReactNode }) { return <html lang="uk"><body suppressHydrationWarning>{children}</body></html>; }
