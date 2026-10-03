import Image from 'next/image';
import { memberAvatarUrl, memberDisplayName, type BotGuildMember } from '@scrt/discord';

export function MemberIdentity({ guildId, member, userId, fallbackName = 'Учасник не на сервері' }: { guildId: string; member: BotGuildMember | null; userId: string; fallbackName?: string }) {
  if (!member) return <div className="member-identity" title={`Discord ID: ${userId}`}><span className="member-avatar member-avatar-missing" aria-hidden="true">?</span><div><strong>{fallbackName}</strong></div></div>;
  const name = memberDisplayName(member);
  return <div className="member-identity" title={`Discord ID: ${userId}`}>
    <Image className="member-avatar" src={memberAvatarUrl(guildId, member)} width={44} height={44} alt="" unoptimized />
    <div><strong>{name}</strong><div className="muted">@{member.user.username}</div></div>
  </div>;
}
