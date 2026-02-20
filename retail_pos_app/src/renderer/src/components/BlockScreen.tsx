import React from "react";
import { Link } from "react-router-dom";

export default function BlockScreen({
  label = "You are not authorized to access this page",
  link = "/",
}: {
  label?: string;
  link?: string;
}) {
  return (
    <div className="flex items-center justify-center h-full text-gray-400 flex-col gap-4">
      <p className="text-sm text-gray-400">{label}</p>
      <Link
        to={link}
        className="text-sm text-blue-600 hover:text-blue-800 font-medium"
      >
        <button className="text-sm text-blue-600 hover:text-blue-800 font-medium">
          Back to Home
        </button>
      </Link>
    </div>
  );
}
