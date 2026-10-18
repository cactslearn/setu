# Disclaimer & Terms of Use

## 1. "As-Is" Software Provision

Setu P2P is open-source software provided on an "AS IS" and "AS AVAILABLE" basis, without warranties or conditions of any kind, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE.

You are solely responsible for determining the appropriateness of using this software and assume any risks associated with its operation.

---

## 2. Network & Connectivity Limitations

- **Direct P2P Connectivity & Relay Fallback:** Setu P2P relies primarily on direct peer-to-peer WebRTC connections via public STUN servers. Depending on network topology, Symmetric NATs, corporate firewalls, or strict cellular carrier-grade NATs (CGNAT), direct peer-to-peer connectivity may not be possible without a TURN relay server. Setu does not operate a centralized relay, but provides a built-in Settings option for users to supply their own custom TURN server credentials (saved purely locally in IndexedDB) to bridge restrictive networks.
- **No Emergency Services:** Setu P2P is an experimental communication tool and CANNOT be used to contact emergency services (e.g. 911, 112, 999).
- **Session Duration:** The one-hour meeting timer is a client-side convenience and informational indicator; it is not a tamper-proof enforcement mechanism.

---

## 3. Recording & Compliance Responsibilities

- Setu P2P includes an in-app consensual recording module that alerts both parties and requests explicit consent.
- However, users are strictly responsible for complying with all applicable local, state, national, and international laws regarding wiretapping, eavesdropping, and the recording of audio and video conversations (including single-party or all-party consent laws in their jurisdiction).
- The creators and contributors of Setu P2P disclaim any and all liability for misuse of the recording or file-transfer capabilities.
