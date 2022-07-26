require('dotenv').config();
const WebSocket = require('ws');
//const g_users = require('../g_usermanagent/g_usermanagement');
const g_users = require('g_usermanagent');

const serverSettings = {
  serverName: 'Template server based on https://github.com/AndreasGrip/Websocket_server',
  timout: 30, // if the server don't get a ping response from client in this number of seconds connection will be terminated.
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
wss.users = new g_users();

let cnxId = 0;

wss.on('connection', connection);

function connection(ws) {
  // setup the connection
  ws.id = 'cnx' + ++cnxId;
  ws.user = { nickname: 'user_' + cnxId };
  console.log(ws.id + '/' + ws.user.nickname + ': connected');
  ws.on('message', onMessage);
  ws.on('error', onError);
  ws.on('close', onClose);
  ws.on('pong', onPong);
  ws.isAlive = new Date();
  ws.allClients = this.clients;
  ws.wss = this;
  ws.pingpong = pingpong;
  this.timeouts = 0;
  // start keepalive check.
  ws.timer = setInterval(function () {
    ws.pingpong();
  }, 1000);

  ws.send('Wellcome to ' + serverSettings.serverName + ' you are assigned nickname ' + ws.user.nickname);
}

function onMessage(message) {
  //const regex = /^(\w+):\ ((\w|\ )?)/i;
  const regex = /^(\w+)\s?(.*)*/i;
  const messageSplit = message.match(regex);
  const command = messageSplit && messageSplit[1];
  const argument = messageSplit && messageSplit[2];
  const arguments = messageSplit && messageSplit[2] && messageSplit[2].split(' ');
  if (command) {
    console.log(`${this.id}/${this.user.nickname}: received ${command}: ${argument}`);
  } else {
    this.send('You sent: ' + message);
  }
  if (command) {
    switch (command) {
      case 'broadcast':
        this.allClients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(`${command}: ${argument}`);
          }
        });
        break;
      case 'login':
      case 'adduser':
        if (arguments && arguments.length === 2) {
          const user = arguments[0];
          const pass = arguments[1];
          let logincredentials;
          switch (command) {
            case 'login':
              logincredentials = this.wss.users.userLogin(user, pass);
              logincredentialsObj = tryParseJSON(logincredentials);
              if (logincredentialsObj && logincredentialsObj.userName) {
                this.wss.users.usersLoggedIn.push(this);
                this.user.nickname = logincredentialsObj.userName;
                this.send('Succesfully logged in as ' + user);
              } else {
                this.send('Failed to login as ' + user);
              }
              break;
            case 'adduser':
              if (this.user.nickname) {
                logincredentials = this.wss.users.userAdd(user, pass);
              } else {
                logincredentials = 'require user to be logged in.';
              }
          }

          this.send(command + ': ' + logincredentials);
        }
        break;
      case 'ping':
        arguments.pop()
        this.send('pong(' + argument + ')' + arguments.join(' '));
        console.log(`${this.id}/${this.user.nickname}: responding pong(${argument}) ${arguments.join(' ')}`);
        break;
      default:
        this.send('unknown command: ' + command);
        console.log(`${this.id}/${this.user.nickname}: unknown command ${command} ${arguments.join(' ')}`);
    }
  }
}

function onError(error) {
  console.log('Error: ' + JSON.stringify(error));
}

function onClose() {
  console.log('Closed connection ' + this.id);
  // remove user from login
  this.wss.users.usersLoggedIn = this.wss.users.usersLoggedIn.filter((a) => a.id != this.id);
  // kill the checkalive timer
  clearInterval(this.timer);
}

// Whenever we get a respons from ping
function onPong() {
  this.isAlive = new Date();
  // console.debug(this.id + ' receive a pong : ' + ' ' + this.isAlive.toUTCString());
}

// Check if we have recived a pong for 30seconds. If so send a ping, otherwise terminate the connection.
function pingpong() {
  // Calculate how long since last pong.
  let lastAlive = new Date() - this.isAlive;
  const timoutThreshold = serverSettings.timout * 1000;
  // console.log(this.id + ' send a ping');
  // Check if more than 30seconds since last pong
  if (lastAlive > timoutThreshold) {
    if (++this.timeouts >= 5) {
      console.log(this.id + '/' + this.user.nickname + ': ms since last pong:' + lastAlive + ' above threshold of ' + timoutThreshold + ' will terminate connection.');
      // kill the timer
      clearInterval(this.timer);
      // Terminate the connection

      this.terminate();
    } else {
      // console.log(this.id + '/' + this.user.nickname + ': ms since last pong:' + lastAlive + ' above threshold of ' + timoutThreshold + ' timeouts: ' + this.timeouts);
      this.ping();
    }
  } else {
    // Send new ping
    this.ping();
    this.timeouts = 0;
    // console.log(this.id + '/' + this.user.nickname + ': ms since last pong:' + lastAlive + ' below threshold of ' + timoutThreshold + '.');
  }
  return true;
}

// https://stackoverflow.com/questions/3710204/how-to-check-if-a-string-is-a-valid-json-string-in-javascript-without-using-try
function tryParseJSON(jsonString) {
  try {
    var o = JSON.parse(jsonString);

    // Handle non-exception-throwing cases:
    // Neither JSON.parse(false) or JSON.parse(1234) throw errors, hence the type-checking,
    // but... JSON.parse(null) returns null, and typeof null === "object",
    // so we must check for that, too. Thankfully, null is falsey, so this suffices:
    if (o && typeof o === 'object') {
      return o;
    }
  } catch (e) {}

  return false;
}
