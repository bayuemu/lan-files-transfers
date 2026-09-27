# LAN Files Transfers (局域网文件传输工具)

[English](README.md) | 中文文档

`lan-files-transfers` 是一个基于 **Rust** 与 **WebRTC** 构建的高效局域网点对点（P2P）文件传输工具。

无需在手机或电脑上安装任何客户端应用，只需在局域网内一台设备上运行服务端程序，其他设备（如手机、平板、桌面电脑）通过浏览器扫码或输入取件码，即可直接在设备间建立加密的 P2P 直连并高速传输文件。

---

## 🌟 核心特性

- 🚀 **点对点直连（WebRTC DataChannel）**：文件数据直接在两台设备之间传输，不经过服务器中转，传输速度仅取决于局域网带宽。
- 📱 **跨平台与免客户端**：前端基于纯原生 Web 界面，手机与电脑浏览器即开即用，无需安装第三方 App 或插件。
- 🔑 **便捷配对方式**：
  - **终端二维码**：服务端启动后自动在终端输出访问二维码与 URL，手机扫码即可快速打开网页。
  - **6 位取件码配对**：支持一键生成取件码，在接收端输入取件码即可建立连接。
  - **专属链接与二维码**：可分享专属 URL 或动态二维码，扫码或打开链接即可直接发起文件传输。
- 🛠️ **内置 STUN / TURN 服务**：基于 Rust 原生实现的 STUN/TURN 服务，自动处理 NAT 穿透与凭证协商，确保复杂网络环境下的连通性。
- 📦 **大文件流式传输**：采用 256KB 分块传输与背压控制（Backpressure Control），内存占用极低，确保大文件传输平稳流畅。

---

## 🏗️ 架构与工作原理

```text
+-------------------+                 +-------------------+
|   设备 A (发送端)  |                 |   设备 B (接收端)  |
| (WebRTC Client A) |                 | (WebRTC Client B) |
+---------+---------+                 +---------+---------+
          |                                     |
          |  1. WebSocket 信令协商 (SDP / ICE)   |
          |-----------------+-------------------|
          |                 |                   |
          v                 v                   v
+---------------------------------------------------------+
|                  Rust 后端服务                          |
|  - Web 静态服务 (Warp)                                  |
|  - 信令服务器 (WebSocket)                                |
|  - 内置 STUN/TURN 服务器                                |
+---------------------------------------------------------+
          |                                     |
          |  2. WebSockets / STUN 完成 NAT 穿透   |
          +-----------------+-------------------+
                            |
                            v
          +-----------------------------------+
          |  3. P2P WebRTC DataChannel 直连   |
          |     (数据点对点传输，不经过服务器)    |
          +-----------------------------------+
```

---

## ⚙️ 配置文件说明 (`appConf.json`)

项目根目录下的 `appConf.json` 用于控制服务端口、局域网 IP 与日志级别：

```json
{
  "webStunPort": 13000,
  "webAddr": "192.168.2.100",
  "logLevel": "error"
}
```

- **`webStunPort`**：Web 服务与 STUN/TURN 服务的共用端口（例如 `13000`）。
- **`webAddr`**：当前服务所在设备的局域网 IP 地址（用于生成前端访问 URL 与二维码）。
- **`logLevel`**：日志输出级别，支持 `error`、`warn`、`info`、`debug`。

---

## 🚀 编译与运行

### 1. 前置条件
- 已安装 [Rust](https://www.rust-lang.org/) (建议 1.75+)

### 2. 本地开发与运行

直接使用 Cargo 运行：
```bash
cargo run --release
```

启动成功后，终端将输出如下二维码及访问地址：
```text
User Browser Open This URL: 192.168.2.100:13000
```

### 3. 交叉编译与构建可执行文件

#### Windows (x86_64)
```bash
cargo build --target x86_64-pc-windows-gnu --release
```
*构建产物在 `target/x86_64-pc-windows-gnu/release/lan-files-transfers.exe`*

#### Linux (x86_64)
```bash
cargo build --target x86_64-unknown-linux-gnu --release
```
*构建产物在 `target/x86_64-unknown-linux-gnu/release/lan-files-transfers`*

### 4. 快速启动脚本
- **Windows**：双击运行根目录下的 `win-start.bat`。
- **Linux**：赋予执行权限后直接运行 `./lan-files-transfers`。

*注：运行时请确保 `www/` 目录与 `appConf.json` 与可执行文件处于同一目录下。*

---

## 📖 使用指南

1. **启动服务**：在电脑上运行 `lan-files-transfers`，观察终端打印的 URL 与二维码。
2. **打开网页**：
   - 手机直接扫描终端中的二维码，或在同局域网设备浏览器中打开输出的 URL。
3. **配对连接**：
   - **取件码方式**：在一端点击“生成取件码”（6 位数字），在另一端输入该取件码即可成功配对。
   - **链接/二维码方式**：生成配对码后，可复制专属链接或让另一台设备扫描页面上的二维码直接连接。
4. **传输文件**：
   - 配对成功后，选择需要发送的文件并点击“发送”。
   - 接收端实时显示进度条，传输完成后点击下载链接保存文件。

---

## 🛠️ 技术栈

- **后端 (Backend)**：
  - 语言：[Rust](https://www.rust-lang.org/) (2021 edition)
  - Web 与信令服务：[warp](https://crates.io/crates/warp), [tokio](https://crates.io/crates/tokio)
  - STUN / TURN：[webrtc-rs](https://github.com/webrtc-rs/webrtc), [rustun](https://crates.io/crates/rustun)
  - 序列化与配置：[serde](https://crates.io/crates/serde), [figment](https://crates.io/crates/figment)
  - 二维码渲染：[qrcode](https://crates.io/crates/qrcode), [image](https://crates.io/crates/image)
- **Frontend**：
  - HTML5 / CSS3 / Vanilla JavaScript (原生 ES6+，无依赖打包)
  - 浏览器原生 WebRTC DataChannel & WebSockets API
