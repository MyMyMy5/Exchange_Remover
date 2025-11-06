import { useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";

import { searchMessages, purgeSender, purgeSenderStream, cancelPurge } from "../api/exchange";

const defaultValues = {
  sender: "",
  subject: "",
  subjectMode: "contains",
  receivedFrom: "",
  receivedTo: "",
  simulate: true,
  deletionMode: "soft"
};

const toISOStringIfPresent = (value) => {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
};

const toDdMmYyyy = (value) => {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

const computeDaysBack = (values) => {
  if (!values.receivedFrom) {
    return 30;
  }

  const start = new Date(values.receivedFrom);
  const end = values.receivedTo ? new Date(values.receivedTo) : new Date();
  const diffMs = Math.max(0, end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (!Number.isFinite(diffDays) || diffDays <= 0) {
    return 30;
  }

  return diffDays;
};

const mapFormToScriptPayload = (values) => {
  const payload = {
    senderEmail: values.sender.trim(),
    simulate: Boolean(values.simulate),
    method: "ComplianceSearch",
    daysBack: computeDaysBack(values)
  };
  payload.allowHardDelete = !payload.simulate && values.deletionMode === "hard";

  if (values.subject && values.subjectMode === "contains") {
    payload.subjectContains = values.subject.trim();
  } else if (values.subject && values.subjectMode === "equals") {
    payload.subjectEqual = values.subject.trim();
  }

  const fromDate = toISOStringIfPresent(values.receivedFrom);
  if (fromDate) {
    payload.receivedFrom = fromDate;
  }

  const toDate = toISOStringIfPresent(values.receivedTo);
  if (toDate) {
    payload.receivedTo = toDate;
  }

  return payload;
};

const mapFormToPreviewPayload = (values) => {
  const payload = {
    sender: values.sender.trim(),
    maxPerMailbox: 500
  };

  if (values.subject && values.subjectMode !== "none") {
    payload.subject = values.subject.trim();
  }

  const receivedFromIso = toISOStringIfPresent(values.receivedFrom);
  if (receivedFromIso) {
    payload.receivedFrom = receivedFromIso;
  }

  const receivedToIso = toISOStringIfPresent(values.receivedTo);
  if (receivedToIso) {
    payload.receivedTo = receivedToIso;
  }

  return payload;
};

const buildPreviewRows = (previewData) => {
  if (!previewData?.results) {
    return [];
  }

  return previewData.results.flatMap((mailbox) =>
    (mailbox.matches || []).map((match, index) => ({
      id: `${mailbox.mailbox}-${match.id || index}`,
      mailbox: mailbox.mailbox,
      subject: match.subject || "(no subject)",
      bodyPreview: match.bodyPreview || "",
      receivedAt: match.receivedAt ? new Date(match.receivedAt).toLocaleString() : "",
      folder: match.folder || ""
    }))
  );
};

const DeleteSection = () => {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { isSubmitting }
  } = useForm({
    defaultValues
  });

  const queryClient = useQueryClient();

  const [lastLogPath, setLastLogPath] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const [streamOutput, setStreamOutput] = useState({ stdout: [], stderr: [] });
  const streamAbortRef = useRef(null);
  const [finalSummary, setFinalSummary] = useState(null);
  const [activeRequestId, setActiveRequestId] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmationState, setConfirmationState] = useState({ isOpen: false, values: null });
  const [confirmationInput, setConfirmationInput] = useState("");

  const previewMutation = useMutation({
    mutationFn: searchMessages
  });

  const purgeMutation = useMutation({
    mutationFn: purgeSender,
    onSuccess: (data) => {
      setLastLogPath(data?.logFile || null);

      if (data?.logEntry) {
        queryClient.setQueryData(["purgeLogs"], (current) => {
          const list = Array.isArray(current) ? current : [];
          const withoutDuplicate = list.filter((entry) => entry?.id !== data.logEntry.id);
          return [data.logEntry, ...withoutDuplicate].slice(0, 500);
        });
      }

      queryClient.invalidateQueries({ queryKey: ["purgeLogs"] });
    },
    onError: () => {
      setLastLogPath(null);
    }
  });

  const subjectMode = watch("subjectMode");
  const simulate = watch("simulate");
  const deletionMode = watch("deletionMode");
  const allowHardDelete = deletionMode === "hard";
  const executePurge = (values) => {
    const scriptPayload = mapFormToScriptPayload(values);

    setLastLogPath(null);
    setStreamOutput({ stdout: [], stderr: [] });
    setFinalSummary(null);
    setActiveRequestId(null);
    setCancelling(false);

    if (streamAbortRef.current) {
      try {
        streamAbortRef.current.abort();
      } catch (_) {
        /* noop */
      }
      streamAbortRef.current = null;
    }

    if (values.simulate) {
      const previewPayload = mapFormToPreviewPayload(values);
      previewMutation.mutate(previewPayload);
    } else {
      previewMutation.reset();
    }

    setStreaming(true);

    const aborter = purgeSenderStream(scriptPayload, (evt) => {
      if (!evt) return;
      switch (evt.type) {
        case "start": {
          setActiveRequestId(evt.data?.requestId || null);
          setLastLogPath(evt.data?.logFile || null);
          setCancelling(false);
          break;
        }
        case "stdout": {
          if (evt.data?.chunk) {
            setStreamOutput((cur) => ({ ...cur, stdout: [...cur.stdout, evt.data.chunk] }));
          }
          break;
        }
        case "stderr": {
          if (evt.data?.chunk) {
            setStreamOutput((cur) => ({ ...cur, stderr: [...cur.stderr, evt.data.chunk] }));
          }
          break;
        }
        case "end": {
          setFinalSummary(evt.data || {});
          setLastLogPath(evt.data?.logFile || null);
          setStreaming(false);
          setActiveRequestId(null);
          setCancelling(false);
          streamAbortRef.current = null;
          queryClient.invalidateQueries({ queryKey: ["purgeLogs"] });
          break;
        }
        case "error": {
          setStreaming(false);
          setFinalSummary({ error: evt.data });
          setActiveRequestId(null);
          setCancelling(false);
          streamAbortRef.current = null;
          break;
        }
        default:
          break;
      }
    });

    streamAbortRef.current = aborter;
  };

  const onSubmit = (values) => {
    if (!values.simulate) {
      setConfirmationState({ isOpen: true, values });
      setConfirmationInput("");
      return;
    }

    executePurge(values);
  };

  const confirmationReady = confirmationInput.trim().toUpperCase() === "DELETE";

  const handleConfirmDeletion = () => {
    if (!confirmationState.values) {
      return;
    }

    const values = confirmationState.values;
    setConfirmationState({ isOpen: false, values: null });
    setConfirmationInput("");
    executePurge(values);
  };

  const handleDismissConfirmation = () => {
    setConfirmationState({ isOpen: false, values: null });
    setConfirmationInput("");
  };

  const handleCancelExecution = () => {
    if (cancelling) {
      return;
    }

    if (activeRequestId) {
      setCancelling(true);
      cancelPurge(activeRequestId)
        .then(() => {
          // Wait for SSE to deliver the final status
        })
        .catch((error) => {
          const status = error?.response?.status;
          if (status === 404 || status === 409) {
            setCancelling(false);
            return;
          }

          setCancelling(false);
          setFinalSummary({
            error: {
              message: error?.response?.data?.message || error?.message || "Failed to cancel purge"
            }
          });
        });
      return;
    }

    if (streamAbortRef.current) {
      try {
        streamAbortRef.current.abort();
      } catch (_) {
        /* noop */
      }
      streamAbortRef.current = null;
    }

    setStreaming(false);
    setActiveRequestId(null);
    setCancelling(false);
    setFinalSummary({ cancelled: true });
  };

  const handleReset = () => {
    reset(defaultValues);
    previewMutation.reset();
    purgeMutation.reset();
    setLastLogPath(null);
    setStreaming(false);
    setStreamOutput({ stdout: [], stderr: [] });
    setFinalSummary(null);
    setActiveRequestId(null);
    setCancelling(false);
    setConfirmationState({ isOpen: false, values: null });
    setConfirmationInput("");
    if (streamAbortRef.current) {
      try { streamAbortRef.current.abort(); } catch (_) { /* noop */ }
      streamAbortRef.current = null;
    }
  };

  const renderOutput = (text) => {
    if (!text) {
      return null;
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      return null;
    }

    const getClass = (line) => {
      const highlightPattern = /(target mailboxes|affected mailboxes|Effected Emails|Deleted|Verification complete)/i;
      const levelMatch = line.match(/\[(INFO|WARNING|ERROR|SUCCESS)\]/i);
      const level = levelMatch ? levelMatch[1].toUpperCase() : "INFO";

      let baseClass;
      switch (level) {
        case "ERROR":
          baseClass = "log-line error";
          break;
        case "WARNING":
          baseClass = "log-line warning";
          break;
        case "SUCCESS":
          baseClass = "log-line success";
          break;
        default:
          baseClass = "log-line info";
          break;
      }

      return clsx(baseClass, highlightPattern.test(line) && "log-line-highlight");
    };

    return (
      <div className="log-output">
        {lines.map((line) => (
          <span key={line} className={getClass(line)}>
            {line}
          </span>
        ))}
      </div>
    );
  };

  const previewRows = useMemo(() => buildPreviewRows(previewMutation.data), [previewMutation.data]);

  return (
    <section className="section-card">
      <div className="section-header">
        <h2>Deletion criteria</h2>
        <p>Select the sender and optional filters, then run a simulation before executing a live purge.</p>
      </div>

      <div className="status-banner error">
        <div>
          <strong>Caution:</strong> Deletions are irreversible when simulation is disabled. Ensure you have appropriate approvals before proceeding.
        </div>
      </div>

      <form className="form" onSubmit={handleSubmit(onSubmit)}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="delete-sender">Sender email</label>
            <input
              id="delete-sender"
              type="email"
              placeholder="malicious@example.com"
              required
              {...register("sender", { required: true })}
            />
          </div>

          <div className="field">
            <label htmlFor="subjectMode">Subject filter</label>
            <select id="subjectMode" {...register("subjectMode")}>
              <option value="contains">Contains text</option>
              <option value="equals">Equals text</option>
              <option value="none">Ignore subject</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="delete-subject">Subject value</label>
            <input
              id="delete-subject"
              type="text"
              placeholder=""
              disabled={subjectMode === "none"}
              {...register("subject")}
            />
          </div>

          <div className="field">
            <label htmlFor="delete-receivedFrom">Sent on or after</label>
            <input id="delete-receivedFrom" type="date" {...register("receivedFrom")} />
          </div>

          <div className="field">
            <label htmlFor="delete-receivedTo">Sent on or before</label>
            <input id="delete-receivedTo" type="date" {...register("receivedTo")} />
          </div>
        </div>

        <div className="deletion-mode">
          <span className="deletion-mode__label">Deletion mode</span>
          <div className="deletion-mode__options">
            <label
              className={clsx("mode-option", { selected: !allowHardDelete })}
            >
              <input
                type="radio"
                value="soft"
                {...register("deletionMode")}
              />
              <span className="mode-option__title">Soft delete (default)</span>
              <span className="mode-option__description">
                Move matching messages to Recoverable Items for investigation or restore.
              </span>
            </label>
            <label
              className={clsx("mode-option", "mode-option--danger", {
                selected: allowHardDelete,
                disabled: simulate
              })}
            >
              <input
                type="radio"
                value="hard"
                {...register("deletionMode")}
                disabled={simulate}
              />
              <span className="mode-option__title">Hard delete (permanent)</span>
              <span className="mode-option__description">
                Purge messages completely, including Recoverable Items.
              </span>
              {simulate ? (
                <span className="mode-option__hint">Disable simulation to enable hard delete.</span>
              ) : (
                <span className="mode-option__hint danger">Ensure approvals are in place before purging.</span>
              )}
            </label>
          </div>
        </div>

        <div className="actions">
          <label className="toggle" htmlFor="simulate">
            <input id="simulate" type="checkbox" {...register("simulate")} />
            Run as simulation (dry run)
          </label>
          <button
            className={clsx("button", simulate ? "button-primary" : "button-danger")}
            type="submit"
            disabled={purgeMutation.isPending || previewMutation.isPending || isSubmitting || streaming}
          >
            {streaming
              ? "Running..."
              : purgeMutation.isPending || previewMutation.isPending
                ? simulate
                  ? "Simulating..."
                  : "Deleting..."
                : simulate
                  ? "Run simulation"
                  : "Delete messages"}
          </button>
          {streaming ? (
            <button
              className={clsx("button", "button-secondary")}
              type="button"
              onClick={handleCancelExecution}
              disabled={cancelling}
            >
              {cancelling ? "Cancelling..." : "Cancel"}
            </button>
          ) : null}
          <button className={clsx("button", "button-secondary")} type="button" onClick={handleReset}>
            Reset form
          </button>
        </div>
      </form>

      {simulate && previewMutation.isPending ? (
        <div className="status-banner info">
          <span>Previewing active messages. This may take a moment�</span>
        </div>
      ) : null}

      {previewRows.length ? (
        <div className="preview-table-wrapper">
          <table className="result-table">
            <thead>
              <tr>
                <th>Mailbox</th>
                <th>Subject</th>
                <th>Body preview</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.slice(0, 200).map((row) => (
                <tr key={row.id}>
                  <td>{row.mailbox}</td>
                  <td>{row.subject}</td>
                  <td>{row.bodyPreview || ""}</td>
                  <td>{row.receivedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {previewRows.length > 200 ? (
            <p className="status-banner info">
              Showing first 200 results. Refine your filters to narrow the scope.
            </p>
          ) : null}
        </div>
      ) : null}

      {streaming ? (
        <div className="status-banner info">
          <span>Compliance purge is running. Streaming output below...</span>
        </div>
      ) : null}

      {cancelling ? (
        <div className="status-banner warning">
          <span>Cancellation requested. Waiting for confirmation...</span>
        </div>
      ) : null}

      {purgeMutation.error ? (
        <div className="status-banner error">
          <span>{purgeMutation.error?.error?.message || purgeMutation.error?.message || "Compliance purge failed"}</span>
        </div>
      ) : null}

      {purgeMutation.data ? (
        <div className="status-banner success">
          <div>
            <strong>
              Compliance purge {purgeMutation.data.simulate ? "simulation" : "execution"} completed (exit code {" "}
              {purgeMutation.data.exitCode}).
            </strong>
            {renderOutput(purgeMutation.data.stdout)}
            {renderOutput(purgeMutation.data.stderr)}
            {lastLogPath ? <p>Log file: {lastLogPath}</p> : null}
          </div>
        </div>
      ) : null}

      {(streamOutput.stdout.length || streamOutput.stderr.length) ? (
        <div className="status-banner info">
          <div>
            <strong>Live output</strong>
            {renderOutput(streamOutput.stdout.join(""))}
            {renderOutput(streamOutput.stderr.join(""))}
            {lastLogPath ? <p>Log file: {lastLogPath}</p> : null}
          </div>
        </div>
      ) : null}

      {finalSummary?.error ? (
        <div className="status-banner error">
          <span>{finalSummary.error?.message || finalSummary.error?.error?.message || "Compliance purge failed"}</span>
        </div>
      ) : null}

      {finalSummary?.status === "cancelled" ? (
        <div className="status-banner warning">
          <div>
            <strong>Compliance purge cancelled before completion.</strong>
            {finalSummary.cancelReason ? (
              <p>Reason: {String(finalSummary.cancelReason).replace(/_/g, " ")}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {finalSummary?.status !== "cancelled" && finalSummary && finalSummary.exitCode !== undefined ? (
        <div className={clsx("status-banner", finalSummary.exitCode === 0 ? "success" : "error") }>
          <div>
            <strong>
              Compliance purge execution completed (exit code {finalSummary.exitCode}).
            </strong>
          </div>
        </div>
      ) : null}

      {finalSummary?.cancelled && !finalSummary?.status ? (
        <div className="status-banner warning">
          <div>
            <strong>Compliance purge cancelled by user.</strong>
          </div>
        </div>
      ) : null}

      {confirmationState.isOpen ? (
        <div className="confirmation-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-deletion-title">
          <div className="confirmation-modal">
            <h3 id="confirm-deletion-title">Confirm deletion</h3>
            <p className="confirmation-modal__description">
              Type <code>DELETE</code> to confirm the purge. This will remove matching messages from all mailboxes.
            </p>
            <input
              className="confirmation-modal__input"
              type="text"
              value={confirmationInput}
              onChange={(event) => setConfirmationInput(event.target.value)}
              placeholder="Type DELETE to confirm"
              autoFocus
            />
            <div className="confirmation-modal__actions">
              <button className={clsx("button", "button-secondary")} type="button" onClick={handleDismissConfirmation}>
                Back
              </button>
              <button
                className={clsx("button", "button-danger")}
                type="button"
                onClick={handleConfirmDeletion}
                disabled={!confirmationReady}
              >
                Confirm deletion
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default DeleteSection;










