const logger = require("../utils/logger");

const requestLogger = (req, res, next) => {
  const startedAt = Date.now();
  logger.info(
    {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      origin: req.get("origin") || undefined
    },
    "Incoming request"
  );

  res.on("finish", () => {
    logger.info(
      {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - startedAt
      },
      "Request completed"
    );
  });

  next();
};

module.exports = requestLogger;
