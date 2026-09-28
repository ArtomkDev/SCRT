import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

export const commands = [{
  data: new SlashCommandBuilder().setName('ping').setDescription('Check bot responsiveness'),
  async execute(interaction: ChatInputCommandInteraction) { await interaction.reply({ content: 'Pong!', ephemeral: true }); },
}];
