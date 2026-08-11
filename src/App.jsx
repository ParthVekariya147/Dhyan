import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DarshanPage from './modules/darshan/DarshanPage';

/**
 * Routing shell. દર્શન is public and needs no account, matching the page that is
 * already live. Later phases (auth, dhyan tracking, dhun, announcements, admin)
 * mount alongside it behind protected routes.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DarshanPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
