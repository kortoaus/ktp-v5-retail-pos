import React, { useState } from "react";
import OnScreenKeyboard from "../components/OnScreenKeyboard";

export default function OnScreenKeyboardTestScreen() {
  const [keyword, setKeyword] = useState("");
  return (
    <div>
      <div>{keyword}</div>
      <div className="max-w-md">
        <OnScreenKeyboard value={keyword} onChange={setKeyword} />
      </div>
    </div>
  );
}
