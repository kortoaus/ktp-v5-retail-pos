import React, { useState } from "react";
import { User } from "../types/models";

export default function ManagerWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);

  return <div>ManagerWrapper</div>;
}
