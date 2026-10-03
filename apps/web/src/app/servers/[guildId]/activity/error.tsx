'use client';
export default function ActivityError({ retry }: { retry: () => void }) {
  return <section role="alert"><p>Не вдалося завантажити статистику.</p><button className="secondary-button" onClick={retry}>Спробувати ще раз</button></section>;
}
