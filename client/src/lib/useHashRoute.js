import { useEffect, useState } from "react";

// 해시 라우터: #/admin/feedback → "/admin/feedback"
// 빈 해시 또는 "#" → "/"
export function useHashRoute() {
  const [path, setPath] = useState(parseHash());
  useEffect(() => {
    const onHash = () => setPath(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return path;
}

function parseHash() {
  const h = window.location.hash || "#/";
  return h.startsWith("#") ? h.slice(1) || "/" : "/";
}

export function navigate(path) {
  window.location.hash = path;
}
