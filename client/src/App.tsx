import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import VolumePage from './pages/VolumePage';
import ChapterPage from './pages/ChapterPage';
import TutorPage from './pages/TutorPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import LeaderboardPage from './pages/LeaderboardPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/volume/:volumeId" element={<VolumePage />} />
            <Route path="/tutor" element={<TutorPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
          </Route>
          {/* ChapterPage is full-width (no sidebar) for editor space */}
          <Route path="/volume/:volumeId/chapter/:chapterName" element={<ChapterPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
