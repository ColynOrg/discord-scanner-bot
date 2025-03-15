# Discord Scanner Bot

A Discord bot that can scan URLs and files for potential threats using VirusTotal API.

## Features

- `/scan url` - Scan a URL for potential threats using VirusTotal
- `/scan file` - Scan a file for malware using VirusTotal

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file with the following variables:
```
DISCORD_TOKEN=your_discord_bot_token_here
VIRUSTOTAL_API_KEY=your_virustotal_api_key
```

3. Replace `your_discord_bot_token_here` with your Discord bot token from the Discord Developer Portal.

4. Run the bot:
```bash
npm start
```

## Usage

- To scan a URL: `/scan url [url]`
- To scan a file: `/scan file [upload a file]`

## Notes

- Maximum file size for scanning: 32MB
- Please respect API rate limits 