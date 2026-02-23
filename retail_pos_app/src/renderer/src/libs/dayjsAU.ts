import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = "Australia/Sydney";

const dayjsAU = (date?: dayjs.ConfigType) => dayjs(date).tz(TZ);

export default dayjsAU;
export { TZ };