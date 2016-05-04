const EndPoint = require('./endpoint')
    , Heap = require('./heap')
    , Helpers = require('./helpers')
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
            process.nextTick(() => { server.emit('listening') });
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
            server.emit('close'); // We can close immediately
        }
    }
    
    address() {
        return this._endPoint.address();
    }

}

var sendQueue = new(function () {
    var before = Helpers.sooner('_sendTime')
        , queue = new Heap(before)
        , sending = false;

    function enqueue(socket, packet, when) {
        queue.add({
            socket: socket
            , packet: packet
            , when: when
        });
        if (!sending) poll();
    }

    function schedule(socket, timestamp) {
        // This gave me a funny feeling, one of violating encapsulation by using a
        // property in the socket object from the send queue, except that am I
        // supposed to do? This is what I would have called violating encapsulation
        // in my Java days, it triggers the creation of a dozen new types to
        // preserve encapsulation. I've yet to completely de-program myself of this
        // sort of rote programming. The send queue is within the same capsule as
        // the socket. They are interdependent. They existing for each other. The
        // socket object's underscored properties are part of its implementation, in
        // fact, the socket is not the implementation, the whole API is.
        socket._sendTime = timestamp;
        queue.push(socket);
        if (!sending) poll();
    }

    function poll() {
        sending = true;
        if (!queue.length) {
            sending = false;
        } else {
            send();
        }
    }

    function send() {
        var socket;
        if (before(queue.peek(), {
                _sendTime: process.hrtime()
            })) {
            socket = queue.pop();
            socket._endPoint.transmit(socket);
        }
        process.nextTick(poll);
    }
    Helpers.extend(this, {
        schedule: schedule
    });
})();
