import moment, { Moment, MomentInput } from "moment-timezone";

export default function momentAU(input: MomentInput): Moment {
  return moment(input).tz("Australia/Sydney");
}
