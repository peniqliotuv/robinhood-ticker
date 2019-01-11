class ToolTipHelper {
  constructor() {
    this.index = 0;
    this.messages = [
      'Welcome to RH-Ticker!',
      'Manually refresh your portfolio',
      'Open your preferences',
      'Switch between your portfolio and watchlist',
      'Press Command+f to search'
    ];
  }

  get next() {
    return this.index < this.messages.length ? this.messages[++this.index] : '';
  }

  get previous() {
    return this.index > 0 ? this.messages[--this.index] : '';
  }

  get message() {
    return this.messages[this.index];
  }

  get head() {
    return this.index === 0;
  }

  get tail() {
    return this.index === this.messages.length - 1;
  }

  reset() {
    this.index = 0;
  }
}

const helper = new ToolTipHelper();
module.exports = helper;
