'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Select } from './select';

export function DurationInput({ name, label, defaultSeconds, min = 1, max = 86400, disabled = false, help }: { name: string; label: string; defaultSeconds: number; min?: number; max?: number; disabled?: boolean; help?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const visible = useRef<HTMLInputElement>(null);
  const id = useId();
  const initialUnit = defaultSeconds > 0 && defaultSeconds % 60 === 0 ? 60 : 1;
  const [unit, setUnit] = useState(initialUnit);
  const [amount, setAmount] = useState(String(defaultSeconds / initialUnit));
  const [touched, setTouched] = useState(false);
  const seconds = Math.round(Number(amount) * unit * 1_000_000) / 1_000_000;
  const invalid = amount === '' || !Number.isInteger(seconds) || seconds < min || seconds > max;
  const previous = useRef(seconds);
  useEffect(() => { visible.current?.setCustomValidity(invalid ? `Вкажіть від ${min} до ${max} цілих секунд.` : ''); }, [invalid, min, max]);

  useEffect(() => {
    const form = root.current?.closest('form');
    const reset = (event: Event) => {
      const value = Number((event as CustomEvent<FormData>).detail.get(name));
      const nextUnit = value > 0 && value % 60 === 0 ? 60 : 1;
      previous.current = value; setUnit(nextUnit); setAmount(String(value / nextUnit)); setTouched(false);
    };
    form?.addEventListener('scrt:reset', reset);
    return () => form?.removeEventListener('scrt:reset', reset);
  }, [name]);
  useEffect(() => {
    if (previous.current === seconds) return;
    previous.current = seconds;
    hidden.current?.dispatchEvent(new Event('input', { bubbles: true }));
  }, [seconds]);

  return <div ref={root} className="duration-field"><label htmlFor={id}>{label}</label><div className="duration-control">
    <input ref={visible} id={id} className="ui-input" type="number" min={min / unit} max={max / unit} step={unit === 1 ? 1 : 'any'} required value={amount} disabled={disabled} aria-invalid={touched && invalid || undefined} aria-describedby={help || touched && invalid ? `${id}-help` : undefined} onBlur={() => setTouched(true)} onInvalid={() => setTouched(true)} onChange={(event) => setAmount(event.target.value)} />
    <Select aria-label={`Одиниця часу: ${label}`} value={unit} disabled={disabled} onChange={(event) => { const next = Number(event.target.value); setAmount(String(seconds / next)); setUnit(next); }}><option value="1">сек</option><option value="60">хв</option></Select>
    <input ref={hidden} type="hidden" name={name} value={amount === '' ? '' : seconds} disabled={disabled} />
  </div>{touched && invalid ? <p id={`${id}-help`} className="field-error" role="alert">Вкажіть від {min} до {max} секунд.</p> : help && <p id={`${id}-help`} className="field-help">{help}</p>}</div>;
}
