const EndPoint = require('./endpoint')
    , events = require('events');

// Events emitted by Server:
// 'close' - Server has been shut down
// 'connection' - A new client connection was established (after handshaking). Returns a socket you can use.
// 'error' - With exception parameter attached
// 'listening' - Server is now listening on requested port and address for incoming connections
module.exports = class Server extends events.EventEmitter {

    constructor() {
        super();
        this.connections = 0;
    }

    listen(address, onConnect, onListening) {
        var server = this;
        server.on('connection', onConnect);
        server.once('listening', onListening);
        server._endPoint = new EndPoint(address, (boundaddress) => {
            server.address = boundaddress;
            process.nextTick(() => { server.emit('listening'); });
            // pass on up endpoint events
            server._endPoint.on('connection', (socket) => {
                server.emit('connection', socket);
            });
        }, (error) => {
            throw error;
        });
    }

    close(callback) {
        if (callback) this.once('close', callback);
        this._closing = true;
        if (this._endPoint.listeners == 0) {
            this.emit('close'); // We can close immediately
        }
    }
    
    address() {
        return this._endPoint.address();
    }

};
