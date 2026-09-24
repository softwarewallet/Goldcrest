import assert from 'node:assert/strict';
import { getDatabase, executeRun } from '../src/database/db';
import {
  getResearchAiServerConfigs,
  saveResearchAiServerConfig,
  testResearchAiServerConnection
} from '../src/services/researchAiServerService';

await getDatabase();
await executeRun('DELETE FROM ai_research_server_connections');

const initial = await getResearchAiServerConfigs();
assert.equal(initial.length, 2);
assert.equal(initial.every(item => item.enabled === false), true);

const saved = await saveResearchAiServerConfig({
  provider: 'QWEN',
  enabled: true,
  baseUrl: 'http://127.0.0.1:8123/',
  model: 'qwen3',
  healthPath: '/health',
  predictPath: '/predict',
  timeoutMs: 5000,
  authToken: 'test-secret-token'
});

assert.equal(saved.provider, 'QWEN');
assert.equal(saved.enabled, true);
assert.equal(saved.baseUrl, 'http://127.0.0.1:8123');
assert.equal(saved.model, 'qwen3');
assert.equal(saved.authConfigured, true);
assert.equal(saved.timeoutMs, 5000);

const configs = await getResearchAiServerConfigs();
const qwen = configs.find(item => item.provider === 'QWEN');
assert.ok(qwen);
assert.equal(qwen?.authConfigured, true);
assert.equal((qwen as any)?.authToken, undefined);

const disconnected = await testResearchAiServerConnection('LLAMA');
assert.equal(disconnected.ok, false);
assert.equal(disconnected.message, 'AI server URL is not configured.');

await executeRun('DELETE FROM ai_research_server_connections');
console.log('RESEARCH AI SERVER CONNECTOR TEST PASSED');
