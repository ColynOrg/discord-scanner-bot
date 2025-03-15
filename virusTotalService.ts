import fetch from 'node-fetch';
import FormData from 'form-data';
import axios from 'axios';
import { Readable } from 'stream';

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
   * Downloads a file from Discord's CDN
   */
  private async downloadFile(url: string): Promise<Buffer> {
    console.log('Downloading file from Discord CDN...');
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'DiscordBot (https://discord.js.org, 1.0.0)'
      }
    });

    return Buffer.from(response.data);
  }

  /**
   * Gets a special upload URL for files
   */
  private async getUploadUrl(): Promise<string> {
    console.log('Getting upload URL from VirusTotal...');
    const response = await axios.get(`${this.baseUrl}/files/upload_url`, {
      headers: {
        'x-apikey': this.apiKey,
        'accept': 'application/json'
      }
    });

    return response.data.data.url;
  }

  /**
   * Main method to scan a file
   */
  async scanFile(fileUrl: string): Promise<string> {
    try {
      // Step 1: Download file from Discord
      const fileBuffer = await this.downloadFile(fileUrl);
      console.log('File downloaded successfully');

      // Step 2: Check file size
      const fileSizeMB = fileBuffer.length / (1024 * 1024);
      console.log(`File size: ${fileSizeMB.toFixed(2)} MB`);
      
      if (fileSizeMB > 32) {
        throw new Error('File size exceeds 32MB limit');
      }

      // Step 3: Get upload URL
      const uploadUrl = await this.getUploadUrl();
      console.log('Got upload URL:', uploadUrl);

      // Step 4: Upload file
      console.log('Uploading file to VirusTotal...');
      const form = new FormData();
      
      // Convert buffer to readable stream
      const stream = new Readable();
      stream.push(fileBuffer);
      stream.push(null);

      form.append('file', stream, {
        filename: 'scan_file',
        contentType: 'application/octet-stream',
        knownLength: fileBuffer.length
      });

      const formHeaders = form.getHeaders();
      console.log('Form headers:', formHeaders);

      const uploadResponse = await axios.post(uploadUrl, form, {
        headers: {
          ...formHeaders,
          'x-apikey': this.apiKey,
          'accept': 'application/json'
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      console.log('Upload successful');
      return uploadResponse.data.data.id;

    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Axios error:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          headers: error.response?.headers
        });
        throw new Error(`File scan failed: ${error.response?.statusText || error.message}`);
      }
      console.error('Error in scanFile:', error);
      throw error;
    }
  }

  /**
   * Gets the analysis results
   */
  async getAnalysisResults(analysisId: string): Promise<VirusTotalAnalysis> {
    console.log(`Getting analysis results for ID: ${analysisId}`);
    const maxAttempts = 10;
    const delaySeconds = 15;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`Attempt ${attempt}/${maxAttempts}`);
      
      try {
        const response = await axios.get(`${this.baseUrl}/analyses/${analysisId}`, {
          headers: {
            'x-apikey': this.apiKey,
            'accept': 'application/json'
          }
        });

        const result = response.data;
        
        if (result.data.attributes.status === 'completed') {
          return result;
        }

        if (attempt < maxAttempts) {
          console.log(`Analysis not ready, waiting ${delaySeconds} seconds...`);
          await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error('Error getting analysis:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data
          });
        }
        throw error;
      }
    }

    throw new Error('Analysis timed out');
  }

  /**
   * Scans a URL
   */
  async scanUrl(url: string): Promise<string> {
    try {
      console.log(`Scanning URL: ${url}`);
      const response = await axios.post(
        `${this.baseUrl}/urls`,
        `url=${encodeURIComponent(url)}`,
        {
          headers: {
            'x-apikey': this.apiKey,
            'content-type': 'application/x-www-form-urlencoded',
            'accept': 'application/json'
          }
        }
      );

      return response.data.data.id;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Error scanning URL:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data
        });
        throw new Error(`URL scan failed: ${error.response?.statusText || error.message}`);
      }
      throw error;
    }
  }
} 