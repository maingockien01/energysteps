import { Link, Route, Routes } from "react-router-dom";
import { useT } from "./lib/i18n";
import SignUpPage from "./pages/SignUpPage";
import StatusPage from "./pages/StatusPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import ModeratorGate from "./moderator/ModeratorGate";
import ModeratorLayout from "./moderator/ModeratorLayout";
import BoardView from "./moderator/BoardView";
import GuideView from "./moderator/GuideView";
import DashboardView from "./moderator/DashboardView";
import RunnersView from "./moderator/RunnersView";
import GiftsView from "./moderator/GiftsView";
import ConfigView from "./moderator/ConfigView";
import ExportView from "./moderator/ExportView";

function NotFound() {
  const t = useT();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <p className="text-lg">{t("notfound.title")}</p>
      <Link to="/" className="text-slate-900 underline">
        {t("notfound.link")}
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SignUpPage />} />
      <Route path="/status" element={<StatusPage />} />
      <Route path="/leaderboard" element={<LeaderboardPage />} />
      <Route
        path="/moderator"
        element={<ModeratorGate>{(pin) => <ModeratorLayout pin={pin} />}</ModeratorGate>}
      >
        <Route index element={<BoardView />} />
        <Route path="dashboard" element={<DashboardView />} />
        <Route path="runners" element={<RunnersView />} />
        <Route path="gifts" element={<GiftsView />} />
        <Route path="config" element={<ConfigView />} />
        <Route path="export" element={<ExportView />} />
        <Route path="guide" element={<GuideView />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
