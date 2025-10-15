const formatDateTime = (value) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
};

const ResultsList = ({ results = [], variant }) => {
  if (!results.length) {
    return null;
  }

  return (
    <div className="results-container">
      {results.map((mailbox) => {
        const entries = mailbox.matches?.slice(0, 10) ?? [];
        const truncatedCount = Math.max((mailbox.matches?.length || 0) - entries.length, 0);

        return (
          <div className="result-card" key={mailbox.mailbox}>
            <div>
              <h3>{mailbox.displayName || mailbox.mailbox}</h3>
              <p>{mailbox.mailbox}</p>
            </div>
            <div className="taglist">
              <span className="tag">Matches: {mailbox.totalMatches ?? entries.length}</span>
              {variant === "delete" ? <span className="tag">Deleted: {mailbox.deleted ?? 0}</span> : null}
              {variant === "delete" && Array.isArray(mailbox.folders) ? (
                <span className="tag">Folders: {mailbox.folders.join(", ")}</span>
              ) : null}
            </div>
            <div className="table-wrapper">
              <table className="result-table">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Sender</th>
                    <th>Folder</th>
                    <th>Received</th>
                    <th>Attachments</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((item) => (
                    <tr key={`${item.id}-${item.changeKey}`}>
                      <td>{item.subject || "(no subject)"}</td>
                      <td>{item.sender || item.from || ""}</td>
                      <td>{item.folder}</td>
                      <td>{formatDateTime(item.receivedAt)}</td>
                      <td>{item.hasAttachments ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {truncatedCount > 0 ? (
                <p>{truncatedCount} more messages not shown here.</p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ResultsList;
