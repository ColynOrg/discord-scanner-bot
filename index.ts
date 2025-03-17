import { Client, GatewayIntentBits, Events, CommandInteraction, EmbedBuilder, Colors, ChatInputCommandInteraction, REST, Routes, ButtonInteraction } from 'discord.js';
import { config } from 'dotenv';
import { ForumManager } from './forumManager';
import { WeatherService } from './weatherService';
import { URLScannerService } from './urlScannerService';
import { createQuickPreview, formatVirusTotalReport, formatWeatherReport, formatHourlyForecast, formatExtendedForecast, formatWeatherAlerts, getWeatherButtons, getBackButton } from './visualService';
import { commands } from './commands';

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
const weatherService = new WeatherService();
let forumManager: ForumManager;

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
  
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
    
    if (['hourly', 'extended', 'back'].includes(buttonId)) {
      // Check if the user who clicked is the same as the user who ran the command
      const message = interaction.message;
      const originalUserId = message.interaction?.user.id;
      
      if (originalUserId !== interaction.user.id) {
        await interaction.reply({ 
          content: `Only the person who ran the command can use these buttons. Try running </weather:1350322316462002207> yourself!`,
          ephemeral: true 
        });
        return;
      }

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

  // Check if command is being used in a server
  if (!interaction.guildId) {
    await interaction.reply({ 
      content: '❌ This command can only be used in the NCW Server!',
      ephemeral: true 
    });
    return;
  }

  if (command === 'help') {
    await interaction.reply({
      embeds: [{
        color: 0x0099FF,
        title: '🤖 Bot Commands',
        description: 'Here are all the available commands:',
        fields: [
          {
            name: '🔍 `/scan`',
            value: 'Scan a URL for potential threats and security risks.',
            inline: false
          },
          {
            name: '🌤️ `/weather`',
            value: 'Get current weather information for San Francisco with interactive buttons for hourly and extended forecasts.',
            inline: false
          },
          {
            name: '✅ `/solved`',
            value: 'Mark a forum post as solved. This will add a "Solved" tag and schedule the post for auto-closure.',
            inline: false
          },
          {
            name: '❌ `/unsolved`',
            value: 'Remove the "Solved" tag from a forum post.',
            inline: false
          },
          {
            name: '❓ `/help`',
            value: 'Show this help message with information about all available commands.',
            inline: false
          }
        ],
        footer: {
          text: 'All commands are server-only and some may require specific permissions.'
        }
      }]
    });
    return;
  }

  if (command === 'scan') {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const url = interaction.options.getString('url');
      
      if (!url) {
        await interaction.editReply('Please provide a URL to scan.');
        return;
      }

      const urlScanner = new URLScannerService();
      await interaction.editReply('🔍 Scanning URL...');
      
      const results = await urlScanner.scanUrl(url);
      const embed = urlScanner.createEmbed(results);

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