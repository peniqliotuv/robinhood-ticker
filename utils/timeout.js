class TimeoutError extends Error {
  constructor(...args) {
    super(...args);
    Error.captureStackTrace(this, TimeoutError);
  }
}


function timeout(ms = 5000, promise) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new TimeoutError(`Timeout: ${ms}ms`));
    }, ms);
    promise.then(resolve, reject);
  });
}

module.exports = { timeout, TimeoutError };
