import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, type ButtonInteraction, type ChatInputCommandInteraction, type GuildMember, type ModalSubmitInteraction, type UserSelectMenuInteraction } from 'discord.js';
import { VoiceError, type VoiceService } from './voice-service';
import { voicePanelRows } from '@scrt/discord';

const prefix = 'scrt:voice:v1:';
const actions = ['lock', 'unlock', 'hide', 'show', 'rename', 'limit', 'bitrate', 'region', 'permit', 'block', 'unblock', 'kick', 'transfer', 'claim', 'reset', 'delete', 'chatOpen', 'chatClose'] as const;
type Action = typeof actions[number];
const labels: Record<Action | 'info', string> = { lock: 'Закрити', unlock: 'Відкрити', hide: 'Сховати', show: 'Показати', rename: 'Назва', limit: 'Ліміт', bitrate: 'Бітрейт', region: 'Регіон', permit: 'Дозволити', block: 'Заблокувати', unblock: 'Розблокувати', kick: 'Викинути', transfer: 'Передати', claim: 'Забрати', reset: 'Скинути', delete: 'Видалити', chatOpen: 'Відкрити чат', chatClose: 'Закрити чат', info: 'Інформація' };
const targetActions = new Set<Action>(['permit', 'block', 'unblock', 'kick', 'transfer']);
const modalActions = new Set<Action>(['rename', 'limit', 'bitrate', 'region']);

export const voiceCommand = {
  data: new SlashCommandBuilder().setName('voice').setDescription('Керування тимчасовою голосовою кімнатою')
    .addSubcommand((command) => command.setName('info').setDescription('Інформація про кімнату'))
    .addSubcommand((command) => command.setName('panel').setDescription('Відкрити панель керування'))
    .addSubcommand((command) => command.setName('rename').setDescription('Змінити назву').addStringOption((option) => option.setName('name').setDescription('Нова назва').setRequired(true)))
    .addSubcommand((command) => command.setName('limit').setDescription('Змінити ліміт учасників').addIntegerOption((option) => option.setName('count').setDescription('0 — без обмеження').setMinValue(0).setMaxValue(99).setRequired(true)))
    .addSubcommand((command) => command.setName('bitrate').setDescription('Змінити бітрейт').addIntegerOption((option) => option.setName('bps').setDescription('Бітрейт у біт/с').setMinValue(8000).setRequired(true)))
    .addSubcommand((command) => command.setName('region').setDescription('Змінити голосовий регіон').addStringOption((option) => option.setName('region').setDescription('ID регіону або auto').setRequired(true)))
    .addSubcommand((command) => command.setName('lock').setDescription('Закрити кімнату'))
    .addSubcommand((command) => command.setName('unlock').setDescription('Відкрити кімнату'))
    .addSubcommand((command) => command.setName('hide').setDescription('Приховати кімнату'))
    .addSubcommand((command) => command.setName('show').setDescription('Показати кімнату'))
    .addSubcommand((command) => command.setName('chat-open').setDescription('Відкрити чат кімнати'))
    .addSubcommand((command) => command.setName('chat-close').setDescription('Закрити чат кімнати'))
    .addSubcommand((command) => command.setName('permit').setDescription('Дозволити доступ').addUserOption((option) => option.setName('user').setDescription('Учасник').setRequired(true)))
    .addSubcommand((command) => command.setName('block').setDescription('Заблокувати доступ').addUserOption((option) => option.setName('user').setDescription('Учасник').setRequired(true)))
    .addSubcommand((command) => command.setName('unblock').setDescription('Зняти блокування').addUserOption((option) => option.setName('user').setDescription('Учасник').setRequired(true)))
    .addSubcommand((command) => command.setName('kick').setDescription('Відключити учасника від кімнати').addUserOption((option) => option.setName('user').setDescription('Учасник').setRequired(true)))
    .addSubcommand((command) => command.setName('transfer').setDescription('Передати кімнату').addUserOption((option) => option.setName('user').setDescription('Новий власник').setRequired(true)))
    .addSubcommand((command) => command.setName('claim').setDescription('Забрати кімнату без власника'))
    .addSubcommand((command) => command.setName('reset').setDescription('Скинути налаштування кімнати'))
    .addSubcommand((command) => command.setName('delete').setDescription('Видалити кімнату')),
  async execute(interaction: ChatInputCommandInteraction, service: VoiceService) {
    if (!interaction.guild) throw new VoiceError('Команда доступна лише на сервері.');
    await interaction.deferReply({ ephemeral: true });
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const name = interaction.options.getSubcommand();
    if (name === 'info') { await interaction.editReply({ content: info(member, service) }); return; }
    if (name === 'panel') { if (!service.roomForMember(member)) throw new VoiceError('Зайдіть у тимчасову кімнату.'); await interaction.editReply({ content: 'Керування голосовою кімнатою', components: panel() }); return; }
    if (name === 'delete') { if (!service.roomForMember(member)) throw new VoiceError('Зайдіть у тимчасову кімнату.'); await interaction.editReply({ content: 'Видалити цю кімнату разом з усіма учасниками?', components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${prefix}confirmDelete`).setLabel('Так, видалити').setStyle(ButtonStyle.Danger))] }); return; }
    const action = name === 'chat-open' ? 'chatOpen' : name === 'chat-close' ? 'chatClose' : name as Action;
    const targetUser = targetActions.has(action) ? interaction.options.getUser('user', true) : null;
    const target = targetUser ? await interaction.guild.members.fetch(targetUser.id) : undefined;
    const value = name === 'rename' ? interaction.options.getString('name', true) : name === 'limit' ? interaction.options.getInteger('count', true) : name === 'bitrate' ? interaction.options.getInteger('bps', true) : name === 'region' ? interaction.options.getString('region', true) : undefined;
    const message = await service.act({ member, action, value, target, admin: await service.canManage(member) });
    await interaction.editReply({ content: message });
  },
};

function info(member: GuildMember, service: VoiceService) {
  const room = service.roomForMember(member);
  const channel = member.voice.channel;
  if (!room || !channel) throw new VoiceError('Зайдіть у тимчасову кімнату.');
  return [`Кімната: ${channel.name}`, `Власник: ${room.ownerId ? `<@${room.ownerId}>` : 'Немає'}`, `Creator: <#${room.creatorId}>`, `Учасники: ${room.memberCount}`, `Ліміт: ${channel.userLimit || 'без обмеження'}`, `Бітрейт: ${channel.bitrate}`, `Регіон: ${channel.rtcRegion ?? 'auto'}`, `Закрита: ${room.locked ? 'так' : 'ні'}`, `Прихована: ${room.hidden ? 'так' : 'ні'}`, `Чат: ${room.chatClosed ? 'закритий' : 'відкритий'}`].join('\n');
}

export const panel = voicePanelRows;

export async function handleVoiceComponent(interaction: ButtonInteraction | ModalSubmitInteraction | UserSelectMenuInteraction, service: VoiceService): Promise<void> {
  try {
    if (!interaction.guild) throw new VoiceError('Доступно лише на сервері.');
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (interaction.isButton() && !await service.canUsePanel(member, interaction.channelId, interaction.message.id, interaction.message.flags.has(MessageFlags.Ephemeral))) throw new VoiceError('Ця панель недоступна для вашої кімнати.');
    const parts = interaction.customId.slice(prefix.length).split(':');
    let action = parts[0] as Action | 'info' | 'confirmDelete' | 'select' | 'modal';
    if (action === 'select' || action === 'modal') action = parts[1] as Action;
    if (action === 'info') { await interaction.reply({ content: info(member, service), ephemeral: true }); return; }
    if (action === 'delete' && interaction.isButton()) { await interaction.reply({ content: 'Видалити цю кімнату разом з усіма учасниками?', components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${prefix}confirmDelete`).setLabel('Так, видалити').setStyle(ButtonStyle.Danger))], ephemeral: true }); return; }
    if (action === 'confirmDelete') action = 'delete';
    if (!actions.includes(action as Action)) throw new VoiceError('Невідома дія.');
    if (interaction.isButton() && modalActions.has(action as Action)) {
      const modal = new ModalBuilder().setCustomId(`${prefix}modal:${action}`).setTitle(labels[action as Action]);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('value').setLabel(labels[action as Action]).setStyle(TextInputStyle.Short).setRequired(true)));
      await interaction.showModal(modal); return;
    }
    if (interaction.isButton() && targetActions.has(action as Action)) {
      await interaction.reply({ content: 'Виберіть учасника:', components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(new UserSelectMenuBuilder().setCustomId(`${prefix}select:${action}`).setPlaceholder('Учасник'))], ephemeral: true }); return;
    }
    let value: string | number | undefined;
    if (interaction.isModalSubmit()) {
      const raw = interaction.fields.getTextInputValue('value');
      value = action === 'limit' || action === 'bitrate' ? Number(raw) : raw;
    }
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.isUserSelectMenu() ? await interaction.guild.members.fetch(interaction.values[0]!) : undefined;
    const message = await service.act({ member, action: action as Action, value, target, admin: await service.canManage(member) });
    await interaction.editReply({ content: message });
  } catch (error) {
    const content = error instanceof VoiceError ? error.message : 'Не вдалося виконати дію. Спробуйте пізніше.';
    if (interaction.deferred && !interaction.replied) await interaction.editReply({ content });
    else if (interaction.replied || interaction.deferred) await interaction.followUp({ content, ephemeral: true });
    else await interaction.reply({ content, ephemeral: true });
  }
}
