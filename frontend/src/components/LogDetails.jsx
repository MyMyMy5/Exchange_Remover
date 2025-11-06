import React from 'react';

const formatDateTime = (value) => {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const LogDetails = ({ log }) => {
  if (!log) {
    return null;
  }

  const exitCodeText = Number.isFinite(Number(log.exitCode)) ? Number(log.exitCode) : "-";
  const statusText = (() => {
    const raw = typeof log.status === "string" ? log.status.trim() : "";
    if (raw) {
      return raw.replace(/_/g, " " );
    }
    if (log.simulate) {
      return "simulated";
    }
    if (Number.isFinite(Number(log.exitCode))) {
      return Number(log.exitCode) === 0 ? "completed" : "failed";
    }
    return "unknown";
  })();
  const cancelReasonText =
    typeof log.cancelReason === "string" && log.cancelReason.trim().length
      ? log.cancelReason.replace(/_/g, " " )
      : null;

  return (
    <div className="log-details">
      <h4>Execution Details</h4>
      <dl>
        <dt>Request ID</dt>
        <dd>{log.requestId}</dd>
        <dt>Completed At</dt>
        <dd>{formatDateTime(log.completedAt)}</dd>
        <dt>Duration</dt>
        <dd>{log.durationMs} ms</dd>
        <dt>Exit Code</dt>
        <dd>{exitCodeText}</dd>
        <dt>Status</dt>
        <dd>{statusText}</dd>
        {cancelReasonText ? (
          <>
            <dt>Cancel reason</dt>
            <dd>{cancelReasonText}</dd>
          </>
        ) : null}
        <dt>Log File</dt>
        <dd>{log.logFile}</dd>
      </dl>

      {log.affectedMailboxes && log.affectedMailboxes.length > 0 && (
        <>
          <h4>Affected Mailboxes</h4>
          <ul>
            {log.affectedMailboxes.map((mailbox) => (
              <li key={mailbox}>{mailbox}</li>
            ))}
          </ul>
        </>
      )}

      <h4>Request Payload</h4>
      <pre>{JSON.stringify(log.requestPayload, null, 2)}</pre>
    </div>
  );
};

export default LogDetails;