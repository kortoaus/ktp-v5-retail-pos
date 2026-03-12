import { useCallback, useState } from "react";
import { User, UserVoucher } from "../types/models";
import { getPublicUsers } from "../service/user.service";
import ModalContainer from "../components/ModalContainer";
import KeyboardInputText from "../components/KeyboardInputText";
import LoadingOverlay from "../components/LoadingOverlay";
import {
  getUserVouchersByUserIds,
  issueUserDailyVoucher,
} from "../service/user.voucher.service";
import { MONEY_DP } from "../libs/constants";

const RESULT_LIMIT = 5;

type UserWithVoucher = User & {
  voucher: UserVoucher | null;
};

const searchUserVouchers = async (keyword: string) => {
  const userRes = await getPublicUsers(
    `?keyword=${keyword}&limit=${RESULT_LIMIT}`,
  );
  if (!userRes.ok || !userRes.result)
    return {
      ok: false,
      result: [],
      msg: userRes.msg || "Failed to search users",
    };

  const userIds = userRes.result.map((user) => user.id);
  const voucherRes = await getUserVouchersByUserIds(userIds);
  if (!voucherRes.ok || !voucherRes.result)
    return {
      ok: false,
      result: [],
      msg: voucherRes.msg || "Failed to search user vouchers",
    };

  const vouchers = voucherRes.result ?? ([] as UserVoucher[]);
  const userWithVoucher = userRes.result.map((user) => ({
    ...user,
    voucher: vouchers.find((voucher) => voucher.userId === user.id) || null,
  }));

  return {
    ok: true,
    result: userWithVoucher,
  };
};

export default function TestScreen() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UserWithVoucher[]>([]);
  const [keyword, setKeyword] = useState("");
  const [lastKeyword, setLastKeyword] = useState("");

  const onSearchHandler = useCallback(async () => {
    if (loading || keyword === lastKeyword || keyword.trim() === "") return;
    setLoading(true);
    try {
      const res = await searchUserVouchers(keyword);
      if (res.ok && res.result) {
        setResult(res.result);
        setLastKeyword(keyword);
        setKeyword("");
      } else {
        setResult([]);
        window.alert("Failed to search users");
      }
    } finally {
      setLoading(false);
    }
  }, [keyword]);

  const onIssueVoucherHandler = useCallback(
    async (userId: number) => {
      if (loading) return;

      const targetIdx = result.findIndex((user) => user.id === userId);
      if (targetIdx === -1) return;

      const ask = window.confirm(
        `Are you sure you want to issue voucher to [${result[targetIdx].name}]?`,
      );
      if (!ask) return;

      setLoading(true);

      try {
        const res = await issueUserDailyVoucher(userId);
        if (res.ok && res.result) {
          result[targetIdx].voucher = res.result;
        } else {
          window.alert(res.msg || "Failed to issue voucher");
        }
      } catch (e) {
        console.error(e);
        window.alert("Failed to issue voucher");
      } finally {
        setLoading(false);
      }
    },
    [loading, result],
  );

  return (
    <div className="bg-gray-100">
      <ModalContainer
        open={true}
        onClose={() => {}}
        title="Search User Voucher"
      >
        <div className="flex-col divide-y divide-gray-200">
          {loading && <LoadingOverlay label="Searching..." />}
          {/* Search Header */}
          <div className="w-full h-16 flex items-center justify-center px-4 gap-2">
            <div className="flex-1">
              <KeyboardInputText value={keyword} onChange={setKeyword} />
            </div>
            <button
              disabled={loading}
              className="h-8 bg-blue-500 text-white px-4 rounded-md"
              onClick={onSearchHandler}
            >
              Search
            </button>
          </div>

          {/* Search Result */}
          <div>
            {lastKeyword === "" && (
              <div className="center py-4 text-gray-500">
                Please Search User
              </div>
            )}
            {lastKeyword !== "" && result.length === 0 && (
              <div className="center py-4 text-gray-500">No user found</div>
            )}
          </div>

          {lastKeyword !== "" && result.length > 0 && (
            <div className="flex flex-col divide-y divide-gray-200">
              {Array.from({ length: RESULT_LIMIT }).map((_, index) => {
                const user = result[index];
                if (!user) return null;
                return (
                  <div key={index}>
                    <UserVoucherItem
                      user={user}
                      onIssueVoucher={onIssueVoucherHandler}
                      onVoucherSelect={console.log}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ModalContainer>
    </div>
  );
}

function UserVoucherItem({
  user,
  onIssueVoucher,
  onVoucherSelect,
}: {
  user: UserWithVoucher;
  onIssueVoucher: (userId: number) => void;
  onVoucherSelect: (voucher: UserVoucher) => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 relative h-14">
      <div className="text-lg font-medium">{user.name}</div>

      {user.voucher === null && (
        <div
          className="h-10 w-24 bg-blue-500 center text-white rounded-md font-bold"
          onClick={() => onIssueVoucher(user.id)}
        >
          Issue
        </div>
      )}
      {user.voucher !== null && (
        <div
          className="h-10 w-24 bg-green-600 center text-white rounded-md font-bold"
          onClick={() => {
            if (user.voucher && user.voucher.left_amount > 0) {
              onVoucherSelect(user.voucher);
            } else {
              window.alert("No voucher left");
            }
          }}
        >
          {`$${user.voucher.left_amount.toFixed(MONEY_DP)}`}
        </div>
      )}
    </div>
  );
}
