import fetch, { Response } from 'node-fetch';
import { config } from './config';
import FormData from 'form-data';

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
    console.log(`Starting file scan process for URL: ${fileUrl}`);
    const startTime = Date.now();

    try {
      // First, download the file
      console.log('Step 1: Downloading file...');
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) {
        const error = `Failed to download file (Status ${fileResponse.status}): ${fileResponse.statusText}`;
        console.error(error);
        throw new Error(error);
      }
      console.log('File download successful');

      console.log('Step 2: Converting file to buffer...');
      const fileBuffer = await fileResponse.buffer();
      const fileSizeMB = fileBuffer.length / (1024 * 1024);
      console.log(`File buffer created, size: ${fileSizeMB.toFixed(2)} MB`);

      // Check file size limit (32MB)
      if (fileSizeMB > 32) {
        throw new Error(`File size (${fileSizeMB.toFixed(2)} MB) exceeds the 32 MB limit`);
      }

      // Get upload URL
      console.log('Step 3: Getting VirusTotal upload URL...');
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
        const errorBody = await urlResponse.text();
        const error = `Failed to get upload URL (Status ${urlResponse.status}): ${errorBody}`;
        console.error(error);
        throw new Error(error);
      }

      const urlData = await urlResponse.json();
      console.log('Successfully got upload URL');

      // Upload file
      console.log('Step 4: Creating form data...');
      const formData = new FormData();
      formData.append('file', fileBuffer, {
        filename: 'scan_file',
        contentType: 'application/octet-stream'
      });
      console.log('Form data created');

      console.log('Step 5: Uploading file to VirusTotal...');
      const uploadResponse = await this.fetchWithTimeout(
        urlData.data.url,
        {
          method: 'POST',
          headers: {
            'x-apikey': this.apiKey,
            ...formData.getHeaders()
          },
          body: formData,
          timeout: 60000 // Increase timeout for large files
        }
      );

      if (!uploadResponse.ok) {
        const errorBody = await uploadResponse.text();
        const error = `Failed to upload file (Status ${uploadResponse.status}): ${errorBody}`;
        console.error(error);
        throw new Error(error);
      }

      console.log('File upload successful');
      const data = await uploadResponse.json();
      console.log('Upload response parsed successfully');
      
      const elapsedTime = (Date.now() - startTime) / 1000;
      console.log(`File scan process completed in ${elapsedTime.toFixed(1)} seconds`);
      
      if (!data?.data?.id) {
        throw new Error('Invalid response from VirusTotal: Missing analysis ID');
      }

      return data.data.id;
    } catch (error: unknown) {
      const elapsedTime = (Date.now() - startTime) / 1000;
      console.error(`Error in scanFile after ${elapsedTime.toFixed(1)} seconds:`, error);
      if (error instanceof Error) {
        console.error('Error stack:', error.stack);
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