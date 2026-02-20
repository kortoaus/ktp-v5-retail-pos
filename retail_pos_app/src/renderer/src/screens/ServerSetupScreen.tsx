import { useEffect, useState } from 'react'

export default function ServerSetupScreen() {
  const [host, setHost] = useState('')
  const [port, setPort] = useState(2200)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      if (config.server) {
        setHost(config.server.host)
        setPort(config.server.port)
      }
    })
  }, [])

  const handleSave = async () => {
    if (!host.trim()) {
      setError('Host is required')
      return
    }

    setTesting(true)
    setError(null)

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const res = await fetch(`http://${host.trim()}:${port}/health`, {
        signal: controller.signal
      })
      clearTimeout(timeout)
      if (!res.ok) {
        setError(`Server responded with ${res.status}`)
        setTesting(false)
        return
      }
    } catch {
      setError('Cannot reach server. Check host and port.')
      setTesting(false)
      return
    }

    const config = await window.electronAPI.getConfig()
    await window.electronAPI.setConfig({
      ...config,
      server: { host: host.trim(), port }
    })

    setTesting(false)
    await window.electronAPI.restartApp()
  }

  return (
    <div className="flex items-center justify-center h-full bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-xl border border-gray-200 p-6">
        <h1 className="text-lg font-bold text-gray-900 mb-1">Server Setup</h1>
        <p className="text-sm text-gray-500 mb-6">Connect to the POS server to get started.</p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Host</label>
            <input
              type="text"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
            <input
              type="number"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            onClick={handleSave}
            disabled={testing}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium text-sm px-4 py-2.5 rounded-lg transition-colors"
          >
            {testing ? 'Testing connection...' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}
