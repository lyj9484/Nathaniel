import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase.js";

export default function LoginPage() {
  const [error, setError] = useState(null);

  useEffect(() => {
    // OAuth 콜백 후 화이트리스트 거부 등 에러를 URL hash에서 감지
    const params = new URLSearchParams(window.location.hash.slice(1));
    const desc = params.get("error_description");
    if (desc) {
      setError(decodeURIComponent(desc));
      // hash 정리
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function signInWith(provider) {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow p-8">
        <h1 className="text-2xl font-bold mb-2">자산관리 대시보드</h1>
        <p className="text-sm text-slate-500 mb-6">초대받은 분만 이용 가능</p>
        <button
          onClick={() => signInWith("google")}
          className="w-full mb-3 py-3 rounded-xl border border-slate-300 hover:bg-slate-50 font-medium"
        >
          Google로 시작
        </button>
        <button
          onClick={() => signInWith("kakao")}
          className="w-full py-3 rounded-xl bg-yellow-300 hover:bg-yellow-400 font-medium"
        >
          카카오로 시작
        </button>
        {error && (
          <div className="mt-6 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
            {error.includes("invite list")
              ? "초대받은 분만 사용할 수 있어요. 호스트에게 문의해주세요."
              : error}
          </div>
        )}
      </div>
    </div>
  );
}
