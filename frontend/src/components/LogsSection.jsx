import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchPurgeLogs } from "../api/exchange";
import LogDetails from "./LogDetails.jsx";

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

const formatDate = (value) => {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, { timeZone: "UTC" });
};

const describeSubject = (mode, value) => {
  if (!mode || mode === "none" || !value) {
    return "Any subject";
  }
  if (mode === "equals") {
    return `Equals "${value}"`;
  }
  if (mode === "contains") {
    return `Contains "${value}"`;
  }
  return "Any subject";
};

const describeRange = (from, to) => {
  if (!from && !to) {
    return "All time";
  }
  if (from && to) {
    return `${formatDate(from)} -> ${formatDate(to)}`;
  }
  if (from) {
    return `From ${formatDate(from)}`;
  }
  return `Up to ${formatDate(to)}`;
};


const resolveMode = (log) => {
  if (!log) {
    return null;
  }
  if (typeof log.mode === "string" && log.mode.trim().length > 0) {
    return log.mode.trim().toLowerCase();
  }
  if (log.simulate) {
    return "simulation";
  }
  if (log.allowHardDelete) {
    return "hard-delete";
  }
  return "soft-delete";
};

const getModeChip = (log) => {
  const mode = resolveMode(log);
  switch (mode) {
    case "simulation":
      return { label: "Simulation", tone: "info" };
    case "hard-delete":
      return { label: "Hard delete", tone: "danger" };
    case "soft-delete":
      return { label: "Soft delete", tone: "success" };
    default:
      return { label: "Unknown", tone: "muted" };
  }
};

const getOutcomeChip = (log) => {
  if (!log) {
    return { label: "Unknown", tone: "muted" };
  }

  const normalizedStatus =
    typeof log.status === "string" ? log.status.toLowerCase() : null;
  const exitCode =
    Number.isFinite(Number(log.exitCode)) ? Number(log.exitCode) : null;

  if (normalizedStatus === "cancelled" || log.cancelled) {
    return { label: "Cancelled", tone: "warning" };
  }

  if (normalizedStatus === "failed" || (exitCode !== null && exitCode !== 0)) {
    return { label: "Failed", tone: "danger" };
  }

  if (normalizedStatus === "simulated" || log.simulate) {
    return { label: "Simulated", tone: "info" };
  }

  return { label: "Completed", tone: "success" };
};

const LogsSection = () => {
  const [expandedId, setExpandedId] = useState(null);

  const query = useQuery({
    queryKey: ["purgeLogs"],
    queryFn: fetchPurgeLogs,
    staleTime: 60_000,
    refetchOnWindowFocus: true
  });

  const logs = useMemo(() => {
    if (!Array.isArray(query.data)) {
      return [];
    }
    return [...query.data].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [query.data]);

  const toggleExpanded = (id) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  return (
    <section className="section-card">
      <div className="section-header">
        <h2>Execution logs</h2>
        <p>Review every purge invocation, including the exact filters that were sent to the server.</p>
      </div>

      <div className="actions">
        <button
          className="button button-secondary"
          type="button"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          {query.isFetching ? "Refreshing..." : "Refresh logs"}
        </button>
      </div>

      {query.isLoading ? (
        <div className="status-banner info">
          <span>Loading logs...</span>
        </div>
      ) : null}

      {query.isError ? (
        <div className="status-banner error">
          <span>{query.error?.message || "Failed to load logs"}</span>
        </div>
      ) : null}

      {!query.isLoading && !logs.length ? (
        <div className="status-banner info">
          <span>No purge executions have been recorded yet.</span>
        </div>
      ) : null}

      {logs.length ? (
        <div className="preview-table-wrapper">
          <table className="result-table logs-table">
            <thead>
              <tr>
                <th>Triggered at</th>
                <th>Sender</th>
                <th>Subject filter</th>
                <th>Date range</th>
                <th>Mode</th>
                <th>Outcome</th>
                <th>Exit code</th>
                <th>Log file</th>
                <th>JSON</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const modeChip = getModeChip(log);
                const outcomeChip = getOutcomeChip(log);
                const exitCode = Number.isFinite(Number(log.exitCode)) ? Number(log.exitCode) : "-";
                return (
                  <Fragment key={log.id || `${log.requestId}-${log.timestamp}`}>
                    <tr>
                      <td>{formatDateTime(log.timestamp)}</td>
                      <td>{log.senderEmail || ""}</td>
                      <td>{describeSubject(log.subjectMode, log.subjectValue)}</td>
                      <td>{describeRange(log.receivedFrom, log.receivedTo)}</td>
                      <td>
                        <span className={`status-chip status-${modeChip.tone}`}>
                          {modeChip.label}
                        </span>
                      </td>
                      <td>
                        <span className={`status-chip status-${outcomeChip.tone}`}>
                          {outcomeChip.label}
                        </span>
                      </td>
                      <td>{exitCode}</td>
                      <td className="cell-log-file">
                        <span title={log.logFile || ""}>{(log.logFile || "").replace(/\r\n/g, ' ')}</span>
                      </td>
                      <td className="cell-actions">
                        <button
                          type="button"
                          className="button button-tertiary"
                          onClick={() => toggleExpanded(log.id || log.requestId)}
                        >
                          {expandedId === (log.id || log.requestId) ? "Hide" : "View"}
                        </button>
                      </td>
                    </tr>
                    {expandedId === (log.id || log.requestId) ? (
                      <tr className="log-expanded-row">
                        <td colSpan={9}>
                          <LogDetails log={log} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
};

export default LogsSection;








