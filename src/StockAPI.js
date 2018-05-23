const queryString = require('query-string');
const fetch = require('node-fetch');

class StockAPI {
  constructor() {
    throw new Error('Cannot instantiate StockAPI');
  }

  static get API_KEY() {
    return 'EHW1WVBJZRY8CJJ1';
  }

  static get HOST() {
    return 'https://api.iextrading.com/1.0/';
  }

  /* Gets the simple moving average of a stock */
  static async getSMA(symbol) {
    try {
      const res = await fetch(`${this.HOST}/stock/${symbol}/chart/1d/`);
      const json = await res.json();
      /* Transform into [{x: ... y: ...}, {}]*/
      return json;
    } catch (e) {
      console.error(e);
      console.error(e.stack);
      throw e;
    }
  }
}

module.exports = StockAPI;
