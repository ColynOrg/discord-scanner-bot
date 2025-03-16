import axios from 'axios';

interface IPQSResponse {
  message: string;
  success: boolean;
  unsafe: boolean;
  domain: string;
  ip_address: string;
  server: string;
  content_type: string;
  status_code: number;
  page_size: number;
  domain_rank: number;
  dns_valid: boolean;
  parking: boolean;
  spamming: boolean;
  malware: boolean;
  phishing: boolean;
  suspicious: boolean;
  adult: boolean;
  risk_score: number;
  domain_age: {
    human: string;
    timestamp: number;
    iso: string;
  };
  category: string;
  domain_trust: string;
  technologies: string[];
  page_title: string;
}

export class URLScannerService {
  private readonly API_KEY = process.env.IPQS_API_KEY;
  private readonly BASE_URL = 'https://www.ipqualityscore.com/api/json/url';
  private readonly STRICTNESS = 1; // Medium strictness level

  public async scanUrl(url: string): Promise<IPQSResponse> {
    try {
      const encodedUrl = encodeURIComponent(url);
      const response = await axios.get<IPQSResponse>(
        `${this.BASE_URL}/${this.API_KEY}/${encodedUrl}`,
        {
          params: {
            strictness: this.STRICTNESS
          }
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.message || 'Failed to scan URL');
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to scan URL: ${error.response?.data?.message || error.message}`);
      }
      throw error;
    }
  }

  private getRiskLevel(score: number): { level: string; color: number } {
    if (score >= 85) {
      return { level: 'High Risk', color: 0xFF0000 }; // Red
    } else if (score >= 60) {
      return { level: 'Medium Risk', color: 0xFFA500 }; // Orange
    } else if (score >= 30) {
      return { level: 'Low Risk', color: 0xFFFF00 }; // Yellow
    } else {
      return { level: 'Safe', color: 0x00FF00 }; // Green
    }
  }

  private formatTechnologies(technologies: string[]): string {
    if (!technologies || technologies.length === 0) return 'None detected';
    return technologies.slice(0, 5).join(', ') + (technologies.length > 5 ? '...' : '');
  }

  private getStatusEmoji(value: boolean | undefined): string {
    return value ? '⚠️' : '✅';
  }

  public createEmbed(result: IPQSResponse) {
    const { level, color } = this.getRiskLevel(result.risk_score);
    const domainAge = result.domain_age.human;
    const technologies = this.formatTechnologies(result.technologies);

    return {
      color: color,
      title: '🔍 URL Scan Results',
      url: `https://www.ipqualityscore.com/threat-feeds/malicious-url-scanner/check/${encodeURIComponent(result.domain)}`,
      description: `Scan results for [${result.domain}](${result.domain})`,
      fields: [
        {
          name: '🎯 Risk Assessment',
          value: [
            `**Risk Level:** ${level} (Score: ${result.risk_score}/100)`,
            `**Domain Trust:** ${result.domain_trust.charAt(0).toUpperCase() + result.domain_trust.slice(1)}`,
            `**Domain Age:** ${domainAge}`,
            `**Domain Rank:** ${result.domain_rank > 0 ? `#${result.domain_rank.toLocaleString()}` : 'Unranked'}`
          ].join('\n'),
          inline: false
        },
        {
          name: '🛡️ Security Checks',
          value: [
            `${this.getStatusEmoji(result.malware)} Malware`,
            `${this.getStatusEmoji(result.phishing)} Phishing`,
            `${this.getStatusEmoji(result.suspicious)} Suspicious`,
            `${this.getStatusEmoji(result.spamming)} Spam`,
            `${this.getStatusEmoji(result.parking)} Parked Domain`
          ].join('\n'),
          inline: true
        },
        {
          name: '🔧 Technical Details',
          value: [
            `**Server:** ${result.server || 'Unknown'}`,
            `**Category:** ${result.category || 'Uncategorized'}`,
            `**Technologies:** ${technologies}`,
            `**Status Code:** ${result.status_code}`
          ].join('\n'),
          inline: true
        }
      ],
      footer: {
        text: 'Powered by IPQualityScore',
        icon_url: 'https://www.ipqualityscore.com/img/logo.png'
      },
      timestamp: new Date().toISOString()
    };
  }
} 