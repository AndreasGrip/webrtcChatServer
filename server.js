require('dotenv').config();
const WebSocket = require('ws');
//const g_users = require('../g_usermanagent/g_usermanagement');
const g_users = require('g_usermanagent');
const gWinston = require('griffinwinston');
const logger = new gWinston();

// the same as JSON.parse(JSON.strigify(obj))
function objCopy(obj) {
  const s = JSON.stringify(obj);
  const o = JSON.parse(s);
  return o;
}

// Check if a returned object (is most likely) an error.
let isError = (e) => {
  return e && e.stack && e.message && typeof e.stack === 'string' && typeof e.message === 'string';
};

// default server settings
const serverSettings = {
  serverName: 'Template server based on https://github.com/AndreasGrip/Websocket_server',
  timeout: 30, // if the server don't get a ping response from client in this number of seconds connection will be terminated.
};

logger.debug('serverSettings: ' + JSON.stringify(serverSettings));

// default ws settings (port should be changed)
const wssettings = {
  port: process.env?.PORT ? process.env.PORT : 8080,
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
logger.debug('wssettings: ' + JSON.stringify(wssettings));

class chatserver {
  constructor(settings = {}) {
    // Setting default serverSettings if they are not defined.
    if (!settings?.serverSettings) settings.serverSettings = serverSettings;
  }
}

logger.debug('starting websocket server');
const wss = new WebSocket.Server(wssettings);

logger.debug('setup users');
const users = new g_users();
wss.users = users;

wss.clientsArray = [];
wss.channels = {};

class channelUser {
  constructor(user) {
    this.user = user;
    this.admin = false; // can change mode of other users ()
    this.protected = false; // can't be banned or demoted (by other than owner)
    this.voice = false;
    this.banProtected = false;
  }
}

class channel {
  constructor(name, creator, topic = '') {
    this.name = name;
    this.owner = creator;
    this.users = [];
    this.usersBanned = [];
    // TODO? add banned adresses?
    this.topic = topic;
    //https://www.unrealircd.org/docs/Channel_modes
    this.modes = {
      inviteonly: false, // only people invited can join
      key: false, // password to join
      limit: 0, // Limit the amount of users that may be in the channel.
      moderated: false, //Only people with +v or higher (+vhoaq) may speak.
      private: false, // Private channel. Partially conceals the existence of the channel. Users cannot see this channel name unless they are a member of it. For example, if you WHOIS a user who is on a +p channel, this channel is omitted from the response
      regonly: true, // Only registered users may join the channel. Registered users are users authenticated t
    };
    this.join(creator);
    logger.debug(`Channel ${this.name} created by ${creator.user.name}`)
  }
  kick(kicker, kicked) {
    const kickerUser = this.users.find(kicker);
    if (!kickerUser) return new Error('Kicker User not in channel');
    if (!kickerUser.admin) return new Error("Kicker User is not admin and can't kick");
    const kickedUser = this.users.find(kicked);
    if (!kickerUser) return new Error('Kicker User not in channel');
    //TODO inform user that hes been kicked.
    this.rmUser(kicked);
    kicked.channels.slice(kicked.channels.find(this), 1);
    logger.debug(`${this.name}: ${kicker.name} kicked ${kicked.name} `)
  }
  join(user) {
    if (this.usersBanned.includes(user)) return new Error('You is banned');
    if (this.users.find((u) => u.user === user)) return new Error('You have already joined channer this.name');
    this.addUser(user);
    logger.debug(`${user.user.name} joined ${this.name}`)
  }
  addUser(user) {
    const newUser = new channelUser(user);
    this.users.push(newUser);
    user.channels.push(this);
    const message = `user ${user.user.nickname} joined.`;
    this.info(message);
  }
  rmUser(user) {
    // find the pointer of the correct user object
    const foundUser = this.users.filter((u) => (u.user = user));
    if (!foundUser) return new Error('User not found');
    // find the index of the pointer and then slice it out. (remove it)
    this.users.slice(this.users.indexOf(foundUser), 1);
    const message = `user ${user.nickname} left #${this.name}.`;
    this.info(message);
  }
  chanMessage(message) {
    this.send(message);
  }
  // give information to everyone in channel about channel event.
  info(message) {
    this.send(message);
    logger.info(message);
  }
  // send data to everyone in channel
  send(message) {
    this.users.forEach((client) => {
      if (client.user.readyState === WebSocket.OPEN) {
        client.user.send(`#${this.name} ${message}`);
      }
    });
  }
}

let cnxId = 0;
logger.debug('cnxId: ' + cnxId);

wss.on('connection', connection);

function connection(ws) {
  // setup the connection
  ws.id = 'cnx' + ++cnxId;
  ws.user = { nickname: 'user_' + cnxId };
  logger.info(ws.id + '/' + ws.user.nickname + ': connected');
  ws.on('message', onMessage);
  ws.on('error', onError);
  ws.on('close', onClose);
  ws.on('pong', onPong);
  ws.isAlive = new Date();
  logger.debug('ws.id:' + ws.id + ' isAlive: ' + ws.isAlive);
  ws.wss = this; // this will not be available for internal functions, so attach it to ws.
  ws.allClients = this.clients;
  ws.allClientsArray = this.clientsArray;
  ws.channels = []; // Channes the user is present in.
  this.clientsArray.push(ws);
  ws.pingpong = pingpong; // custom function
  this.timeouts = 0;
  // start keepalive check.
  ws.timer = setInterval(function () {
    ws.pingpong();
  }, 1000);

  ws.send('Welcome to ' + serverSettings.serverName + ' you are assigned nickname ' + ws.user.nickname);
}

function onMessage(message) {
  // const regex = /^(\w+):\ ((\w|\ )?)/i;
  // const regex = /^\/(\w+)\s?(.*)*/i;
  const regEx = /^\/(\w+)((\s(\S*))+)?/i;
  const messageSplit = message.match(regEx);
  const command = messageSplit && messageSplit[1];
  // slice is to remove first whitespace
  const argument = messageSplit && messageSplit[2] ? messageSplit[2].slice(1) : '';
  const argumentsList = argument !== '' ? argument.split(' ') : [];
  if (command) {
    logger.info(`${this.id}/${this.user.nickname}: received ${command}: ${argument}`);
  } else {
    this.send('You sent: ' + message);
  }
  if (command) {
    switch (command) {
      // TODO: this should be removed or limited
      case 'broadcast':
        this.allClients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(`${command} from ${this.user.nickname}: ${argument}`);
          }
        });
        break;

      case 'msg':
        let destination = argumentsList.shift();
        if (destination.slice(0, 1) === '#') {
          destination = destination.slice(1)
          if (this.channels && this.channels.find(c => c.name === destination)) {
            let destChannel = this.channels.find(c => c.name === destination);
            if(!destChannel.voice || (destChannel.voice && (destChannel.users.find(c => c.user === this).voice || destChannel.users.find(c => c.user === this).admin))) {
              destChannel.chanMessage(`@${this.user.nickname}: ${argumentsList.join(' ')}`);              
            } else {
              this.send(`Not enought permissions to msg #${destChannel} `)
            }
          } else this.send(`You are not in channel #${destination}`);
        } else {
          const destUser = this.allClientsArray.filter((c) => c.user.nickname === destination);
          if (destUser.length > 0) {
            destUser.forEach((user) => user.send(`@${this.user.nickname}: ${argumentsList.join(' ')}`));
            //this.send(`${destination}: ${argumentsList.join(' ')}`);
          } else {
            this.send(`No user called '${destination}' is not connected.`);
          }
        }
        break;
      case 'join':
        const destChannel = argumentsList.shift();
        if (this.wss.channels[destChannel]) {
          const channelJoin = this.wss.channels[destChannel].join(this);
          if (isError(channelJoin)) this.send(channelJoin.message);
        } else {
          this.wss.channels[destChannel] = new channel(destChannel, this, arguments);
        }
        break;
      case 'login':
      case 'adduser':
        if (argumentsList && argumentsList.length === 2) {
          const user = argumentsList[0];
          const pass = argumentsList[1];
          let loginCredentials;
          switch (command) {
            case 'login':
              loginCredentials = this.wss.users.userLogin(user, pass);
              loginCredentialsObj = tryParseJSON(loginCredentials);
              if (loginCredentialsObj && loginCredentialsObj.userName) {
                this.wss.users.usersLoggedIn.push(this);
                this.user.nickname = loginCredentialsObj.userName;
                this.send('Successfully logged in as ' + user);
              } else {
                this.send('Failed to login as ' + user);
              }
              break;
            case 'adduser':
              if (this.user.nickname) {
                loginCredentials = this.wss.users.userAdd(user, pass);
              } else {
                loginCredentials = 'require user to be logged in.';
              }
          }

          this.send(command + ': ' + loginCredentials);
        }
        break;
      case 'ping':
        argumentsList.pop();
        this.send('pong(' + argument + ')' + argumentsList.join(' '));
        logger.info(`${this.id}/${this.user.nickname}: responding pong(${argument}) ${argumentsList.join(' ')}`);
        break;
      case 'users':
        if (!this.user.nickname) {
          this.send(command + ' requires user to be logged in.');
        } else {
          switch (command) {
            case 'users':
              console.log('ab');
              const clients = [];
              this.allClients.forEach((t) => clients.push(t.user.nickname));
              this.send(clients.join(','));
          }
        }
        break;
      case 'help':
        let helpText = '';
        this.send('');
        this.send('Available commands are');
        this.send('broadcast [message] - Broadcast a message to all connected clients');
        this.send('login [username] [password] - Log in as a user');
        this.send('adduser [username] [password] - Add a new user');
        this.send('ping - measure latency towards server');
        this.send('');
        break;

      default:
        this.send('unknown command: ' + command);
        logger.info(`${this.id}/${this.user.nickname}: unknown command ${command} ${argumentsList.join(' ')}`);
    }
  }
}

function onError(error) {
  logger.error('Error: ' + JSON.stringify(error));
}

function onClose() {
  logger.info('Closed connection ' + this.id);
  // remove user from login
  logger.debug(this.id + ' removed from usersLoggedIn');
  //this.wss.users.usersLoggedIn = this.wss.users.usersLoggedIn.filter((a) => a.id != this.id);
  this.wss.users.usersLoggedIn.splice(this);
  // kill the check alive timer
  logger.debug(this.id + ' removed keepalive timer');
  clearInterval(this.timer);
  this.allClientsArray.splice(this, 1);
}

// Whenever we get a response from ping
function onPong() {
  this.isAlive = new Date();
  // console.debug(this.id + ' receive a pong : ' + ' ' + this.isAlive.toUTCString());
}

// Check if we have received a pong for 30seconds. If so send a ping, otherwise terminate the connection.
function pingpong() {
  // Calculate how long since last pong.
  let lastAlive = new Date() - this.isAlive;
  const timeoutThreshold = serverSettings.timeout * 1000;
  // console.log(this.id + ' send a ping');
  // Check if more than 30seconds since last pong
  if (lastAlive > timeoutThreshold) {
    if (++this.timeouts >= 5) {
      logger.info(this.id + '/' + this.user.nickname + ': ms since last pong:' + lastAlive + ' above threshold of ' + timeoutThreshold + ' will terminate connection.');
      // kill the timer
      logger.debug(this.id + ' removed keepalive timer');
      clearInterval(this.timer);
      // Terminate the connection
      logger.debug(this.id + ' terminate connection');
      this.terminate();
    } else {
      // console.log(this.id + '/' + this.user.nickname + ': ms since last pong:' + lastAlive + ' above threshold of ' + timeoutThreshold + ' timeouts: ' + this.timeouts);
      this.ping();
    }
  } else {
    // Send new ping
    this.ping();
    this.timeouts = 0;
    // console.log(this.id + '/' + this.user.nickname + ': ms since last pong:' + lastAlive + ' below threshold of ' + timeoutThreshold + '.');
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
