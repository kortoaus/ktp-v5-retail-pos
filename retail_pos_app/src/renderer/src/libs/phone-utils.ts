export const sanitizePhone = (phone: string): string | null => {
  if (!phone) return null;

  let cleaned = phone.replace(/\D/g, "");

  if (cleaned.startsWith("61")) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith("0")) {
    cleaned = cleaned.substring(1);
  }

  if (cleaned.length === 9 && cleaned.startsWith("4")) {
    return cleaned;
  }

  return null;
};
