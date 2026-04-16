# SavannaGuard Federation Protocol

**Federated Bot Intelligence Network — P2P Gossip Protocol**

SavannaGuard instances can share bot signatures with each other in a peer-to-peer network, enabling collective threat intelligence without a central server.

## Overview

```
Instance A (Forum)      Instance B (E-commerce)    Instance C (SaaS)
     │                        │                        │
     │  Bot detected          │                        │
     │  hash: abc123...       │                        │
     │────── GOSSIP ──────────▶│                        │
     │                        │────── GOSSIP ──────────▶│
     │                        │                        │
     │                        │  Bot blocked!          │
     │                        │  confidence: 0.94       │
```

## Privacy Guarantees

**What is shared:**
- SHA256(ipHash + behavioralFingerprint) — bot signature, not raw IP
- Attack type classification
- Confidence score (0.0-1.0)
- Reporter count (how many peers agree)

**What is NEVER shared:**
- Raw IP addresses
- User agents
- Behavioral raw data
- Session data
- Site URLs

## Protocol Specification

### Gossip Message Format

```json
{
  "type": "push|pull",
  "signatures": [
    {
      "hash": "sha256(ipHash + fingerprint)",
      "hashType": "ip|ua|combined",
      "confidence": 0.85,
      "attackType": "credential_stuffing|scraping|ddos|unknown",
      "firstSeen": 1713001234567,
      "lastSeen": 1713004567890
    }
  ],
  "timestamp": 1713007890123
}
```

### Authentication

Peers authenticate via HMAC-SHA256:
- Pre-shared key (PSK) configured per peer
- HMAC computed over the JSON payload body
- Header: `X-SavannaGuard-HMAC: <hex_digest>`

### Sync Algorithm

1. **Pull**: Peer A requests signatures from Peer B since last sync
2. **Push**: Peer B responds with new signatures
3. **Merge**: Peer A merges using CRDT-like rules:
   - Higher confidence wins for same hash
   - Reporter counts are summed
   - `lastSeen` = max(local, remote)

### Conflict Resolution

| Scenario | Resolution |
|----------|------------|
| Same hash, different confidence | Keep MAX |
| Same hash, same confidence | Sum reporter_count |
| New hash from peer | INSERT |
| Hash older than 30 days | DELETE on merge |

## Configuration

### Environment Variables

```bash
# Enable federation
FEDERATION_ENABLED=true

# Comma-separated list of peer URLs
FEDERATION_PEERS=https://forum.example.com,https://shop.example.com

# Pre-shared key for peer authentication
FEDERATION_PSK=your-secret-key-here

# Sync interval (default: 5 minutes)
FEDERATION_SYNC_INTERVAL=300000
```

### Admin UI

Federation is managed via the Admin UI at `/admin/federation`:
- Add/remove trusted peers
- View federation statistics
- Manually trigger sync

## Federation API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /federation/sync | Receive pushed signatures (HMAC auth) |
| GET | /federation/state | Get current state hash for verification |
| POST | /federation/push | Get signatures for pull request (HMAC auth) |
| GET | /admin/api/federation/peers | List all peers |
| POST | /admin/api/federation/peers | Add a peer |
| DELETE | /admin/api/federation/peers/:id | Remove a peer |
| POST | /admin/api/federation/sync | Trigger manual sync |
| GET | /admin/api/federation/stats | Federation statistics |

## Federation Tiers

### Community (Public Repo)
- Manual peer list (add/remove)
- Gossip sync every 5 minutes
- Receive federated signatures
- 2+ reporters required for action

### Enterprise/Paid (Private Repo)
- Automatic peer discovery via DNS
- Real-time push notifications
- Priority reputation (instant sync)
- Managed peer network
- Attack campaign correlation

## Security Considerations

1. **PSK Rotation**: Rotate PSKs periodically (recommended: monthly)
2. **Trust Model**: Only add peers you trust — they can influence your bot decisions
3. **Network Isolation**: Federation traffic should ideally be over private networks or VPN
4. **No Identifiers**: The protocol is designed so no PII or identifiable data leaves your network

## Implementation Details

- **Database**: SQLite with `federation_peers`, `federated_signatures`, `federation_sync_state` tables
- **Background Sync**: Node.js setInterval running every `FEDERATION_SYNC_INTERVAL` ms
- **HMAC**: timingSafeEqual used to prevent timing attacks
- **Retention**: Federated signatures older than 30 days are automatically cleaned

## Future Enhancements

- **v2**: DNS-based peer discovery (TXT records)
- **v3**: DHT/Kademlia for true decentralized peer discovery (libp2p)
- **v4**: Encrypted payloads (e.g.,age encryption)
