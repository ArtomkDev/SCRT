import Image from 'next/image';
import { AppBrand } from '../app-brand';
import { DiscordLoginButton } from './discord-login-button';
import { ScrtFaceMotion } from './scrt-face-motion';
import { ScrtFace } from './scrt-face';
import environmentArtwork from './assets/cosmic-environment.webp';

const authErrors: Record<string, string> = {
  oauth_denied: 'Вхід через Discord скасовано. Ви можете спробувати ще раз.',
  oauth_state: 'Не вдалося увійти через Discord. Спробуйте ще раз.',
  oauth_failed: 'Не вдалося увійти через Discord. Спробуйте ще раз.',
};

export function AuthScreen({ development, error }: { development: boolean; error?: string | string[] }) {
  const errorMessage = typeof error === 'string' && Object.hasOwn(authErrors, error) ? authErrors[error] : undefined;
  return <main className="auth-screen">
    <div className="auth-environment" aria-hidden="true"><Image src={environmentArtwork} alt="" fill sizes="100vw" loading="eager" fetchPriority="high" className="auth-environment-image" /></div>
    <header className="auth-header"><div className="brand"><AppBrand development={development} /></div><span className="auth-system-label">CONTROL SYSTEM</span></header>
    <div className="auth-composition">
      <div className="auth-visual" aria-hidden="true"><ScrtFaceMotion><ScrtFace /></ScrtFaceMotion></div>
      <section className="auth-content" aria-labelledby="auth-heading">
        <span className="auth-eyebrow">Панель керування</span>
        <h1 id="auth-heading">Увійти до SCRT</h1>
        <p className="auth-description">Увійдіть через Discord, щоб відкрити панель керування сервером.</p>
        {errorMessage && <p className="auth-error" role={error === 'oauth_denied' ? 'status' : 'alert'}>{errorMessage}</p>}
        <DiscordLoginButton retry={Boolean(errorMessage)} />
        <p className="auth-privacy">Discord використовується для входу та перевірки доступу до серверів.</p>
      </section>
    </div>
  </main>;
}
