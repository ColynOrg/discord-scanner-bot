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

  const { commandName } = interaction;

  try {
    switch (commandName) {
      case 'scan':
        await handleScanCommand(interaction);
        break;
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
});

async function handleScanCommand(interaction: ChatInputCommandInteraction) {
  const url = interaction.options.getString('url');
  const file = interaction.options.getAttachment('file');

  // Check if both options are provided
  if (url && file) {
    await interaction.reply({
      content: 'Please provide either a URL or a file, not both.',
      ephemeral: true
    });
    return;
  }

  if (url) {
    // Handle URL scan
    const reply = await interaction.reply({ 
      embeds: [createQuickPreview(url)],
      ephemeral: true,
      fetchReply: true
    });

    try {
      // Create scan
      const analysisId = await virusTotalService.scanUrl(url);
      
      // Poll for results
      const analysisResult = await virusTotalService.pollAnalysisResults(analysisId);
      
      // Update message with full scan report
      await interaction.editReply({
        embeds: [formatVirusTotalReport(url, analysisResult)]
      });
    } catch (error: any) {
      console.error('Error during URL scan:', error);
      
      // Create error embed
      const errorEmbed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle('❌ URL Scan Error')
        .setDescription('Failed to scan the URL')
        .addFields(
          { name: '🎯 Target URL', value: url },
          { name: '❌ Error', value: error.message || 'Unknown error occurred' }
        )
        .setTimestamp();
      
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  } else if (file) {
    // Handle file scan (placeholder for now)
    await interaction.reply({
      content: 'File scanning will be implemented soon.',
      ephemeral: true
    });
  }
}

// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN); 