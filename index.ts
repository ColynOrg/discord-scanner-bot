import { Client, GatewayIntentBits, Events, CommandInteraction, EmbedBuilder, Colors, ChatInputCommandInteraction, REST, Routes, ButtonInteraction } from 'discord.js';
import { config } from 'dotenv';
import { VirusTotalService } from './virusTotalService';
import { createQuickPreview, formatVirusTotalReport, formatWeatherReport, formatHourlyForecast, formatExtendedForecast, getWeatherButtons, getBackButton } from './visualService';
import { commands } from './commands';
import { ForumManager } from './forumManager';
import { WeatherService } from './weatherService';

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
const weatherService = new WeatherService();
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

// Register slash commands and button interactions
client.on(Events.InteractionCreate, async (interaction) => {
  // Handle button interactions
  if (interaction.isButton()) {
    const buttonId = interaction.customId;
    
    if (['hourly', 'extended', 'refresh', 'back'].includes(buttonId)) {
      await interaction.deferUpdate();
      
      try {
        switch (buttonId) {
          case 'hourly': {
            const forecast = await weatherService.getSanFranciscoHourlyForecast();
            const embed = formatHourlyForecast(forecast);
            await interaction.editReply({ embeds: [embed], components: [getBackButton()] });
            break;
          }
          case 'extended': {
            const forecast = await weatherService.getSanFranciscoExtendedForecast();
            const embed = formatExtendedForecast(forecast);
            await interaction.editReply({ embeds: [embed], components: [getBackButton()] });
            break;
          }
          case 'refresh': {
            const forecast = await weatherService.getSanFranciscoWeather();
            const embed = formatWeatherReport(forecast);
            // Keep the same button layout as the current view
            const buttons = interaction.message.components[0].components[0].customId === 'back' 
              ? getBackButton() 
              : getWeatherButtons();
            await interaction.editReply({ embeds: [embed], components: [buttons] });
            break;
          }
          case 'back': {
            const forecast = await weatherService.getSanFranciscoWeather();
            const embed = formatWeatherReport(forecast);
            await interaction.editReply({ embeds: [embed], components: [getWeatherButtons()] });
            break;
          }
        }
      } catch (error) {
        console.error('Error handling weather button:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await interaction.editReply({ content: `❌ An error occurred: ${errorMessage}`, components: [] });
      }
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const command = interaction.commandName;

  if (command === 'scan') {
    await interaction.deferReply();
    
    try {
      const url = interaction.options.getString('url');
      
      if (!url) {
        await interaction.editReply('Please provide a URL to scan.');
        return;
      }

      const virusTotalService = new VirusTotalService();
      await interaction.editReply('🔍 Submitting URL for scanning...');
      const analysisId = await virusTotalService.scanUrl(url);

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
        .setDescription(`Scan results for URL: ${url}`)
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

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error in scan command:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await interaction.editReply(`❌ An error occurred while scanning: ${errorMessage}`);
    }
  } else if (command === 'weather') {
    await interaction.deferReply();
    
    try {
      const forecast = await weatherService.getSanFranciscoWeather();
      const embed = formatWeatherReport(forecast);
      await interaction.editReply({ 
        embeds: [embed],
        components: [getWeatherButtons()]
      });
    } catch (error) {
      console.error('Error in weather command:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await interaction.editReply(`❌ An error occurred while getting weather: ${errorMessage}`);
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