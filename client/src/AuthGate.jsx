import { useAuth } from "./AuthProvider.jsx";
import LoginPage from "./LoginPage.jsx";
import AssetDashboard from "./AssetDashboard.jsx";
import AdminFeedbackPage from "./AdminFeedbackPage.jsx";
import { useHashRoute } from "./lib/useHashRoute.js";

export default function AuthGate() {
  const { session, loading } = useAuth();
  const route = useHashRoute();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        로딩 중…
      </div>
    );
  }
  if (!session) return <LoginPage />;
  if (route === "/admin/feedback") return <AdminFeedbackPage />;
  return <AssetDashboard />;
}
