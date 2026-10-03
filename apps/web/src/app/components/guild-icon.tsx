'use client';

import Image from 'next/image';
import { useState } from 'react';
import { guildIconUrl, guildInitials } from '@/lib/guild-presentation';

export function GuildIcon({ id, name, icon, size = 48 }: { id: string; name: string; icon: string | null; size?: number }) {
  const src = guildIconUrl(id, icon, 64);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return <span className="guild-icon" style={{ width: size, height: size }}>
    {src && src !== failedSrc ? <Image src={src} alt={`Іконка сервера ${name}`} width={size} height={size} unoptimized onError={() => setFailedSrc(src)} /> : <span aria-label={`Сервер ${name}`} role="img">{guildInitials(name)}</span>}
  </span>;
}
