function createHttpError(statusCode, message, details = null, errorCode = null) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.details = details;
  err.errorCode = errorCode;
  return err;
}

module.exports = {
  createHttpError
};
