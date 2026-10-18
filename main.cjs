'use strict';

// mods/clock-perf-widget/main.cjs — Electron 主进程入口（v2）。
//
// 回答客户端 `folium.rpc.call('metrics')`：app.getAppMetrics() 的 CPU/内存
// 汇总 + 分进程明细，外加 GPU 数据。GPU 优先走 nvidia-smi（占用/温度/显存/
// 功耗），拿不到就退回 Electron GPU 进程的 percentCPUUsage，此时温度是 null。
//
// nvidia-smi 结果缓存 2 秒；一次失败后记忆并降级，不再反复 spawn，也只记一条日志。

const { execFile } = require('child_process');

const RPC_METRICS = 'metrics';
const NVIDIA_TTL_MS = 2000;
const NVIDIA_TIMEOUT_MS = 3000;
const NVIDIA_QUERY = 'name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw';
const NVIDIA_FORMAT = 'csv,noheader,nounits';

// Electron 进程类型：'Browser'（主进程）、'Tab'/'Renderer'、'GPU'，
// 其余 helper（Utility / Zygote …）只贡献合计。
const groupOf = (type) => {
  switch (type) {
    case 'Browser':
      return 'main';
    case 'Tab':
    case 'Renderer':
      return 'renderer';
    case 'GPU':
      return 'gpu';
    default:
      return null;
  }
};

const toNumber = (raw) => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const parseNvidia = (stdout) => {
  const line = String(stdout || '').trim().split(/\r?\n/)[0] || '';
  const parts = line.split(',').map((part) => part.trim());
  if (parts.length < 6) return null;
  const utilPct = toNumber(parts[1]);
  if (utilPct === null) return null;
  return {
    utilPct,
    tempC: toNumber(parts[2]),
    memUsedMb: toNumber(parts[3]),
    memTotalMb: toNumber(parts[4]),
    powerW: toNumber(parts[5]),
  };
};

const nvidiaCommands = () => {
  const list = ['nvidia-smi'];
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    list.push(root + '\\System32\\nvidia-smi.exe');
  }
  return list;
};

const runNvidia = (command) =>
  new Promise((resolve) => {
    execFile(
      command,
      ['--query-gpu=' + NVIDIA_QUERY, '--format=' + NVIDIA_FORMAT],
      { timeout: NVIDIA_TIMEOUT_MS, windowsHide: true, encoding: 'utf8', maxBuffer: 256 * 1024 },
      (error, stdout) => {
        resolve(error ? null : parseNvidia(stdout));
      },
    );
  });

module.exports = function activate(api) {
  const { app } = require('electron');
  if (!app || typeof app.getAppMetrics !== 'function') {
    throw new Error('clock-perf-widget needs app.getAppMetrics() in the main process');
  }

  // `cpu.percentCPUUsage` 是「上次调用以来」的占用，启动后第一次全是 0。
  // 先打一次底，让第一次轮询就是真实值。
  app.getAppMetrics();

  const round2 = (value) => Math.round(value * 100) / 100;

  let nvidiaDisabled = false;
  let nvidiaCacheAt = 0;
  let nvidiaCache = null;
  let warnedNvidia = false;

  const warnNvidia = (error) => {
    if (warnedNvidia) return;
    warnedNvidia = true;
    if (api && api.log && typeof api.log.warn === 'function') {
      const reason = error && error.message ? error.message : String(error);
      api.log.warn('clock-perf-widget: nvidia-smi unavailable, falling back to the Electron GPU process (' + reason + ')');
    }
  };

  const readNvidia = async () => {
    if (nvidiaDisabled) return null;
    if (nvidiaCache && Date.now() - nvidiaCacheAt < NVIDIA_TTL_MS) return nvidiaCache;
    for (const command of nvidiaCommands()) {
      const value = await runNvidia(command);
      if (value) {
        nvidiaCache = value;
        nvidiaCacheAt = Date.now();
        return value;
      }
    }
    nvidiaDisabled = true;
    warnNvidia('no usable nvidia-smi output');
    return null;
  };

  const collectSystem = () => {
    const processes = app.getAppMetrics() || [];
    let totalCpu = 0;
    let totalMemKb = 0;
    const groups = {
      main: { cpu: 0, memKb: 0 },
      renderer: { cpu: 0, memKb: 0 },
      gpu: { cpu: 0, memKb: 0 },
    };

    for (const metric of processes) {
      const cpu = Number(metric && metric.cpu && metric.cpu.percentCPUUsage) || 0;
      const memKb = Number(metric && metric.memory && metric.memory.workingSetSize) || 0;
      totalCpu += cpu;
      totalMemKb += memKb;
      const group = groupOf(metric && metric.type);
      if (group) {
        groups[group].cpu += cpu;
        groups[group].memKb += memKb;
      }
    }

    return {
      totalCpu: round2(totalCpu),
      totalMemKb: Math.round(totalMemKb),
      byType: {
        main: { cpu: round2(groups.main.cpu), memKb: Math.round(groups.main.memKb) },
        renderer: { cpu: round2(groups.renderer.cpu), memKb: Math.round(groups.renderer.memKb) },
        gpu: { cpu: round2(groups.gpu.cpu), memKb: Math.round(groups.gpu.memKb) },
      },
    };
  };

  const collect = async () => {
    const system = collectSystem();
    const nvidia = await readNvidia();
    const gpu = nvidia
      ? {
          utilPct: round2(nvidia.utilPct),
          tempC: nvidia.tempC,
          memUsedMb: nvidia.memUsedMb,
          memTotalMb: nvidia.memTotalMb,
          powerW: nvidia.powerW,
          source: 'nvidia-smi',
        }
      : {
          utilPct: system.byType.gpu.cpu,
          tempC: null,
          memUsedMb: null,
          memTotalMb: null,
          powerW: null,
          source: 'electron',
        };

    return {
      totalCpu: system.totalCpu,
      totalMemKb: system.totalMemKb,
      gpu,
      byType: system.byType,
    };
  };

  api.rpc.handle(RPC_METRICS, () => collect());

  if (api && typeof api.onDispose === 'function') {
    api.onDispose(() => {
      nvidiaDisabled = true;
      nvidiaCache = null;
    });
  }
};
