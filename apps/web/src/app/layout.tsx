import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'SCRT Control', description: 'Private Discord server control' };
export default function RootLayout({ children }: { children: ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
