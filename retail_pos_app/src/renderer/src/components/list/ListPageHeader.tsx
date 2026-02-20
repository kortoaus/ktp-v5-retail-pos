import { Link } from "react-router-dom";
import { ReactNode } from "react";

type ListPageHeaderProps = {
  title: string;
  href: string;
  action?: ReactNode;
};

export default function ListPageHeader({
  title,
  href,
  action,
}: ListPageHeaderProps) {
  const formattedTitle = title
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

  return (
    <div className="flex items-center justify-between p-2">
      <Link to={href}>
        <h2 className="text-2xl font-bold">{formattedTitle}</h2>
      </Link>
      {action}
    </div>
  );
}
