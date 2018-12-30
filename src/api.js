class RobinHoodAPI {
  constructor() {
    if (!RobinHoodAPI.instance) {
      this._token = '';
      this._accountNumber = '';
      this._positions = [];
      this._portfolio = {};
      this._watchlist = [];
      RobinHoodAPI.instance = this;
    }
    return RobinHoodAPI.instance;
  }

  get token() {
    return this._token;
  }

  set token(newToken) {
    this._token = newToken;
  }

  get accountNumber() {
    return this._accountNumber;
  }

  set accountNumber(number) {
    this._accountNumber = number;
  }

  get positions() {
    return this._positions;
  }

  set positions(positions) {
    this._positions = positions;
  }

  get portfolio() {
    return this._portfolio;
  }

  get watchlist() {
    return this._watchlist;
  }

  set watchlist(watchlist) {
    this._watchlist = watchlist;
  }

  set portfolio(portfolio) {
    this._portfolio = portfolio;
  }

  async getAccountNumber() {
    const { token, accountNumber } = this;
    if (!token) {
      throw new Error('Token must be non-null');
    }
    if (!accountNumber) {
      try {
        const res = await fetch('https://api.robinhood.com/accounts/', {
          Authorization: `Token ${token}`
        });
        if (res.ok) {
          const json = await res.json();
          return json.results[0].account_number;
        }
      } catch (e) {
        throw e;
      }
    } else {
      return accountNumber;
    }
  }

  async getPositions() {
    if (!this.accountNumber) {
      throw new Error('No account number provided');
    } else {
      try {
        const res = await fetch(
          `https://api.robinhood.com/accounts/${this.accountNumber}/positions/`
        );
        if (res.ok) {
          const json = await res.json();
          const transformed = await Promise.all(
            json.results
              .filter(result => Number(result.quantity) !== 0)
              .map(async result => {
                const instrument = await (await fetch(
                  decodeURIComponent(result.instrument)
                )).json();
                const quote = await (await fetch(
                  decodeURIComponent(instrument.quote)
                )).json();
                return {
                  averageBuyPrice: result.average_buy_price,
                  instrument: result.instrument,
                  quantity: Number(result.quantity),
                  quote: quote,
                  currentPrice: quote.last_traded_price,
                  symbol: instrument.symbol,
                  name: instrument.name,
                  instrument: instrument
                };
              })
          );
          return transformed;
        }
      } catch (e) {
        console.log(e.stack);
        throw e;
      }
    }
  }

  async getPortfolio() {
    try {
      const res = await fetch(
        `https://api.robinhood.com/accounts/${this.accountNumber}/portfolio/`
      );
      if (res.ok) {
        return await res.json();
      } else {
        throw new Error('Could not retrieve portfolio');
      }
    } catch (e) {
      console.log(e);
      throw e;
    }
  }

  async getWatchlist() {
    try {
      const res = await fetch('https://api.robinhood.com/watchlists/Default/');
      const json = await res.json();
      if (res.ok) {
        return await Promise.all(
          json.results.map(async result => {
            const instrument = await (await fetch(
              decodeURIComponent(result.instrument)
            )).json();
            return await (await fetch(
              decodeURIComponent(instrument.quote)
            )).json();
          })
        );
      }
    } catch (e) {
      console.error(e.stack, e);
    }
  }

  async login(username, password, mfa_code) {
    try {
      const res = await fetch('https://api.robinhood.com/api-token-auth/', {
        method: 'POST',
        Accept: 'application/json',
        body: JSON.stringify({
          username,
          password,
          mfa_code
        })
      });
      const json = await res.json();
      if (res.ok) {
        return {
          success: true,
          twoFactorAuthRequired: Boolean(json.mfa_required),
          token: json.token || null
        };
      } else {
        // Get the error message from RobinHood and re-throw it
        let message = '';
        if (json.non_field_errors) {
          message = json.non_field_errors[0];
        } else if (json.mfa_code) {
          message = json.mfa_code[0];
        }
        throw new Error(message);
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

let data = new RobinHoodAPI();

module.exports = data;
