# LAN Files Transfers

[中文文档](README_CN.md) | English

**LAN Files Transfers** is a fast, cross-platform, clientless local area network (LAN) peer-to-peer (P2P) file transfer tool built with **Rust** and **WebRTC**.

No installation or client software is required on receiving or sending devices (smartphones, tablets, PCs). Simply run the server on one device in your local network, and other devices can transfer files directly to each other through any modern web browser via QR code scanning or shareable pairing codes.

---

## 🌟 Key Features

- 🚀 **Direct P2P Transfer (WebRTC DataChannel)**: Files are transferred directly between devices over WebRTC DataChannel without relaying through the server, delivering maximum speed limited only by your local network.
- 📱 **Clientless & Cross-Platform**: Pure Web interface on the frontend. Works seamlessly on iOS, Android, Windows, macOS, and Linux browsers without extra apps or plugins.
- 🔑 **Multiple Pairing Options**:
  - **Terminal QR Code**: Automatically prints an access QR code and URL in the console upon server startup for instant mobile access.
  - **6-Digit Pairing Code**: Generate a quick 6-digit code to connect devices securely.
  - **Direct Links & QR Codes**: Share exclusive pairing URLs or scan dynamic QR codes to initiate direct file transfers.
- 🛠️ **Built-in STUN / TURN Server**: Powered by native Rust STUN/TURN server implementations (`webrtc-rs` & `rustun`), automatically handling NAT traversal and credential auth for reliable connectivity.
- 📦 **Chunked Streaming Transfer**: Uses 256 KB chunking with dynamic backpressure control (`bufferedAmountLowThreshold`) for low memory usage and smooth transfers of large files.

---

## 🏗️ How It Works

```text
+-------------------+                 +-------------------+
|   Device A (Sender) |               | Device B (Receiver)|
| (WebRTC Client A) |                 | (WebRTC Client B) |
+---------+---------+                 +---------+---------+
          |                                     |
          |  1. WebSocket Signaling (SDP / ICE) |
          |-----------------+-------------------|
          |                 |                   |
          v                 v                   v
+---------------------------------------------------------+
|                    Rust Server                          |
|  - Web Static File Serving (Warp)                       |
|  - WebSocket Signaling Server                           |
|  - Built-in STUN/TURN Server                            |
+---------------------------------------------------------+
          |                                     |
          |  2. WebSockets / STUN NAT Traversal |
          +-----------------+-------------------+
                            |
                            v
          +-----------------------------------+
          |  3. P2P WebRTC DataChannel Direct |
          |     (Data transferred directly)   |
          +-----------------------------------+
```

---

## ⚙️ Configuration (`appConf.json`)

The server configuration is managed via `appConf.json` in the root directory:

```json
{
  "webStunPort": 13000,
  "webAddr": "192.168.2.100",
  "logLevel": "error"
}
```

- **`webStunPort`**: Port used for both Web HTTP service and STUN/TURN service (e.g., `13000`).
- **`webAddr`**: Local IP address of the host machine (used for generating access URLs and QR codes).
- **`logLevel`**: Server log verbosity (`error`, `warn`, `info`, `debug`).

---

## 🚀 Building & Running

### Prerequisites
- [Rust](https://www.rust-lang.org/) (Edition 2021, recommended 1.75+)

### Quick Start (Local Run)

Run directly using Cargo:
```bash
cargo run --release
```

Upon startup, the application will display an access URL and ASCII QR code in the terminal:
```text
User Browser Open This URL: 192.168.2.100:13000
```

### Cross-Compilation

#### Windows (x86_64)
```bash
cargo build --target x86_64-pc-windows-gnu --release
```
*Output binary: `target/x86_64-pc-windows-gnu/release/lan-files-transfers.exe`*

#### Linux (x86_64)
```bash
cargo build --target x86_64-unknown-linux-gnu --release
```
*Output binary: `target/x86_64-unknown-linux-gnu/release/lan-files-transfers`*

### Quick Start Scripts
- **Windows**: Double-click `win-start.bat`.
- **Linux**: Make executable and run `./lan-files-transfers`.

*Note: Ensure `www/` static assets directory and `appConf.json` are placed in the same directory as the executable.*

---

## 📖 Usage Guide

1. **Start the Server**: Launch `lan-files-transfers` on a computer in your local network.
2. **Access the Web App**:
   - Scan the terminal QR code with a phone, or open the displayed URL in any browser on the LAN.
3. **Pair Devices**:
   - **Pairing Code**: Click "Generate Code" on one device (generates a 6-digit code), then enter the code on the second device.
   - **QR / Direct Link**: Share the generated link or scan the browser QR code to connect directly.
4. **Transfer Files**:
   - Select a file and click **Send File**.
   - The receiver will see real-time progress bars and can download the file once the transfer completes.

---

## 🛠️ Tech Stack

- **Backend (Rust)**:
  - Framework: [Warp](https://crates.io/crates/warp), [Tokio](https://crates.io/crates/tokio)
  - STUN / TURN: [webrtc-rs](https://github.com/webrtc-rs/webrtc), [rustun](https://crates.io/crates/rustun)
  - Config & Serialization: [serde](https://crates.io/crates/serde), [figment](https://crates.io/crates/figment)
  - QR Code Generation: [qrcode](https://crates.io/crates/qrcode), [image](https://crates.io/crates/image)
- **Frontend**:
  - HTML5 / CSS3 / Vanilla JavaScript (ES6+, zero bundler dependencies)
  - Browser Native WebRTC DataChannel & WebSockets API
