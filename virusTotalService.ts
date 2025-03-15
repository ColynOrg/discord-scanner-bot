import fetch from 'node-fetch';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { basename } from 'path';

export interface VirusTotalAnalysis {
  data: {
    id: string;
    type: string;
    attributes: {
      status: string;
      stats: {
        harmless: number;
        malicious: number;
        suspicious: number;
        undetected: number;
        timeout: number;
      };
      results: {
        [engine: string]: {
          category: string;
          result: string;
          method: string;
          engine_name: string;
        };
      };
    };
  };
}

export interface VirusTotalScanResult {
  malicious: number;
  total: number;
  status: string;
}

export class VirusTotalService {
  private readonly baseUrl = 'https://www.virustotal.com/api/v3';
  private readonly apiKey: string;

  constructor() {
    this.apiKey = process.env.VIRUSTOTAL_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('VirusTotal API key not found in environment variables');
    }
  }

  /**
   * Downloads a file from Discord's CDN and saves it temporarily
   */
  private async downloadFile(url: string): Promise<Buffer> {
    console.log('Downloading file from Discord CDN...');
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'DiscordBot (https://discord.js.org, 1.0.0)'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    return await response.buffer();
  }

  /**
   * Gets a special upload URL for large files
   */
  private async getUploadUrl(): Promise<string> {
    console.log('Getting upload URL from VirusTotal...');
    const response = await fetch(`${this.baseUrl}/files/upload_url`, {
      headers: {
        'x-apikey': this.apiKey
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get upload URL: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.data.url;
  }

  /**
   * Uploads a file to VirusTotal
   */
  private async uploadFile(fileBuffer: Buffer, uploadUrl: string): Promise<string> {
    console.log('Uploading file to VirusTotal...');
    const form = new FormData();
    form.append('file', fileBuffer, {
      filename: 'file',
      contentType: 'application/octet-stream'
    });

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'x-apikey': this.apiKey
      },
      body: form
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to upload file: ${response.status} ${response.statusText}\n${text}`);
    }

    const data = await response.json();
    return data.data.id;
  }

  /**
   * Main method to scan a file
   */
  async scanFile(fileUrl: string): Promise<string> {
    try {
      // Step 1: Download the file from Discord
      const fileBuffer = await this.downloadFile(fileUrl);
      
      // Step 2: Check file size
      const fileSizeMB = fileBuffer.length / (1024 * 1024);
      console.log(`File size: ${fileSizeMB.toFixed(2)} MB`);
      
      if (fileSizeMB > 32) {
        throw new Error('File size exceeds 32MB limit');
      }

      // Step 3: Get upload URL (always get a fresh URL)
      const uploadUrl = await this.getUploadUrl();

      // Step 4: Upload the file
      return await this.uploadFile(fileBuffer, uploadUrl);
    } catch (error) {
      console.error('Error in scanFile:', error);
      throw error;
    }
  }

  /**
   * Gets the analysis results for a file
   */
  async getAnalysisResults(analysisId: string): Promise<VirusTotalAnalysis> {
    console.log(`Getting analysis results for ID: ${analysisId}`);
    const maxAttempts = 10;
    const delaySeconds = 15;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`Attempt ${attempt}/${maxAttempts}`);
      
      const response = await fetch(`${this.baseUrl}/analyses/${analysisId}`, {
        headers: {
          'x-apikey': this.apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get analysis: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.data.attributes.status === 'completed') {
        return result;
      }

      if (attempt < maxAttempts) {
        console.log(`Analysis not ready, waiting ${delaySeconds} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      }
    }

    throw new Error('Analysis timed out');
  }

  /**
   * Scans a URL
   */
  async scanUrl(url: string): Promise<string> {
    console.log(`Scanning URL: ${url}`);
    const response = await fetch(`${this.baseUrl}/urls`, {
      method: 'POST',
      headers: {
        'x-apikey': this.apiKey,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: `url=${encodeURIComponent(url)}`
    });

    if (!response.ok) {
      throw new Error(`Failed to scan URL: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.data.id;
  }
} 