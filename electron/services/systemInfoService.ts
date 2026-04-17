import os from 'node:os'
import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { SystemInfo, GpuInfo, HardwareProfile, ModelTier } from '../../shared/types'

const VENDOR_NVIDIA = 0x10de
const VENDOR_AMD = 0x1002
const VENDOR_INTEL = 0x8086
const VENDOR_APPLE = 0x106b

let cachedSystemInfo: SystemInfo | null = null

function mapVendorId(vendorId: number): GpuInfo['vendor'] {
  switch (vendorId) {
    case VENDOR_NVIDIA: return 'nvidia'
    case VENDOR_AMD: return 'amd'
    case VENDOR_INTEL: return 'intel'
    case VENDOR_APPLE: return 'apple'
    default: return 'unknown'
  }
}

function isAppleSilicon(): boolean {
  return process.platform === 'darwin' && os.arch() === 'arm64'
}

// ── VRAM detection ────────────────────────────────────────────

const NVIDIA_VRAM_LOOKUP: ReadonlyMap<string, number> = new Map([
  ['RTX 5090', 32768],
  ['RTX 5080', 16384],
  ['RTX 5070 Ti Super', 16384],
  ['RTX 5070 Ti', 16384],
  ['RTX 5070 Super', 16384],
  ['RTX 5070', 12288],
  ['RTX 5060 Ti', 16384],
  ['RTX 5060', 8192],
  ['RTX 4090', 24576],
  ['RTX 4080 Super', 16384],
  ['RTX 4080', 16384],
  ['RTX 4070 Ti Super', 16384],
  ['RTX 4070 Ti', 12288],
  ['RTX 4070 Super', 12288],
  ['RTX 4070', 12288],
  ['RTX 4060 Ti 16GB', 16384],
  ['RTX 4060 Ti', 8192],
  ['RTX 4060', 8192],
  ['RTX 3090 Ti', 24576],
  ['RTX 3090', 24576],
  ['RTX 3080 Ti', 12288],
  ['RTX 3080 12GB', 12288],
  ['RTX 3080', 10240],
  ['RTX 3070 Ti', 8192],
  ['RTX 3070', 8192],
  ['RTX 3060 Ti', 8192],
  ['RTX 3060', 12288],
  ['RTX 3050', 8192],
  ['RTX A6000', 49152],
  ['RTX A5500', 24576],
  ['RTX A5000', 24576],
  ['RTX A4500', 20480],
  ['RTX A4000', 16384],
  ['RTX A2000', 12288],
  ['A100 80GB', 81920],
  ['A100', 40960],
  ['H100', 81920],
  ['L40S', 49152],
  ['L40', 49152],
  ['L4', 24576],
])

function lookupNvidiaVramByName(deviceString: string): number | null {
  const upper = deviceString.toUpperCase()
  for (const [key, vramMB] of NVIDIA_VRAM_LOOKUP) {
    if (upper.includes(key.toUpperCase())) return vramMB
  }
  return null
}

function runCliCommand(command: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5000 }, (error, stdout) => {
      if (error) { resolve(null); return }
      resolve(stdout.trim())
    })
  })
}

async function detectNvidiaVram(): Promise<number | null> {
  const output = await runCliCommand('nvidia-smi', [
    '--query-gpu=memory.total',
    '--format=csv,noheader,nounits',
  ])
  if (!output) return null
  const vram = parseInt(output.split('\n')[0], 10)
  return isNaN(vram) ? null : vram
}

async function detectAmdVramSysfs(): Promise<number | null> {
  try {
    const drmPath = '/sys/class/drm'
    const entries = await readdir(drmPath)
    for (const entry of entries) {
      if (!entry.startsWith('card')) continue
      const vramFile = path.join(drmPath, entry, 'device', 'mem_info_vram_total')
      try {
        const content = await readFile(vramFile, 'utf-8')
        const bytes = parseInt(content.trim(), 10)
        if (!isNaN(bytes) && bytes > 0) return Math.round(bytes / (1024 * 1024))
      } catch {
        continue
      }
    }
  } catch {
    // /sys/class/drm not readable
  }
  return null
}

async function detectAmdVramRocmSmi(): Promise<number | null> {
  const output = await runCliCommand('rocm-smi', ['--showmeminfo', 'vram'])
  if (!output) return null
  const match = output.match(/Total Memory \(B\):\s*(\d+)/i)
  if (!match) return null
  const bytes = parseInt(match[1], 10)
  return isNaN(bytes) ? null : Math.round(bytes / (1024 * 1024))
}

async function detectVram(vendor: GpuInfo['vendor'], deviceString: string): Promise<number | null> {
  if (vendor === 'apple') {
    return Math.round(os.totalmem() / (1024 * 1024))
  }

  if (vendor === 'nvidia') {
    const cliVram = await detectNvidiaVram()
    if (cliVram !== null) return cliVram
    return lookupNvidiaVramByName(deviceString)
  }

  if (vendor === 'amd' && process.platform === 'linux') {
    const sysfsVram = await detectAmdVramSysfs()
    if (sysfsVram !== null) return sysfsVram
    return detectAmdVramRocmSmi()
  }

  return null
}

// ── GPU detection ─────────────────────────────────────────────

async function detectGpu(): Promise<GpuInfo | null> {
  if (isAppleSilicon()) {
    const deviceString = os.cpus()[0]?.model ?? 'Apple Silicon'
    return {
      vendor: 'apple',
      vendorString: 'Apple',
      deviceString,
      vramMB: await detectVram('apple', deviceString),
      cudaSupported: false,
      metalSupported: true,
      rocmSupported: false,
    }
  }

  try {
    const gpuInfo = await app.getGPUInfo('complete') as Record<string, unknown>
    const devices = gpuInfo.gpuDevice as Array<{
      vendorId: number
      deviceId: number
      active: boolean
      vendorString?: string
      deviceString?: string
    }> | undefined

    if (!devices || devices.length === 0) return null

    const activeDevice = devices.find(d => d.active) ?? devices[0]
    const vendor = mapVendorId(activeDevice.vendorId)
    const deviceString = activeDevice.deviceString ?? 'Unknown GPU'

    return {
      vendor,
      vendorString: activeDevice.vendorString ?? vendor,
      deviceString,
      vramMB: await detectVram(vendor, deviceString),
      cudaSupported: vendor === 'nvidia',
      metalSupported: vendor === 'apple',
      rocmSupported: vendor === 'amd' && process.platform === 'linux',
    }
  } catch {
    return null
  }
}

export async function getSystemInfo(): Promise<SystemInfo> {
  if (cachedSystemInfo) return cachedSystemInfo

  const gpu = await detectGpu()
  const cpus = os.cpus()

  cachedSystemInfo = {
    platform: process.platform as SystemInfo['platform'],
    osVersion: os.release(),
    arch: os.arch(),
    totalMemoryGB: Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10,
    freeMemoryGB: Math.round((os.freemem() / (1024 ** 3)) * 10) / 10,
    cpuModel: cpus[0]?.model?.trim() ?? 'Unknown CPU',
    cpuCores: cpus.length,
    gpu,
  }

  return cachedSystemInfo
}

export function getHardwareProfile(info: SystemInfo): HardwareProfile {
  const ramBasedMaxParams = Math.floor((info.totalMemoryGB - 2.5) / 0.55)

  // When VRAM is known, use it as the primary constraint for GPU-accelerated models.
  // ~0.65 GB VRAM per billion parameters at Q4 quantization is a reasonable estimate.
  const vramBasedMaxParams = info.gpu?.vramMB != null
    ? Math.floor(info.gpu.vramMB / 650)
    : null

  const maxParametersBillions = Math.max(
    0,
    vramBasedMaxParams ?? ramBasedMaxParams,
  )

  let maxModelTier: ModelTier
  if (maxParametersBillions <= 4) maxModelTier = 'small'
  else if (maxParametersBillions <= 8) maxModelTier = 'medium'
  else maxModelTier = 'large'

  let gpuAcceleration = false
  let gpuAccelerationType: HardwareProfile['gpuAccelerationType'] = 'none'

  if (info.gpu) {
    if (info.gpu.cudaSupported) {
      gpuAcceleration = true
      gpuAccelerationType = 'cuda'
    } else if (info.gpu.metalSupported) {
      gpuAcceleration = true
      gpuAccelerationType = 'metal'
    } else if (info.gpu.rocmSupported) {
      gpuAcceleration = true
      gpuAccelerationType = 'rocm'
    }
  }

  const warnings: string[] = []

  if (info.gpu?.vendor === 'amd' && info.platform === 'win32') {
    warnings.push('AMD GPUs have limited Ollama support on Windows. Models will run on CPU.')
  }
  if (info.gpu?.vendor === 'intel') {
    warnings.push('Intel GPUs are not supported for LLM acceleration. Models will run on CPU.')
  }
  if (info.totalMemoryGB < 6) {
    warnings.push('Limited RAM detected. Only small models (3B) are recommended.')
  }
  if (!info.gpu) {
    warnings.push('No dedicated GPU detected. Models will run on CPU (slower for large models).')
  }

  return {
    maxModelTier,
    maxParametersBillions,
    gpuAcceleration,
    gpuAccelerationType,
    warnings,
  }
}
