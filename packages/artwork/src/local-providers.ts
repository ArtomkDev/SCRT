import { Buffer } from 'node:buffer';
import * as icons from 'simple-icons';
import { artworkUrlSchema } from '@scrt/validation';
import type { ArtworkAsset } from '@scrt/shared';
import { canonicalArtworkName } from './matching';
import type { ActivityArtworkProvider, ArtworkLookupInput, ArtworkProviderResult, ProviderHealth } from './types';

type BrandIcon = { title: string; slug: string; hex: string; path: string; source: string };
// The brand catalog also contains games. Only explicit software hints bypass game metadata APIs.
const softwareNames = new Set(['github', 'spotify', 'steam', 'obs studio', 'docker', 'visual studio code', 'discord', 'slack', 'notion', 'gitlab', 'firefox', 'google chrome', 'opera', 'brave', 'vivaldi', 'safari', 'postman', 'insomnia', 'blender', 'gimp', 'inkscape', 'krita', 'figma', 'sublime text', 'intellij idea', 'pycharm', 'webstorm', 'vim', 'neovim', 'emacs', 'audacity', 'vlc media player']);
const catalog = new Map<string, BrandIcon>();
for (const icon of Object.values(icons)) {
  if (typeof icon === 'object' && icon && 'title' in icon && 'path' in icon) {
    const entry = icon as BrandIcon;
    catalog.set(canonicalArtworkName(entry.title), entry);
    catalog.set(canonicalArtworkName(entry.slug), entry);
  }
}
// Simple Icons removed Microsoft brands. Use the publisher's documented icon directly, without redistributing it.
const publisherBrands = new Map([
  ['visual studio code', { url: 'https://code.visualstudio.com/assets/branding/code-stable.png', name: 'Visual Studio Code', color: '#007ACC', attribution: 'https://code.visualstudio.com/brand' }],
]);
export function softwareArtwork(name: string): ArtworkProviderResult | null {
  const icon = catalog.get(canonicalArtworkName(name));
  if (!icon) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#${icon.hex}" d="${icon.path}"/></svg>`;
  const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  if (url.length > 24000) return null;
  return { icon: { url, source: 'simple-icons', kind: 'logo', entityId: icon.slug, attributionUrl: artworkUrlSchema.safeParse(icon.source).success ? icon.source : 'https://simpleicons.org' }, classification: softwareNames.has(canonicalArtworkName(name)) ? 'application' : 'unknown', resolvedName: icon.title, confidence: 1, dominantColor: `#${icon.hex}` };
}
export function isKnownSoftware(name: string) { return softwareNames.has(canonicalArtworkName(name)) || publisherBrands.has(canonicalArtworkName(name)); }
export class SimpleIconsArtworkProvider implements ActivityArtworkProvider {
  readonly id = 'simple-icons';
  health(): ProviderHealth { return { status: 'available', checkedAt: 0 }; }
  async resolve(input: ArtworkLookupInput) { return softwareArtwork(input.displayName); }
}
export class BrandArtworkProvider implements ActivityArtworkProvider {
  readonly id = 'brand';
  health(): ProviderHealth { return { status: 'available', checkedAt: 0 }; }
  async resolve(input: ArtworkLookupInput): Promise<ArtworkProviderResult | null> {
    const brand = publisherBrands.get(canonicalArtworkName(input.displayName));
    return brand ? { icon: { url: brand.url, source: 'brand', kind: 'logo', entityId: canonicalArtworkName(input.displayName), attributionUrl: brand.attribution }, classification: 'application', resolvedName: brand.name, confidence: 1, dominantColor: brand.color } : null;
  }
}
export class DiscordArtworkProvider implements ActivityArtworkProvider {
  readonly id = 'discord';
  health(): ProviderHealth { return { status: 'available', checkedAt: 0 }; }
  async resolve(input: ArtworkLookupInput): Promise<ArtworkProviderResult | null> {
    const asset = (url: string | null, kind: 'icon' | 'hero'): ArtworkAsset | null => url && artworkUrlSchema.safeParse(url).success ? { url, kind, source: 'discord', entityId: input.applicationId, attributionUrl: null } : null;
    const icon = asset(input.discord.iconUrl, 'icon');
    const hero = asset(input.discord.heroUrl, 'hero');
    return icon || hero ? { icon, hero, confidence: 1 } : null;
  }
}
export class GeneratedFallbackProvider implements ActivityArtworkProvider {
  readonly id = 'generated';
  health(): ProviderHealth { return { status: 'available', checkedAt: 0 }; }
  async resolve(): Promise<ArtworkProviderResult> { return { confidence: 0 }; }
}
