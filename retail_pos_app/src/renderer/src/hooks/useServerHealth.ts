import { useEffect, useRef, useState } from 'react'
import { apiService } from '../libs/api'

interface ServerHealth {
  ok: boolean
  lastChecked: number
}

export function useServerHealth(): ServerHealth {
  const [health, setHealth] = useState<ServerHealth>({ ok: false, lastChecked: 0 })
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    const check = async () => {
      const res = await apiService.get('/ok')
      if (mountedRef.current) {
        setHealth({ ok: res.ok, lastChecked: Date.now() })
      }
    }

    check()
    const interval = setInterval(check, 5000)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [])

  return health
}
