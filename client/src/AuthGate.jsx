import { useAuth } from "./AuthProvider.jsx";
import LoginPage from "./LoginPage.jsx";
import AssetDashboard from "./AssetDashboard.jsx";

export default function AuthGate() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        로딩 중…
      </div>
    );
  }
  return session ? <AssetDashboard /> : <LoginPage />;
}
