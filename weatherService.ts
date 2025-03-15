import axios from 'axios';

interface WeatherPoint {
  properties: {
    forecast: string;
    forecastHourly: string;
    relativeLocation: {
      properties: {
        city: string;
        state: string;
      };
    };
    gridId: string;
    gridX: number;
    gridY: number;
  };
}

interface WeatherForecast {
  properties: {
    periods: Array<{
      number: number;
      name: string;
      startTime: string;
      endTime: string;
      temperature: number;
      temperatureUnit: string;
      temperatureTrend: string | null;
      windSpeed: string;
      windDirection: string;
      shortForecast: string;
      detailedForecast: string;
      isDaytime: boolean;
    }>;
  };
}

export class WeatherService {
  private readonly baseUrl = 'https://api.weather.gov';
  private readonly userAgent = '(DiscordBot, github.com/ColynOrg/discord-scanner-bot)';
  private lastPoint: WeatherPoint | null = null;
  private lastForecast: WeatherForecast | null = null;
  private lastForecastTime: number = 0;
  private lastHourlyForecast: WeatherForecast | null = null;
  private lastHourlyForecastTime: number = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

  /**
   * Gets the grid point for a given latitude and longitude
   */
  private async getPoint(lat: number, lon: number): Promise<WeatherPoint> {
    try {
      const response = await axios.get(`${this.baseUrl}/points/${lat},${lon}`, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/geo+json'
        }
      });
      this.lastPoint = response.data;
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Error getting weather point:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data
        });
        throw new Error(`Failed to get weather location: ${error.response?.statusText || error.message}`);
      }
      throw error;
    }
  }

  /**
   * Gets the forecast for a given forecast URL
   */
  private async getForecast(forecastUrl: string): Promise<WeatherForecast> {
    try {
      const response = await axios.get(forecastUrl, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/geo+json'
        }
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Error getting forecast:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data
        });
        throw new Error(`Failed to get forecast: ${error.response?.statusText || error.message}`);
      }
      throw error;
    }
  }

  /**
   * Gets weather for San Francisco
   * San Francisco coordinates: 37.7749° N, 122.4194° W
   */
  async getSanFranciscoWeather(): Promise<WeatherForecast> {
    try {
      // Check if we have a cached forecast that's less than 5 minutes old
      const now = Date.now();
      if (this.lastForecast && (now - this.lastForecastTime) < this.CACHE_DURATION) {
        return this.lastForecast;
      }

      // Get the grid point for San Francisco
      const point = await this.getPoint(37.7749, -122.4194);
      console.log('Got weather point:', point.properties.gridId, point.properties.gridX, point.properties.gridY);

      // Get the forecast using the URL from the point response
      const forecast = await this.getForecast(point.properties.forecast);
      
      // Cache the results
      this.lastForecast = forecast;
      this.lastForecastTime = now;
      
      return forecast;
    } catch (error) {
      console.error('Error in getSanFranciscoWeather:', error);
      throw error;
    }
  }

  /**
   * Gets hourly forecast for San Francisco
   */
  async getSanFranciscoHourlyForecast(): Promise<WeatherForecast> {
    try {
      // Check if we have a cached hourly forecast that's less than 5 minutes old
      const now = Date.now();
      if (this.lastHourlyForecast && (now - this.lastHourlyForecastTime) < this.CACHE_DURATION) {
        return this.lastHourlyForecast;
      }

      if (!this.lastPoint) {
        await this.getPoint(37.7749, -122.4194);
      }
      
      if (!this.lastPoint) {
        throw new Error('Failed to get weather point');
      }

      const forecast = await this.getForecast(this.lastPoint.properties.forecastHourly);
      
      // Cache the results
      this.lastHourlyForecast = forecast;
      this.lastHourlyForecastTime = now;
      
      return forecast;
    } catch (error) {
      console.error('Error in getSanFranciscoHourlyForecast:', error);
      throw error;
    }
  }

  /**
   * Gets extended forecast for San Francisco (next 7 days)
   */
  async getSanFranciscoExtendedForecast(): Promise<WeatherForecast> {
    // Extended forecast uses the same endpoint as regular forecast
    return this.getSanFranciscoWeather();
  }
} 