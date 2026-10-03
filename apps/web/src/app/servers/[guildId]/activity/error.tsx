'use client';
export default function ActivityError({ reset }: { reset: () => void }) {
  return <section role="alert"><p>Не вдалося завантажити статистику.</p><button className="secondary-button" onClick={reset}>Спробувати ще раз</button></section>;
}
