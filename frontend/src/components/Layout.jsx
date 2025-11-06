import { NavLink, Outlet } from "react-router-dom";

const navItems = [
  {
    to: "/search",
    title: "Search Messages",
    caption: "Discover suspicious communication"
  },
  {
    to: "/delete",
    title: "Delete Messages",
    caption: "Remediate and purge at scale"
  },
  {
    to: "/logs",
    title: "Logs",
    caption: "Audit past purge activity"
  }
];

const Layout = () => {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-badge">Exchange</span>
          <h1 className="sidebar-title">Message Control Center</h1>
          <p className="sidebar-subtitle">
            Unified console for hunting and removing malicious mail across your organisation.
          </p>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              <span className="nav-link-title">{item.title}</span>
              <span className="nav-link-caption">{item.caption}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <p className="sidebar-tip">Tip: simulate deletions first, then run the live action once reviewed.</p>
        </div>
      </aside>
      <div className="content-area">
        <div className="content-inner">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default Layout;


