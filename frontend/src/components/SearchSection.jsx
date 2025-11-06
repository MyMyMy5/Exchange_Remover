import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";

import { searchMessages } from "../api/exchange";
import useMailboxes from "../hooks/useMailboxes";
import ResultsList from "./ResultsList.jsx";
import SummaryMetrics from "./SummaryMetrics.jsx";

const folderOptions = [
  { value: "Inbox", label: "Inbox" },
  { value: "JunkEmail", label: "Junk Email" },
  { value: "DeletedItems", label: "Deleted Items" },
  { value: "SentItems", label: "Sent Items" }
];

const defaultValues = {
  sender: "",
  subject: "",
  body: "",
  keywords: "",
  receivedFrom: "",
  receivedTo: "",
  hasAttachments: "",
  importance: "",
  folders: ["Inbox", "JunkEmail"],
  maxPerMailbox: 100
};

const mapFormToPayload = (values) => {
  const payload = {};

  if (values.sender) {
    payload.sender = values.sender.trim();
  }

  if (values.subject) {
    payload.subject = values.subject.trim();
  }

  if (values.body) {
    payload.body = values.body.trim();
  }

  if (values.keywords) {
    payload.keywords = values.keywords
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean);
  }

  if (values.receivedFrom) {
    payload.receivedFrom = new Date(values.receivedFrom).toISOString();
  }

  if (values.receivedTo) {
    payload.receivedTo = new Date(values.receivedTo).toISOString();
  }

  if (values.hasAttachments === "true") {
    payload.hasAttachments = true;
  } else if (values.hasAttachments === "false") {
    payload.hasAttachments = false;
  }

  if (values.importance) {
    payload.importance = values.importance;
  }

  if (values.folders) {
    const folderList = Array.isArray(values.folders) ? values.folders : [values.folders];
    if (folderList.length) {
      payload.folders = folderList;
    }
  }

  if (values.maxPerMailbox) {
    payload.maxPerMailbox = Number.parseInt(values.maxPerMailbox, 10);
  }

  return payload;
};

const SearchSection = () => {
  const { data: mailboxes = [], isLoading: mailboxesLoading, error: mailboxesError } = useMailboxes();

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting }
  } = useForm({
    defaultValues
  });

  const mutation = useMutation({
    mutationFn: searchMessages
  });

  const onSubmit = (values) => {
    mutation.mutate(mapFormToPayload(values));
  };

  const handleReset = () => {
    reset(defaultValues);
    mutation.reset();
  };

  const mailboxCount = mailboxes.length;

  const failureMessages = useMemo(() => {
    if (!mutation.data?.failures || !mutation.data.failures.length) {
      return [];
    }

    return mutation.data.failures.map((failure) => {
      const segments = [failure.displayName || failure.mailbox, failure.error];
      if (failure.details?.cause) {
        segments.push(`Cause: ${failure.details.cause}`);
      }
      return segments.filter(Boolean).join(" — ");
    });
  }, [mutation.data]);

  const activeRequestId = mutation.error?.error?.requestId || mutation.data?.requestId || null;

  return (
    <section className="section-card">
      <div className="section-header">
        <h2>Filters &amp; criteria</h2>
        <p>
          Fine-tune the discovery parameters before running the organisation-wide search.
        </p>
      </div>

      <form className="form" onSubmit={handleSubmit(onSubmit)}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="sender">Sender email</label>
            <input
              id="sender"
              type="email"
              placeholder="malicious@example.com"
              {...register("sender")}
            />
          </div>

          <div className="field">
            <label htmlFor="subject">Subject contains</label>
            <input id="subject" type="text" placeholder="Invoice" {...register("subject")} />
          </div>

          <div className="field">
            <label htmlFor="body">Message body contains</label>
            <input id="body" type="text" placeholder="Urgent" {...register("body")} />
          </div>

          <div className="field">
            <label htmlFor="keywords">Keywords (comma separated)</label>
            <input id="keywords" type="text" placeholder="urgent, wire" {...register("keywords")} />
          </div>

          <div className="field">
            <label htmlFor="receivedFrom">Received from</label>
            <input id="receivedFrom" type="date" {...register("receivedFrom")} />
          </div>

          <div className="field">
            <label htmlFor="receivedTo">Received to</label>
            <input id="receivedTo" type="date" {...register("receivedTo")} />
          </div>

          <div className="field">
            <label htmlFor="hasAttachments">Attachments</label>
            <select id="hasAttachments" {...register("hasAttachments")}>
              <option value="">Include all</option>
              <option value="true">Only with attachments</option>
              <option value="false">Only without attachments</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="importance">Importance</label>
            <select id="importance" {...register("importance")}>
              <option value="">Any</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="maxPerMailbox">Limit per mailbox</label>
            <input
              id="maxPerMailbox"
              type="number"
              min="1"
              max="2000"
              placeholder="100"
              {...register("maxPerMailbox")}
            />
          </div>
        </div>

        <div className="field">
          <label>Target folders</label>
          <div className="checkbox-list">
            {folderOptions.map((folder) => (
              <label className="checkbox-pill" key={folder.value}>
                <input type="checkbox" value={folder.value} {...register("folders")} />
                {folder.label}
              </label>
            ))}
          </div>
        </div>

        <div className="actions">
          <button
            className={clsx("button", "button-primary")}
            type="submit"
            disabled={mutation.isPending || isSubmitting}
          >
            {mutation.isPending ? "Searching..." : "Run search"}
          </button>
          <button className={clsx("button", "button-secondary")} type="button" onClick={handleReset}>
            Clear filters
          </button>
          <span className="tag">Mailboxes discovered: {mailboxCount}</span>
        </div>
      </form>

      {mailboxesLoading ? (
        <div className="status-banner info">Fetching mailbox list.</div>
      ) : null}

      {mailboxesError ? (
        <div className="status-banner error">
          <span>Mailbox discovery failed. Searches may still work if you provide explicit folders.</span>
        </div>
      ) : null}

      {mutation.error ? (
        <div className="status-banner error">
          <span>
            {mutation.error?.error?.message || "Search failed"}
            {activeRequestId ? ` (Request ID: ${activeRequestId})` : ""}
          </span>
        </div>
      ) : null}

      {failureMessages.length ? (
        <div className="status-banner error">
          <div>
            <strong>Some mailboxes could not be queried.</strong>
            <ul className="alert-list">
              {failureMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {mutation.data ? (
        <>
          <SummaryMetrics summary={mutation.data.summary} variant="search" />
          <ResultsList results={mutation.data.results} variant="search" />
          {mutation.data.requestId ? (
            <div className="status-banner info">
              <span>Request ID: {mutation.data.requestId}</span>
            </div>
          ) : null}
        </>
      ) : (
        <div className="status-banner info">
          <span>Run a search to populate results.</span>
        </div>
      )}
    </section>
  );
};

export default SearchSection;
