import axios from "axios";

// Use relative URLs so Next.js proxies /api/* → backend (see next.config.js rewrites)
const api = axios.create({
  baseURL: "",
  headers: { "Content-Type": "application/json" },
});

// Attach JWT from localStorage on every request
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// On auth failure, backend down, or network error — clear token and go to login.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (typeof window !== "undefined") {
      const status = error.response?.status;
      // 401 = expired/invalid token
      // 503 = proxy couldn't reach the backend (returned by route.ts on network failure)
      // no response at all = pure network error (axios couldn't reach the proxy)
      if (status === 401 || status === 503 || !error.response) {
        localStorage.removeItem("access_token");
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default api;

/**
 * Download a binary response (ZIP or JSON) through the axios JWT interceptor.
 * Using axios (not window.location.href) so the Authorization header is sent.
 */
export async function downloadExport(url: string, fallbackFilename: string): Promise<void> {
  const res = await api.get(url, { responseType: "blob" });

  // Prefer the filename from Content-Disposition if present
  const cd: string = res.headers["content-disposition"] ?? "";
  const match = cd.match(/filename="?([^";\n]+)"?/i);
  const filename = match?.[1] ?? fallbackFilename;

  const blob = new Blob([res.data], { type: res.headers["content-type"] ?? "application/octet-stream" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
