'use client';

import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useUnsavedChanges } from './unsaved-changes';

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type FieldState = { control: Control; value: string; checked?: boolean };
function snapshot(form: HTMLFormElement): FieldState[] {
  return Array.from(form.elements).filter((element): element is Control => element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)
    .filter((control) => !['submit', 'button', 'reset'].includes(control.type))
    .map((control) => ({ control, value: control.value, ...('checked' in control ? { checked: control.checked } : {}) }));
}
function changed(baseline: FieldState[], current: FieldState[]) {
  return baseline.length !== current.length || baseline.some((field, index) => field.control !== current[index]?.control || field.value !== current[index]?.value || field.checked !== current[index]?.checked);
}

type ActionFormProps = {
  action: (form: FormData) => Promise<void>;
  children: ReactNode;
  className?: string;
  successMessage?: string;
  feedbackPlacement?: 'inline' | 'toast';
  trackChanges?: boolean;
  confirmation?: { title: string; description: string; actionLabel: string };
};

export function ActionForm({ action, children, className, successMessage = 'Зміни збережено.', feedbackPlacement = 'inline', trackChanges = true, confirmation }: ActionFormProps) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const pendingData = useRef<FormData | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const baseline = useRef<FieldState[]>([]);
  const { setDirty } = useUnsavedChanges();

  useEffect(() => {
    mounted.current = true;
    if (trackChanges && formRef.current) baseline.current = snapshot(formRef.current);
    return () => { mounted.current = false; setDirty(formId, null); };
  }, [formId, setDirty, trackChanges]);

  useEffect(() => {
    if (feedbackPlacement !== 'toast' || feedback?.kind !== 'success') return;
    const timer = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback, feedbackPlacement]);

  function discard() {
    for (const field of baseline.current) {
      field.control.value = field.value;
      if (field.checked !== undefined && field.control instanceof HTMLInputElement) field.control.checked = field.checked;
    }
    setDirty(formId, null);
    setFeedback(null);
  }

  function updateDirty() {
    const form = formRef.current;
    if (!form) return;
    setFeedback(null);
    if (trackChanges) setDirty(formId, changed(baseline.current, snapshot(form)) ? { save: () => form.requestSubmit(), discard } : null);
  }

  function submit(data: FormData) {
    if (submitting.current || pending) return;
    submitting.current = true;
    const sentFields = trackChanges && formRef.current ? snapshot(formRef.current) : [];
    setFeedback(null);
    startTransition(async () => {
      try {
        await action(data);
        if (!mounted.current) return;
        baseline.current = sentFields;
        updateDirty();
        setFeedback({ kind: 'success', text: successMessage });
      } catch {
        if (mounted.current) setFeedback({ kind: 'error', text: 'Не вдалося зберегти зміни. Спробуйте ще раз.' });
      } finally {
        submitting.current = false;
      }
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || pending) return;
    const data = new FormData(event.currentTarget);
    if (confirmation) {
      pendingData.current = data;
      dialog.current?.showModal();
      return;
    }
    submit(data);
  }

  function confirm() {
    const data = pendingData.current;
    pendingData.current = null;
    dialog.current?.close();
    if (data) submit(data);
  }

  return <form ref={formRef} className={className} onSubmit={handleSubmit} onChange={updateDirty} onInput={updateDirty} aria-busy={pending}>
    {children}
    {confirmation && <dialog ref={dialog} className="confirm-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onClose={() => { pendingData.current = null; }}>
      <h2 id={titleId}>{confirmation.title}</h2>
      <p id={descriptionId}>{confirmation.description}</p>
      <div className="confirm-actions"><button type="button" onClick={() => dialog.current?.close()}>Скасувати</button><button type="button" className="danger-button" onClick={confirm}>{confirmation.actionLabel}</button></div>
    </dialog>}
    {pending && !feedback && <p className={`form-feedback${feedbackPlacement === 'toast' ? ' form-feedback-toast' : ''}`} role="status">Збереження…</p>}
    {feedback && <p className={`form-feedback form-feedback-${feedback.kind}${feedbackPlacement === 'toast' ? ' form-feedback-toast' : ''}`} role={feedback.kind === 'error' ? 'alert' : 'status'}><span>{feedback.text}</span>{feedbackPlacement === 'toast' && <button type="button" className="form-feedback-dismiss" onClick={() => setFeedback(null)} aria-label="Закрити повідомлення">×</button>}</p>}
  </form>;
}
