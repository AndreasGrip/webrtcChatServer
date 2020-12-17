const WebSocket = require("ws");

const wssettings = {
  port: 8080,
  perMessageDeflate: {
    zlibDeflateOptions: {
      // See zlib defaults.
      chunkSize: 1024,
      memLevel: 7,
      level: 3,
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024,
    },
    // Other options settable:
    clientNoContextTakeover: true, // Defaults to negotiated value.
    serverNoContextTakeover: true, // Defaults to negotiated value.
    serverMaxWindowBits: 10, // Defaults to negotiated value.
    // Below options specified as default values.
    concurrencyLimit: 10, // Limits zlib concurrency for perf.
    threshold: 1024, // Size (in bytes) below which messages
    // should not be compressed.
  },
};

const wss = new WebSocket.Server(wssettings);

let cnxId = 0;

wss.on("connection", connection);

function connection(ws) {
  console.log("connected");
  ws.id = "cnx" + ++cnxId;
  ws.on("message", onMessage);
  ws.on("error", onError);
  // ws.ping(() => {});
  ws.send("Wellcome to server.");
  ws.on("close", onClose);
  ws.on("pong", onPong);
  ws.isAlive = new Date();
  ws.allClients = this.clients;
  ws.pingpong = (ws) => {
    let lastAlive = new Date() - ws.isAlive;
    console.log(ws.id + " send a ping");
    if (lastAlive > 30000) {
      console.log('lastAlive:' + lastAlive)
      clearInterval(ws.timer);
      // connection is dead
      ws.terminate();
    } else {
      ws.ping();
      console.log('Alive:' + lastAlive);
    }
  
  };
  // start keepalive check.
  ws.timer = setInterval(function () {
    ws.pingpong(ws);
  }, 1000);
}

function onMessage(message) {
  if (message.match(/^broadcast:\ .*/)) {
    message = message.replace("broadcast: ", "");
    console.log("received broadcast: " + message);
    this.allClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send("broadcast: " + message);
      }
    });
  } else if (message.match(/^ping\(.*\)$/)) {
    this.send("pong(" + message.match(/^ping\((.*)\)/)[1] + ")");
    console.log(
      "Recived " +
        message +
        " responding pong(" +
        message.match(/^ping\((.*)\)/)[1] +
        ")"
    );
  } else {
    console.log("received: %s", message);
    this.send("You sent: " + message);
  }
}

function onError(error) {
  console.log("Error: " + JSON.stringify(error));
}

wss.on("ping", function () {
  console.log("Recived Ping");
});

function onClose(ws) {
  console.log("Closed connection");
  clearInterval(ws.timer);
}
function onPong() {
  this.isAlive = new Date();
  console.log(
    this.id + " receive a pong : " + " " + this.isAlive.toUTCString()
  );
}
