import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'SCRT — керування серверами', description: 'Керування Discord-серверами' };
export default function RootLayout({ children }: { children: ReactNode }) { return <html lang="uk"><body suppressHydrationWarning>{children}</body></html>; }
