import LogsSection from "../components/LogsSection.jsx";

const LogsPage = () => {
  return (
    <div className="page">
      <header className="page-header">
        <p className="page-kicker">Audit trail</p>
        <h1>Logs</h1>
        <p className="page-subtitle">
          Inspect the historical record of purge executions, including the filters, execution mode, and outcome for each run.
        </p>
      </header>
      <div className="page-content">
        <LogsSection />
      </div>
    </div>
  );
};

export default LogsPage;
