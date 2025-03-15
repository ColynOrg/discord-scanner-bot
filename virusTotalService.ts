import fetch, { Response } from 'node-fetch';
import { config } from './config';

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

  private async fetchWithTimeout(url: string, options: any, timeout = 30000): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async scanFile(fileUrl: string): Promise<string> {
    console.log(`Scanning file with VirusTotal: ${fileUrl}`);
    const startTime = Date.now();

    try {
      // First, download the file
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) {
        throw new Error('Failed to download file');
      }

      const fileBuffer = await fileResponse.buffer();

      // Get upload URL
      const urlResponse = await this.fetchWithTimeout(
        `${this.baseUrl}/files/upload_url`,
        {
          method: 'GET',
          headers: {
            'x-apikey': this.apiKey
          }
        }
      );

      if (!urlResponse.ok) {
        throw new Error(`Failed to get upload URL: ${urlResponse.status} ${urlResponse.statusText}`);
      }

      const { data: { url: uploadUrl } } = await urlResponse.json();

      // Upload file
      const formData = new FormData();
      formData.append('file', new Blob([fileBuffer]));

      const uploadResponse = await this.fetchWithTimeout(
        uploadUrl,
        {
          method: 'POST',
          headers: {
            'x-apikey': this.apiKey
          },
          body: formData
        }
      );

      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload file: ${uploadResponse.status} ${uploadResponse.statusText}`);
      }

      const data = await uploadResponse.json();
      return data.data.id;
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Unknown error occurred while scanning file');
    }
  }

  async scanUrl(url: string): Promise<string> {
    console.log(`Scanning URL with VirusTotal: ${url}`);
    const startTime = Date.now();

    try {
      // First, check if we have a recent analysis
      const urlId = Buffer.from(url).toString('base64');
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/urls/${urlId}`,
        {
          method: 'GET',
          headers: {
            'x-apikey': this.apiKey
          }
        }
      );

      if (response.status === 404) {
        // No existing analysis, submit URL for scanning
        const scanResponse = await this.fetchWithTimeout(
          `${this.baseUrl}/urls`,
          {
            method: 'POST',
            headers: {
              'x-apikey': this.apiKey,
              'content-type': 'application/x-www-form-urlencoded'
            },
            body: `url=${encodeURIComponent(url)}`
          }
        );

        if (!scanResponse.ok) {
          throw new Error(`Failed to submit URL for scanning: ${scanResponse.status} ${scanResponse.statusText}`);
        }

        const data = await scanResponse.json();
        return data.data.id;
      } else if (response.ok) {
        // Existing analysis found
        const data = await response.json();
        return data.data.id;
      } else {
        throw new Error(`Failed to check URL analysis: ${response.status} ${response.statusText}`);
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Unknown error occurred while scanning URL');
    }
  }

  async getAnalysisResults(analysisId: string): Promise<VirusTotalAnalysis> {
    const maxAttempts = 30; // 5 minutes total with 10-second delay
    const delay = 10000; // 10 seconds between attempts
    let attempts = 0;
    const startTime = Date.now();

    while (attempts < maxAttempts) {
      try {
        const response = await this.fetchWithTimeout(
          `${this.baseUrl}/analyses/${analysisId}`,
          {
            method: 'GET',
            headers: {
              'x-apikey': this.apiKey
            }
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to get analysis results: ${response.status} ${response.statusText}`);
        }

        const result = await response.json() as VirusTotalAnalysis;
        const elapsedTime = (Date.now() - startTime) / 1000;
        const remainingAttempts = maxAttempts - attempts - 1;

        console.log(`Polling attempt ${attempts + 1}/${maxAttempts} - Status: ${result.data.attributes.status}`);
        console.log(`Elapsed time: ${elapsedTime.toFixed(1)}s, Remaining attempts: ${remainingAttempts}`);

        if (result.data.attributes.status === 'completed') {
          return result;
        }

        attempts++;
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        console.error(`Error during polling attempt ${attempts + 1}:`, error);
        attempts++;
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    const totalTime = (Date.now() - startTime) / 1000;
    throw new Error(`Analysis timeout: Results not available after ${totalTime.toFixed(1)} seconds (${maxAttempts} attempts)`);
  }
} 