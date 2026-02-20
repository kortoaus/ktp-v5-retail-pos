import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import useHotkeys from "../hooks/useHotkeys";
import { Item } from "../types/models";
import {
  upsertHotkey,
  deleteHotkey,
  UpsertHotkeyPayload,
} from "../service/hotkey.service";
import { itemNameParser } from "../libs/item-utils";
import SearchItemModal from "../components/SearchItemModal";
import OnScreenKeyboard from "../components/OnScreenKeyboard";
import ModalContainer from "../components/ModalContainer";
import { cn } from "../libs/cn";
import { HOTKEY_COLORS } from "../components/Hotkeys";
import { useUser } from "../contexts/UserContext";
import hasScope from "../libs/scope-utils";
import BlockScreen from "../components/BlockScreen";

const GRID_SIZE = 6;

interface EditableKey {
  x: number;
  y: number;
  itemId: number;
  item: Item;
  name: string;
  color: string;
}

interface EditableHotkey {
  id?: number;
  sort: number;
  name: string;
  color: string;
  keys: EditableKey[];
  dirty: boolean;
}

interface CellEditState {
  x: number;
  y: number;
  itemId: number;
  item: Item;
  name: string;
  color: string;
}

export default function HotkeyManagerScreen() {
  const { user, loading: userLoading } = useUser();
  const navigate = useNavigate();
  const { hotkeys, hotkeysLoading, refresh } = useHotkeys();

  const [groups, setGroups] = useState<EditableHotkey[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [targetCell, setTargetCell] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const [cellAction, setCellAction] = useState<{
    x: number;
    y: number;
    name: string;
  } | null>(null);

  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState(HOTKEY_COLORS[1]);

  const [cellEdit, setCellEdit] = useState<CellEditState | null>(null);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setGroups(
      hotkeys.map((hk) => ({
        id: hk.id,
        sort: hk.sort,
        name: hk.name,
        color: hk.color,
        keys: hk.keys.map((k) => ({
          x: k.x,
          y: k.y,
          itemId: k.itemId,
          item: k.item,
          name: k.name,
          color: k.color,
        })),
        dirty: false,
      })),
    );
    setSelectedIndex((prev) =>
      hotkeys.length > 0 ? Math.min(prev, hotkeys.length - 1) : 0,
    );
  }, [hotkeys]);

  const selectedGroup = groups[selectedIndex] ?? null;
  const hasDirty = groups.some((g) => g.dirty);

  const openCreateGroup = useCallback(() => {
    setEditingIndex(null);
    setFormName("");
    setFormColor(HOTKEY_COLORS[1]);
    setGroupModalOpen(true);
  }, []);

  const openEditGroup = useCallback(
    (index: number) => {
      const group = groups[index];
      if (!group) return;
      setEditingIndex(index);
      setFormName(group.name);
      setFormColor(group.color);
      setGroupModalOpen(true);
    },
    [groups],
  );

  const handleGroupSubmit = useCallback(() => {
    const trimmed = formName.trim();
    if (!trimmed) return;

    if (editingIndex !== null) {
      setGroups((prev) =>
        prev.map((g, i) =>
          i === editingIndex
            ? { ...g, name: trimmed, color: formColor, dirty: true }
            : g,
        ),
      );
    } else {
      const newGroup: EditableHotkey = {
        sort: groups.length,
        name: trimmed,
        color: formColor,
        keys: [],
        dirty: true,
      };
      setGroups((prev) => [...prev, newGroup]);
      setSelectedIndex(groups.length);
    }
    setGroupModalOpen(false);
  }, [formName, formColor, editingIndex, groups.length]);

  const handleDeleteGroup = useCallback(
    async (index: number) => {
      const group = groups[index];
      if (!group) return;
      if (!window.confirm(`Delete "${group.name}"?`)) return;

      if (group.id) {
        try {
          await deleteHotkey(group.id);
        } catch {
          window.alert("Failed to delete group");
          return;
        }
      }

      setGroups((prev) => prev.filter((_, i) => i !== index));
      setSelectedIndex((prev) => {
        if (prev >= index && prev > 0) return prev - 1;
        return prev;
      });
    },
    [groups],
  );

  const handleCellClick = useCallback(
    (x: number, y: number) => {
      if (!selectedGroup) return;

      const existing = selectedGroup.keys.find((k) => k.x === x && k.y === y);
      if (existing) {
        setCellAction({ x, y, name: existing.name });
      } else {
        setTargetCell({ x, y });
        setSearchModalOpen(true);
      }
    },
    [selectedGroup],
  );

  const handleItemSelect = useCallback(
    (item: Item) => {
      if (!targetCell) return;
      const { name_en, name_ko } = itemNameParser(item);

      setSearchModalOpen(false);
      setCellEdit({
        x: targetCell.x,
        y: targetCell.y,
        itemId: item.id,
        item,
        name: name_en || name_ko,
        color: HOTKEY_COLORS[1],
      });
      setTargetCell(null);
    },
    [targetCell],
  );

  const handleCellEditConfirm = useCallback(() => {
    if (!cellEdit) return;

    setGroups((prev) =>
      prev.map((g, i) => {
        if (i !== selectedIndex) return g;
        const filtered = g.keys.filter(
          (k) => !(k.x === cellEdit.x && k.y === cellEdit.y),
        );
        return {
          ...g,
          keys: [
            ...filtered,
            {
              x: cellEdit.x,
              y: cellEdit.y,
              itemId: cellEdit.itemId,
              item: cellEdit.item,
              name: cellEdit.name,
              color: cellEdit.color,
            },
          ],
          dirty: true,
        };
      }),
    );

    setCellEdit(null);
  }, [cellEdit, selectedIndex]);

  const removeCell = useCallback(
    (x: number, y: number) => {
      setGroups((prev) =>
        prev.map((g, i) => {
          if (i !== selectedIndex) return g;
          return {
            ...g,
            keys: g.keys.filter((k) => !(k.x === x && k.y === y)),
            dirty: true,
          };
        }),
      );
    },
    [selectedIndex],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      for (const group of groups) {
        if (!group.dirty) continue;
        const payload: UpsertHotkeyPayload = {
          id: group.id,
          name: group.name,
          sort: group.sort,
          color: group.color,
          keys: group.keys.map((k) => ({
            x: k.x,
            y: k.y,
            itemId: k.itemId,
            name: k.name,
            color: k.color,
          })),
        };
        await upsertHotkey(payload);
      }
      await refresh();
    } catch {
      window.alert("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [groups, refresh]);

  if (userLoading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading...
      </div>
    );
  }

  if (!user || !hasScope(user.scope, ["hotkey"])) {
    return (
      <BlockScreen
        label="You are not authorized to access this page"
        link="/"
      />
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200 bg-white shrink-0">
        <button
          type="button"
          onPointerDown={() => navigate("/")}
          className="px-4 py-2 rounded-lg bg-gray-100 active:bg-gray-200 text-sm font-medium"
        >
          ← Back
        </button>
        <h1 className="text-lg font-bold">Hotkey Manager</h1>
        <button
          type="button"
          onPointerDown={handleSave}
          disabled={!hasDirty || saving}
          className="px-6 py-2 rounded-lg bg-blue-600 text-white active:bg-blue-700 disabled:opacity-30 text-sm font-medium"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {hotkeysLoading && groups.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          Loading...
        </div>
      ) : groups.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-gray-400">No hotkey groups</p>
          <button
            type="button"
            onPointerDown={openCreateGroup}
            className="px-6 py-3 rounded-xl bg-blue-600 text-white active:bg-blue-700 font-medium"
          >
            Create First Group
          </button>
        </div>
      ) : (
        <>
          <div className="h-14 flex items-center border-b border-gray-200 shrink-0">
            <div className="flex-1 flex items-center divide-x divide-gray-200 h-full overflow-x-auto">
              {groups.map((group, index) => (
                <button
                  key={group.id ?? `new-${index}`}
                  type="button"
                  onPointerDown={() => setSelectedIndex(index)}
                  className={cn(
                    "h-full px-6 text-sm font-medium whitespace-nowrap",
                    index === selectedIndex
                      ? `${group.color || "bg-gray-100 text-black"} font-bold text-lg`
                      : cn(
                          group.color || "bg-gray-100 text-black",
                          "active:opacity-80",
                        ),
                  )}
                >
                  {group.name}
                  {group.dirty && " •"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onPointerDown={openCreateGroup}
              className="h-full px-4 text-sm font-medium text-blue-600 active:bg-blue-50 shrink-0 border-l border-gray-200"
            >
              + New
            </button>
          </div>

          {selectedGroup && (
            <div className="h-12 flex items-center justify-between px-4 border-b border-gray-200 bg-white shrink-0">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "w-4 h-4 rounded-sm",
                    selectedGroup.color || "bg-gray-100",
                  )}
                />
                <span className="font-medium text-sm">
                  {selectedGroup.name}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onPointerDown={() => openEditGroup(selectedIndex)}
                  className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 active:bg-gray-200"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onPointerDown={() => handleDeleteGroup(selectedIndex)}
                  className="px-3 py-1.5 text-sm rounded-lg bg-red-50 text-red-600 active:bg-red-100"
                >
                  Delete
                </button>
              </div>
            </div>
          )}

          {selectedGroup && (
            <div className="flex-1 flex flex-col divide-y divide-gray-200">
              {Array.from({ length: GRID_SIZE }).map((_, yIdx) => (
                <div
                  key={yIdx}
                  className="flex-1 flex divide-x divide-gray-200"
                >
                  {Array.from({ length: GRID_SIZE }).map((_, xIdx) => {
                    const hotkeyItem = selectedGroup.keys.find(
                      (k) => k.x === xIdx && k.y === yIdx,
                    );
                    return (
                      <button
                        key={xIdx}
                        type="button"
                        className={cn(
                          "flex-1 overflow-hidden flex items-center justify-center p-1",
                          hotkeyItem
                            ? hotkeyItem.color || "bg-gray-100 text-black"
                            : "bg-white text-gray-300 active:bg-gray-50",
                        )}
                        onPointerDown={() => handleCellClick(xIdx, yIdx)}
                      >
                        {hotkeyItem ? (
                          <span className="text-xs font-medium text-center line-clamp-2 leading-tight">
                            {hotkeyItem.name ||
                              itemNameParser(hotkeyItem.item).name_en}
                          </span>
                        ) : (
                          <span className="text-2xl">+</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <SearchItemModal
        open={searchModalOpen}
        onClose={() => {
          setSearchModalOpen(false);
          setTargetCell(null);
        }}
        onSelect={handleItemSelect}
      />

      <ModalContainer
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        title={editingIndex !== null ? "Edit Group" : "New Group"}
        maxWidth="max-w-3xl"
      >
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
            <div className="flex-1 text-lg min-h-[28px]">
              {formName || (
                <span className="text-gray-400">Enter group name</span>
              )}
            </div>
            {formName && (
              <button
                type="button"
                onPointerDown={() => setFormName("")}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-300 text-sm"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="px-4 py-3">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Color
          </label>
          <div className="grid grid-cols-4 gap-2">
            {HOTKEY_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onPointerDown={() => setFormColor(color)}
                className={cn(
                  "h-10 rounded-lg border-2",
                  color,
                  formColor === color
                    ? "border-blue-600"
                    : "border-transparent",
                )}
              />
            ))}
          </div>

          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onPointerDown={() => setGroupModalOpen(false)}
              className="flex-1 py-3 rounded-xl bg-gray-200 active:bg-gray-300 font-medium text-base"
            >
              Cancel
            </button>
            <button
              type="button"
              onPointerDown={handleGroupSubmit}
              disabled={!formName.trim()}
              className="flex-1 py-3 rounded-xl bg-blue-600 text-white active:bg-blue-700 disabled:opacity-30 font-medium text-base"
            >
              {editingIndex !== null ? "Update" : "Create"}
            </button>
          </div>
        </div>

        <div className="border-t border-gray-200 p-2">
          <OnScreenKeyboard value={formName} onChange={setFormName} />
        </div>
      </ModalContainer>

      <ModalContainer
        open={cellAction !== null}
        onClose={() => setCellAction(null)}
        title={cellAction?.name ?? "Cell"}
      >
        <div className="p-4 flex flex-col gap-3">
          <button
            type="button"
            onPointerDown={() => {
              if (!cellAction || !selectedGroup) return;
              const existing = selectedGroup.keys.find(
                (k) => k.x === cellAction.x && k.y === cellAction.y,
              );
              if (existing) {
                setCellEdit({
                  x: existing.x,
                  y: existing.y,
                  itemId: existing.itemId,
                  item: existing.item,
                  name: existing.name,
                  color: existing.color,
                });
              }
              setCellAction(null);
            }}
            className="w-full py-3 rounded-xl bg-gray-100 active:bg-gray-200 font-medium text-base"
          >
            Edit Name / Color
          </button>
          <button
            type="button"
            onPointerDown={() => {
              if (!cellAction) return;
              setTargetCell({ x: cellAction.x, y: cellAction.y });
              setSearchModalOpen(true);
              setCellAction(null);
            }}
            className="w-full py-3 rounded-xl bg-blue-600 text-white active:bg-blue-700 font-medium text-base"
          >
            Replace Item
          </button>
          <button
            type="button"
            onPointerDown={() => {
              if (!cellAction) return;
              removeCell(cellAction.x, cellAction.y);
              setCellAction(null);
            }}
            className="w-full py-3 rounded-xl bg-red-500 text-white active:bg-red-600 font-medium text-base"
          >
            Remove Item
          </button>
          <button
            type="button"
            onPointerDown={() => setCellAction(null)}
            className="w-full py-3 rounded-xl bg-gray-200 active:bg-gray-300 font-medium text-base"
          >
            Cancel
          </button>
        </div>
      </ModalContainer>

      <ModalContainer
        open={cellEdit !== null}
        onClose={() => setCellEdit(null)}
        title="Edit Cell"
        maxWidth="max-w-3xl"
      >
        {cellEdit && (
          <>
            <div className="px-4 py-3 border-b border-gray-200">
              <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
                <div className="flex-1 text-lg min-h-[28px]">
                  {cellEdit.name || (
                    <span className="text-gray-400">
                      {itemNameParser(cellEdit.item).name_en || "Empty"}
                    </span>
                  )}
                </div>
                {cellEdit.name && (
                  <button
                    type="button"
                    onPointerDown={() =>
                      setCellEdit((prev) =>
                        prev ? { ...prev, name: "" } : null,
                      )
                    }
                    className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-300 text-sm"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <div className="px-4 py-3">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Color
              </label>
              <div className="grid grid-cols-4 gap-2">
                {HOTKEY_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onPointerDown={() =>
                      setCellEdit((prev) => (prev ? { ...prev, color } : null))
                    }
                    className={cn(
                      "h-10 rounded-lg border-2",
                      color,
                      cellEdit.color === color
                        ? "border-blue-600"
                        : "border-transparent",
                    )}
                  />
                ))}
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  type="button"
                  onPointerDown={() => setCellEdit(null)}
                  className="flex-1 py-3 rounded-xl bg-gray-200 active:bg-gray-300 font-medium text-base"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onPointerDown={handleCellEditConfirm}
                  className="flex-1 py-3 rounded-xl bg-blue-600 text-white active:bg-blue-700 font-medium text-base"
                >
                  Confirm
                </button>
              </div>
            </div>

            <div className="border-t border-gray-200 p-2">
              <OnScreenKeyboard
                value={cellEdit.name}
                onChange={(v) =>
                  setCellEdit((prev) => (prev ? { ...prev, name: v } : null))
                }
              />
            </div>
          </>
        )}
      </ModalContainer>
    </div>
  );
}
