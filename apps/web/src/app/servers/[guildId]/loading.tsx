import { LoadingValue } from '@/app/components/data-loading';
export default function Loading() { return <main className="content-page" aria-label="Завантаження сервера…" aria-busy="true"><div className="page-heading"><h1>Сервер</h1></div><section className="detail-panel"><LoadingValue width="18ch" /></section></main>; }
