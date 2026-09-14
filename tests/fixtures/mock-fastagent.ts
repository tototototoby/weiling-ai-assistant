type MockFastAgentScenario = 'crash_after_running' | 'happy';

const DEFAULT_STEP_DELAY_MS = 50;
const EXIT_DELAY_MS = 5;
const TRUSTED_QR_CODE_URL = 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=00000000000000000000000000000000&bot_type=3';

const agentId = process.env.IM_GATEWAY_AGENT_ID ?? 'bot_unknown';
const scenario = getScenario(process.env.MOCK_FASTAGENT_SCENARIO);
const stepDelayMs = getPositiveInteger(process.env.MOCK_FASTAGENT_STEP_DELAY_MS, DEFAULT_STEP_DELAY_MS);

let keepAliveTimer: NodeJS.Timeout | null = null;
let stopping = false;

void main();

async function main() {
  emitEvent('process_started', 'IM runtime process started', {
    channel: 'weixin',
  });
  await delay(stepDelayMs);

  emitEvent('qr_code', 'Weixin QR code ready', {
    qrCodeUrl: TRUSTED_QR_CODE_URL,
  });
  await delay(stepDelayMs);

  emitEvent('login_confirmed', 'Weixin login confirmed', {
    accountId: 'wx_acc_1',
    userId: 'wx_user_1',
  });
  await delay(stepDelayMs);

  emitEvent('running', 'Bot running', {
    accountId: 'wx_acc_1',
  });

  if (scenario === 'crash_after_running') {
    await delay(stepDelayMs);
    emitEvent('runtime_error', 'Mock runtime crashed.', {
      code: 'RUNTIME_ERROR',
    });
    await delay(stepDelayMs);
    emitEvent('stopped', 'Mock runtime stopped unexpectedly.', {
      exitCode: 1,
      reason: 'runtime_error',
    });
    await delay(EXIT_DELAY_MS);
    process.exit(1);
  }

  keepAliveTimer = setInterval(() => {
    // Keep the mock runtime alive until it receives a stop signal.
  }, 60_000);
}

process.on('SIGINT', () => {
  void handleStopSignal();
});

process.on('SIGTERM', () => {
  void handleStopSignal();
});

async function handleStopSignal() {
  if (stopping) {
    return;
  }

  stopping = true;

  emitEvent('stopping', 'Mock runtime stopping.', {
    reason: 'signal',
  });
  await delay(stepDelayMs);
  emitEvent('stopped', 'Mock runtime stopped.', {
    exitCode: 0,
    reason: 'signal',
  });

  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
  }

  await delay(EXIT_DELAY_MS);
  process.exit(0);
}

function emitEvent(type: string, message: string, data: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify({
    agentId,
    data,
    message,
    pid: process.pid,
    timestamp: new Date().toISOString(),
    type,
  })}\n`);
}

function delay(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function getScenario(value: string | undefined): MockFastAgentScenario {
  return value === 'crash_after_running' ? value : 'happy';
}

function getPositiveInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}
