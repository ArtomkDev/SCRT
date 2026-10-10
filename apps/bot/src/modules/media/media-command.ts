import { randomUUID } from 'node:crypto';
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { MediaAction } from '@scrt/validation';
import { MediaSourceError } from '@scrt/media';
import { MediaError, type MediaCommandService } from './command-service';

export const mediaCommandData = new SlashCommandBuilder().setName('media').setDescription('Медіа SCRT')
  .addSubcommand((sub) => sub.setName('play').setDescription('Знайти й додати доступне аудіо').addStringOption((option) => option.setName('query').setDescription('Пошук або HTTP URL').setRequired(true).setMaxLength(250)))
  .addSubcommand((sub) => sub.setName('pause').setDescription('Призупинити'))
  .addSubcommand((sub) => sub.setName('resume').setDescription('Відновити'))
  .addSubcommand((sub) => sub.setName('skip').setDescription('Пропустити або проголосувати'))
  .addSubcommand((sub) => sub.setName('queue').setDescription('Показати чергу'))
  .addSubcommand((sub) => sub.setName('now').setDescription('Зараз грає'))
  .addSubcommand((sub) => sub.setName('stop').setDescription('Зупинити сесію'));
export async function executeMediaSlash(interaction: ChatInputCommandInteraction, commands: MediaCommandService) {
  await interaction.deferReply({ ephemeral: true });
  try {
    if (!interaction.guildId) throw new MediaError('Команда доступна лише на сервері.');
    const state = await commands.sessions.state(interaction.guildId, interaction.user.id); const sub = interaction.options.getSubcommand();
    if (sub === 'queue' || sub === 'now') { const track = state.session?.currentTrack; const lines = sub === 'now' ? [] : (state.session?.queue ?? []).slice(0, 10).map((item, i) => `${i + 1}. ${item.title}`); await interaction.editReply({ content: `${track ? `Зараз: ${track.title}` : 'Зараз нічого не відтворюється.'}${lines.length ? '\n' + lines.join('\n') : ''}`.slice(0, 1800), allowedMentions: { parse: [] } }); return; }
    let action: MediaAction;
    if (sub === 'play') {
      const search = await commands.sessions.search(interaction.guildId, interaction.user.id, interaction.options.getString('query', true)); const track = search.results.find((item) => item.playable);
      if (!track) throw new MediaError(search.errors?.[0] ?? (search.unavailable.length ? `Доступного аудіо не знайдено. Недоступні джерела: ${search.unavailable.join(', ')}.` : 'Доступного аудіо не знайдено. Спробуйте інший запит або посилання YouTube, SoundCloud чи аудіофайлу.'));
      action = { type: 'ADD_TRACK', provider: track.provider, providerItemId: track.providerItemId };
    } else if (sub === 'skip') action = { type: state.controls.SKIP ? 'SKIP' : 'VOTE_SKIP' };
    else if (sub === 'resume') action = { type: state.session?.recoverable ? 'RESTORE' : 'RESUME' };
    else action = { type: sub === 'pause' ? 'PAUSE' : 'STOP' };
    await commands.execute({ commandId: randomUUID(), guildId: interaction.guildId, actorUserId: interaction.user.id, sessionId: state.session?.sessionId ?? null, expectedQueueVersion: state.session?.queueVersion ?? null, action });
    const after = await commands.sessions.state(interaction.guildId, interaction.user.id);
    await interaction.editReply({ content: action.type === 'VOTE_SKIP' ? `Пропустити: ${after.votes.count}/${after.votes.required} голосів.` : action.type === 'ADD_TRACK' ? 'Трек додано до черги.' : 'Виконано.', allowedMentions: { parse: [] } });
  } catch (error) { await interaction.editReply({ content: error instanceof MediaError || error instanceof MediaSourceError ? error.message : 'Медіа тимчасово недоступне.', allowedMentions: { parse: [] } }); }
}
