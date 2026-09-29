import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { VoiceService } from './voice/voice-service';
import { voiceCommand } from './voice/voice-command';

export const commands = [{
  data: new SlashCommandBuilder().setName('ping').setDescription('Check bot responsiveness'),
  async execute(interaction: ChatInputCommandInteraction, voice: VoiceService) { void voice; await interaction.reply({ content: 'Pong!', ephemeral: true }); },
}, voiceCommand];
