import React from "react";
import { Link } from "react-router-dom";

export default function HomeScreen() {
  return (
    <div className="grid grid-cols-4 grid-rows-2 gap-4">
      <Link to="/sale">
        <button className="w-full h-full bg-gray-100">Sale</button>
      </Link>
      <Link to="/labeling">
        <button className="w-full h-full bg-gray-100">Labeling</button>
      </Link>
      <Link to="/test">
        <button className="w-full h-full bg-gray-100">Test</button>
      </Link>
      <Link to="/settings">
        <button className="w-full h-full bg-gray-100">
          Interface Settings
        </button>
      </Link>
    </div>
  );
}
