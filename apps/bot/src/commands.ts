import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { VoiceService } from './voice/voice-service';
import { voiceCommand } from './voice/voice-command';
import { mediaCommandData } from './modules/media/media-command';
import { executeMediaSlash } from './modules/media/media-command';
import type { MediaCommandService } from './modules/media/command-service';

type BotCommand = { data: Pick<SlashCommandBuilder, 'name' | 'toJSON'>; execute: (interaction: ChatInputCommandInteraction, voice: VoiceService, media: MediaCommandService) => Promise<void> };
export const commands: BotCommand[] = [{
  data: new SlashCommandBuilder().setName('ping').setDescription('Check bot responsiveness'),
  async execute(interaction: ChatInputCommandInteraction, voice: VoiceService) { void voice; await interaction.reply({ content: 'Pong!', ephemeral: true }); },
}, voiceCommand, { data: mediaCommandData, async execute(interaction, _voice, media) { await executeMediaSlash(interaction, media); } }];
