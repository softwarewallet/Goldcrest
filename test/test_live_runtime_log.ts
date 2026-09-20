import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  startLiveRuntimeLog,
  stopLiveRuntimeLog,
  getLiveRuntimeLogStatus,
  liveRuntimeLog
} from '../src/services/liveRuntimeLog';

const status = startLiveRuntimeLog('TEST');
assert.equal(status.enabled, true);
assert.ok(fs.existsSync(status.file));

liveRuntimeLog('INFO', 'TEST_EVENT', {
  account: '****1234',
  accessToken: 'super-secret-access-token-value-that-must-not-appear',
  clientSecret: 'super-secret-client-secret-value-that-must-not-appear'
});

const contentText = fs.readFileSync(status.file, 'utf8');
assert.match(contentText, /TEST_EVENT/);
assert.doesNotMatch(contentText, /super-secret-access-token-value/);
assert.doesNotMatch(contentText, /super-secret-client-secret-value/);
assert.match(contentText, /\[REDACTED\]/);

const stopped = stopLiveRuntimeLog('TEST');
assert.equal(stopped.enabled, false);
const sizeBefore = fs.statSync(stopped.file).size;

liveRuntimeLog('INFO', 'SHOULD_NOT_BE_WRITTEN');
const sizeAfter = fs.statSync(stopped.file).size;
assert.equal(sizeAfter, sizeBefore);

const finalStatus = getLiveRuntimeLogStatus();
assert.equal(finalStatus.enabled, false);
assert.equal(finalStatus.exists, true);

console.log('LIVE RUNTIME LOG TESTS PASSED');
