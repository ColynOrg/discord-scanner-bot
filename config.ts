import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  VIRUSTOTAL_API_KEY: string;
}

export const config: Config = {
  VIRUSTOTAL_API_KEY: process.env.VIRUSTOTAL_API_KEY || ''
}; 