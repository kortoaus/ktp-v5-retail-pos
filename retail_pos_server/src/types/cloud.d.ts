export type PagingType = {
  hasPrev: boolean;
  hasNext: boolean;
  currentPage: number;
  totalPages: number;
};

export type Member = {
  id: string;
  companyId: number;
  phone_last4: string | null; // Last 4 digits for display
  name: string;
  email: string | null;
  dob: Date | null;
  gender: string; // n: none, m: male, f: female
  cash_spend: number;
  credit_spend: number;
  points: number;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLogin?: Date;
  level: number;
};

export type CreateMemberDTO = {
  phone: string;
  name: string;
  email?: string;
  dob?: string;
  gender?: string;
};
