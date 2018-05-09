import queryString from 'query-string';
import fetch from 'node-fetch';

class StockAPI {
  constructor() {
    throw new Error('Cannot instantiate StockAPI');
  }

  static get API_KEY() {
    return 'EHW1WVBJZRY8CJJ1';
  }

  static get HOST() {
    return 'https://www.alphavantage.co';
  }

  /* Gets the simple moving average of a stock */
  static async getSMA(symbol) {
    const query = {
      apikey: this.API_KEY,
      function: 'SMA',
      symbol,
      interval: '15min',
      series_type: 'close',
      time_period: 10
    };
    const qs = queryString.stringify(query);
    try {
      const res = await fetch(`${this.HOST}/query?${qs}`);
      const json = await res.json();
      const data = json['Technical Analysis: SMA'];
      console.log(`Data for ${symbol} received.`);
      /* Transform into [{x: ... y: ...}, {}]*/
      console.log(json);
      return data;
    } catch (e) {
      console.error(e);
      console.error(e.stack);
      throw e;
    }
  }
}

export default StockAPI;
