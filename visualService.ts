import { EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { VirusTotalAnalysis } from './virusTotalService';

export function createQuickPreview(url: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.Blue)
    .setTitle('🔍 URL Scan in Progress')
    .setDescription('Analyzing the provided URL for potential threats...')
    .addFields(
      { name: '🎯 Target URL', value: url },
      { name: '⏳ Status', value: 'Scanning...' }
    )
    .setTimestamp();
}

export function formatVirusTotalReport(url: string, analysis: VirusTotalAnalysis): EmbedBuilder {
  const stats = analysis.data.attributes.stats;
  const totalEngines = stats.harmless + stats.malicious + stats.suspicious + stats.undetected + stats.timeout;
  const detectionRate = ((stats.malicious + stats.suspicious) / totalEngines * 100).toFixed(1);
  
  let riskLevel: string;
  let riskColor: number;
  
  if (stats.malicious > 0) {
    riskLevel = 'High Risk';
    riskColor = Colors.Red;
  } else if (stats.suspicious > 0) {
    riskLevel = 'Suspicious';
    riskColor = Colors.Yellow;
  } else {
    riskLevel = 'Safe';
    riskColor = Colors.Green;
  }

  const embed = new EmbedBuilder()
    .setColor(riskColor)
    .setTitle(`🔍 URL Scan Results`)
    .setDescription('Analysis complete! Here are the results:')
    .addFields(
      { name: '🎯 Target URL', value: url },
      { name: '⚠️ Risk Level', value: riskLevel },
      { 
        name: '📊 Detection Stats', 
        value: [
          `🔴 Malicious: ${stats.malicious}`,
          `🟡 Suspicious: ${stats.suspicious}`,
          `🟢 Clean: ${stats.harmless}`,
          `⚪ Undetected: ${stats.undetected}`,
          `⏳ Timeout: ${stats.timeout}`,
          `📈 Detection Rate: ${detectionRate}%`
        ].join('\n')
      }
    )
    .setTimestamp()
    .setFooter({ text: 'Powered by VirusTotal' });

  // Add detailed results if there are any malicious/suspicious findings
  if (stats.malicious > 0 || stats.suspicious > 0) {
    type ScanResult = {
      category: string;
      result: string;
    };

    const detections = Object.entries(analysis.data.attributes.results)
      .filter(([_, result]: [string, ScanResult]) => 
        result.category === 'malicious' || result.category === 'suspicious'
      )
      .map(([engine, result]: [string, ScanResult]) => 
        `• ${engine}: ${result.result || result.category}`
      )
      .slice(0, 10) // Limit to top 10 detections
      .join('\n');

    if (detections) {
      embed.addFields({
        name: '🚨 Top Detections',
        value: detections || 'No specific detections available'
      });
    }
  }

  return embed;
}

function capitalizeFirstLetter(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function formatWeatherReport(forecast: any): EmbedBuilder {
  const currentPeriod = forecast.properties.periods[0];
  const nextPeriod = forecast.properties.periods[1];

  // Determine embed color based on temperature
  let color: number;
  if (currentPeriod.temperature < 50) {
    color = Colors.Blue; // Cold
  } else if (currentPeriod.temperature < 70) {
    color = Colors.Green; // Mild
  } else if (currentPeriod.temperature < 85) {
    color = Colors.Yellow; // Warm
  } else {
    color = Colors.Red; // Hot
  }

  // Create weather condition emoji
  const getWeatherEmoji = (forecast: string): string => {
    const lowercaseForecast = forecast.toLowerCase();
    if (lowercaseForecast.includes('sun')) return '☀️';
    if (lowercaseForecast.includes('cloud')) return '☁️';
    if (lowercaseForecast.includes('rain')) return '🌧️';
    if (lowercaseForecast.includes('snow')) return '❄️';
    if (lowercaseForecast.includes('fog')) return '🌫️';
    if (lowercaseForecast.includes('wind')) return '💨';
    if (lowercaseForecast.includes('storm')) return '⛈️';
    return '🌡️';
  };

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`San Francisco Weather Report ${getWeatherEmoji(currentPeriod.shortForecast)}`)
    .setDescription(currentPeriod.detailedForecast)
    .addFields(
      { 
        name: '🌡️ Temperature', 
        value: `${currentPeriod.temperature}°${currentPeriod.temperatureUnit}`,
        inline: true 
      },
      { 
        name: '💨 Wind', 
        value: `${currentPeriod.windSpeed} ${currentPeriod.windDirection}`,
        inline: true 
      },
      { 
        name: '⏰ Period', 
        value: currentPeriod.name,
        inline: true 
      },
      {
        name: `📅 Next Period (${nextPeriod.name})`,
        value: `${nextPeriod.temperature}°${nextPeriod.temperatureUnit} - ${nextPeriod.shortForecast}`,
        inline: false
      }
    )
    .setTimestamp()
    .setFooter({ text: 'Data from National Weather Service' });

  return embed;
}

interface WeatherPeriod {
  startTime: string;
  temperature: number;
  temperatureUnit: string;
  shortForecast: string;
  name: string;
  windSpeed: string;
  windDirection: string;
}

export function formatHourlyForecast(forecast: any): EmbedBuilder {
  const next12Hours = forecast.properties.periods.slice(0, 12);
  
  const embed = new EmbedBuilder()
    .setColor(Colors.Blue)
    .setTitle('📊 San Francisco Hourly Forecast')
    .setDescription('Next 12 hours forecast:')
    .addFields(
      next12Hours.map((period: WeatherPeriod) => ({
        name: `${new Date(period.startTime).toLocaleTimeString('en-US', { hour: 'numeric' })}`,
        value: `${period.temperature}°${period.temperatureUnit} - ${period.shortForecast}`,
        inline: true
      }))
    )
    .setTimestamp()
    .setFooter({ text: 'Data from National Weather Service' });

  return embed;
}

export function formatExtendedForecast(forecast: any): EmbedBuilder {
  const periods = forecast.properties.periods;
  
  const embed = new EmbedBuilder()
    .setColor(Colors.Blue)
    .setTitle('📅 San Francisco Extended Forecast')
    .setDescription('Next 7 days forecast:')
    .addFields(
      periods.map((period: WeatherPeriod) => ({
        name: period.name,
        value: `${period.temperature}°${period.temperatureUnit} - ${period.shortForecast}\n${period.windSpeed} ${period.windDirection}`,
        inline: false
      }))
    )
    .setTimestamp()
    .setFooter({ text: 'Data from National Weather Service' });

  return embed;
}

export function formatWeatherAlerts(alerts: any[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(Colors.Orange)
    .setTitle('⚠️ San Francisco Weather Alerts')
    .setTimestamp()
    .setFooter({ text: 'Data from National Weather Service' });

  if (alerts.length === 0) {
    embed.setDescription('No active weather alerts for San Francisco.');
    return embed;
  }

  // Sort alerts by severity
  const severityOrder = {
    'Extreme': 0,
    'Severe': 1,
    'Moderate': 2,
    'Minor': 3,
    'Unknown': 4
  };

  alerts.sort((a, b) => {
    const severityA = severityOrder[a.properties.severity as keyof typeof severityOrder] || 4;
    const severityB = severityOrder[b.properties.severity as keyof typeof severityOrder] || 4;
    return severityA - severityB;
  });

  // Add each alert as a field
  alerts.forEach(alert => {
    const props = alert.properties;
    const timeUntilEnd = props.ends ? `Ends: ${new Date(props.ends).toLocaleString()}` : 'No end time specified';
    
    let emoji = '⚠️';
    switch (props.severity.toLowerCase()) {
      case 'extreme': emoji = '🔴'; break;
      case 'severe': emoji = '🟡'; break;
      case 'moderate': emoji = '🟠'; break;
      case 'minor': emoji = '🟢'; break;
    }

    embed.addFields({
      name: `${emoji} ${props.event}`,
      value: [
        `**Severity:** ${props.severity}`,
        `**Status:** ${props.certainty}`,
        `**${timeUntilEnd}**`,
        '',
        props.headline,
        '',
        props.instruction ? `**Instructions:** ${props.instruction}` : ''
      ].filter(Boolean).join('\n'),
      inline: false
    });
  });

  return embed;
}

export function getWeatherButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('hourly')
        .setLabel('Hourly Forecast')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('extended')
        .setLabel('Extended Forecast')
        .setStyle(ButtonStyle.Primary)
    );
}

export function getBackButton(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('back')
        .setLabel('Back to Current Weather')
        .setStyle(ButtonStyle.Secondary)
    );
} 