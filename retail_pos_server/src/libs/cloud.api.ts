import axios, { AxiosInstance } from "axios";
import { API_KEY, API_URL, CRM_URL, ITEM_URL } from "./constants";
import { PagingType } from "../types/cloud";

export type ApiResponse<T = any> = {
  ok: boolean;
  message?: string;
  msg?: string;
  status?: number;
  result?: T | null;
  paging?: PagingType | null;
};

class ApiService {
  private instance: AxiosInstance;

  constructor(baseURL: string) {
    this.instance = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        "device-api-key": API_KEY,
      },
    });
  }

  async request<T = any>(
    endpoint: string,
    method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT" = "GET",
    data?: any,
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.instance.request({
        url: endpoint,
        method,
        data: method !== "GET" ? data : undefined,
        params: method === "GET" ? data : undefined,
      });

      const responseData = response.data;

      const msg = responseData.message || responseData.msg || "Success";

      console.log("status", response.status);

      return {
        ok: true,
        msg,
        message: msg,
        status: response.status,
        result: responseData.result ?? null,
        paging: responseData.paging ?? null,
      };
    } catch (error) {
      // console.log(error);
      if (axios.isAxiosError(error)) {
        console.log("error", error.response?.status);
        const status = error.response?.status ?? 500;
        const data = error.response?.data ?? {};
        const msg = data.message || data.msg || "Server Error";

        return {
          ok: false,
          msg,
          message: msg,
          status,
          result: data.result ?? null,
          paging: data.paging ?? null,
        };
      }

      return {
        ok: false,
        msg: "Network Error",
        message: "Network Error",
        status: 0,
        result: null,
        paging: null,
      };
    }
  }

  get<T = any>(endpoint: string, params?: any) {
    return this.request<T>(endpoint, "GET", params);
  }

  post<T = any>(endpoint: string, data?: any) {
    return this.request<T>(endpoint, "POST", data);
  }

  patch<T = any>(endpoint: string, data?: any) {
    return this.request<T>(endpoint, "PATCH", data);
  }

  put<T = any>(endpoint: string, data?: any) {
    return this.request<T>(endpoint, "PUT", data);
  }

  delete<T = any>(endpoint: string) {
    return this.request<T>(endpoint, "DELETE");
  }
}

export const apiService = new ApiService(API_URL);
export const itemApiService = new ApiService(ITEM_URL);
export const crmApiService = new ApiService(CRM_URL);

export default apiService;
