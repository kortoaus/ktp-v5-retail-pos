// 주문 수신함 상주 컴포넌트 (Gateway 상주 — 고객 디스플레이는 Gateway 밖이라
// 자동 제외). 소켓 1개를 소유하고 orderInboxStore 에 상태를 공급한다.
//
// - 배너: count > 0 → 상단 주황 슬림 스트립(터치 → /manager/orders).
//   소켓 끊김 → 회색 "reconnecting", crm 불통(ok:false) → 은은한 안내.
// - 차임: 자기 터미널 id ∈ chimeTerminalIds 일 때만. `order:new` 즉시 1회 +
//   count > 0 인 동안 120초 간격 반복. 벨 톤(WebAudio 딩–동) 직후 보이스
//   시그니처("New order in~", ElevenLabs, 번들 mp3)가 이어진다.
//   최초 pointerdown 제스처에서 AudioContext 언락(Chromium 자동재생 정책).

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import apiService from "../../libs/api";
import { cn } from "../../libs/cn";
import { useTerminal } from "../../contexts/TerminalContext";
import {
  getOrderInboxState,
  normalizeOrderPendingCountPayload,
  ORDER_NEW_EVENT,
  ORDER_PENDING_COUNT_EVENT,
  setOrderInboxState,
  subscribeOrderInbox,
} from "./orderInboxStore";
import orderChimeVoiceUrl from "../../assets/order-chime-voice.mp3";

const CHIME_REPEAT_MS = 120_000;

// 벨(딩–동, ~1s)이 끝나갈 무렵 보이스가 이어지는 간격.
const VOICE_DELAY_MS = 900;

export default function OrderNotification() {
  const navigate = useNavigate();
  const { terminal } = useTerminal();
  const { connected, payload } = useSyncExternalStore(
    subscribeOrderInbox,
    getOrderInboxState,
  );

  const count = payload?.count ?? null;
  const hasPending = count != null && count > 0;
  const chimeEnabled =
    terminal != null &&
    payload != null &&
    payload.chimeTerminalIds.includes(terminal.id);

  // ── Audio: 언락 + 더블 비프 ─────────────────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    // 최초 사용자 제스처에서 AudioContext 생성/resume (capture, 비간섭).
    const unlock = () => {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      void audioCtxRef.current.resume();
      window.removeEventListener("pointerdown", unlock, true);
    };
    window.addEventListener("pointerdown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      audioCtxRef.current?.close().catch(() => undefined);
      audioCtxRef.current = null;
    };
  }, []);

  // 보이스 시그니처는 재사용 한 개 인스턴스 — 반복 재생 시 currentTime 리셋.
  const voiceRef = useRef<HTMLAudioElement | null>(null);
  if (voiceRef.current === null) {
    voiceRef.current = new Audio(orderChimeVoiceUrl);
    voiceRef.current.preload = "auto";
  }
  const voiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playChime = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return; // 아직 제스처 언락 전
    void ctx.resume();

    // 부드러운 벨 톤: 사인파 + 짧은 어택 + 긴 지수 감쇠 (마림바 느낌)
    const bell = (startAt: number, freq: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(0.35, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.7);
      osc.connect(gain).connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + 0.75);
    };

    const t0 = ctx.currentTime;
    bell(t0, 659.25); // E5
    bell(t0 + 0.35, 880); // A5 — 딩-동 ~1s

    // 벨에 이어 보이스 "New order in~!" — 실패해도 벨만으로 알림은 성립.
    if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
    voiceTimerRef.current = setTimeout(() => {
      const voice = voiceRef.current;
      if (!voice) return;
      voice.currentTime = 0;
      voice.play().catch(() => undefined);
    }, VOICE_DELAY_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
      voiceRef.current?.pause();
    };
  }, []);

  // 소켓 핸들러(order:new)가 최신 차임 가능 여부를 보도록 ref 로 추적.
  const chimeEnabledRef = useRef(false);
  useEffect(() => {
    chimeEnabledRef.current = chimeEnabled;
  }, [chimeEnabled]);

  // ── Socket (단일 소유자) ────────────────────────────────────
  useEffect(() => {
    const baseURL = apiService.getBaseURL();
    if (!baseURL) return;

    const socket: Socket = io(baseURL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    });

    socket.on("connect", () => setOrderInboxState({ connected: true }));
    socket.on("disconnect", () => setOrderInboxState({ connected: false }));
    socket.on("connect_error", () => setOrderInboxState({ connected: false }));
    socket.on(ORDER_PENDING_COUNT_EVENT, (next: unknown) => {
      const normalized = normalizeOrderPendingCountPayload(next);
      if (normalized) setOrderInboxState({ payload: normalized });
    });
    socket.on(ORDER_NEW_EVENT, () => {
      if (chimeEnabledRef.current) playChime();
    });

    return () => {
      socket.disconnect();
      setOrderInboxState({ connected: false });
    };
  }, [playChime]);

  // ── 반복 차임: count > 0 이고 이 터미널이 차임 대상인 동안 120초 간격 ──
  useEffect(() => {
    if (!chimeEnabled || !hasPending) return;
    const handle = setInterval(playChime, CHIME_REPEAT_MS);
    return () => clearInterval(handle);
  }, [chimeEnabled, hasPending, playChime]);

  // ── Banner ──────────────────────────────────────────────────
  // Gateway 의 flex column 안에서 자체 높이(h-8)를 차지하는 슬림 스트립 —
  // fixed 가 아니므로 SaleScreen 상단 바를 가리지 않는다.
  if (!connected && hasPending) {
    return (
      <div className="h-8 shrink-0 flex items-center justify-center gap-2 bg-gray-300 text-gray-600 text-sm font-bold">
        Orders: {count} — reconnecting…
      </div>
    );
  }

  if (connected && payload != null && !payload.ok) {
    return (
      <div className="h-8 shrink-0 flex items-center justify-center bg-gray-100 text-gray-400 text-xs font-medium">
        Order inbox: cloud unreachable
      </div>
    );
  }

  if (connected && hasPending) {
    return (
      <div
        onPointerDown={() => navigate("/manager/orders")}
        className={cn(
          "h-8 shrink-0 flex items-center justify-center gap-2 cursor-pointer",
          "bg-orange-500 text-white text-sm font-bold active:bg-orange-600",
        )}
      >
        New orders: {count} — touch to open
      </div>
    );
  }

  return null;
}
