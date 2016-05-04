const Server = require('./server');

exports.createServer = function () {
  return new Server(arguments[0], arguments[1]);
}
