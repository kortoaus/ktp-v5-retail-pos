import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'

type ScaleType = 'CAS' | 'DATALOGIC'
type Parity = 'none' | 'even' | 'odd' | 'mark' | 'space'

interface ScaleForm {
  enabled: boolean
  type: ScaleType
  path: string
  baudRate: number
  dataBits: number
  stopBits: number
  parity: Parity
}

type LabelLanguage = 'zpl' | 'slcs'

interface ZplSerialForm {
  enabled: boolean
  path: string
  language: LabelLanguage
}

interface ZplNetEntry {
  name: string
  host: string
  port: number
  language: LabelLanguage
}

interface EscposForm {
  enabled: boolean
  host: string
  port: number
}

const SCALE_DEFAULTS: ScaleForm = {
  enabled: false,
  type: 'CAS',
  path: '',
  baudRate: 9600,
  dataBits: 7,
  stopBits: 1,
  parity: 'even'
}

const ZPL_SERIAL_DEFAULTS: ZplSerialForm = {
  enabled: false,
  path: '',
  language: 'zpl'
}

const ESCPOS_DEFAULTS: EscposForm = {
  enabled: false,
  host: '',
  port: 9100
}

const PARITIES: Parity[] = ['none', 'even', 'odd', 'mark', 'space']

const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-400'
const selectClass = inputClass
const labelClass = 'block text-sm font-medium text-gray-700 mb-1'
const btnSmClass = 'text-xs font-medium px-3 py-1.5 rounded-lg transition-colors'

export default function InterfaceSettingsScreen() {
  const [ports, setPorts] = useState<string[]>([])
  const [scale, setScale] = useState<ScaleForm>(SCALE_DEFAULTS)
  const [zplSerial, setZplSerial] = useState<ZplSerialForm>(ZPL_SERIAL_DEFAULTS)
  const [zplNet, setZplNet] = useState<ZplNetEntry[]>([])
  const [escpos, setEscpos] = useState<EscposForm>(ESCPOS_DEFAULTS)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchPorts = useCallback(async () => {
    const result = await window.electronAPI.getSerialPorts()
    setPorts(result)
  }, [])

  useEffect(() => {
    async function init() {
      const [config] = await Promise.all([
        window.electronAPI.getConfig(),
        fetchPorts()
      ])

      if (config.devices.scale) {
        setScale({ enabled: true, ...config.devices.scale })
      }
      if (config.devices.zplSerial) {
        setZplSerial({ enabled: true, ...config.devices.zplSerial })
      }
      if (config.devices.zplNet.length > 0) {
        setZplNet(config.devices.zplNet)
      }
      if (config.devices.escposPrinter) {
        setEscpos({ enabled: true, ...config.devices.escposPrinter })
      }

      setLoading(false)
    }
    init()
  }, [fetchPorts])

  const handleSave = async () => {
    const current = await window.electronAPI.getConfig()
    await window.electronAPI.setConfig({
      ...current,
      devices: {
        scale: scale.enabled
          ? { type: scale.type, path: scale.path, baudRate: scale.baudRate, dataBits: scale.dataBits, stopBits: scale.stopBits, parity: scale.parity }
          : null,
        zplSerial: zplSerial.enabled
          ? { path: zplSerial.path, language: zplSerial.language }
          : null,
        zplNet: zplNet.filter((e) => e.host.trim() !== ''),
        escposPrinter: escpos.enabled
          ? { host: escpos.host, port: escpos.port }
          : null
      }
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const addZplNet = () => {
    setZplNet((prev) => [...prev, { name: '', host: '', port: 9100, language: 'zpl' }])
  }

  const updateZplNet = (index: number, field: keyof ZplNetEntry, value: string | number) => {
    setZplNet((prev) => prev.map((e, i) => i === index ? { ...e, [field]: value } : e))
  }

  const removeZplNet = (index: number) => {
    setZplNet((prev) => prev.filter((_, i) => i !== index))
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-gray-400">Loading...</div>
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-sm text-blue-600 hover:text-blue-800 font-medium">
              &larr; Back
            </Link>
            <h1 className="text-xl font-bold text-gray-900">Interface Settings</h1>
          </div>
          <button onClick={fetchPorts} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
            Refresh Ports
          </button>
        </div>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Scale</h2>
            <Toggle checked={scale.enabled} onChange={(v) => setScale((s) => ({ ...s, enabled: v }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Type</label>
              <select className={selectClass} disabled={!scale.enabled} value={scale.type} onChange={(e) => setScale((s) => ({ ...s, type: e.target.value as ScaleType }))}>
                <option value="CAS">CAS</option>
                <option value="DATALOGIC">Datalogic (Scale + Scanner)</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Serial Port</label>
              <select className={selectClass} disabled={!scale.enabled} value={scale.path} onChange={(e) => setScale((s) => ({ ...s, path: e.target.value }))}>
                <option value="">Select port</option>
                {ports.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Baud Rate</label>
              <input type="number" className={inputClass} disabled={!scale.enabled} value={scale.baudRate} onChange={(e) => setScale((s) => ({ ...s, baudRate: Number(e.target.value) }))} />
            </div>
            <div>
              <label className={labelClass}>Data Bits</label>
              <input type="number" className={inputClass} disabled={!scale.enabled} value={scale.dataBits} onChange={(e) => setScale((s) => ({ ...s, dataBits: Number(e.target.value) }))} />
            </div>
            <div>
              <label className={labelClass}>Stop Bits</label>
              <input type="number" className={inputClass} disabled={!scale.enabled} value={scale.stopBits} onChange={(e) => setScale((s) => ({ ...s, stopBits: Number(e.target.value) }))} />
            </div>
            <div>
              <label className={labelClass}>Parity</label>
              <select className={selectClass} disabled={!scale.enabled} value={scale.parity} onChange={(e) => setScale((s) => ({ ...s, parity: e.target.value as Parity }))}>
                {PARITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Label Printer (Serial)</h2>
            <Toggle checked={zplSerial.enabled} onChange={(v) => setZplSerial((s) => ({ ...s, enabled: v }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Language</label>
              <select className={selectClass} disabled={!zplSerial.enabled} value={zplSerial.language} onChange={(e) => setZplSerial((s) => ({ ...s, language: e.target.value as LabelLanguage }))}>
                <option value="zpl">ZPL</option>
                <option value="slcs">SLCS</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Serial Port</label>
              <select className={selectClass} disabled={!zplSerial.enabled} value={zplSerial.path} onChange={(e) => setZplSerial((s) => ({ ...s, path: e.target.value }))}>
                <option value="">Select port</option>
                {ports.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Label Printers (Network)</h2>
            <button onClick={addZplNet} className={`${btnSmClass} bg-blue-600 hover:bg-blue-700 text-white`}>
              + Add
            </button>
          </div>
          {zplNet.length === 0 ? (
            <p className="text-sm text-gray-400">No network label printers configured.</p>
          ) : (
            <div className="space-y-3">
              {zplNet.map((entry, i) => (
                <div key={i} className="flex items-end gap-3">
                  <div className="w-24">
                    <label className={labelClass}>Language</label>
                    <select className={selectClass} value={entry.language} onChange={(e) => updateZplNet(i, 'language', e.target.value)}>
                      <option value="zpl">ZPL</option>
                      <option value="slcs">SLCS</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className={labelClass}>Name</label>
                    <input type="text" className={inputClass} value={entry.name} onChange={(e) => updateZplNet(i, 'name', e.target.value)} placeholder="Label printer 1" />
                  </div>
                  <div className="flex-1">
                    <label className={labelClass}>Host</label>
                    <input type="text" className={inputClass} value={entry.host} onChange={(e) => updateZplNet(i, 'host', e.target.value)} placeholder="192.168.1.50" />
                  </div>
                  <div className="w-24">
                    <label className={labelClass}>Port</label>
                    <input type="number" className={inputClass} value={entry.port} onChange={(e) => updateZplNet(i, 'port', Number(e.target.value))} />
                  </div>
                  <button onClick={() => removeZplNet(i)} className={`${btnSmClass} border border-gray-300 hover:border-red-400 hover:text-red-600 text-gray-500 mb-0.5`}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">ESC/POS Printer</h2>
            <Toggle checked={escpos.enabled} onChange={(v) => setEscpos((s) => ({ ...s, enabled: v }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Host</label>
              <input type="text" className={inputClass} disabled={!escpos.enabled} value={escpos.host} onChange={(e) => setEscpos((s) => ({ ...s, host: e.target.value }))} placeholder="192.168.1.101" />
            </div>
            <div>
              <label className={labelClass}>Port</label>
              <input type="number" className={inputClass} disabled={!escpos.enabled} value={escpos.port} onChange={(e) => setEscpos((s) => ({ ...s, port: Number(e.target.value) }))} />
            </div>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm px-6 py-2.5 rounded-lg transition-colors">
            Save
          </button>
          {saved && <span className="text-sm text-green-600 font-medium">Saved</span>}
        </div>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-200'}`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}
