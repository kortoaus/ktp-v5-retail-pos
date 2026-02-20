import { ApiSearchParams } from "./api";

// Generate query string from search params object
export function generateQueryString(searchParams: ApiSearchParams): string {
  const queryParams = {
    page: searchParams.page ? searchParams.page.toString() : "1",
    keyword: searchParams.keyword || "",
    limit: searchParams.limit?.toString(),
    from: searchParams.from,
    to: searchParams.to,
    vendorId: searchParams.vendorId,
    brandId: searchParams.brandId,
    categoryId: searchParams.categoryId,
  };

  const queryList = Object.entries(queryParams)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value + "")}`);

  return queryList.length > 0 ? `?${queryList.join("&")}` : "";
}

// Generate query string from URLSearchParams
export function generateQueryStringFromUrl(
  searchParams: URLSearchParams,
): string {
  const params: ApiSearchParams = {
    page: searchParams.get("page") ? searchParams.get("page")?.toString() : "1",
    keyword: searchParams.get("keyword") || "",
    limit: searchParams.get("limit")
      ? searchParams.get("limit")?.toString()
      : undefined,
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    vendorId: searchParams.get("vendorId") || undefined,
    brandId: searchParams.get("brandId") || undefined,
    categoryId: searchParams.get("categoryId") || undefined,
  };

  return generateQueryString(params);
}

// Update page in query string
export function pagenateQuery(queryString: string, targetPage: number): string {
  if (!queryString) {
    return `?page=${targetPage}`;
  }

  const cleanQuery = queryString.startsWith("?")
    ? queryString.slice(1)
    : queryString;
  const params = new URLSearchParams(cleanQuery);
  params.set("page", targetPage.toString());

  return `?${params.toString()}`;
}

// Update keyword in query string (resets page to 1)
export function changeKeyword(queryString: string, keyword: string): string {
  const cleanQuery = queryString.startsWith("?")
    ? queryString.slice(1)
    : queryString;
  const params = new URLSearchParams(cleanQuery);

  if (keyword) {
    params.set("keyword", keyword);
  } else {
    params.delete("keyword");
  }
  params.set("page", "1");

  return `?${params.toString()}`;
}

// Parse search params from current URL
export function getSearchParamsFromUrl(): ApiSearchParams {
  const searchParams = new URLSearchParams(window.location.search);
  return {
    page: searchParams.get("page") ? searchParams.get("page")?.toString() : "1",
    keyword: searchParams.get("keyword") || "",
    limit: searchParams.get("limit")
      ? searchParams.get("limit")?.toString()
      : undefined,
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    vendorId: searchParams.get("vendorId") || undefined,
    brandId: searchParams.get("brandId") || undefined,
    categoryId: searchParams.get("categoryId") || undefined,
  };
}
