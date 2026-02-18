import React from "react";
import { MONEY_DP } from "../../libs/constants";

export default function MoneyNumpad({
  val,
  setVal,
}: {
  val: string;
  setVal: (val: string) => void;
}) {
  // val is cents string, display as dollars
  // "500" -> "5.00", "50" -> "0.50", "5" -> "0.05", "" -> "0.00"
  const cents = parseInt(val || "0", 10);
  const display = (cents / 100).toFixed(MONEY_DP);

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    const value = e.currentTarget.textContent;
    if (!value) return;

    // Clear
    if (value === "CLS") {
      setVal("");
      return;
    }

    // Delete last digit
    if (value === "DEL") {
      setVal(val.slice(0, -1));
      return;
    }

    // Append digits
    setVal(val + value);
  }

  return (
    <div className="Numpad">
      <div onClick={() => setVal("")} className="Numpad-display">
        {display}
      </div>
      <div className="Numpad-buttons">
        <div className="Numpad-row">
          <button onClick={handleClick}>1</button>
          <button onClick={handleClick}>2</button>
          <button onClick={handleClick}>3</button>
        </div>
        <div className="Numpad-row">
          <button onClick={handleClick}>4</button>
          <button onClick={handleClick}>5</button>
          <button onClick={handleClick}>6</button>
        </div>
        <div className="Numpad-row">
          <button onClick={handleClick}>7</button>
          <button onClick={handleClick}>8</button>
          <button onClick={handleClick}>9</button>
        </div>
        <div className="Numpad-row">
          <button onClick={handleClick}>DEL</button>
          <button onClick={handleClick}>0</button>
          <button onClick={handleClick}>00</button>
        </div>
      </div>
    </div>
  );
}
