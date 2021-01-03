const WebSocket = require('ws');

const serverSettings = {
  serverName: 'Template server based on https://github.com/AndreasGrip/Websocket_server',
  timout: 30, // if the server don't get a ping respons from client in this number of seconds connection will be terminated.
};

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

wss.on('connection', connection);

function connection(ws) {
  // setup the connection
  ws.id = 'cnx' + ++cnxId;
  ws.username = 'user_' + cnxId;
  console.log(ws.id + '/' + ws.username + ': connected');
  ws.on('message', onMessage);
  ws.on('error', onError);
  ws.on('close', onClose);
  ws.on('pong', onPong);
  ws.isAlive = new Date();
  ws.allClients = this.clients;
  ws.pingpong = pingpong;
  // start keepalive check.
  ws.timer = setInterval(function () {
    ws.pingpong();
  }, 1000);

  ws.send('Wellcome to ' + serverSettings.serverName + ' you are assigned username ' + ws.username);
}

function onMessage(message) {
  if (message.match(/^broadcast:\ .*/)) {
    message = message.replace('broadcast: ', '');
    console.log('received broadcast: ' + message);
    this.allClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send('broadcast: ' + message);
      }
    });
  } else if (message.match(/^ping\(.*\)$/)) {
    this.send('pong(' + message.match(/^ping\((.*)\)/)[1] + ')');
    console.log('Recived ' + message + ' responding pong(' + message.match(/^ping\((.*)\)/)[1] + ')');
  } else {
    console.log('received: ' + message);
    this.send('You sent: ' + message);
  }
}

function onError(error) {
  console.log('Error: ' + JSON.stringify(error));
}

function onClose() {
  console.log('Closed connection ' + this.id);
  // kill the checkalive timer
  clearInterval(this.timer);
}

// Whenever we get a respons from ping
function onPong() {
  this.isAlive = new Date();
  console.debug(this.id + ' receive a pong : ' + ' ' + this.isAlive.toUTCString());
}

// Check if we have recived a pong for 30seconds. If so send a ping, otherwise terminate the connection.
function pingpong() {
  // Calculate how long since last pong.
  let lastAlive = new Date() - this.isAlive;
  const timoutThreshold = serverSettings.timout * 1000;
  console.log(this.id + ' send a ping');
  // Check if more than 30seconds since last pong
  if (lastAlive > timoutThreshold) {
    console.log(this.id + '/' + this.username + ': ms since last pong:' + lastAlive + ' above threshold of ' + timoutThreshold + ' will terminate connection.');
    // kill the timer
    clearInterval(this.timer);
    // Terminate the connection
    this.terminate();
  } else {
    // Send new ping
    this.ping();
    console.log(this.id + '/' + this.username + ': ms since last pong:' + lastAlive + ' below threshold of ' + timoutThreshold + '.');
  }
}
