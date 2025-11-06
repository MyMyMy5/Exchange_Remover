require("dotenv").config();

const express = require("express");
const cors = require("cors");
const createHttpError = require("http-errors");

const requestContext = require("./middleware/requestContext");
const requestLogger = require("./middleware/requestLogger");
const exchangeRouter = require("./routes/exchangeRoutes");
const logger = require("./utils/logger");

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
  : "*";

const corsOptions =
  allowedOrigins === "*"
    ? { origin: true, credentials: true }
    : {
        origin: allowedOrigins,
        credentials: true
      };

app.use(requestContext);
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use(requestLogger);

app.get("/healthz", (_, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api", exchangeRouter);

app.use((req, res, next) => {
  next(createHttpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const expose = typeof err.expose === "boolean" ? err.expose : status < 500;
  const response = {
    message: expose ? err.message || "Unexpected server error" : "Unexpected server error",
    status,
    requestId: req.requestId
  };

  if (err.details) {
    response.details = err.details;
  } else if (err.cause?.message && expose) {
    response.details = { cause: err.cause.message };
  }

  logger.error(
    {
      error: err,
      requestId: req.requestId,
      status,
      details: err.details,
      cause: err.cause ? { message: err.cause.message, name: err.cause.name } : undefined
    },
    "Unhandled error"
  );

  res.status(status).json({
    error: response
  });
});

const port = process.env.PORT || 5000;
const server = app.listen(port, () => {
  logger.info({ port }, "Exchange management API listening");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (error) => {
  logger.fatal({ error }, "Uncaught exception");
  server.close(() => {
    process.exit(1);
  });
});
