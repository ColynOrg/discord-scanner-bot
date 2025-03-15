import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Scan a URL for potential threats')
    .addStringOption(option =>
      option
        .setName('url')
        .setDescription('The URL to scan')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('solved')
    .setDescription('Mark a forum post as solved'),
  new SlashCommandBuilder()
    .setName('unsolved')
    .setDescription('Remove the solved status from a forum post')
].map(command => command.toJSON()); 