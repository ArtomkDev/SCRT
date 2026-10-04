'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { renderVoiceRoomName, voiceNameVariables } from '@scrt/validation/voice-name';

const example = {
  username: 'artom', displayName: 'Артем', userId: '123456789012345678',
  accountCreatedAt: Date.UTC(2021, 3, 12), serverJoinedAt: Date.UTC(2024, 8, 5),
  highestRole: 'Учасник', hoistRole: 'Учасник', serverName: 'SCRT', serverId: '223456789012345678',
  creatorName: 'Створити кімнату', creatorId: '323456789012345678', categoryName: 'Голосові',
  privacy: 'open' as const, counter: 2,
};

export function VoiceNameEditor({ defaultValue }: { defaultValue: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const [template, setTemplate] = useState(defaultValue);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    function resetPreview() {
      setTemplate(input.current?.value ?? defaultValue);
      setNotice('');
      if (menu.current) menu.current.open = false;
    }
    form.addEventListener('scrt:reset', resetPreview);
    return () => form.removeEventListener('scrt:reset', resetPreview);
  }, [defaultValue]);
  let preview: string;
  try { preview = renderVoiceRoomName(template, example); }
  catch { preview = 'Перевірте змінні та довжину назви (до 100 символів).'; }

  function insert(token: string) {
    const field = input.current;
    if (!field) return;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    field.setRangeText(`{${token}}`, start, end, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    setTemplate(field.value);
    menu.current!.open = false;
    field.focus();
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(`{${token}}`);
      setNotice(`Змінну {${token}} скопійовано.`);
    } catch { setNotice('Не вдалося скопіювати. Натисніть на змінну, щоб вставити її.'); }
  }

  const groups = [...new Set(voiceNameVariables.map((variable) => variable.group))];
  return <div className="name-template-editor">
    <label htmlFor={id}>Назва кімнати</label>
    <div className="name-template-row"><input ref={input} id={id} name="nameTemplate" defaultValue={defaultValue} maxLength={100} required onInput={(event) => setTemplate(event.currentTarget.value)} />
      <details ref={menu} className="variable-picker"><summary aria-label="Додати змінну до назви">+ Змінна</summary>
        <div className="variable-menu"><p>Натисніть змінну, щоб додати її до назви.</p>
          {groups.map((group) => <section key={group}><h4>{group}</h4>{voiceNameVariables.filter((variable) => variable.group === group).map((variable) => <div className="variable-option" key={variable.token}>
            <button type="button" onClick={() => insert(variable.token)}><code>{`{${variable.token}}`}</code><span><strong>{variable.label}</strong><small>{variable.help}</small></span></button>
            <button type="button" className="variable-copy" aria-label={`Скопіювати {${variable.token}}`} onClick={() => void copy(variable.token)}>Копіювати</button>
          </div>)}</section>)}
        </div>
      </details>
    </div>
    <p className="name-preview"><span>Приклад:</span> {preview}</p>
    <p className="field-help">Бот підставить значення змінних під час створення кімнати.</p>
    {notice && <p className="field-help" role="status">{notice}</p>}
  </div>;
}
