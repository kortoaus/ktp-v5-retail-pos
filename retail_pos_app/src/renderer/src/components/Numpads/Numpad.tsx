import React from "react";

export default function Numpad({
  val,
  setVal,
  useDot = true,
  maxDp = 3,
}: {
  val: string;
  setVal: (val: string) => void;
  useDot?: boolean;
  maxDp?: number;
}) {
  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    const value = e.currentTarget.textContent;
    if (!value) return;

    // Clear
    if (value === "CLS") {
      setVal("");
      return;
    }

    // Delete last character
    if (value === "DEL") {
      setVal(val.slice(0, -1));
      return;
    }

    // Decimal point - only allow one
    if (value === ".") {
      if (!val.includes(".")) {
        setVal(val === "" ? "0." : val + ".");
      }
      return;
    }

    // Numbers 0-9
    // Prevent multiple leading zeros (e.g., "00", "000")
    if (val === "0" && value === "0") return;

    // Replace leading zero with new digit (0 -> 5, not 05)
    if (val === "0") {
      setVal(value);
      return;
    }

    // Limit decimal places to 3 digits
    const dotIndex = val.indexOf(".");
    if (dotIndex !== -1 && val.length - dotIndex > maxDp) return;

    setVal(val + value);
  }

  return (
    <div className="Numpad">
      <div onClick={() => setVal("")} className="Numpad-display">
        {val}
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
          {useDot ? (
            <button onClick={handleClick}>.</button>
          ) : (
            <div className="Numpad-empty"></div>
          )}
        </div>
      </div>
    </div>
  );
}
