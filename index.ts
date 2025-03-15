import { Client, GatewayIntentBits, Events, CommandInteraction, EmbedBuilder, Colors, ChatInputCommandInteraction, REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import { VirusTotalService } from './virusTotalService';
import { createQuickPreview, formatVirusTotalReport } from './visualService';
import { commands } from './commands';
import { ForumManager } from './forumManager';

// Load environment variables
config();

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Initialize services
const virusTotalService = new VirusTotalService();
let forumManager: ForumManager;

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  
  // Initialize forum manager after client is ready
  forumManager = new ForumManager(readyClient);
  
  try {
    // Register slash commands
    const rest = new REST().setToken(process.env.DISCORD_TOKEN!);
    
    console.log('Started refreshing application (/) commands.');
    
    await rest.put(
      Routes.applicationCommands(readyClient.user.id),
      { body: commands }
    );
    
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }
});

// Register slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.commandName;

  if (command === 'scan') {
    await interaction.deferReply();
    
    try {
      const url = interaction.options.getString('url');
      const file = interaction.options.getAttachment('file');
      
      if (!url && !file) {
        await interaction.editReply('Please provide either a URL or a file to scan.');
        return;
      }

      if (url && file) {
        await interaction.editReply('Please provide either a URL or a file, not both.');
        return;
      }

      const virusTotalService = new VirusTotalService();
      let analysisId: string;

      if (url) {
        await interaction.editReply('🔍 Submitting URL for scanning...');
        analysisId = await virusTotalService.scanUrl(url);
      } else if (file) {
        await interaction.editReply('🔍 Downloading and submitting file for scanning...');
        try {
          // Use the absolute proxyURL or attachment URL
          const fileUrl = file.proxyURL || file.url;
          if (!fileUrl) {
            throw new Error('Could not get file URL from attachment');
          }
          analysisId = await virusTotalService.scanFile(fileUrl);
        } catch (error) {
          console.error('File scan error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          await interaction.editReply(`❌ Error scanning file: ${errorMessage}`);
          return;
        }
      } else {
        await interaction.editReply('An unexpected error occurred.');
        return;
      }

      await interaction.editReply('⏳ Analyzing... This may take a few minutes.');
      const results = await virusTotalService.getAnalysisResults(analysisId);

      const stats = results.data.attributes.stats;
      const totalScans = stats.harmless + stats.malicious + stats.suspicious + stats.undetected + stats.timeout;
      const detectionRate = ((stats.malicious + stats.suspicious) / totalScans * 100).toFixed(1);

      const threatLevel = stats.malicious + stats.suspicious > 0 ? '⚠️ Threats detected' : '✅ No threats detected';
      const color = stats.malicious + stats.suspicious > 0 ? 0xFF0000 : 0x00FF00;

      const embed = new EmbedBuilder()
        .setTitle('VirusTotal Scan Results')
        .setColor(color)
        .addFields(
          { name: 'Status', value: threatLevel, inline: false },
          { name: 'Detection Rate', value: `${detectionRate}% (${stats.malicious + stats.suspicious}/${totalScans})`, inline: true },
          { name: 'Breakdown', value: [
            `Malicious: ${stats.malicious}`,
            `Suspicious: ${stats.suspicious}`,
            `Clean: ${stats.harmless}`,
            `Undetected: ${stats.undetected}`,
            `Timeout: ${stats.timeout}`
          ].join('\n'), inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'Powered by VirusTotal' });

      if (url) {
        embed.setDescription(`Scan results for URL: ${url}`);
      } else if (file) {
        embed.setDescription(`Scan results for file: ${file.name}`);
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in scan command:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await interaction.editReply(`❌ An error occurred while scanning: ${errorMessage}`);
    }
  } else {
    const { commandName } = interaction;

    try {
      switch (commandName) {
        case 'solved':
          await forumManager.handleSolvedCommand(interaction);
          break;
        case 'unsolved':
          await forumManager.handleUnsolvedCommand(interaction);
          break;
      }
    } catch (error) {
      console.error(`Error handling command ${commandName}:`, error);
      try {
        const errorMessage = 'An error occurred while processing your command.';
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: errorMessage, ephemeral: true });
        } else {
          await interaction.followUp({ content: errorMessage, ephemeral: true });
        }
      } catch (replyError) {
        console.error('Error sending error message:', replyError);
      }
    }
  }
});

// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN); 