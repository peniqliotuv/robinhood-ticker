const moment = require('moment-timezone');

function isAfterHours() {
  const EST = moment().tz('America/New_York');
  const hours = EST.hours();
  if (hours < 16) {
    return false;
  }
  return true;
}

module.exports = {
  isAfterHours,
};
