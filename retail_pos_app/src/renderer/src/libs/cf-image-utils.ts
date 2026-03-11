export type CF_Variant = "dbase" | "dsm" | "dxs" | "thumb" | "dDetail";

export function CF_URL(id: string, variant: CF_Variant = "thumb") {
  const baseUrl = "https://imagedelivery.net/Cqklq-HapOBQqS6V9uKtyw/";
  return `${baseUrl}${id}/${variant}`;
}
