import { useCallback, useEffect, useRef, useState } from 'react'

interface WeightResult {
  weight: number
  unit: 'kg' | 'lb' | 'oz' | 'g'
  status: 'stable' | 'unstable' | 'error' | 'disconnected'
  message?: string
}

interface UseWeightReturn {
  weight: WeightResult
  connected: boolean
  connect: () => Promise<boolean>
  disconnect: () => Promise<void>
  readWeight: () => Promise<WeightResult>
}

const IDLE: WeightResult = { weight: 0, unit: 'kg', status: 'disconnected' }

export function useWeight(): UseWeightReturn {
  const [weight, setWeight] = useState<WeightResult>(IDLE)
  const [connected, setConnected] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    window.electronAPI.scaleStatus().then((s) => {
      if (mountedRef.current) setConnected(s.connected)
    })
    return () => { mountedRef.current = false }
  }, [])

  const connect = useCallback(async () => {
    const res = await window.electronAPI.scaleConnect()
    if (mountedRef.current) setConnected(res.ok)
    return res.ok
  }, [])

  const disconnect = useCallback(async () => {
    await window.electronAPI.scaleDisconnect()
    if (mountedRef.current) {
      setConnected(false)
      setWeight(IDLE)
    }
  }, [])

  const readWeight = useCallback(async () => {
    const result = await window.electronAPI.scaleReadWeight()
    if (mountedRef.current) setWeight(result)
    return result
  }, [])

  return { weight, connected, connect, disconnect, readWeight }
}
