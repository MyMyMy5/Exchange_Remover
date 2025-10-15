const express = require("express");
const Joi = require("joi");
const createError = require("http-errors");
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");
const logger = require("../utils/logger");
const { appendLogEntry, readLogEntries } = require("../utils/logStore");

const { searchMessages, deleteMessages, listMailboxes } = require("../services/exchangeService");

const router = express.Router();

const activePurges = new Map();

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const filterBaseSchema = Joi.object({
  sender: Joi.string().email({ tlds: { allow: false } }),
  subject: Joi.string().max(256),
  receivedFrom: Joi.date().iso(),
  receivedTo: Joi.date().iso(),
  maxPerMailbox: Joi.number().integer().min(1).max(2000)
})
  .custom((value, helpers) => {
    const hasPrimaryFilter = Boolean(value.sender || value.subject);

    if (!hasPrimaryFilter) {
      return helpers.error("any.custom", {
        message: "Sender email is required."
      });
    }

    if (value.receivedFrom && value.receivedTo && value.receivedFrom > value.receivedTo) {
      return helpers.error("date.max", {
        limit: value.receivedFrom.toISOString(),
        value: value.receivedTo.toISOString()
      });
    }

    return value;
  }, "filter requirement")
  .messages({
    "any.custom": "Sender email must be provided.",
    "date.max": "receivedTo must be greater than or equal to receivedFrom."
  });

const deleteSchema = filterBaseSchema
  .fork(["sender"], (schema) => schema.required())
  .keys({
    simulate: Joi.boolean().default(true)
  });

const purgeSchema = Joi.object({
  senderEmail: Joi.string().email({ tlds: { allow: false } }).required(),
  subjectContains: Joi.string().max(256).allow(""),
  subjectEqual: Joi.string().max(256).allow(""),
  receivedFrom: Joi.date().iso(),
  receivedTo: Joi.date().iso(),
  simulate: Joi.boolean().default(true),
  allowHardDelete: Joi.boolean().default(false),
  method: Joi.string().valid("ComplianceSearch", "SearchMailbox").default("ComplianceSearch"),
  daysBack: Joi.number().integer().min(1).max(365).default(30)
}).custom((value, helpers) => {
  if (value.subjectContains && value.subjectEqual) {
    return helpers.error("any.conflict", {
      message: "subjectContains and subjectEqual cannot be used together."
    });
  }

  if (value.receivedFrom && value.receivedTo && value.receivedFrom > value.receivedTo) {
    return helpers.error("date.max", {
      limit: value.receivedFrom.toISOString(),
      value: value.receivedTo.toISOString()
    });
  }

  return value;
}, "purge validation");

const cancelSchema = Joi.object({
  requestId: Joi.string().required()
});

const validateBody = (schema) => async (req, _res, next) => {
  try {
    const payload = await schema.validateAsync(req.body ?? {}, {
      abortEarly: false,
      stripUnknown: true
    });
    req.validatedBody = payload;
    return next();
  } catch (error) {
    if (error.isJoi) {
      const validationError = createError(400, "Invalid request payload");
      validationError.details = error.details.map((issue) => ({
        message: issue.message,
        path: issue.path
      }));
      validationError.expose = true;
      return next(validationError);
    }

    return next(error);
  }
};

router.get(
  "/mailboxes",
  asyncHandler(async (req, res) => {
    const mailboxes = await listMailboxes({ requestId: req.requestId });
    res.setHeader("x-request-id", req.requestId);
    res.json({ mailboxes, requestId: req.requestId });
  })
);

router.post(
  "/search",
  validateBody(filterBaseSchema),
  asyncHandler(async (req, res) => {
    const data = await searchMessages(req.validatedBody, { requestId: req.requestId });
    res.setHeader("x-request-id", req.requestId);
    res.json({ ...data, requestId: req.requestId });
  })
);

router.post(
  "/delete",
  validateBody(deleteSchema),
  asyncHandler(async (req, res) => {
    const data = await deleteMessages(req.validatedBody, { requestId: req.requestId });
    res.setHeader("x-request-id", req.requestId);
    res.json({ ...data, requestId: req.requestId });
  })
);


router.get(
  "/purge-logs",
  asyncHandler(async (req, res) => {
    const logs = await readLogEntries({ limit: 500 });
    res.setHeader("x-request-id", req.requestId);
    res.json({ logs, requestId: req.requestId });
  })
);

router.post(
  "/purge-sender/cancel",
  validateBody(cancelSchema),
  asyncHandler(async (req, res) => {
    const { requestId: targetRequestId } = req.validatedBody;
    const context = activePurges.get(targetRequestId);

    if (!context || !context.child) {
      res.setHeader("x-request-id", req.requestId);
      res.status(404).json({
        requestId: targetRequestId,
        status: "not-found"
      });
      return;
    }

    if (context.child.exitCode !== null) {
      activePurges.delete(targetRequestId);
      res.setHeader("x-request-id", req.requestId);
      res.status(409).json({
        requestId: targetRequestId,
        status: "already-finished"
      });
      return;
    }

    context.cancelled = true;
    context.cancelReason = context.cancelReason || "user_requested";

    let killed = false;
    try {
      killed = context.child.kill();
    } catch (error) {
      logger.error({ error, requestId: targetRequestId }, "Failed to terminate purge process");
    }

    res.setHeader("x-request-id", req.requestId);
    res.json({
      requestId: targetRequestId,
      status: killed ? "cancelling" : "pending"
    });
  })
);

const scriptPath = path.resolve(__dirname, "../../../PS.ps1");

const formatDateForScript = (value) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
};

router.post(
  "/purge-sender",
  validateBody(purgeSchema),
  asyncHandler(async (req, res, next) => {
    if (!fs.existsSync(scriptPath)) {
      throw createError(500, { message: "Purge script not found on server." });
    }

    const {
      senderEmail,
      subjectContains,
      subjectEqual,
      receivedFrom,
      receivedTo,
      simulate,
      method,
      daysBack,
      allowHardDelete
    } = req.validatedBody;

    const subjectMode = subjectEqual ? "equals" : subjectContains ? "contains" : "none";
    const subjectValue = subjectEqual || subjectContains || null;
    const startedAt = new Date();

    const logPath = path.join(os.tmpdir(), `EmailDeletion_${Date.now()}.log`);
    const scriptArgs = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-SenderEmail",
      senderEmail,
      "-Method",
      method,
      "-DaysBack",
      String(daysBack)
    ];

    if (subjectEqual) {
      scriptArgs.push("-SubjectEqual", subjectEqual);
    } else if (subjectContains) {
      scriptArgs.push("-SubjectContains", subjectContains);
    }

    const fromDateFormatted = formatDateForScript(receivedFrom);
    if (fromDateFormatted) {
      scriptArgs.push("-FromDate", fromDateFormatted);
    }

    const toDateFormatted = formatDateForScript(receivedTo);
    if (toDateFormatted) {
      scriptArgs.push("-ToDate", toDateFormatted);
    }

    scriptArgs.push("-LogFile", logPath);

    if (simulate) {
      scriptArgs.push("-WhatIf");
    } else {
      scriptArgs.push("-AutoConfirm");
    }

    if (allowHardDelete) {
      scriptArgs.push("-AllowHardDelete");
    }

    // Detect if the client requested a streaming response (SSE)
    const wantsStream =
      String(req.query.stream || "").toLowerCase() === "true" ||
      String(req.query.stream || "") === "1" ||
      (req.headers.accept || "").includes("text/event-stream");

    let sse;
    if (wantsStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("x-request-id", req.requestId);
      sse = (event, data) => {
        try {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (err) {
          logger.error({ err, requestId: req.requestId }, "Failed to write SSE chunk");
        }
      };
    }

    const purgeContext = {
      requestId: req.requestId,
      child: null,
      cancelled: false,
      cancelReason: null,
      wantsStream,
      sse: null
    };

    const child = spawn("powershell.exe", scriptArgs, {
      cwd: path.dirname(scriptPath)
    });

    purgeContext.child = child;
    purgeContext.sse = wantsStream ? sse : null;
    activePurges.set(req.requestId, purgeContext);

    // If client disconnects during streaming, terminate the child process
    req.on("close", () => {
      if (wantsStream && child.exitCode === null) {
        purgeContext.cancelled = true;
        purgeContext.cancelReason = purgeContext.cancelReason || "connection_closed";
        try { child.kill(); } catch (_) { /* noop */ }
      }
    });

    const output = { stdout: [], stderr: [] };

    if (wantsStream) {
      sse("start", {
        requestId: req.requestId,
        logFile: logPath,
        startedAt: startedAt.toISOString(),
        simulate,
        allowHardDelete,
        method,
        daysBack,
        subjectMode,
        subjectValue,
        // include processed date filters for visibility
        receivedFrom: fromDateFormatted || null,
        receivedTo: toDateFormatted || null
      });
    }

    child.stdout.on("data", (data) => {
      const text = data.toString();
      output.stdout.push(text);
      if (wantsStream) sse("stdout", { chunk: text });
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      output.stderr.push(text);
      if (wantsStream) sse("stderr", { chunk: text });
    });

    child.on("error", (error) => {
      activePurges.delete(req.requestId);
      purgeContext.child = null;

      if (wantsStream) {
        sse("error", { message: "Failed to launch PowerShell", details: { error: error.message } });
        try { res.end(); } catch (_) { /* noop */ }
      } else {
        next(createError(500, { message: "Failed to launch PowerShell", details: { error: error.message } }));
      }
    });

    child.on("close", async (code, signal) => {
      const completedAt = new Date();
      const stdoutText = output.stdout.join("");
      const stderrText = output.stderr.join("");

      const affectedMailboxes = new Set();

      const regex1 = /\[INFO\] Mailbox (.*?): \d+ active items/g;
      let match1;
      while ((match1 = regex1.exec(stdoutText)) !== null) {
        affectedMailboxes.add(match1[1].trim());
      }

      const regex2 = /\[INFO\] Effected Emails: (.*)/;
      const match2 = stdoutText.match(regex2);
      if (match2 && match2[1]) {
        match2[1].split(',').forEach(email => affectedMailboxes.add(email.trim()));
      }

      const regex3 = /Deleted ([1-9]\d*) items from (.*)/g;
      let match3;
      while ((match3 = regex3.exec(stdoutText)) !== null) {
        affectedMailboxes.add(match3[2].trim());
      }


      const executionMode = simulate ? "simulation" : allowHardDelete ? "hard-delete" : "soft-delete";
      const exitCode = typeof code === "number" ? code : null;
      const exitSignal = signal || null;
      const wasCancelled = Boolean(purgeContext.cancelled);

      activePurges.delete(req.requestId);
      purgeContext.child = null;

      let status;
      if (wasCancelled) {
        status = "cancelled";
      } else if (exitCode === 0) {
        status = simulate ? "simulated" : "completed";
      } else {
        status = "failed";
      }

      const requestPayload = {
        senderEmail,
        subjectContains: subjectContains || null,
        subjectEqual: subjectEqual || null,
        simulate,
        allowHardDelete,
        mode: executionMode,
        method,
        daysBack,
        receivedFrom: receivedFrom ? new Date(receivedFrom).toISOString() : null,
        receivedTo: receivedTo ? new Date(receivedTo).toISOString() : null
      };

      const logEntry = {
        timestamp: startedAt.toISOString(),
        requestId: req.requestId,
        senderEmail,
        subjectMode,
        subjectValue,
        receivedFrom: requestPayload.receivedFrom,
        receivedTo: requestPayload.receivedTo,
        simulate,
        allowHardDelete,
        mode: executionMode,
        method,
        daysBack,
        exitCode,
        exitSignal,
        status,
        cancelled: wasCancelled,
        cancelReason: purgeContext.cancelReason || null,
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        logFile: logPath,
        stdoutLength: stdoutText.length,
        stderrLength: stderrText.length,
        requestPayload,
        affectedMailboxes: Array.from(affectedMailboxes)
      };

      let persistedLog = logEntry;
      try {
        persistedLog = await appendLogEntry(logEntry);
      } catch (error) {
        logger.error({ error, requestId: req.requestId }, "Failed to persist purge log entry");
      }

      if (wantsStream) {
        sse("end", {
          requestId: req.requestId,
          exitCode,
          status,
          cancelled: wasCancelled,
          cancelReason: purgeContext.cancelReason || null,
          logFile: logPath,
          simulate,
          logEntry: persistedLog
        });
        try { res.end(); } catch (_) { /* noop */ }
      } else {
        res.setHeader("x-request-id", req.requestId);
        res.json({
          requestId: req.requestId,
          exitCode,
          stdout: stdoutText,
          stderr: stderrText,
          status,
          cancelled: wasCancelled,
          cancelReason: purgeContext.cancelReason || null,
          logFile: logPath,
          simulate,
          logEntry: persistedLog
        });
      }
    });
  })
);

module.exports = router;






























