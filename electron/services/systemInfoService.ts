import os from 'node:os'
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

async function detectGpu(): Promise<GpuInfo | null> {
  if (isAppleSilicon()) {
    return {
      vendor: 'apple',
      vendorString: 'Apple',
      deviceString: os.cpus()[0]?.model ?? 'Apple Silicon',
      vramMB: null,
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

    return {
      vendor,
      vendorString: activeDevice.vendorString ?? vendor,
      deviceString: activeDevice.deviceString ?? 'Unknown GPU',
      vramMB: null,
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
  const maxParams = Math.floor((info.totalMemoryGB - 2.5) / 0.55)
  const maxParametersBillions = Math.max(0, maxParams)

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
