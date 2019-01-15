const log = require('electron-log');
log.transports.file.format = '{h}:{i}:{s}:{ms} {text}';
log.transports.file.level = 'info';
/* Disable printing to console */
log.transports.console.level = false;

class TimeoutError extends Error {
  constructor(...args) {
    super(...args);
    Error.captureStackTrace(this, TimeoutError);
    log.error(...args);
  }
}

class UnauthorizedError extends Error {
  constructor(...args) {
    super(...args);
    Error.captureStackTrace(this, TimeoutError);
    log.error(...args);
  }
}

module.exports = {
  TimeoutError,
  UnauthorizedError
};
