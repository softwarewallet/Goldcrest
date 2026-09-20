import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  startLiveRuntimeLog,
  stopLiveRuntimeLog,
  getLiveRuntimeLogStatus,
  liveRuntimeLog,
  listLiveRuntimeLogFiles
} from '../src/services/liveRuntimeLog';

const status = startLiveRuntimeLog('TEST');
assert.equal(status.enabled, true);
assert.ok(fs.existsSync(status.file));
assert.match(status.file, /goldcrest-live-\d{4}-\d{2}-\d{2}\.log$/);
assert.doesNotMatch(status.file, /goldcrest-live\\.log$/);

liveRuntimeLog('INFO', 'TEST_EVENT', {
  account: '****1234',
  accessToken: 'super-secret-access-token-value-that-must-not-appear',
  clientSecret: 'super-secret-client-secret-value-that-must-not-appear'
});

const contentText = fs.readFileSync(status.file, 'utf8');
assert.match(contentText, /TEST_EVENT/);
assert.doesNotMatch(contentText, /super-secret-access-token-value/);
assert.doesNotMatch(contentText, /super-secret-client-secret-value/);
assert.match(contentText, /\[REDACTED(?:_TOKEN)?\]/);

const stopped = stopLiveRuntimeLog('TEST');
assert.equal(stopped.enabled, false);
const sizeBefore = fs.statSync(stopped.file).size;

liveRuntimeLog('INFO', 'SHOULD_NOT_BE_WRITTEN');
const sizeAfter = fs.statSync(stopped.file).size;
assert.equal(sizeAfter, sizeBefore);

const archive = listLiveRuntimeLogFiles();
assert.ok(archive.some(item => item.file === status.file));

const finalStatus = getLiveRuntimeLogStatus();
assert.equal(finalStatus.enabled, false);
assert.equal(finalStatus.exists, true);

console.log('LIVE RUNTIME LOG TESTS PASSED');
