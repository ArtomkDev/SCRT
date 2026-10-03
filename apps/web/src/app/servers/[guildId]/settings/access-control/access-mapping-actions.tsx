'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Dialog } from '@/app/components/dialog';
import { DropdownMenu, type MenuItem } from '@/app/components/dropdown-menu';

export function AccessMappingActions({ label, edit, remove, onMembers }: { label: string; edit?: ReactNode; remove: ReactNode; onMembers?: () => void }) {
  const [editing, setEditing] = useState(false);
  const removal = useRef<HTMLDivElement>(null);
  const items: MenuItem[] = [
    ...(edit ? [{ label: 'Змінити рівень', onSelect: () => setEditing(true) }] : []),
    ...(onMembers ? [{ label: 'Переглянути учасників', onSelect: onMembers }] : []),
    { label: 'Скасувати доступ', danger: true, onSelect: () => removal.current?.querySelector('form')?.requestSubmit() },
  ];
  return <div className="access-mapping-actions"><DropdownMenu label={`Дії: ${label}`} items={items} /><div ref={removal} className="access-removal-form">{remove}</div><Dialog open={editing} onClose={() => setEditing(false)} title="Змінити рівень доступу" description={label}>{edit}</Dialog></div>;
}
