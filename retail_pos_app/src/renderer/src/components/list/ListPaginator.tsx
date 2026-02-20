import { Link } from "react-router-dom";
import { Fragment } from "react";
import { PagingType } from "../../libs/api";
import { pagenateQuery } from "../../libs/query-utils";
import { cn } from "../../libs/cn";

function generatePageNumbers(paging: PagingType): number[] {
  const { currentPage, totalPages } = paging;
  if (totalPages <= 1) return [1];

  const rangeStart = Math.max(2, currentPage - 4);
  const rangeEnd = Math.min(totalPages - 1, currentPage + 4);

  const middlePages = Array.from(
    { length: rangeEnd - rangeStart + 1 },
    (_, i) => rangeStart + i,
  );

  const pageNumbers = [1, ...middlePages, totalPages];
  return Array.from(new Set(pageNumbers)).sort((a, b) => a - b);
}

function ChevronLeft() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8.842 3.135a.5.5 0 0 1 .023.707L5.435 7.5l3.43 3.658a.5.5 0 0 1-.73.684l-3.75-4a.5.5 0 0 1 0-.684l3.75-4a.5.5 0 0 1 .707-.023Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6.158 3.135a.5.5 0 0 0-.023.707L9.565 7.5l-3.43 3.658a.5.5 0 0 0 .73.684l3.75-4a.5.5 0 0 0 0-.684l-3.75-4a.5.5 0 0 0-.707-.023Z"
        fill="currentColor"
      />
    </svg>
  );
}

const btnBase =
  "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors";
const btnSoft =
  "bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40 disabled:pointer-events-none";
const btnSolid = "bg-blue-600 text-white";

type ListPaginatorProps = {
  paging: PagingType;
  baseURL: string;
  query: string;
};

export default function ListPaginator({
  paging,
  baseURL,
  query,
}: ListPaginatorProps) {
  const { hasNext, hasPrev, currentPage, totalPages } = paging;
  const pageNumbers = generatePageNumbers(paging);

  return (
    <div className="bg-gray-50 p-4">
      {/* Mobile */}
      <div className="flex md:hidden items-center justify-between">
        <div className="w-12">
          {hasPrev && (
            <Link
              to={`${baseURL}${pagenateQuery(query, currentPage - 1)}`}
              className={cn(btnBase, btnSoft, "px-2 py-2")}
            >
              <ChevronLeft />
            </Link>
          )}
        </div>

        <span className="text-sm font-medium">
          Page {currentPage} of {totalPages}
        </span>

        <div className="w-12">
          {hasNext && (
            <Link
              to={`${baseURL}${pagenateQuery(query, currentPage + 1)}`}
              className={cn(btnBase, btnSoft, "px-2 py-2")}
            >
              <ChevronRight />
            </Link>
          )}
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden md:flex items-center justify-center gap-2">
        {hasPrev ? (
          <Link
            to={`${baseURL}${pagenateQuery(query, currentPage - 1)}`}
            className={cn(btnBase, btnSoft)}
          >
            <ChevronLeft />
          </Link>
        ) : (
          <span
            className={cn(btnBase, btnSoft, "opacity-40 pointer-events-none")}
          >
            <ChevronLeft />
          </span>
        )}

        <div className="flex items-center gap-1">
          {pageNumbers.map((pn, index) => {
            const isActive = pn === currentPage;
            const showEllipsis = index > 0 && pn - pageNumbers[index - 1] > 1;

            return (
              <Fragment key={pn}>
                {showEllipsis && (
                  <span className="text-sm text-gray-500 mx-1">...</span>
                )}
                {isActive ? (
                  <span className={cn(btnBase, btnSolid)}>{pn}</span>
                ) : (
                  <Link
                    to={`${baseURL}${pagenateQuery(query, pn)}`}
                    className={cn(btnBase, btnSoft)}
                  >
                    {pn}
                  </Link>
                )}
              </Fragment>
            );
          })}
        </div>

        {hasNext ? (
          <Link
            to={`${baseURL}${pagenateQuery(query, currentPage + 1)}`}
            className={cn(btnBase, btnSoft)}
          >
            <ChevronRight />
          </Link>
        ) : (
          <span
            className={cn(btnBase, btnSoft, "opacity-40 pointer-events-none")}
          >
            <ChevronRight />
          </span>
        )}
      </div>
    </div>
  );
}
