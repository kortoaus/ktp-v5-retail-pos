import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
} from "axios";

export interface PagingType {
  hasPrev: boolean;
  hasNext: boolean;
  currentPage: number;
  totalPages: number;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  msg: string;
  result: T | null;
  paging: PagingType | null;
  // Staff session token — only `GET /api/user/code` sends it (server R-1).
  token?: string;
}

// Server marker on a 401 from its staff-auth middleware (expired / revoked /
// archived staff session). Other 401s (missing scope, crm proxy) keep the
// session.
const STAFF_SESSION_INVALID = "STAFF_SESSION_INVALID";

function isStaffSessionInvalid(status: number, result: unknown): boolean {
  return (
    status === 401 &&
    typeof result === "object" &&
    result !== null &&
    (result as { code?: unknown }).code === STAFF_SESSION_INVALID
  );
}

export type ApiSearchParams = {
  page?: string;
  keyword?: string;
  limit?: string;
  from?: string;
  to?: string;
  vendorId?: string;
  brandId?: string;
  categoryId?: string;
  [key: string]: string | string[] | undefined;
};

class ApiService {
  private instance: AxiosInstance;
  private accessToken: string | null = null;
  private sessionLostListeners = new Set<() => void>();

  constructor() {
    this.instance = axios.create({
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.setupInterceptors();
    this.loadTokens();
  }

  private loadTokens(): void {
    if (typeof window !== "undefined") {
      this.accessToken = localStorage.getItem("accessToken");
      // R-19: the refresh half never refreshed anything — drop its leftover.
      localStorage.removeItem("refreshToken");
    }
  }

  private saveToken(accessToken: string): void {
    this.accessToken = accessToken;
    if (typeof window !== "undefined") {
      localStorage.setItem("accessToken", accessToken);
    }
  }

  private clearTokens(): void {
    this.accessToken = null;
    if (typeof window !== "undefined") {
      localStorage.removeItem("accessToken");
    }
  }

  private setupInterceptors(): void {
    this.instance.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        if (this.accessToken && config.headers) {
          config.headers["Authorization"] = `Bearer ${this.accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error),
    );
  }

  setBaseURL(url: string): void {
    this.instance.defaults.baseURL = url.replace(/\/+$/, "");
  }

  getBaseURL(): string {
    return this.instance.defaults.baseURL ?? "";
  }

  setHeader(key: string, value: string): void {
    this.instance.defaults.headers.common[key] = value;
  }

  // Store the staff session issued by `GET /api/user/code`.
  setToken(accessToken: string): void {
    this.saveToken(accessToken);
  }

  logout(): void {
    this.clearTokens();
  }

  // Called when the server rejects the staff session (expired, revoked,
  // archived user). The token is already cleared; listeners send the till
  // back to the staff login screen. Returns an unsubscribe function.
  onSessionLost(listener: () => void): () => void {
    this.sessionLostListeners.add(listener);
    return () => {
      this.sessionLostListeners.delete(listener);
    };
  }

  private handleSessionLost(): void {
    this.clearTokens();
    for (const listener of this.sessionLostListeners) listener();
  }

  private async request<T = unknown>(
    endpoint: string,
    method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
    data?: unknown,
  ): Promise<ApiResponse<T>> {
    const sentToken = this.accessToken;
    try {
      const response = await this.instance.request({
        url: endpoint,
        method,
        data: method !== "GET" ? data : undefined,
        params: method === "GET" ? data : undefined,
      });

      const body = response.data;
      const msg = body.msg || body.message || "Success";

      return {
        ok: body.ok ?? true,
        status: response.status,
        msg,
        result: body.result ?? null,
        paging: body.paging ?? null,
        ...(typeof body.token === "string" ? { token: body.token } : {}),
      };
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{
          ok?: boolean;
          msg?: string;
          message?: string;
          result?: T | null;
          paging?: PagingType | null;
        }>;
        const status = axiosError.response?.status ?? 0;
        const body = axiosError.response?.data;
        const msg = body?.msg || body?.message || "Server Error";

        // Only if the rejected token is still the current one — a late 401
        // from before a fresh login must not log the new staff out.
        if (
          isStaffSessionInvalid(status, body?.result) &&
          this.accessToken === sentToken
        ) {
          this.handleSessionLost();
        }

        return {
          ok: false,
          status,
          msg,
          result: body?.result ?? null,
          paging: body?.paging ?? null,
        };
      }

      return {
        ok: false,
        status: 0,
        msg: "Network Error",
        result: null,
        paging: null,
      };
    }
  }

  get<T = unknown>(endpoint: string, params?: Record<string, string>) {
    return this.request<T>(endpoint, "GET", params);
  }

  post<T = unknown>(endpoint: string, data?: unknown) {
    return this.request<T>(endpoint, "POST", data);
  }

  patch<T = unknown>(endpoint: string, data?: unknown) {
    return this.request<T>(endpoint, "PATCH", data);
  }

  put<T = unknown>(endpoint: string, data?: unknown) {
    return this.request<T>(endpoint, "PUT", data);
  }

  delete<T = unknown>(endpoint: string) {
    return this.request<T>(endpoint, "DELETE");
  }
}

export const apiService = new ApiService();

export default apiService;
