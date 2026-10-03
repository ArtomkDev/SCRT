'use client';

import { useEffect, useId, useRef, useState } from 'react';

export type ResourceOption = { id: string; name: string };

export function ResourceMultiSelect({ name, label, options, defaultSelected, disabled = false }: { name: string; label: string; options: ResourceOption[]; defaultSelected: readonly string[]; disabled?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLDetailsElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState([...defaultSelected]);
  const [query, setQuery] = useState('');
  const id = useId();
  const byId = new Map(options.map((option) => [option.id, option.name]));
  // Keep every checkbox mounted so form snapshots and discard stay reliable.
  const all = [...options, ...defaultSelected.filter((value) => !byId.has(value)).map((value) => ({ id: value, name: 'Ресурс більше недоступний' }))];
  function sync() { setSelected(Array.from(root.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked') ?? []).map((control) => control.value)); }

  useEffect(() => {
    const form = root.current?.closest('form');
    form?.addEventListener('scrt:reset', sync);
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target) && picker.current) picker.current.open = false; };
    document.addEventListener('pointerdown', outside);
    return () => { form?.removeEventListener('scrt:reset', sync); document.removeEventListener('pointerdown', outside); };
  }, []);

  return <div ref={root} className="resource-multiselect">
    <span id={id} className="field-label">{label}</span>
    <div className="resource-chips" aria-labelledby={id}>{selected.map((value) => <span className="resource-chip" key={value} title={value}>{byId.get(value) ?? 'Ресурс більше недоступний'}{!disabled && <button type="button" aria-label={`Прибрати: ${byId.get(value) ?? value}`} onClick={() => Array.from(root.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? []).find((control) => control.value === value)?.click()}>×</button>}</span>)}{!selected.length && <span className="field-help">Нічого не вибрано.</span>}</div>
    <details ref={picker} className="resource-picker" onToggle={() => { if (picker.current?.open) search.current?.focus(); }} onKeyDown={(event) => { if (event.key === 'Escape' && picker.current) { event.preventDefault(); event.stopPropagation(); picker.current.open = false; picker.current.querySelector<HTMLElement>('summary')?.focus(); } }}>
      <summary aria-disabled={disabled} onClick={(event) => { if (disabled) event.preventDefault(); }}>+ Вибрати {label.toLocaleLowerCase('uk-UA')}</summary>
      <div className="resource-picker-menu"><input ref={search} className="ui-input" type="search" aria-label={`Пошук: ${label}`} placeholder="Пошук…" value={query} onChange={(event) => setQuery(event.target.value)} disabled={disabled} />
        <div className="resource-picker-options">{all.map((option) => <label className="voice-check" key={option.id} hidden={!option.name.toLocaleLowerCase('uk-UA').includes(query.toLocaleLowerCase('uk-UA'))}><input type="checkbox" name={name} value={option.id} defaultChecked={defaultSelected.includes(option.id)} disabled={disabled} onChange={sync} /><span>{option.name}</span></label>)}{!all.some((option) => option.name.toLocaleLowerCase('uk-UA').includes(query.toLocaleLowerCase('uk-UA'))) && <p className="empty-state">Нічого не знайдено.</p>}</div>
      </div>
    </details>
  </div>;
}
