import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { NotifyProvider } from './components/Toast';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import ChapterPage from './pages/ChapterPage';
import TutorPage from './pages/TutorPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import LeaderboardPage from './pages/LeaderboardPage';
import JsCoqTestPage from './pages/JsCoqTestPage';

// When a user lands on /volume/<id> (no chapter), jump them to the
// first chapter (Preface). Going to the volume's `toc.html` page means
// the user might click chapter links INSIDE the cross-origin iframe,
// which navigates the iframe but not the parent URL — so the sidebar
// stays out of sync. By always landing on a real chapter, the sidebar
// always reflects the in-chapter outline.
function VolumeRedirect() {
  const { volumeId } = useParams<{ volumeId: string }>();
  return <Navigate to={`/volume/${volumeId}/chapter/Preface`} replace />;
}

export default function App() {
  return (
    <AuthProvider>
     <NotifyProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/tutor" element={<TutorPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
          </Route>
          {/* /volume (bare) and /volume/<id> (no chapter) → navigate user
              somewhere useful instead of rendering nothing. */}
          <Route path="/volume" element={<Navigate to="/" replace />} />
          <Route path="/volume/:volumeId" element={<VolumeRedirect />} />
          {/* ChapterPage is full-width (no sidebar) for editor space */}
          <Route path="/volume/:volumeId/chapter/:chapterName" element={<ChapterPage />} />
          {/* Smoke test for the jsCoq classic IDE integration */}
          <Route path="/jscoq-test" element={<JsCoqTestPage />} />
          {/* Anything else → home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
     </NotifyProvider>
    </AuthProvider>
  );
}
