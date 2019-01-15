const log = require('electron-log');
const { TimeoutError } = require('./error');
log.transports.file.format = '{h}:{i}:{s}:{ms} {text}';
log.transports.file.level = 'info';
/* Disable printing to console */
log.transports.console.level = false;

function timeout(ms = 5000, promise) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new TimeoutError(`Timeout: ${ms}ms`));
    }, ms);
    promise.then(resolve, reject);
  });
}

module.exports = {
  timeout,
  TimeoutError
};
