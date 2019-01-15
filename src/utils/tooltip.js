class ToolTipHelper {
  constructor() {
    this.index = 0;
    this.messages = [
      'Welcome to RH-Ticker!',
      'Manually refresh your portfolio by hitting the button in the top-left',
      'Open your preferences by hitting the settings icon in the top-right',
      'Switch between your portfolio and watchlist by clicking on the tabs above',
      'Long-press on any equity to rearrange its order on the list',
      'Press ⌘+f to search for an equity'
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
