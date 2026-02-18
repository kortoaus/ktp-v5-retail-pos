import { cn } from "../libs/cn";

interface ModalContainerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export default function ModalContainer({
  open,
  onClose,
  title,
  children,
  maxWidth = "max-w-md",
}: ModalContainerProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: 999 }}
    >
      <div
        className={cn(
          "bg-white rounded-2xl w-full flex flex-col overflow-hidden shadow-2xl",
          maxWidth,
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            type="button"
            onPointerDown={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 text-xl"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
