var net = require('net');

var _ = require('lodash');

var C = require('./constants');

var EOL = '\0';

function _encode(tokens) {
  tokens = _.flatten([tokens]);

  _.forEach(tokens, function (value, i) {
    if (_.isBoolean(value)) {
      tokens[i] = value ? 1 : 0;
    }
  });

  var data = tokens.join(EOL);

  var buffer = Buffer.alloc(data.length + 4);

  buffer.write(data, 4);
  buffer.writeInt32BE(data.length, 0);

  return buffer;
}

function Socket(controller) {
  this._controller = controller;

  this._client = null;
  this._connected = false;
  this._dataFragment = '';
  this._neverReceived = true;
  this._neverSent = true;
  this._waitingAsync = false;
}

Socket.prototype._onConnect = function () {
  this._connected = true;
  this._controller.emit('connected');

  var v100Prefix = 'API\0';
  var v100Version = 'v100..139';
  var msg = _encode(v100Version);

  var buffer = Buffer.concat([Buffer.from(v100Prefix), msg]);

  this._client.write(buffer)
  // this.send(buffer);

  // this._controller.run('sendAsync', [C.CLIENT_VERSION]);
  // this._controller.run('sendAsync', [this._controller.options.clientId]);
};

Socket.prototype._onData = function (data) {
  let offset = 0;

  let rawBuffer = data.slice(offset);

  let firstTokens = null;

  while (rawBuffer.length) {
    const size = rawBuffer.readUInt32BE(rawBuffer);
    const messageBuffer = rawBuffer.slice(4);

    const tokens = messageBuffer.toString().split(EOL);

    if (!firstTokens) {
      firstTokens = tokens;
    }

    this._controller.emit('received', tokens.slice(0), messageBuffer);

    if (!this._neverReceived) {
      this._controller._incoming.enqueue(tokens);
    }

    rawBuffer = rawBuffer.slice(size + 4);
  }

  if (this._neverReceived) {
    this._controller._serverVersion = parseInt(firstTokens[0], 10);
    this._controller._serverConnectionTime = firstTokens[1]
    this._controller.emit('server', this._controller._serverVersion, this._controller._serverConnectionTime);

    var startApi = _encode([C.OUTGOING.START_API, 2, this._controller.options.clientId, '\0']);

    this._client.write(startApi);
  }

  this._controller._incoming.process();

  // Async
  if (this._waitingAsync) {
    this._waitingAsync = false;
    this._controller.resume();
  }

  this._neverReceived = false;

  return;

  // var dataWithFragment = this._dataFragment + data.toString();

  // var tokens = dataWithFragment.split(EOL);
  // if (tokens[tokens.length - 1] !== '') {
  //   this._dataFragment = tokens[tokens.length - 1];
  // } else {
  //   this._dataFragment = '';
  // }
  // tokens = tokens.slice(0, -1);
  // this._controller.emit('received', tokens.slice(0), data);

  // // Process data queue
  // this._controller._incoming.enqueue(tokens);

  // if (this._neverReceived) {
  //   this._controller._serverVersion = parseInt(this._controller._incoming.dequeue(), 10);
  //   this._controller._serverConnectionTime = this._controller._incoming.dequeue();
  //   this._controller.emit('server', this._controller._serverVersion, this._controller._serverConnectionTime);

  //   var startApi = _encode([C.OUTGOING.START_API, 2, this._controller.options.clientId, '\0']);

  //   this._client.write(startApi);
  // }

  // this._controller._incoming.process();

  // // Async
  // if (this._waitingAsync) {
  //   this._waitingAsync = false;
  //   this._controller.resume();
  // }

  // this._neverReceived = false;
};

Socket.prototype._onEnd = function () {
  var wasConnected = this._connected;
  this._connected = false;

  if (wasConnected) {
    this._controller.emit('disconnected');
  }

  this._controller.resume();
};

Socket.prototype._onError = function (err) {
  this._controller.emit('error', err);
};

Socket.prototype.connect = function () {
  var self = this;

  this._controller.pause();

  this._neverReceived = true;
  this._neverSent = true;

  this._client = net.connect({
    host: this._controller.options.host,
    port: this._controller.options.port
  }, function () {
    self._onConnect.apply(self, arguments);
    self._controller.resume();
  });

  this._client.on('data', function () {
    self._onData.apply(self, arguments);
  });

  this._client.on('close', function () {
    self._onEnd.apply(self, arguments);
  });

  this._client.on('end', function () {
    self._onEnd.apply(self, arguments);
  });

  this._client.on('error', function () {
    self._onError.apply(self, arguments);
  });
};

Socket.prototype.disconnect = function () {
  this._controller.pause();
  this._client.end();
};

Socket.prototype.send = function (tokens, async) {
  if (async) {
    this._waitingAsync = true;
    this._controller.pause();
  }

  tokens.push('\0');

  var buffer = _encode(tokens);

  this._client.write(buffer);

  this._controller.emit('sent', tokens, buffer);

  this._neverSent = false;


  // tokens = _.flatten([tokens]);

  // _.forEach(tokens, function (value, i) {
  //   if (_.isBoolean(value)) {
  //     tokens[i] = value ? 1 : 0;
  //   }
  // });

  // var data = tokens.join(EOL) + EOL;
  // this._client.write(data);

  // this._controller.emit('sent', tokens, data);

  // this._neverSent = false;
};

module.exports = Socket;
