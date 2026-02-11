import { useEffect, useRef, useState } from 'react'

export function useScaleStatus(): boolean {
  const [connected, setConnected] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    const check = async () => {
      const status = await window.electronAPI.scaleStatus()
      if (mountedRef.current) setConnected(status.connected)
    }

    check()
    const interval = setInterval(check, 5000)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [])

  return connected
}
