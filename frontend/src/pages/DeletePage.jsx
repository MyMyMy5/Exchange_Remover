import DeleteSection from "../components/DeleteSection.jsx";

const DeletePage = () => {
  return (
    <div className="page">
      <header className="page-header">
        <p className="page-kicker">Remediation</p>
        <h1>Delete Messages</h1>
        <p className="page-subtitle">
          Launch targeted purge operations with dry-run validation before committing destructive actions.
        </p>
      </header>
      <div className="page-content">
        <DeleteSection />
      </div>
    </div>
  );
};

export default DeletePage;
