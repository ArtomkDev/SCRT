'use client';
import { Panel } from '@/app/components/dashboard-screen';

import { Button } from '@/app/components/controls';
export default function MediaError({ reset }: { reset: () => void }) { return <Panel className="module-state-panel"><h2>Медіа недоступне</h2><p>Не вдалося завантажити дані сервера.</p><Button onClick={reset}>Повторити</Button></Panel>; }
