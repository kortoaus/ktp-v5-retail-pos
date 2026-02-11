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
}

class ApiService {
  private baseURL: string;
  private defaultHeaders: Record<string, string>;

  constructor(baseURL: string, headers: Record<string, string> = {}) {
    this.baseURL = baseURL.replace(/\/+$/, "");
    this.defaultHeaders = {
      "Content-Type": "application/json",
      ...headers,
    };
  }

  setBaseURL(url: string): void {
    this.baseURL = url.replace(/\/+$/, "");
  }

  setHeader(key: string, value: string): void {
    this.defaultHeaders[key] = value;
  }

  private async request<T = unknown>(
    endpoint: string,
    method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
    data?: unknown,
  ): Promise<ApiResponse<T>> {
    let url = `${this.baseURL}${endpoint}`;

    const init: RequestInit = {
      method,
      headers: { ...this.defaultHeaders },
    };

    if (method === "GET" && data) {
      const params = new URLSearchParams(
        Object.entries(data as Record<string, string>).filter(
          ([, v]) => v !== undefined && v !== null,
        ),
      );
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    } else if (data) {
      init.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, init);
      const body = await response.json();

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          msg: body.msg || body.message || "Server Error",
          result: body.result ?? null,
          paging: body.paging ?? null,
        };
      }

      return {
        ok: true,
        status: response.status,
        msg: body.msg || body.message || "Success",
        result: body.result ?? null,
        paging: body.paging ?? null,
      };
    } catch {
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

export const apiService = new ApiService("http://localhost:2200");

export default apiService;
