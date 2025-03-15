import { EmbedBuilder, Colors } from 'discord.js';
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