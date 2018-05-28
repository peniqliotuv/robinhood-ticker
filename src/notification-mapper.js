const moment = require('moment-timezone');
const path = require('path');
const {
  Notification
} = require('electron');
const {
  isAfterHours
} = require('./utils/stockHelpers.js');


class NotificationMapper {

  constructor() {
    this.positionsMap = new Map();
    this.watchlistMap = new Map();
    this.date = null;
    this.thresholdPercent = 2;
  }

  set thresholdPercent(percent) {
    this._thresholdPercent = percent;
  }

  get thresholdPercent() {
    return this._thresholdPercent;
  }

  getDate() {
    return moment().tz('America/New_York').format("MMM Do YY");;
  }

  clear() {
    this.positionsMap.clear();
    this.watchlistMap.clear();
  }

  notify(positions = [], watchlist = []) {
    console.log(`Size of positionsMap: ${this.positionsMap.size}`);
    console.log(`Size of watchlistMap: ${this.watchlistMap.size}`);
    if (!this.date || this.date !== this.getDate()) {
      console.log('Date is empty');
      this.date = this.getDate();
      this.clear();
    }
    /* Array of notifications to be sent to the notification center */
    const notifications = [];
    const afterHours = isAfterHours();
    /* Iterate through all of the positions and watchlists, calculating if their difference >= 5% */
    positions.forEach(({
      quote,
      symbol
    }) => {
      const equity = (isAfterHours && quote.last_extended_hours_trade_price !== null) ? quote.last_extended_hours_trade_price : quote.last_trade_price;
      let entry = this.positionsMap.get(symbol);
      console.log('positions', symbol, entry);
      if (entry !== undefined) {
        const {
          equity: oldEquity,
          hasNotificationTriggered,
        } = entry;
        if (!hasNotificationTriggered) {
          const notif = this.createNotification(symbol, equity, oldEquity);
          if (notif !== null) {
            notifications.push(notif);
            entry.hasNotificationTriggered = true;
            this.positionsMap.set(symbol, entry);
          }
        }
      } else {
        entry = {
          equity,
          hasNotificationTriggered: false,
        };
        this.positionsMap.set(symbol, entry);
      }
    });

    watchlist.forEach(({
      symbol,
      last_extended_hours_trade_price,
      last_trade_price
    }) => {
      const equity = (isAfterHours && last_extended_hours_trade_price !== null) ? last_extended_hours_trade_price : last_trade_price;
      let entry = this.watchlistMap.get(symbol);
      console.log('watchlist', symbol, entry);
      if (entry !== undefined) {
        const {
          equity: oldEquity,
          hasNotificationTriggered,
        } = entry;
        if (!hasNotificationTriggered) {
          const notif = this.createNotification(symbol, equity, oldEquity);
          if (notif !== null) {
            notifications.push(notif);
            entry.hasNotificationTriggered = true;
            this.positionsMap.set(symbol, entry);
          }
        }
      } else {
        entry = {
          equity,
          hasNotificationTriggered: false,
        };
        this.positionsMap.set(symbol, entry);
      }
    });

    for (const notif of notifications) {
      this.showNotification(notif);
    }
  }

  createNotification(symbol, equity, oldEquity) {
    const diff = Number(equity) - Number(oldEquity);
    if (Math.abs(diff / Number(oldEquity)) >= this.thresholdPercent / 100) {
      if (Math.sign(diff) === 1) {
        console.log(`Greater than ${this.thresholdPercent / 100}`);
        return `${symbol} is up ${(diff * 100).toFixed(2)}%`;
      } else {
        console.log(`Less than ${this.thresholdPercent / 100}`);
        return `${symbol} is down ${(diff * 100).toFixed(2)}%`;
      }
    } else {
      console.log(`thresholdpercent == 0, not ${this.thresholdPercent}`);
      return `${symbol} showed no change!`;
    }
    return null;
  }

  showNotification(notification) {
    const notif = new Notification({
      title: 'Price Movement',
      body: notification,
    });

    notif.show();
  }
}

const mapper = new NotificationMapper();
module.exports = mapper;
