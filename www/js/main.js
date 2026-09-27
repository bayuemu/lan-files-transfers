"use strict";

const iceServers = {
  iceServers: [],
};


let stunHostPortStr = "";
let intervalId=null;

let container = document.querySelector("#container");
const currentPeerCode = { value: "" };
const clientMap = new Map();
const fileTransportInfoMap = new Map();
const fileSendInfoMap = new Map();
const downloadObjectUrlMap = new Map();
const pendingIceMap = new Map();
const pendingWsMessages = [];
const wsOpenCallbacks = [];
const chunkSize = 262144;
const transferTimeoutMs = 30000;

let wsUrl = "";
let webSocket;
let sysType = "Unknown";
let clientName = "";
let reconnectAttempts = 0;
let reconnectTimerId = null;
const maxReconnectAttempts = 8;

const PeerConnection =
  window.RTCPeerConnection ||
  window.mozRTCPeerConnection ||
  window.webkitRTCPeerConnection;

function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function stringToHashConversion(string) {
  var hashVal = 0;
  if (string.length == 0) return hashVal;
  for (let i = 0; i < string.length; i++) {
    let char = string.charCodeAt(i);
    hashVal = (hashVal << 5) - hashVal + char;
    hashVal = hashVal & hashVal;
  }
  return hashVal;
}

class FileSendInfo {
  constructor() {
    this.fileName = "";
    this.label = "";
    this.fileReader = null;
    this.timeoutId = null;
    this.transferId = "";
  }
}

class FileTransportInfo {
  constructor() {
    this.fileName = "";
    this.fileSize = 0;
    this.fileType = "";
    this.receivedSize = 0;
    this.timeoutId = null;
    this.transferId = "";
  }
}

function buildTransferId(fileName, fileSize) {
  return (
    Date.now().toString(36) +
    "_" +
    Math.abs(stringToHashConversion(fileName + "_" + fileSize)).toString(36)
  );
}

function configureIceServers(stunHostPort, username, credential) {
  const urls = [];
  if (stunHostPort) {
    urls.push("stun:" + stunHostPort);
    urls.push("turn:" + stunHostPort);
  }

  if (username && credential) {
    iceServers.iceServers = [
      {
        urls,
        username,
        credential,
      },
    ];
  } else {
    iceServers.iceServers = [ { urls } ];
  }
}

function normalizeWsUrl(rawWsUrl) {
  try {
    const parsed = new URL(rawWsUrl, window.location.origin);
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    parsed.protocol = protocol;
    return parsed.toString();
  } catch (_) {
    return "";
  }
}

async function loadRuntimeConfig() {
  const fallbackHostPort = window.location.host;
  const fallbackWs =
    (window.location.protocol === "https:" ? "wss://" : "ws://") +
    fallbackHostPort +
    "/ws";

  try {
    const response = await fetch("/jsConf", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("jsConf http status " + response.status);
    }

    const conf = await response.json();
    const confWs = conf && conf.wsUrl ? normalizeWsUrl(conf.wsUrl) : "";
    const confStun = conf && conf.stun ? conf.stun : fallbackHostPort;
    return {
      wsBase: confWs || fallbackWs,
      stunHostPort: confStun,
    };
  } catch (err) {
    console.warn("loadRuntimeConfig fallback:", err);
    return {
      wsBase: fallbackWs,
      stunHostPort: fallbackHostPort,
    };
  }
}

function updateTransferStatus(id, label, text) {
  const statusNode = document.querySelector("div#status_" + id + "_" + label);
  if (!statusNode) {
    return;
  }
  statusNode.textContent = text;
}

function setPeerState(id, text, isError) {
  const stateNode = document.querySelector("span#peerState_" + id);
  if (!stateNode) {
    return;
  }

  stateNode.textContent = text;
  stateNode.className = isError ? "peer-state state-error" : "peer-state";
}

function ensurePeerSection(id) {
  let section = document.querySelector("section#" + id);
  if (!section) {
    addSection(id);
    section = document.querySelector("section#" + id);
  }
  return section;
}

function clearTransferTimeout(timeoutId) {
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
}

function armSendTimeout(id, channelLabel, fileLabel) {
  const info = fileSendInfoMap.get(channelLabel);
  if (!info) {
    return;
  }

  clearTransferTimeout(info.timeoutId);
  info.timeoutId = setTimeout(() => {
    updateTransferStatus(id, fileLabel, "Send timeout");
    if (info.fileReader && info.fileReader.readyState === 1) {
      info.fileReader.abort();
    }
  }, transferTimeoutMs);
}

function armReceiveTimeout(id, channelLabel, fileLabel) {
  const info = fileTransportInfoMap.get(channelLabel);
  if (!info) {
    return;
  }

  clearTransferTimeout(info.timeoutId);
  info.timeoutId = setTimeout(() => {
    updateTransferStatus(id, fileLabel, "Receive timeout");
  }, transferTimeoutMs);
}

class ClientPeer {
  constructor(iceServers, id) {
    this.webSocket = webSocket;
    this.id = id;
    this.connection = new PeerConnection(iceServers);
    this.sendChannelNum = 0;
    this.pendingIceCandidates = [];

    const queuedIce = pendingIceMap.get(id);
    if (queuedIce && queuedIce.length > 0) {
      this.pendingIceCandidates = this.pendingIceCandidates.concat(queuedIce);
      pendingIceMap.delete(id);
    }

    this.connection.addEventListener("icecandidate", async (event) => {
      console.log("addEventListener:",event.candidate)
      if (event.candidate!=null &&  event.candidate!='') {
        console.log("if addEventListener:",event.candidate)
        let msg = {
          type: "ice",
          content: { from: clientName, to: this.id, data: event.candidate },
        };
        sendWsJsonData(msg);
      }
    });
    this.connection.addEventListener("datachannel", (event) => {
      receiveChannelCallback(event, this.id);
    });
  }

  async setOffer(data) {
    console.log('setOffer===>',data);
    await this.connection.setRemoteDescription(data);
    await this.flushPendingIce();
    await this.answerAction();
  }

  async setAnswer(data) {
    console.log('setAnswer===>',data);
    await this.connection.setRemoteDescription(data);
    await this.flushPendingIce();
  }

  async setIce(data) {
    console.log('setIce===>',data);
    if (!this.connection.remoteDescription || !this.connection.remoteDescription.type) {
      this.pendingIceCandidates.push(data);
      return;
    }
    await this.connection.addIceCandidate(data);
  }

  async flushPendingIce() {
    while (this.pendingIceCandidates.length > 0) {
      const candidate = this.pendingIceCandidates.shift();
      await this.connection.addIceCandidate(candidate);
    }
  }

  async offerAction() {
    const offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(offer);
    if (offer) {
      let msg = {
        type: "offer",
        content: { from: clientName, to: this.id, data: offer },
      };
      sendWsJsonData(msg);
    }
  }

  async answerAction() {
    const answer = await this.connection.createAnswer();
    await this.connection.setLocalDescription(answer);
    if (answer) {
      let msg = {
        type: "answer",
        content: { from: clientName, to: this.id, data: answer },
      };
      sendWsJsonData(msg);
    }
  }

  createSendChannel(channelName, onSendChannelStateChange, onError) {
    const sendChannel = this.connection.createDataChannel(
      channelName + "_" + this.sendChannelNum,
      {
        ordered: true, // 保证到达顺序
      }
    );
    this.sendChannelNum += 1;
    sendChannel.binaryType = "arraybuffer";
    sendChannel.addEventListener("open", function (event) {
      onSendChannelStateChange(event, sendChannel);
    });
    sendChannel.addEventListener("close", function (event) {
      onSendChannelStateChange(event, sendChannel);
    });
    sendChannel.addEventListener("error", function (event) {
      onError(event, sendChannel);
    });
  }
}


//!PeerConnection && alert('浏览器不支持WebRTC！');

function addSection(id) {
  if (!container) {
    container = document.querySelector("#container");
  }
  if (!container) {
    console.error("Container node not found");
    return;
  }
  let sectionPlaceholder = document.createElement("section");
  sectionPlaceholder.innerHTML = html_section_tpl(id);
  let sectionNode = sectionPlaceholder.firstElementChild;
  container.appendChild(sectionNode);
}

async function addHtmlAction(id) {
  let fileInput = document.querySelector("input#fileInput_" + id);
  if (!fileInput) return;
  let sendFileButton = document.querySelector("button#sendFile_" + id);
  if (!sendFileButton) return;
  sendFileButton.addEventListener("click", () => {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
      createConnection(id, sendFileButton, fileInput);
      return;
    }

    runWhenWebSocketOpen(function () {
      createConnection(id, sendFileButton, fileInput);
    });
  });

  fileInput.addEventListener(
    "change",
    function () {
      handleFileInputChange(id, fileInput, sendFileButton);
    },
    false
  );
}

async function createConnection(id, sendFileButton, fileInput) {
  if (fileInput.files.length == 0) {
    return;
  }

  sendFileButton.disabled = true;
  setPeerState(id, "File connecting", false);
  let label = stringToHashConversion(fileInput.files[0].name);
  let connectMsg = {
    type: "connect",
    content: { from: clientName, to: id, label: label },
  };
  sendWsJsonData(connectMsg);

  if (!clientMap.has(id)) {
    const clientPeer = new ClientPeer(iceServers, id);
    clientMap.set(id, clientPeer);
  }

  const tmponSendChannelStateChange = (event, sendChannel) => {
    onSendChannelStateChange(id, fileInput, sendChannel);
  };
  const tmpOnErr = (event, sendChannel) => {
    onError(sendChannel, event);
  };

  const clientPeer = clientMap.get(id);
  clientPeer.createSendChannel(
    "sendDataChannel" + id,
    tmponSendChannelStateChange,
    tmpOnErr
  );
  await clientPeer.offerAction();

  //fileInput.disabled = true;
}

function sendData(id, fileInput, sendChannel) {
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    console.error("No selected file for sending");
    return;
  }

  if (!sendChannel || sendChannel.readyState !== "open") {
    console.error("Send channel is not open");
    return;
  }

  const file = fileInput.files[0];
  const fileSendInfo = new FileSendInfo();
  fileSendInfo.fileName = file.name;
  fileSendInfo.label = stringToHashConversion(file.name);
  fileSendInfo.transferId = buildTransferId(file.name, file.size);
  fileSendInfoMap.set(sendChannel.label, fileSendInfo);
  updateTransferStatus(id, fileSendInfo.label, "Sending...");
  setPeerState(id, "Sending file", false);
  console.log(
    `File is ${[file.name, file.size, file.type, file.lastModified].join(" ")}`
  );

  let abortButton = document.querySelector(
    "button#abortButton_" + id + "_" + fileSendInfo.label
  );
  if (abortButton) {
    abortButton.disabled = false;
  }

  const sendChannelLabelInput = document.querySelector(
    "input#sendChannelLabel_" + id + "_" + fileSendInfo.label
  );
  if (sendChannelLabelInput) {
    sendChannelLabelInput.value = sendChannel.label;
  }

  let sendProgress = document.querySelector(
    "div#sendProgress_" + id + "_" + fileSendInfo.label
  );

  let sendProgressLabel = document.querySelector(
    "label#sendProgressLabel_" + id + "_" + fileSendInfo.label
  );
  if (sendProgressLabel) {
    sendProgressLabel.innerText =
      "File:" + file.name + " Size:" + file.size + "bytes";
  }
   

  
  fileSendInfo.fileReader = new FileReader();
  let offset = 0;
  fileSendInfo.fileReader.addEventListener("error", (error) => {
    updateTransferStatus(id, fileSendInfo.label, "Send failed");
    setPeerState(id, "Send failed", true);
    clearTransferTimeout(fileSendInfo.timeoutId);
    console.error("Error reading file:", error);
  });
  fileSendInfo.fileReader.addEventListener("abort", (event) => {
    updateTransferStatus(id, fileSendInfo.label, "Send aborted");
    setPeerState(id, "Send aborted", true);
    clearTransferTimeout(fileSendInfo.timeoutId);
    console.log("File reading aborted:", event);
  });

  fileSendInfo.fileReader.addEventListener("load", (e) => {
    

    if (offset == 0) {
      let jsonInfo = stringToUint8Array(
        JSON.stringify({
          proto: 1,
          packetType: "meta",
          transferId: fileSendInfo.transferId,
          lastModified: file.lastModified,
          type: "file",
          fileType: file.type,
          name: encodeURIComponent(file.name),
          size: file.size,
        })
      );
      sendChannel.send(jsonInfo);
    }

    if (sendChannel.bufferedAmountLowThreshold === 0) {
      sendChannel.bufferedAmountLowThreshold = chunkSize * 4;
    }

    if (sendChannel.bufferedAmount > sendChannel.bufferedAmountLowThreshold) {
      sendChannel.onbufferedamountlow = () => {
        sendChannel.onbufferedamountlow = null;

        sendChannel.send(e.target.result);
        offset += e.target.result.byteLength;
        armSendTimeout(id, sendChannel.label, fileSendInfo.label);
        let p = (offset / file.size).toFixed(2) * 100;
        if (sendProgress) {
          sendProgress.style.width = p + "%";
          sendProgress.innerText = p + "%";
        }

        if (offset < file.size) {
          readSlice(offset);
          return;
        }
        closeDataChannels(id, sendChannel);
      };
      return;
    }

    sendChannel.send(e.target.result);
    offset += e.target.result.byteLength;
    armSendTimeout(id, sendChannel.label, fileSendInfo.label);
    let p = (offset / file.size).toFixed(2) * 100;
    if (sendProgress) {
      sendProgress.style.width = p + "%";
      sendProgress.innerText = p + "%";
    }

    if (offset < file.size) {
      readSlice(offset);
      return;
    }
    clearTransferTimeout(fileSendInfo.timeoutId);
    updateTransferStatus(id, fileSendInfo.label, "Send completed");
    setPeerState(id, "Send completed", false);
    
    let sendProgressBar = document.querySelector("#sendProgress_" + id + "_" + fileSendInfo.label);
    if (sendProgressBar) {
      let sendCard = sendProgressBar.closest(".progress-card");
      if (sendCard) {
        sendCard.style.display = "none";
      }
    }
    
    closeDataChannels(id, sendChannel);
  });

  const readSlice = (o) => {
    const slice = file.slice(offset, o + chunkSize);
    fileSendInfo.fileReader.readAsArrayBuffer(slice);
  };
  armSendTimeout(id, sendChannel.label, fileSendInfo.label);
  readSlice(0);
}

function receiveChannelCallback(event, id) {
   
  let receiveChannel = event.channel;
  receiveChannel.binaryType = "arraybuffer";
  let receiveBuffer = [];

  const fileTransportInfo = new FileTransportInfo();
  fileTransportInfoMap.set(receiveChannel.label, fileTransportInfo);

  receiveChannel.onmessage = function (e) {
    onReceiveMessageCallback(e, id, receiveBuffer, receiveChannel);
  };
  receiveChannel.onopen = function (e) {
    onReceiveChannelStateChange(e, id, receiveChannel);
  };
  receiveChannel.onclose = function (e) {
    onReceiveChannelStateChange(e, id, receiveChannel);
  };
}

function onReceiveMessageCallback(event, id, receiveBuffer, receiveChannel) {
  const transportInfo = fileTransportInfoMap.get(receiveChannel.label);
  if (!transportInfo) {
    closeDataChannels(id, receiveChannel);
    return;
  }

  if (transportInfo.fileSize === 0) {
    let jsonString = Uint8ArrayToString(new Uint8Array(event.data));
    let info;
    try {
      info = JSON.parse(jsonString);
    } catch (err) {
      console.error("Invalid file metadata packet:", err);
      closeDataChannels(id, receiveChannel);
      return;
    }

    if (!info || !info.name || !info.size) {
      console.error("Incomplete file metadata");
      closeDataChannels(id, receiveChannel);
      return;
    }

    if (info.packetType && info.packetType !== "meta") {
      console.error("Unexpected packetType:", info.packetType);
      closeDataChannels(id, receiveChannel);
      return;
    }

    if (info.proto && info.proto !== 1) {
      console.error("Unsupported transfer protocol version:", info.proto);
      closeDataChannels(id, receiveChannel);
      return;
    }

    if (info.type !== "file") {
      console.error("Unsupported metadata type:", info.type);
      closeDataChannels(id, receiveChannel);
      return;
    }

    try {
      transportInfo.fileName = decodeURIComponent(info.name);
    } catch (err) {
      console.error("Invalid encoded file name:", err);
      closeDataChannels(id, receiveChannel);
      return;
    }
    transportInfo.fileSize = info.size;
    transportInfo.fileType = info.fileType;
    transportInfo.transferId = info.transferId || "";
    
    let receiveLabel = stringToHashConversion(transportInfo.fileName);
    let chatNode = document.querySelector("div#chat_" + id);
    if (chatNode && !document.querySelector("div#receiveProgressLabel_" + id + "_" + receiveLabel)) {
      chatNode.innerHTML += html_receive_progress_tpl(id, receiveLabel);
    }

    let receiveProgressLabel = document.querySelector(
      "div#receiveProgressLabel_" +
        id +
        "_" +
        receiveLabel
    );
    if (receiveProgressLabel) {
      receiveProgressLabel.innerHTML =
        "File:" +
        transportInfo.fileName +
        " Size:" +
        formatBytes(transportInfo.fileSize);
    }
    updateTransferStatus(id, receiveLabel, "Receiving...");
    setPeerState(id, "Receiving file", false);
    armReceiveTimeout(id, receiveChannel.label, receiveLabel);
    return;
  } else {
    receiveBuffer.push(event.data);
    transportInfo.receivedSize += event.data.byteLength;
    let receiveProgress = document.querySelector(
      "div#receiveProgress_" +
        id +
        "_" +
        stringToHashConversion(transportInfo.fileName)
    );
    let p = ((transportInfo.receivedSize / transportInfo.fileSize).toFixed(2)) * 100;
    
    if (receiveProgress) {
      receiveProgress.style.width = p + "%";
      receiveProgress.innerText = p + "%";
    }
    let receiveLabel = stringToHashConversion(transportInfo.fileName);
    armReceiveTimeout(id, receiveChannel.label, receiveLabel);
  }

  
  if (
    transportInfo.receivedSize >= transportInfo.fileSize
  ) {
    const received = new Blob(receiveBuffer);
    receiveBuffer = [];
    let label = stringToHashConversion(transportInfo.fileName);
    let downloadAnchor = document.querySelector(
      "a#download_" + id + "_" + label
    );
    if (downloadAnchor) {
      const oldUrl = downloadObjectUrlMap.get(downloadAnchor.id);
      if (oldUrl) {
        URL.revokeObjectURL(oldUrl);
      }

      downloadAnchor.href = URL.createObjectURL(received);
      downloadObjectUrlMap.set(downloadAnchor.id, downloadAnchor.href);
      downloadAnchor.download = transportInfo.fileName;

      downloadAnchor.textContent = `Click to download '${
        transportInfo.fileName
      }' (${transportInfo.fileSize} bytes)`;
      downloadAnchor.style.display = "block";
    }

    updateTransferStatus(id, label, "Receive completed");
    setPeerState(id, "Receive completed", false);
    clearTransferTimeout(transportInfo.timeoutId);

    let receiveProgressBar = document.querySelector("#receiveProgress_" + id + "_" + label);
    if (receiveProgressBar) {
      let receiveCard = receiveProgressBar.closest(".progress-card");
      if (receiveCard) {
        // Keep receive card visible so the download link is accessible
      }
    }

    closeDataChannels(id, receiveChannel);
  }
}

function closeDataChannels(id, dataChannel) {
  console.log("Closing data channels");
  if (!dataChannel) {
    return;
  }

  let info = fileTransportInfoMap.get(dataChannel.label);
  if (info) {
    clearTransferTimeout(info.timeoutId);
  }
  if (fileTransportInfoMap.has(dataChannel.label)) {
     
    fileTransportInfoMap.delete(dataChannel.label);
  }

  let sendInfo = fileSendInfoMap.get(dataChannel.label);
  if (sendInfo) {
    clearTransferTimeout(sendInfo.timeoutId);
  }
  if (fileSendInfoMap.has(dataChannel.label)) {
     
    fileSendInfoMap.delete(dataChannel.label);
  }

  const sendFileButton = document.querySelector("button#sendFile_" + id);
  if (sendFileButton) {
    sendFileButton.disabled = false;
  }

  dataChannel.close();
  console.log(`Closed data channel with label: ${dataChannel.label}`);

  console.log("Closed peer connections");
}

async function onReceiveChannelStateChange(eventx, id, receiveChannel) {
  // console.log(" onReceiveChannelStateChange:",id,eventx);
  // if (receiveChannel) {
  //   const readyState = receiveChannel.readyState;
  //   console.log(`Receive channel state is: ${readyState}`);
  // }
}

function onSendChannelStateChange(id, fileInput, sendChannel) {
  if (sendChannel) {
    const { readyState } = sendChannel;

    if (readyState === "open") {
      setPeerState(id, "Data channel ready", false);
      sendData(id, fileInput, sendChannel);
    } else if (readyState === "closed") {
      setPeerState(id, "Data channel closed", false);
    }
  }
}

function onError(sendChannel, error) {
  console.error("Data channel error:", error);
  if (sendChannel) {
    return;
  }
}

async function handleFileInputChange(id, fileInput, sendFileButton) {
  let sectionNode = document.querySelector("section#" + id);
  if (!sectionNode) {
    console.error("section not found for id:", id);
    sendFileButton.disabled = true;
    return;
  }
  let progressPlaceholder = document.createElement("div");
  const file = fileInput.files[0];
  if (!file) {
    console.log("No file chosen");
    sendFileButton.disabled = true;
    return;
  }
  let label = stringToHashConversion(file.name);

  const oldSendCard = document.querySelector("input#sendChannelLabel_" + id + "_" + label);
  if (oldSendCard) {
    const oldWrap = oldSendCard.closest("div.progress-card");
    if (oldWrap) {
      oldWrap.remove();
    }
  }

  progressPlaceholder.innerHTML = html_send_progress_tpl(id, label);
  let progressNode = progressPlaceholder;
  sectionNode.appendChild(progressNode);

  let abortButton = document.querySelector(
    "button#abortButton_" + id + "_" + label
  );

  if (!abortButton) {
    console.error("abort button not found for id:", id);
    sendFileButton.disabled = true;
    return;
  }

  abortButton.addEventListener("click", () => {
    let sendChannelLabel = document.querySelector(
      "input#sendChannelLabel_" + id + "_" + label
    );
    let sclVal = sendChannelLabel.value;

    if (fileSendInfoMap.has(sclVal)) {
      if (
        fileSendInfoMap.get(sclVal).fileReader &&
        fileSendInfoMap.get(sclVal).fileReader.readyState === 1
      ) {
        console.log("Abort read!");
        fileSendInfoMap.get(sclVal).fileReader.abort();
      }
    }
  });
  sendFileButton.disabled = false;
}

function html_section_tpl(id) {
  return (
    '<section class="peer-card" id="' +
    id +
    '">' +
    '<div class="peer-header">' +
    '<span class="peer-name">' +
    id +
    "</span>" +
    '<span class="peer-state" id="peerState_' +
    id +
    '">Ready</span>' +
    "</div>" +
    '<div class="peer-body" id="chat_' +
    id +
    '"></div>' +
    "</section>"
  );
}

function html_form_tpl(id) {
  let tpl =
    '<div class="transfer-controls">' +
    "<div>" +
    '<label for="fileInput" class="form-label">Choose File:</label>' +
    '<input class="form-control" type="file" id="fileInput_' +
    id +
    '" name="files" />' +
    "</div>" +
    '<div class="button-row">' +
    '<button disabled class="btn btn-success" id="sendFile_' +
    id +
    '">Send File</button>' +
    "</div>" +
    '</div>';
  return tpl;
}

function html_send_progress_tpl(id, label) {
  let tpl =
    ' <div class="progress-card">' +
    '<div>' +
    '<input type="hidden" id="sendChannelLabel_' +
    id +
    "_" +
    label +
    '"  value="" />' +
    '<label for="sendProgressBar_' +
    id +
    "_" +
    label +
    '" id="sendProgressLabel_' +
    id +
    "_" +
    label +
    '"  class="form-label">Send progress:</label>' +
    '<div id="sendProgressBar_' +
    id +
    "_" +
    label +
    '"  class="progress" role="progressbar" aria-label="Basic example" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">' +
    '<div class="progress-bar" id="sendProgress_' +
    id +
    "_" +
    label +
    '" style="width: 0%"></div>' +
    "</div>" +
    "</div>" +
    '<div class="button-row mt-2">' +
    '<button disabled id="abortButton_' +
    id +
    "_" +
    label +
    '" class="btn btn-danger" id="abortButton">Abort</button>' +
    '<div id="status_' +
    id +
    "_" +
    label +
    '" class="status-note"></div>' +
    "</div>" +
    "</div>" +
    "</div>";

  return tpl;
}

function html_receive_progress_tpl(id, label) {
  let tpl =
    '<div class="progress-card">' +
    '<div>' +
    '<div class="label" id="receiveProgressLabel_' +
    id +
    "_" +
    label +
    '" >Receive progress: </div>' +
    '<div class="progress" role="progressbar" aria-label="Basic example" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">' +
    '<div class="progress-bar" id="receiveProgress_' +
    id +
    "_" +
    label +
    '"  style="width: 0%"></div>' +
    "</div>" +
    '<a class="download-link" id="download_' +
    id +
    "_" +
    label +
    '"></a>' +
    '<div id="status_' +
    id +
    "_" +
    label +
    '" class="status-note"></div>' +
    "</div>" +
    "</div>";
  return tpl;
}

async function offerAction(id, data) {
  const clientPeer = new ClientPeer(iceServers, id);
  clientMap.set(id, clientPeer);

  setPeerState(id, "Negotiating", false);
  await clientPeer.setOffer(data);
}

function Uint8ArrayToString(fileData) {
  var dataString = "";
  for (var i = 0; i < fileData.length; i++) {
    dataString += String.fromCharCode(fileData[i]);
  }

  return dataString;
}

function stringToUint8Array(str, size) {
  var arr = [];
  for (var i = 0, j = str.length; i < j; ++i) {
    arr.push(str.charCodeAt(i));
  }

  if (size) {
    var tmpUint8Array = new Uint8Array(size);
    tmpUint8Array.set(new Uint8Array(arr));
    return tmpUint8Array;
  } else {
    var tmpUint8Array = new Uint8Array(arr);
    return tmpUint8Array;
  }
}

async function init() {
  if (!PeerConnection) {
    alert("Browser does not support WebRTC");
    return;
  }

  const runtimeConf = await loadRuntimeConfig();
  stunHostPortStr = runtimeConf.stunHostPort;
  configureIceServers(runtimeConf.stunHostPort);

  let uuid = window.crypto && crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15));
  sysType = systemType();
  clientName = sysType + "-" + uuid;

  const params = new URLSearchParams(window.location.search);
  const targetCode = params.get("to");
  if (targetCode && /^\d{6}$/.test(targetCode)) {
    currentPeerCode.value = targetCode;
    document.getElementById('inputTargetCode').value = targetCode;
  }

  console.log(window.location.protocol + "//" + window.location.host);
  wsUrl = runtimeConf.wsBase + "?id=" + encodeURIComponent(clientName);
  webSocket = new WebSocket(wsUrl);


  createWebSocket(webSocket);

  if (currentPeerCode.value) {
    setTimeout(() => {
      connectTargetCode();
    }, 1500);
  }
}

function createWebSocket(ws, func) {
  if (typeof func === "function") {
    wsOpenCallbacks.push(func);
  }

  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }

  ws.onopen = () => {
    reconnectAttempts = 0;
    flushPendingWsMessages();

    while (wsOpenCallbacks.length > 0) {
      const callback = wsOpenCallbacks.shift();
      try {
        callback();
      } catch (err) {
        console.error("onopen callback failed:", err);
      }
    }
  };

  
  ws.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (err) {
      console.error("Invalid websocket message:", err);
      return;
    }
    if (!message.type) {
      return;
    }
    let id = message.content && message.content.from ? message.content.from : "";
    switch (message.type) {
      case "turn_credentials":
        if (message.content && message.content.username && message.content.credential) {
          configureIceServers(stunHostPortStr, message.content.username, message.content.credential);
        }
        break;
      case "code_generated":
        {
          const code = message.content.code;
          document.getElementById('codeDisplayValue').textContent = code;
          document.getElementById('receiveCodeDisplay').style.display = 'block';
          const baseUrl = window.location.origin;
          const link = `${baseUrl}/?to=${code}`;
          document.getElementById('exclusiveLinkInput').value = link;
          generateQRCode(link, 'qrCodeCanvas');
          let btn = document.getElementById('btnGenerateCode');
          if (btn) btn.disabled = false;
        }
        break;
      case "code_resolved":
        {
          const uuid = message.content.uuid;
          let section = ensurePeerSection(uuid);
          if (!section) break;
          let chatNode = document.querySelector("div#chat_" + uuid);
          if (!chatNode) break;
          if (document.querySelector("input#fileInput_" + uuid)) break;
          chatNode.innerHTML = html_form_tpl(uuid);
          setPeerState(uuid, "Connected", false);
          const selInfo = document.getElementById('selectedPeerInfo');
          selInfo.textContent = "Selected: " + uuid;
          selInfo.style.display = 'block';
          addHtmlAction(uuid);
        }
        break;
      case "error":
        alert("Error: " + (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)));
        break;
      case "pong":
      //  console.info("pong action receive msg：", event);
        break;
      case "connect":
        {
          const peerId = id;
          setPeerState(peerId, "Connected", false);
        }
        break;
      case "offer":
        {
          const peerId = id;
          let section = ensurePeerSection(peerId);
          if (!section) break;
          let chatNode = document.querySelector("div#chat_" + peerId);
          if (!chatNode) break;
          if (!clientMap.has(peerId)) {
            const clientPeer = new ClientPeer(iceServers, peerId);
            clientMap.set(peerId, clientPeer);
          }
          clientMap.get(peerId).setOffer(message.content.data).catch((err) => {
            console.error("setOffer failed:", err);
            setPeerState(peerId, "Offer failed", true);
          });
        }
        break;
      case "answer":
        if (clientMap.get(id) != null) {
          setPeerState(id, "Answer received", false);
          clientMap.get(id).setAnswer(message.content.data).catch((err) => {
            console.error("setAnswer failed:", err);
            setPeerState(id, "Answer failed", true);
          });
        }
        break;
      case "ice":
        if (clientMap.get(id) != null) {
            clientMap.get(id).setIce(message.content.data).catch((err) => {
              console.error("setIce failed:", err);
              setPeerState(id, "ICE failed", true);
            });
        } else {
            if (!pendingIceMap.has(id)) {
              pendingIceMap.set(id, []);
            }
            pendingIceMap.get(id).push(message.content.data);
        }
        break;
      default:
        console.error("default action receive msg：", event);
    }
  };

  
  ws.onerror = (error) => {
    if( intervalId!=null ){
      clearInterval(intervalId)
      intervalId = null
    }
    console.error("WebSocket Error: ", error);
  };

  ws.onclose = () => {
    if( intervalId!=null ){
       clearInterval(intervalId)
      intervalId = null
    }
    console.log("WebSocket was closed!");
    scheduleReconnect();
  };

  intervalId =  setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(
      JSON.stringify({ type: "ping",content:"{}"})
    );
      //console.log('ping~~')
  }, 5000)

}

function runWhenWebSocketOpen(callback) {
  if (typeof callback === "function") {
    wsOpenCallbacks.push(callback);
  }

  if (webSocket && webSocket.readyState === WebSocket.OPEN) {
    flushOpenCallbacksImmediately();
    return;
  }

  if (!webSocket || webSocket.readyState === WebSocket.CLOSED) {
    webSocket = new WebSocket(wsUrl);
    createWebSocket(webSocket);
  }
}

function flushOpenCallbacksImmediately() {
  while (wsOpenCallbacks.length > 0) {
    const callback = wsOpenCallbacks.shift();
    try {
      callback();
    } catch (err) {
      console.error("immediate callback failed:", err);
    }
  }
}

function scheduleReconnect() {
  if (!wsUrl || reconnectTimerId != null) {
    return;
  }

  if (reconnectAttempts >= maxReconnectAttempts) {
    console.error("WebSocket reconnect limit reached");
    return;
  }

  const delay = Math.min(1000 * (2 ** reconnectAttempts), 15000);
  reconnectAttempts += 1;
  reconnectTimerId = setTimeout(() => {
    reconnectTimerId = null;
    if (webSocket && (webSocket.readyState === WebSocket.OPEN || webSocket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    webSocket = new WebSocket(wsUrl);
    createWebSocket(webSocket);
  }, delay);
}

function flushPendingWsMessages() {
  if (!webSocket || webSocket.readyState !== WebSocket.OPEN) {
    return;
  }

  while (pendingWsMessages.length > 0) {
    webSocket.send(pendingWsMessages.shift());
  }
}

function systemType() {
  let userAgentInfo = navigator.userAgent.toLowerCase();
  console.log(userAgentInfo);
  let Agents = [
    "android",
    "iphone",
    "linux",
    "symbianos",
    "windows",
    "ipad",
    "ipod",
  ];

  for (let v = 0; v < Agents.length; v++) {
    if (userAgentInfo.indexOf(Agents[v]) >= 0) {
      return Agents[v];
    }
  }
  return "Unknown";
}

// send json data use websocket
function sendWsJsonData(data) {
  const payload = JSON.stringify(data);
  if (webSocket && webSocket.readyState === WebSocket.OPEN) {
    webSocket.send(payload);
    return;
  }

  if (pendingWsMessages.length > 100) {
    pendingWsMessages.shift();
  }
  pendingWsMessages.push(payload);

  if (!webSocket || webSocket.readyState === WebSocket.CLOSED) {
    webSocket = new WebSocket(wsUrl);
    createWebSocket(webSocket);
  } else {
    console.error("WebSocket Not Open!");
  }
}

function generateReceiveCode() {
    let btn = document.getElementById('btnGenerateCode');
    if (btn) btn.disabled = true;
    sendWsJsonData({ type: "generate_code", content: {} });
}

function connectTargetCode() {
    let input = document.getElementById('inputTargetCode');
    if (!input) return;
    let code = input.value.trim();
    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
        alert("Please enter a valid 6-digit code.");
        return;
    }
    sendWsJsonData({ type: "resolve_code", content: { code: code } });
}

function generateQRCode(text, canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !text) return;

  let code = "";
  try {
    const parsed = new URL(text, window.location.origin);
    code = (parsed.searchParams.get("to") || parsed.searchParams.get("code") || "").trim();
  } catch (err) {
    console.error("Invalid QR source url:", err);
    return;
  }

  if (!code) {
    console.error("QR code value is empty");
    return;
  }

  const img = new Image();
  img.onload = () => {
    const drawSize = 180;
    canvas.width = drawSize;
    canvas.height = drawSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error("Canvas context unavailable");
      return;
    }
    ctx.clearRect(0, 0, drawSize, drawSize);
    ctx.drawImage(img, 0, 0, drawSize, drawSize);
  };

  img.onerror = (err) => {
    console.error("Load backend QR image failed:", err);
  };

  img.src = `/qrCode?code=${encodeURIComponent(code)}&ts=${Date.now()}`;
}

async function copyExclusiveLink() {
    const input = document.getElementById('exclusiveLinkInput');
    if (!input) return;
    try {
        await navigator.clipboard.writeText(input.value);
        const btn = event.target;
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
    } catch (err) {
        input.select();
        document.execCommand('copy');
    }
}

init().catch((err) => {
  console.error("init failed:", err);
});


