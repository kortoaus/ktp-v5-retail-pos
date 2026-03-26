import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import advancedFormat from "dayjs/plugin/advancedFormat";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advancedFormat);

const TZ = "Australia/Sydney";

const dayjsAU = (date?: dayjs.ConfigType) => dayjs(date).tz(TZ);

export function fmtDateRangeStr(from: string, to: string): string {
  const fmt = "Do MMM YY";
  const [fromD, fromM, fromY] = dayjsAU(from).format(fmt).split(" ");
  const [toD, toM, toY] = dayjsAU(to).format(fmt).split(" ");

  if (fromM === toM && fromY === toY) {
    return `${fromD}-${toD} ${fromM} ${toY}`;
  }

  if (fromY === toY) {
    return `${fromD} ${fromM}-${toD} ${toM} ${toY}`;
  }

  return `${fromD} ${fromM} ${fromY}-${toD} ${toM} ${toY}`;
}

export default dayjsAU;
export { TZ };
