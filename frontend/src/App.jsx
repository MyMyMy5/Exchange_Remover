import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout.jsx";
import SearchPage from "./pages/SearchPage.jsx";
import DeletePage from "./pages/DeletePage.jsx";
import LogsPage from "./pages/LogsPage.jsx";

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/search" replace />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/delete" element={<DeletePage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="*" element={<Navigate to="/search" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;

