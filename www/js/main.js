"use strict";

const iceServers = {
  iceServers: [
    { url: "stun:" + window.location.host },

    // {"urls": ["turn:192.168.2.103:3478"], "username": "user1", "credential": "test"},
  ],
};

const selectObj = document.querySelector("select#clients");
const clientMap = new Map();
const fileTransportInfoMap = new Map();
const fileSendInfoMap = new Map();
const chunkSize = 262144;

let wsUrl = "";
let webSocket;
let sysType = "Unknow";
let clientName = "";

const PeerConnection =
  window.RTCPeerConnection ||
  window.mozRTCPeerConnection ||
  window.webkitRTCPeerConnection;

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
  }
}

class FileTransportInfo {
  constructor() {
    this.fileName = "";
    this.fileSize = 0;
    this.fileType = "";
  }
}

class CilentObj {
  constructor(iceServers, id) {
    this.webSocket = webSocket;
    this.id = id;
    this.connection = new RTCPeerConnection(iceServers);
    this.sendChannelNum = 0;

    this.connection.addEventListener("icecandidate", async (event) => {
      if (event.candidate) {
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
    await this.connection.setRemoteDescription(data);
    await this.answerAction();
  }

  async setAnswer(data) {
    await this.connection.setRemoteDescription(data);
  }

  async setIce(data) {
    await this.connection.addIceCandidate(data);
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

function addClientPanel(obj) {
  console.log(obj.value);
  let id = obj.value;

  let section = document.querySelector("section#" + id);

  console.log("section" + section);
  if (!section) {
    addSection(id);
  }
  let fileInputNode = document.querySelector("input#fileInput_" + id);
  if (!fileInputNode) {
    addPanelNode(id);
  }
}

function addPanelNode(id) {
  let sectionNode = document.querySelector("div#chat_" + id);
  let divPlaceholder = document.createElement("div");
  divPlaceholder.innerHTML = html_form_tpl(id);
  let divNode = divPlaceholder.firstElementChild;
  sectionNode.appendChild(divNode);

  addHtmlAction(id);
}

function addSection(id) {
  let sectionPlaceholder = document.createElement("section");
  sectionPlaceholder.innerHTML = html_section_tpl(id);
  let sectionNode = sectionPlaceholder.firstElementChild;
  container.appendChild(sectionNode);
}

async function addHtmlAction(id) {
  if (!clientMap.has(id)) {
    const mCilentObj = new CilentObj(iceServers, id);
    clientMap.set(id, mCilentObj);
  }

  let fileInput = document.querySelector("input#fileInput_" + id);
  let sendFileButton = document.querySelector("button#sendFile_" + id);
  sendFileButton.addEventListener("click", () => {
    if (webSocket.readyState === WebSocket.CLOSED) {
      webSocket = new WebSocket(wsUrl);
      createWebSocket(webSocket, function () {
        createConnection(id, sendFileButton, fileInput);
      });
    } else {
      createConnection(id, sendFileButton, fileInput);
    }
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
  let label = stringToHashConversion(fileInput.files[0].name);
  let connectMsg = {
    type: "connect",
    content: { from: clientName, to: id, label: label },
  };
  sendWsJsonData(connectMsg);

  const tmponSendChannelStateChange = (event, sendChannel) => {
    onSendChannelStateChange(id, fileInput, sendChannel);
  };
  const tmpOnErr = (event, sendChannel) => {
    onError(sendChannel, err);
  };

  clientMap
    .get(id)
    .createSendChannel(
      "sendDataChannel" + id,
      tmponSendChannelStateChange,
      tmpOnErr
    );
  await clientMap.get(id).offerAction();

  //fileInput.disabled = true;
}

function sendData(id, fileInput, sendChannel) {
  let readyState = sendChannel.readyState;
   

  const file = fileInput.files[0];
  const fileSendInfo = new FileSendInfo();
  fileSendInfo.fileName = file.name;
  fileSendInfo.label = stringToHashConversion(file.name);
  fileSendInfoMap.set(sendChannel.label, fileSendInfo);
  console.log(
    `File is ${[file.name, file.size, file.type, file.lastModified].join(" ")}`
  );

  let abortButton = document.querySelector(
    "button#abortButton_" + id + "_" + fileSendInfo.label
  );
  abortButton.disabled = false;

  document.querySelector(
    "input#sendChannelLabel_" + id + "_" + fileSendInfo.label
  ).value = sendChannel.label;

  let sendProgress = document.querySelector(
    "div#sendProgress_" + id + "_" + fileSendInfo.label
  );

  let sendProgressLabel = document.querySelector(
    "label#sendProgressLabel_" + id + "_" + fileSendInfo.label
  );
  sendProgressLabel.innerText =
    "File:" + file.name + " Size:" + file.size + "bytes";
   

  
  fileSendInfo.fileReader = new FileReader();
  let offset = 0;
  fileSendInfo.fileReader.addEventListener("error", (error) =>
    console.error("Error reading file:", error)
  );
  fileSendInfo.fileReader.addEventListener("abort", (event) =>
    console.log("File reading aborted:", event)
  );

  fileSendInfo.fileReader.addEventListener("load", (e) => {
    

    if (offset == 0) {
      let jsonInfo = stringToUint8Array(
        JSON.stringify({
          lastModified: file.lastModified,
          type: "file",
          fileType: file.type,
          name: encodeURIComponent(file.name),
          size: file.size,
        })
      );
      sendChannel.send(jsonInfo);
    }

    if (sendChannel.bufferedAmount > sendChannel.bufferedAmountLowThreshold) {
      sendChannel.onbufferedamountlow = () => {
        sendChannel.onbufferedamountlow = null;

        sendChannel.send(e.target.result);
        offset += e.target.result.byteLength;
        let p = (offset / file.size).toFixed(2) * 100;
        sendProgress.style.width = p + "%";
        sendProgress.innerText = p + "%";

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
    let p = (offset / file.size).toFixed(2) * 100;
    sendProgress.style.width = p + "%";
    sendProgress.innerText = p + "%";

    if (offset < file.size) {
      readSlice(offset);
      return;
    }
    closeDataChannels(id, sendChannel);
  });

  const readSlice = (o) => {
    console.log("readSlice ", o);
    const slice = file.slice(offset, o + chunkSize);
    fileSendInfo.fileReader.readAsArrayBuffer(slice);
  };
  readSlice(0);
}

function receiveChannelCallback(event, id) {
   
  let receiveChannel = event.channel;
  receiveChannel.binaryType = "arraybuffer";
  let receiveBuffer = [];

  const fileTransportInfo = new FileTransportInfo();
  fileTransportInfoMap.set(receiveChannel.label, fileTransportInfo);
  fileTransportInfoMap.get(receiveChannel.label).receivedSize = 0;

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
  

  if (fileTransportInfoMap.get(receiveChannel.label).fileSize == 0) {
    let jsonString = Uint8ArrayToString(new Uint8Array(event.data));
    
    let info = JSON.parse(jsonString);
    fileTransportInfoMap.get(receiveChannel.label).fileName =
      decodeURIComponent(info.name);
    fileTransportInfoMap.get(receiveChannel.label).fileSize = info.size;
    fileTransportInfoMap.get(receiveChannel.label).fileType = info.fileType;
    let receiveProgressLabel = document.querySelector(
      "div#receiveProgressLabel_" +
        id +
        "_" +
        stringToHashConversion(
          fileTransportInfoMap.get(receiveChannel.label).fileName
        )
    );
    receiveProgressLabel.innerHTML =
      "File:" +
      fileTransportInfoMap.get(receiveChannel.label).fileName +
      " Size:" +
      fileTransportInfoMap.get(receiveChannel.label).fileSize +
      "bytes";
    return;
  } else {
    receiveBuffer.push(event.data);
    fileTransportInfoMap.get(receiveChannel.label).receivedSize +=
      event.data.byteLength;
    let receiveProgress = document.querySelector(
      "div#receiveProgress_" +
        id +
        "_" +
        stringToHashConversion(
          fileTransportInfoMap.get(receiveChannel.label).fileName
        )
    );
    let p =
      (
        fileTransportInfoMap.get(receiveChannel.label).receivedSize /
        fileTransportInfoMap.get(receiveChannel.label).fileSize
      ).toFixed(2) * 100;
    
    receiveProgress.style.width = p + "%";
    receiveProgress.innerText = p + "%";
  }

  
  if (
    fileTransportInfoMap.get(receiveChannel.label).receivedSize ===
    fileTransportInfoMap.get(receiveChannel.label).fileSize
  ) {
    const received = new Blob(receiveBuffer);
    receiveBuffer = [];
    let label = stringToHashConversion(
      fileTransportInfoMap.get(receiveChannel.label).fileName
    );
    let downloadAnchor = document.querySelector(
      "a#download_" + id + "_" + label
    );
    downloadAnchor.href = URL.createObjectURL(received);
    downloadAnchor.download = fileTransportInfoMap.get(
      receiveChannel.label
    ).fileName;

    downloadAnchor.textContent = `Click to download '${
      fileTransportInfoMap.get(receiveChannel.label).fileName
    }' (${fileTransportInfoMap.get(receiveChannel.label).fileSize} bytes)`;
    downloadAnchor.style.display = "block";

    closeDataChannels(id, receiveChannel);
  }
}

function closeDataChannels(id, dataChannel) {
  console.log("Closing data channels");
  if (fileTransportInfoMap.has(dataChannel.label)) {
     
    fileTransportInfoMap.delete(dataChannel.label);
  }

  if (fileSendInfoMap.has(dataChannel.label)) {
     
    fileSendInfoMap.delete(dataChannel.label);
  }

  if (dataChannel) {
    dataChannel.close();
    console.log(`Closed data channel with label: ${dataChannel.label}`);
    dataChannel = null;
  }

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
      sendData(id, fileInput, sendChannel);
    }
  }
}

function onError(sendChannel, error) {
  if (sendChannel) {
    console.error("Error in sendChannel:", error);
    return;
  }
  console.log("Error in sendChannel which is already closed:", error);
}

async function handleFileInputChange(id, fileInput, sendFileButton) {
  let sectionNode = document.querySelector("section#" + id);
  let progressPlaceholder = document.createElement("div");
  const file = fileInput.files[0];
  let label = stringToHashConversion(file.name);
  progressPlaceholder.innerHTML = html_send_progress_tpl(id, label);
  let progressNode = progressPlaceholder.firstElementChild;
  sectionNode.appendChild(progressNode);

  let abortButton = document.querySelector(
    "button#abortButton_" + id + "_" + label
  );

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

  if (!file) {
    console.log("No file chosen");
  } else {
    sendFileButton.disabled = false;
  }
}

function html_section_tpl(id) {
  let tpl =
    '<section class="card m-1 p-2" id="' +
    id +
    '">' +
    '<span class="card-header text-white bg-dark">' +
    id +
    "</span>" +
    '<div class="card  m-1" id="chat_' +
    id +
    '"></div>';
  ("</section>");
  return tpl;
}

function html_form_tpl(id) {
  let tpl =
    '<div class="row">' +
    '<div class="col-sm">' +
    '<label for="fileInput" class="form-label">Choose File:</label>' +
    '<input class="form-control" type="file" id="fileInput_' +
    id +
    '" name="files" />' +
    "</div>" +
    '<div class="col-sm-1 m-1 align-self-end">' +
    '<button disabled class="btn btn-success align-self-end" id="sendFile_' +
    id +
    '">Send</button>' +
    "</div>" +
    "</div>";
  return tpl;
}

function html_send_progress_tpl(id, label) {
  let tpl =
    ' <div class="card  m-1">' +
    '<div class="row m-2">' +
    '<div class="col-sm m-1">' +
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
    '<div class="col-sm-1 m-1 align-self-end">' +
    '<button disabled id="abortButton_' +
    id +
    "_" +
    label +
    '" class="btn btn-success  align-self-end" id="abortButton">Abort</button>' +
    "</div>" +
    "</div>" +
    "</div>";

  return tpl;
}

function html_receive_progress_tpl(id, label) {
  let tpl =
    '<div class="card  m-1">' +
    '<div class="col-sm m-1">' +
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
    '<a class="m-1"  id="download_' +
    id +
    "_" +
    label +
    '"id="download_' +
    id +
    "_" +
    label +
    '"></a>' +
    '<div id="status_' +
    id +
    "_" +
    label +
    '"></div>' +
    "</div>" +
    "</div>";
  return tpl;
}

function offerAction(id, data) {
  const mCilentObj = new CilentObj(iceServers, id);
  clientMap.set(id, mCilentObj);
  mCilentObj.setOffer(data);
   
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

function init() {
  let uuid = Math.floor(Math.random() * 10000);
  sysType = systemType();
  clientName = sysType + "-" + uuid+"-" + userName;
  console.log(window.location.protocol + "//" + window.location.host);
  wsUrl = "ws://" + window.location.host + "/ws" + "?id=" + clientName;
  webSocket = new WebSocket(wsUrl);

 
  createWebSocket(webSocket);
}

function createWebSocket(ws, func) {

  let fnOnce = false;
  ws.onopen = () => {
     
     
    ws.send(
      JSON.stringify({ type: "list", id: clientName, content: "Hello Server!" })
    );
    if (!fnOnce && func != null) {
      fnOnce = true;
      func();
    }
  };

  
  ws.onmessage = (event) => {
    
    var message = JSON.parse(event.data);
    if (!message.type) {
      return;
    }
    let id = message.content.from;
    switch (message.type) {
      case "connect":
        if (!document.querySelector("section#" + id)) {
          addSection(id);
        }
        let label = message.content.label;
        let sectionNode = document.querySelector("section#" + id);
        let recProgressPlaceholder = document.createElement("div");
        recProgressPlaceholder.innerHTML = html_receive_progress_tpl(id, label);
        let recProgressNode = recProgressPlaceholder;
        sectionNode.appendChild(recProgressNode);
        
        break;
      case "offer":
        if (clientMap.get(id) == null) {
          offerAction(id, message.content.data);
        }
        break;
      case "answer":
        if (clientMap.get(id) != null) {
          clientMap.get(id).setAnswer(message.content.data);
        }
        break;
      case "ice":
        if (clientMap.get(id) != null) {
          clientMap.get(id).setIce(message.content.data);
        }
        break;
      case "list":
        let opSize = selectObj.length;
        for (let index = 0; index < opSize; index++) {
          selectObj.options[0].remove();
        }

        selectObj.add(new Option("select Client", "-1"));
        for (let index = 0; index < message.content.length; index++) {
          if (message.content[index] != clientName) {
            selectObj.add(
              new Option(message.content[index], message.content[index])
            );
          }
        }
         
        break;
      default:
        console.err("default action receive msg：", event);
    }
  };

  
  ws.onerror = (error) => {
    console.error("WebSocket Error: ", error);
  };

  ws.onclose = () => {
    console.log("WebSocket was closed!");
  };
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
  return "Unkknow";
}

// send json data use websocket
function sendWsJsonData(data) {
  if (webSocket.readyState === WebSocket.OPEN) {
    webSocket.send(JSON.stringify(data));
  } else {
    console.error("WebSocket Not Open!");
  }
}

let userName = prompt('Input a UserName:');
if(userName !=null){
   init();
}else{
  console.error("UserName is Null");
}

