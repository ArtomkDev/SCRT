'use client';
import { Button } from '@/app/components/controls';
export default function MediaError({ reset }: { reset: () => void }) { return <section className="module-state-panel"><h2>Медіа недоступне</h2><p>Не вдалося завантажити дані сервера.</p><Button onClick={reset}>Повторити</Button></section>; }
