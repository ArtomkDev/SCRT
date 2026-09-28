import { NextResponse } from 'next/server';
import { appUrl } from '@/lib/server';
import { clearSession } from '@/lib/session';

export async function POST() { await clearSession(); return NextResponse.redirect(appUrl(), 303); }
