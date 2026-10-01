export const voiceNameVariables = [
  { token: 'username', group: 'Власник', label: 'Ім’я користувача', help: 'Ім’я користувача власника кімнати в Discord.' },
  { token: 'displayName', group: 'Власник', label: 'Ім’я на сервері', help: 'Нік на сервері або ім’я профілю.' },
  { token: 'userId', group: 'Власник', label: 'ID користувача', help: 'ID власника кімнати в Discord.' },
  { token: 'accountCreated', group: 'Власник', label: 'Дата створення акаунта', help: 'Дата реєстрації власника у форматі ДД.ММ.РРРР.' },
  { token: 'serverJoined', group: 'Власник', label: 'Дата приєднання', help: 'Дата приєднання власника кімнати до сервера.' },
  { token: 'highestRole', group: 'Ролі', label: 'Найвища роль', help: 'Назва найвищої ролі власника.' },
  { token: 'hoistRole', group: 'Ролі', label: 'Відображувана роль', help: 'Роль власника, що відображається окремо у списку учасників.' },
  { token: 'serverName', group: 'Сервер і канал', label: 'Назва сервера', help: 'Поточна назва Discord-сервера.' },
  { token: 'serverId', group: 'Сервер і канал', label: 'ID сервера', help: 'ID сервера в Discord.' },
  { token: 'creatorName', group: 'Сервер і канал', label: 'Назва каналу створення', help: 'Канал, через який було створено кімнату.' },
  { token: 'creatorId', group: 'Сервер і канал', label: 'ID каналу створення', help: 'ID каналу створення в Discord.' },
  { token: 'categoryName', group: 'Сервер і канал', label: 'Категорія кімнати', help: 'Категорія, у якій створюється кімната.' },
  { token: 'privacy', group: 'Кімната', label: 'Приватність', help: 'Відкрита, закрита або прихована згідно з початковими налаштуваннями.' },
  { token: 'counter', group: 'Нумерація', label: 'Номер', help: 'Порядковий номер кімнати власника: 1, 2, 3…' },
  { token: 'counterRoman', group: 'Нумерація', label: 'Римський номер', help: 'Той самий номер римськими цифрами: I, II, III…' },
  { token: 'counterAlpha', group: 'Нумерація', label: 'Літерний номер', help: 'Той самий номер латинськими літерами: A, B, C…' },
  { token: 'counterPadded', group: 'Нумерація', label: 'Номер із нулем', help: 'Двозначний номер: 01, 02, 03…' },
  { token: 'counterSuperscript', group: 'Нумерація', label: 'Надрядковий номер', help: 'Номер малими надрядковими цифрами: ¹, ², ³…' },
] as const;

export type VoiceNameInput = {
  username: string; displayName: string; counter: number;
  userId?: string; accountCreatedAt?: number | null; serverJoinedAt?: number | null;
  highestRole?: string | null; hoistRole?: string | null;
  serverName?: string; serverId?: string; creatorName?: string; creatorId?: string; categoryName?: string | null;
  privacy?: 'open' | 'locked' | 'hidden';
};

function roman(value: number): string {
  if (value < 1 || value > 3999) return String(value);
  const parts: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let remaining = value;
  let result = '';
  for (const [number, numeral] of parts) {
    while (remaining >= number) { result += numeral; remaining -= number; }
  }
  return result;
}

function alpha(value: number): string {
  if (value < 1) return String(value);
  let remaining = value;
  let result = '';
  while (remaining > 0) { remaining--; result = String.fromCharCode(65 + remaining % 26) + result; remaining = Math.floor(remaining / 26); }
  return result;
}

function date(value?: number | null): string {
  return value ? new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(value) : 'невідомо';
}

export function renderVoiceRoomName(template: string, input: VoiceNameInput): string {
  if (/[{}\r\n\t]/u.test(template.replace(/\{[^{}]+\}/gu, ''))) throw new Error('Invalid room name template');
  const values: Record<(typeof voiceNameVariables)[number]['token'], string> = {
    username: input.username, displayName: input.displayName, userId: input.userId ?? 'невідомо',
    accountCreated: date(input.accountCreatedAt), serverJoined: date(input.serverJoinedAt),
    highestRole: input.highestRole ?? 'Без ролі', hoistRole: input.hoistRole ?? 'Без ролі',
    serverName: input.serverName ?? 'Сервер', serverId: input.serverId ?? 'невідомо',
    creatorName: input.creatorName ?? 'Creator', creatorId: input.creatorId ?? 'невідомо', categoryName: input.categoryName ?? 'Без категорії',
    privacy: input.privacy === 'hidden' ? 'Прихована' : input.privacy === 'locked' ? 'Закрита' : 'Відкрита',
    counter: String(input.counter), counterRoman: roman(input.counter), counterAlpha: alpha(input.counter),
    counterPadded: String(input.counter).padStart(2, '0'),
    counterSuperscript: String(input.counter).replace(/[0-9]/gu, (digit) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(digit)]!),
  };
  const name = template.replace(/\{([^{}]+)\}/gu, (_match, token: string) => {
    if (!Object.hasOwn(values, token)) throw new Error(`Unknown room name variable: ${token}`);
    return values[token as keyof typeof values];
  }).replace(/\s+/gu, ' ').trim();
  if (!name || name.length > 100) throw new Error('Invalid room name');
  return name;
}
