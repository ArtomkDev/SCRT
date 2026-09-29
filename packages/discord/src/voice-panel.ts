export const voiceComponentPrefix = 'scrt:voice:v1:';
const controls = [
  ['lock', 'Закрити'], ['unlock', 'Відкрити'], ['hide', 'Сховати'], ['show', 'Показати'], ['rename', 'Назва'],
  ['limit', 'Ліміт'], ['bitrate', 'Бітрейт'], ['region', 'Регіон'], ['permit', 'Дозволити'], ['block', 'Заблокувати'],
  ['unblock', 'Розблокувати'], ['kick', 'Викинути'], ['transfer', 'Передати'], ['claim', 'Забрати'], ['reset', 'Скинути'],
  ['chatOpen', 'Відкрити чат'], ['chatClose', 'Закрити чат'], ['info', 'Інформація'], ['delete', 'Видалити'],
] as const;
export function voicePanelRows() {
  const rows: Array<{ type: 1; components: Array<{ type: 2; custom_id: string; label: string; style: 2 | 4 }> }> = [];
  for (let i = 0; i < controls.length; i += 5) {
    rows.push({ type: 1, components: controls.slice(i, i + 5).map(([action, label]) => ({ type: 2, custom_id: `${voiceComponentPrefix}${action}`, label, style: action === 'delete' ? 4 : 2 })) });
  }
  return rows;
}
