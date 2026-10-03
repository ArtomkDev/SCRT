import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from 'react';

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement>; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon' }) {
  return <button type={type} className={`ui-button ui-button-${variant} ${className}`} {...props} />;
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ui-input ${className}`} {...props} />;
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`ui-input ui-textarea ${className}`} {...props} />;
}

export function Checkbox({ label, className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return <label className={`voice-check ${className}`}><input type="checkbox" {...props} /><span>{label}</span></label>;
}

export function Switch({ label, help, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> & { label: ReactNode; help?: string }) {
  return <label className="voice-switch"><span><strong>{label}</strong>{help && <small>{help}</small>}</span><input type="checkbox" role="switch" {...props} /></label>;
}
