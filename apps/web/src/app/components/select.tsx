'use client';

import { Children, isValidElement, useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

type Option = { value: string; label: ReactNode; text: string; disabled: boolean };
type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { searchable?: boolean };

function readOptions(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return [];
    if (child.type !== 'option') return readOptions(child.props.children);
    const text = Children.toArray(child.props.children).join('');
    return [{ value: String(child.props.value ?? text), label: child.props.children, text, disabled: Boolean(child.props.disabled) }];
  });
}

// The native select is a form/validation bridge. The visible list is fully styled.
export function Select({ children, value, defaultValue = '', onChange, searchable = false, className = '', ...props }: SelectProps) {
  const options = readOptions(children);
  const [localValue, setLocalValue] = useState(String(defaultValue));
  const current = value === undefined ? localValue : String(value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 300 });
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ text: '', at: 0 });
  const id = useId();
  const selected = options.find((option) => option.value === current);
  const filtered = options.filter((option) => option.text.toLocaleLowerCase('uk-UA').includes(query.toLocaleLowerCase('uk-UA')));
  const label = props['aria-label'];

  function close(restore = true) { setOpen(false); if (restore) trigger.current?.focus(); }
  function choose(next: string) {
    const control = native.current;
    if (!control) return;
    control.value = next;
    control.dispatchEvent(new Event('change', { bubbles: true }));
    setInvalid(false);
    close();
  }
  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    setLocalValue(event.target.value);
    onChange?.(event);
  }

  useEffect(() => {
    const control = native.current;
    const form = control?.form;
    const reset = () => { if (control) { setLocalValue(control.value); setInvalid(false); setQuery(''); setOpen(false); } };
    form?.addEventListener('scrt:reset', reset);
    return () => form?.removeEventListener('scrt:reset', reset);
  }, []);

  useEffect(() => {
    if (!open) return;
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds) {
      const below = window.innerHeight - bounds.bottom - 12;
      const above = bounds.top - 12;
      const height = Math.min(320, Math.max(below, above));
      setPosition({ top: below >= Math.min(240, above) ? bounds.bottom + 6 : Math.max(8, bounds.top - height - 6), left: Math.max(8, Math.min(bounds.left, window.innerWidth - bounds.width - 8)), width: bounds.width, maxHeight: height });
    }
    if (searchable) search.current?.focus();
    else (menu.current?.querySelector<HTMLElement>('[aria-selected="true"]:not(:disabled)') ?? menu.current?.querySelector<HTMLElement>('[role="option"]:not(:disabled)'))?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const reposition = (event: Event) => { if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, [open, searchable]);

  function navigate(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { close(false); trigger.current?.focus(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target === search.current && ['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' || index < 0 && event.key === 'ArrowUp' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  return <span className={`ui-select ${className}`}>
    <button ref={trigger} id={props.id} type="button" className="ui-select-trigger" role="combobox" aria-label={label} aria-labelledby={props['aria-labelledby']} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="listbox" aria-required={props.required || undefined} aria-invalid={invalid || props['aria-invalid']} disabled={props.disabled} onClick={() => { setQuery(''); setOpen((previous) => !previous); }} onKeyDown={(event) => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setQuery(''); setOpen(true); }
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
        const now = Date.now();
        typeahead.current = { text: (now - typeahead.current.at < 600 ? typeahead.current.text : '') + event.key.toLocaleLowerCase('uk-UA'), at: now };
        const match = options.find((option) => !option.disabled && option.text.toLocaleLowerCase('uk-UA').startsWith(typeahead.current.text));
        if (match) choose(match.value);
      }
    }}><span>{selected?.label ?? 'Виберіть значення'}</span><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" /></svg></button>
    <select {...props} id={undefined} ref={native} className="visually-hidden ui-select-native" tabIndex={-1} aria-hidden="true" value={current} onChange={handleChange} onInvalid={(event) => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); }}>{children}</select>
    {invalid && <span className="field-error" role="alert">Виберіть значення.</span>}
    {open && createPortal(<div ref={menu} className="ui-select-popover" style={position} onKeyDown={navigate}>
      {searchable && <input ref={search} type="search" className="ui-input ui-select-search" aria-label={`Пошук: ${label ?? 'значення'}`} placeholder="Пошук…" value={query} onChange={(event) => setQuery(event.target.value)} />}
      <div id={id} role="listbox" aria-label={label} className="ui-select-options">{filtered.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === current} tabIndex={-1} disabled={option.disabled} onClick={() => choose(option.value)}>{option.label}{option.value === current && <span aria-hidden="true">✓</span>}</button>)}{!filtered.length && <p className="empty-state">Нічого не знайдено.</p>}</div>
    </div>, trigger.current?.closest('dialog') ?? document.body)}
  </span>;
}
