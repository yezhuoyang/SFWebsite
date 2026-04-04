import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import VolumePage from './pages/VolumePage';
import ChapterPage from './pages/ChapterPage';
import TutorPage from './pages/TutorPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/volume/:volumeId" element={<VolumePage />} />
          <Route path="/tutor" element={<TutorPage />} />
        </Route>
        {/* ChapterPage is full-width (no sidebar) for editor space */}
        <Route path="/volume/:volumeId/chapter/:chapterName" element={<ChapterPage />} />
      </Routes>
    </BrowserRouter>
  );
}
