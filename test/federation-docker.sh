#!/bin/sh
# ==============================================================================
# SavannaGuard Federation Docker Integration Test
#
# This script runs inside the test-runner container on the same Docker network
# as node-a and node-b. It:
#   1. Verifies both nodes are healthy
#   2. Inserts federation peer records into both databases
#   3. Inserts a bot signature (threat) into node-a
#   4. Waits for the 5-second sync interval to propagate
#   5. Verifies node-b received the federated signature
#   6. Cleans up and exits 0 (pass) or 1 (fail)
#
# Expected usage:
#   docker compose -f docker-compose.test.yml up --build --abort-on-container-exit
# ==============================================================================

set -e

NODE_A_URL="http://node-a:3000"
NODE_B_URL="http://node-b:3000"
DB_A="/data/node-a/savannaguard.db"
DB_B="/data/node-b/savannaguard.db"
PSK="test-psk-key-for-federation-testing"
SYNC_WAIT_SECONDS=15

echo ""
echo "============================================="
echo "  SavannaGuard Federation Integration Test"
echo "============================================="
echo ""

# Generate a unique test hash to avoid collisions between runs
TEST_HASH="fedtest_$(date +%s)_$$_$(head -c 4 /dev/urandom | od -A n -t x1 | tr -d ' \n')"
echo "Test signature hash: ${TEST_HASH}"
echo ""

# ---- Step 1: Verify both nodes are healthy ----
echo "[1/6] Verifying node health..."
wget -q -O /dev/null "${NODE_A_URL}/health" 2>/dev/null && echo "  node-a: OK" || { echo "  node-a: UNHEALTHY"; exit 1; }
wget -q -O /dev/null "${NODE_B_URL}/health" 2>/dev/null && echo "  node-b: OK" || { echo "  node-b: UNHEALTHY"; exit 1; }
echo ""

# ---- Step 2: Insert peer records into both databases ----
echo "[2/6] Setting up federation peers..."
cat > /tmp/setup-peers.mjs << 'PEERSCRIPT'
import Database from 'better-sqlite3';

const DB_A = process.env.DB_A;
const DB_B = process.env.DB_B;
const NODE_A_URL = process.env.NODE_A_URL;
const NODE_B_URL = process.env.NODE_B_URL;
const PSK = process.env.PSK;
const now = Date.now();

const INSERT_PEER = `
  INSERT OR IGNORE INTO federation_peers
    (peer_id, peer_url, psk, last_seen, trusted, status,
     consecutive_failures, last_failure_at, last_failure_reason, last_success_at)
  VALUES (?, ?, ?, ?, 1, 'active', 0, 0, '', ?)
`;

// node-a gets node-b as a peer
const dbA = new Database(DB_A);
dbA.pragma('busy_timeout = 5000');
dbA.prepare(INSERT_PEER).run('peer-node-b', NODE_B_URL, PSK, now, now);
dbA.close();
console.log('  node-a: peer record for node-b inserted');

// node-b gets node-a as a peer
const dbB = new Database(DB_B);
dbB.pragma('busy_timeout = 5000');
dbB.prepare(INSERT_PEER).run('peer-node-a', NODE_A_URL, PSK, now, now);
dbB.close();
console.log('  node-b: peer record for node-a inserted');
PEERSCRIPT

DB_A="${DB_A}" DB_B="${DB_B}" NODE_A_URL="${NODE_A_URL}" NODE_B_URL="${NODE_B_URL}" PSK="${PSK}" \
  node /tmp/setup-peers.mjs
echo ""

# ---- Step 3: Insert a bot signature (threat) into node-a ----
echo "[3/6] Reporting threat (bot signature) to node-a..."
cat > /tmp/insert-sig.mjs << 'SIGSCRIPT'
import Database from 'better-sqlite3';

const DB_A = process.env.DB_A;
const TEST_HASH = process.env.TEST_HASH;
const now = Date.now();

const db = new Database(DB_A);
db.pragma('busy_timeout = 5000');
db.prepare(`
  INSERT OR REPLACE INTO bot_signatures
    (hash, hash_type, match_count, first_seen, last_seen, source)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(TEST_HASH, 'ip', 5, now, now, 'auto');
db.close();
console.log('  Bot signature inserted into node-a: ' + TEST_HASH);
SIGSCRIPT

DB_A="${DB_A}" TEST_HASH="${TEST_HASH}" node /tmp/insert-sig.mjs
echo ""

# ---- Step 4: Wait for federation sync ----
echo "[4/6] Waiting ${SYNC_WAIT_SECONDS} seconds for federation sync..."
sleep ${SYNC_WAIT_SECONDS}
echo "  Done waiting."
echo ""

# ---- Step 5: Check node-b for the federated signature ----
echo "[5/6] Checking node-b for federated signature..."
cat > /tmp/check-sig.mjs << 'CHECKSCRIPT'
import Database from 'better-sqlite3';

const DB_B = process.env.DB_B;
const TEST_HASH = process.env.TEST_HASH;

const db = new Database(DB_B);
db.pragma('busy_timeout = 5000');

const row = db.prepare(
  'SELECT hash, confidence, reporter_count, source_peer FROM federated_signatures WHERE hash = ?'
).get(TEST_HASH);

if (row) {
  console.log('  FOUND federated signature on node-b!');
  console.log('    Hash:           ' + row.hash);
  console.log('    Confidence:     ' + row.confidence);
  console.log('    Reporter count: ' + row.reporter_count);
  console.log('    Source peer:    ' + row.source_peer);
  db.close();
  process.exit(0);
} else {
  console.log('  NOT FOUND on node-b.');

  // Debug info: what does node-b have?
  const count = db.prepare('SELECT COUNT(*) as c FROM federated_signatures').get();
  console.log('  Total federated signatures on node-b: ' + count.c);

  const peers = db.prepare('SELECT peer_id, peer_url, status FROM federation_peers').all();
  console.log('  Peers on node-b: ' + JSON.stringify(peers));

  const localSigs = db.prepare('SELECT COUNT(*) as c FROM bot_signatures').get();
  console.log('  Local bot signatures on node-b: ' + localSigs.c);

  db.close();
  process.exit(1);
}
CHECKSCRIPT

DB_B="${DB_B}" TEST_HASH="${TEST_HASH}" node /tmp/check-sig.mjs
RESULT=$?
echo ""

# ---- Step 6: Cleanup and report ----
echo "[6/6] Cleanup..."
rm -f /tmp/setup-peers.mjs /tmp/insert-sig.mjs /tmp/check-sig.mjs
echo "  Temp files removed."
echo ""

if [ ${RESULT} -eq 0 ]; then
  echo "============================================="
  echo "  PASS: Federation test completed successfully"
  echo "============================================="
  exit 0
else
  echo "============================================="
  echo "  FAIL: Federation signature not propagated"
  echo "============================================="
  exit 1
fi
