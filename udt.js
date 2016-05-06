const Server = require('./server')
    , Socket = require('./socket')
    , endpoint = require('./endpoint');

exports.createServer = function () {
    return new Server();
};

exports.createConnection = function (port, host, connectListener) {
    var socket = new Socket();
    socket.on('connect', connectListener);

    endpoint.createEndPoint({
        port: 0
        , address: '0.0.0.0'
    }, onCreated);

    function onCreated(endPoint) {
        // We do this on the next tick so that execution
        // runs out of this whole function and the user gets
        // access to the unconnected socket. This allows them to set features
        // on the socket such as timeout for handshaking the connection.
        process.nextTick(() => {
            socket.connect({
                port: port
                , address: host
            }, endPoint);
        });
    }

    return socket;
};