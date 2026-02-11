import { Terminal } from "../contexts/TerminalContext";
import { useServerHealth } from "../hooks/useServerHealth";
import { useScaleStatus } from "../hooks/useScaleStatus";

const badgeOk = "text-xs font-medium px-2 py-1 rounded-full bg-green-100 text-green-700"
const badgeNg = "text-xs font-medium px-2 py-1 rounded-full bg-red-100 text-red-700"
const badgeOff = "text-xs font-medium px-2 py-1 rounded-full bg-gray-100 text-gray-500"

export default function DeviceMonitor({ terminal }: { terminal: Terminal }) {
  const { ok: serverOk } = useServerHealth()
  const scaleConnected = useScaleStatus()

  return (
    <div className="h-8 bg-gray-100 border-t border-gray-200 flex items-center px-2 divide-x divide-gray-300 text-sm *:px-2">
      <div className="text-sm font-medium">{terminal.name}</div>
      <div>{terminal.ipAddress}</div>
      <div>
        <span className={serverOk ? badgeOk : badgeNg}>
          Server : {serverOk ? "OK" : "NG"}
        </span>
      </div>
      <div>
        <span className={scaleConnected ? badgeOk : badgeOff}>
          Scale : {scaleConnected ? "OK" : "OFF"}
        </span>
      </div>
    </div>
  )
}
