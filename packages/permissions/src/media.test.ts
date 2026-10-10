import { describe, expect, it } from 'vitest';
import { mediaPolicy, type MediaActor, type MediaPolicySettings } from './media';
const settings: MediaPolicySettings = { enabled: true, controlMode: 'QUEUE', allowRemoteAdminControl: false, allowRemoteRequests: false, skipMode: 'vote', djRoleIds: ['dj'], sameVoiceUsersCan: { addTracks: true, pauseResume: true, skip: false, removeOwnTracks: true, removeAnyTracks: false, reorderOwnTracks: true, reorderQueue: false, changeVolume: false, stopSession: false } };
const actor: MediaActor = { userId: 'user', voiceChannelId: 'room', permissions: new Set(['media.view', 'media.request']), roleIds: [] };
const session = { voiceChannelId: 'room', lockedMode: 'unlocked' as const };
describe('Media voice authorization', () => {
  it('permits seeking under direct track control without bypassing votes, Voice or locks', () => {
    const dj = { ...actor, roleIds: ['dj'] };
    expect(mediaPolicy(settings, actor, session, 'SEEK')).not.toBeNull();
    expect(mediaPolicy({ ...settings, skipMode: 'direct', sameVoiceUsersCan: { ...settings.sameVoiceUsersCan, skip: true } }, actor, session, 'SEEK')).toBeNull();
    expect(mediaPolicy(settings, dj, session, 'SEEK')).toBeNull();
    expect(mediaPolicy(settings, { ...dj, voiceChannelId: 'other' }, session, 'SEEK')).not.toBeNull();
    expect(mediaPolicy(settings, dj, { ...session, lockedMode: 'admin' }, 'SEEK')).not.toBeNull();
    expect(mediaPolicy(settings, { ...dj, permissions: new Set(['media.view']) }, session, 'SEEK')).not.toBeNull();
  });
  it('allows starting a track but never lets play-now bypass voting, DJ/admin locks or Voice rules', () => {
    expect(mediaPolicy(settings, actor, null, 'PLAY_TRACK')).toBeNull();
    expect(mediaPolicy(settings, actor, session, 'PLAY_TRACK')).not.toBeNull();
    expect(mediaPolicy({ ...settings, skipMode: 'direct', sameVoiceUsersCan: { ...settings.sameVoiceUsersCan, skip: true } }, actor, session, 'PLAY_TRACK')).toBeNull();
    const dj = { ...actor, roleIds: ['dj'] };
    expect(mediaPolicy(settings, dj, session, 'PLAY_TRACK')).toBeNull();
    expect(mediaPolicy(settings, { ...dj, voiceChannelId: 'other' }, session, 'PLAY_TRACK')).not.toBeNull();
    expect(mediaPolicy(settings, dj, { ...session, lockedMode: 'admin' }, 'PLAY_TRACK')).not.toBeNull();
    expect(mediaPolicy(settings, { ...actor, voiceChannelId: null }, null, 'PLAY_TRACK')).not.toBeNull();
  });
  it.each([null, 'other'])('denies ordinary controls from voice %s', (voiceChannelId) => {
    for (const type of ['PAUSE', 'RESUME', 'SKIP', 'VOTE_SKIP', 'REMOVE_QUEUE_ITEM', 'MOVE_QUEUE_ITEM', 'SET_VOLUME', 'STOP']) expect(mediaPolicy(settings, { ...actor, voiceChannelId }, session, type, 'user')).not.toBeNull();
    expect(mediaPolicy(settings, { ...actor, voiceChannelId }, session, 'VIEW')).toBeNull();
  });
  it('allows configured actions and own queue edits, rejects edits to others', () => {
    expect(mediaPolicy(settings, actor, session, 'PAUSE')).toBeNull(); expect(mediaPolicy(settings, actor, session, 'REMOVE_QUEUE_ITEM', 'user')).toBeNull();
    expect(mediaPolicy(settings, actor, session, 'REMOVE_QUEUE_ITEM', 'other')).not.toBeNull(); expect(mediaPolicy(settings, actor, session, 'SET_VOLUME')).not.toBeNull();
  });
  it('requires media.request for a view-only actor', () => { expect(mediaPolicy(settings, { ...actor, permissions: new Set(['media.view']) }, session, 'PAUSE')).not.toBeNull(); });
  it('DJ role or media.control broadens actions but preserves voice rules', () => {
    for (const elevated of [{ ...actor, roleIds: ['dj'] }, { ...actor, permissions: new Set(['media.view', 'media.control']) }]) {
      expect(mediaPolicy(settings, elevated, session, 'SKIP')).toBeNull(); expect(mediaPolicy(settings, { ...elevated, voiceChannelId: 'other' }, session, 'SKIP')).not.toBeNull();
    }
  });
  it('requires remote override for ordinary manager controls but allows explicit restore in the manager Voice', () => {
    const manager = { ...actor, voiceChannelId: 'other', permissions: new Set(['media.view', 'media.manage']) };
    expect(mediaPolicy(settings, manager, session, 'STOP')).not.toBeNull();
    expect(mediaPolicy({ ...settings, allowRemoteAdminControl: true }, manager, session, 'STOP')).toBeNull();
    expect(mediaPolicy(settings, manager, session, 'RESTORE')).toBeNull();
    expect(mediaPolicy({ ...settings, allowRemoteAdminControl: true }, { ...manager, voiceChannelId: null }, session, 'RESTORE')).not.toBeNull();
    expect(mediaPolicy(settings, { ...actor, voiceChannelId: 'other' }, session, 'RESTORE')).not.toBeNull();
  });
  it('does not let remote requests start a session outside Voice', () => { expect(mediaPolicy({ ...settings, allowRemoteRequests: true }, { ...actor, voiceChannelId: null }, null, 'ADD_TRACK')).not.toBeNull(); });
  it('locks controls while allowing ordinary requests in DJ mode', () => {
    expect(mediaPolicy(settings, actor, { ...session, lockedMode: 'dj' }, 'PAUSE')).not.toBeNull(); expect(mediaPolicy(settings, actor, { ...session, lockedMode: 'dj' }, 'ADD_TRACK')).toBeNull();
    expect(mediaPolicy(settings, actor, { ...session, lockedMode: 'dj' }, 'VOTE_SKIP')).not.toBeNull();
    expect(mediaPolicy({ ...settings, controlMode: 'DJ' }, actor, session, 'VOTE_SKIP')).not.toBeNull();
    expect(mediaPolicy(settings, { ...actor, roleIds: ['dj'] }, { ...session, lockedMode: 'admin' }, 'SKIP')).not.toBeNull();
  });
});
