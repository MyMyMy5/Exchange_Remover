import SearchSection from "../components/SearchSection.jsx";

const SearchPage = () => {
  return (
    <div className="page">
      <header className="page-header">
        <p className="page-kicker">Search</p>
        <h1>Search Messages</h1>
        <p className="page-subtitle">
          Identify and review suspicious correspondence across every mailbox before executing remediation.
        </p>
      </header>
      <div className="page-content">
        <SearchSection />
      </div>
    </div>
  );
};

export default SearchPage;
