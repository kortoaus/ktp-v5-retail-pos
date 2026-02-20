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
  private refreshToken: string | null = null;

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
      this.refreshToken = localStorage.getItem("refreshToken");
    }
  }

  private saveTokens(accessToken: string, refreshToken: string): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    if (typeof window !== "undefined") {
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
    }
  }

  private clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    if (typeof window !== "undefined") {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
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

  setHeader(key: string, value: string): void {
    this.instance.defaults.headers.common[key] = value;
  }

  setTokens(accessToken: string, refreshToken: string): void {
    this.saveTokens(accessToken, refreshToken);
  }

  logout(): void {
    this.clearTokens();
  }

  private async request<T = unknown>(
    endpoint: string,
    method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
    data?: unknown,
  ): Promise<ApiResponse<T>> {
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
