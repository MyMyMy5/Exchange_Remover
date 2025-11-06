const formatBool = (value) => (value ? "Yes" : "No");

const SummaryMetrics = ({ summary, variant }) => {
  if (!summary) {
    return null;
  }

  const baseMetrics = [
    { label: "Mailboxes Scanned", value: summary.totalMailboxesScanned ?? 0 },
    { label: "Mailboxes With Matches", value: summary.mailboxesWithMatches ?? 0 }
  ];

  const additionalMetrics =
    variant === "delete"
      ? [
          { label: "Messages Matched", value: summary.totalMatches ?? 0 },
          { label: "Messages Deleted", value: summary.totalDeleted ?? 0 },
          { label: "Delete Mode", value: summary.mode ?? "softdelete" },
          { label: "Simulation", value: formatBool(summary.simulate) }
        ]
      : [{ label: "Messages Matched", value: summary.totalMessages ?? 0 }];

  return (
    <div className="metrics-grid">
      {[...baseMetrics, ...additionalMetrics].map((metric) => (
        <div className="metric-card" key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
    </div>
  );
};

export default SummaryMetrics;
