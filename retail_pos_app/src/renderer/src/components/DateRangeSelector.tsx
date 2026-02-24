import { useState } from "react";
import type { Dayjs } from "dayjs";
import dayjsAU from "../libs/dayjsAU";

interface DateRangeSelectorProps {
  from: Dayjs | null;
  to: Dayjs | null;
  setVal: (from: Dayjs | null, to: Dayjs | null) => void;
  className?: string;
}

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export default function DateRangeSelector({
  from,
  to,
  setVal,
  className = "",
}: DateRangeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [leftMonth, setLeftMonth] = useState(() =>
    (from ?? dayjsAU()).startOf("month"),
  );
  const [rightMonth, setRightMonth] = useState(() =>
    (to ?? dayjsAU()).startOf("month"),
  );

  const hasValue = from !== null && to !== null;

  function handleInlinePress() {
    if (hasValue) {
      setVal(null, null);
    } else {
      setLeftMonth(dayjsAU().startOf("month"));
      setRightMonth(dayjsAU().startOf("month"));
      setOpen(true);
    }
  }

  function handleFromDate(d: Dayjs) {
    setVal(d.startOf("day"), (to ?? d).endOf("day"));
  }

  function handleToDate(d: Dayjs) {
    setVal((from ?? d).startOf("day"), d.endOf("day"));
  }

  function preset(fromD: Dayjs, toD: Dayjs) {
    setVal(fromD.startOf("day"), toD.endOf("day"));
    setLeftMonth(fromD.startOf("month"));
    setRightMonth(toD.startOf("month"));
    setOpen(false);
  }

  return (
    <>
      <div
        onPointerDown={handleInlinePress}
        className={`h-9 px-3 rounded-lg border border-gray-300 text-sm flex items-center cursor-pointer ${className}`}
      >
        {hasValue ? (
          <>
            {from.format("DD/MM/YY")} — {to.format("DD/MM/YY")}
            <span className="ml-1 text-gray-400">✕</span>
          </>
        ) : (
          <span className="text-gray-400">Any date</span>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center"
          style={{ zIndex: 1000 }}
          onPointerDown={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-6 flex flex-col gap-4"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex gap-6">
              <MonthCalendar
                month={leftMonth}
                onPrevMonth={() =>
                  setLeftMonth((m) => m.subtract(1, "month"))
                }
                onNextMonth={() => setLeftMonth((m) => m.add(1, "month"))}
                selected={from}
                rangeFrom={from}
                rangeTo={to}
                onSelect={handleFromDate}
                label="From"
              />
              <MonthCalendar
                month={rightMonth}
                onPrevMonth={() =>
                  setRightMonth((m) => m.subtract(1, "month"))
                }
                onNextMonth={() => setRightMonth((m) => m.add(1, "month"))}
                selected={to}
                rangeFrom={from}
                rangeTo={to}
                onSelect={handleToDate}
                label="To"
              />
            </div>

            <div className="flex gap-2">
              <PresetButton
                label="Today"
                onPress={() => {
                  const d = dayjsAU();
                  preset(d, d);
                }}
              />
              <PresetButton
                label="This Week"
                onPress={() => {
                  preset(
                    dayjsAU().startOf("week").add(1, "day"),
                    dayjsAU().endOf("week").add(1, "day"),
                  );
                }}
              />
              <PresetButton
                label="This Month"
                onPress={() => {
                  preset(
                    dayjsAU().startOf("month"),
                    dayjsAU().endOf("month"),
                  );
                }}
              />
              <PresetButton
                label="This Year"
                onPress={() => {
                  preset(
                    dayjsAU().startOf("year"),
                    dayjsAU().endOf("year"),
                  );
                }}
              />
              <div className="flex-1" />
              <button
                type="button"
                onPointerDown={() => setOpen(false)}
                className="px-4 h-10 rounded-lg bg-gray-200 text-sm font-medium active:bg-gray-300"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MonthCalendar({
  month,
  onPrevMonth,
  onNextMonth,
  selected,
  rangeFrom,
  rangeTo,
  onSelect,
  label,
}: {
  month: Dayjs;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  selected: Dayjs | null;
  rangeFrom: Dayjs | null;
  rangeTo: Dayjs | null;
  onSelect: (d: Dayjs) => void;
  label: string;
}) {
  const start = month.startOf("month");
  const daysInMonth = month.daysInMonth();
  const startDay = (start.day() + 6) % 7;

  const cells: (Dayjs | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(month.date(i));

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-bold text-gray-400 uppercase">{label}</div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onPointerDown={onPrevMonth}
          className="w-10 h-10 flex items-center justify-center rounded-lg active:bg-gray-200 text-lg"
        >
          ←
        </button>
        <span className="text-sm font-bold">{month.format("MMMM YYYY")}</span>
        <button
          type="button"
          onPointerDown={onNextMonth}
          className="w-10 h-10 flex items-center justify-center rounded-lg active:bg-gray-200 text-lg"
        >
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {DAYS.map((d) => (
          <div
            key={d}
            className="h-8 flex items-center justify-center text-xs text-gray-400 font-medium"
          >
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;

          const isSelected = selected && day.isSame(selected, "day");
          const inRange =
            rangeFrom &&
            rangeTo &&
            day.isAfter(rangeFrom.subtract(1, "day"), "day") &&
            day.isBefore(rangeTo.add(1, "day"), "day");
          const isToday = day.isSame(dayjsAU(), "day");

          let cls =
            "h-10 w-10 flex items-center justify-center rounded-lg text-sm font-medium ";
          if (isSelected) {
            cls += "bg-blue-600 text-white";
          } else if (inRange) {
            cls += "bg-blue-100 text-blue-800";
          } else if (isToday) {
            cls += "bg-gray-100 font-bold";
          } else {
            cls += "active:bg-gray-200";
          }

          return (
            <button
              key={day.date()}
              type="button"
              onPointerDown={() => onSelect(day)}
              className={cls}
            >
              {day.date()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PresetButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={onPress}
      className="px-4 h-10 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium active:bg-blue-200"
    >
      {label}
    </button>
  );
}
