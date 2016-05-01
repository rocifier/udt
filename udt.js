var EndPoint = require('./endpoint')
    , crypto = require('crypto')
    , dns = require('dns')
    , Heap = require('./heap')
    , Helpers = require('./helpers');

const MAX_MSG_NO = 0x1FFFFFFF;
const MAX_SEQ_NO = Math.pow(2, 31) - 1;

var socketId = crypto.randomBytes(4).readUInt32BE(0);

function nextSocketId() {
    if (socketId == 1) socketId = Math.pow(2, 32);
    return --socketId;
}

var Stream = require('stream');
var util = require('util');
var events = require('events');
var net = require('net');

// The start of time used in our high resolution timings.
var epoch = process.hrtime();

// Comparison operator generator for high-resolution time for use with heap.
function sooner(property) {
    return function (a, b) {
        if (a[property][0] < b[property][0]) return true;
        if (a[property][0] > b[property][0]) return false;
        return a[property][1] < b[property][1];
    }
}

var sendQueue = new(function () {
    var before = sooner('_sendTime')
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


// Native control algorithm is an event emitter with certain properties. Ought
// to be simple enough for the user to implement a native control algorithm as
// an event emitter.
class NativeControlAlgorithm extends events.EventEmitter {

    constructor() {
        this.roundTripTime = 0;
        this.maximumSegmentSize = 0;
        this.estimatedBandwidth = 0;
        this.latestPacketSequenceNo = 0;
        this.windowSize = 16;
    }

}

function exceptional() {
    return new Error();
}

// Reference counted cache of UDP datagram sockets.
var endPoints = {};

// Create a new UDP datagram socket from the user specified port and address.

// TODO: IP version.
function createEndPoint(local) {
    var endPoint = new EndPoint(local)
        , local = endPoint.local;
    if (!endPoints[local.port]) endPoints[local.port] = {};
    return endPoints[local.port][local.address] = endPoint;
}

// Look up an UDP datagram socket in the cache of bound UDP datagram sockets by
// the user specified port and address. 

// 
function lookupEndPoint(local) {
    // No interfaces bound by the desired port. Note that this would also work for
    // zero, which indicates an ephemeral binding, but we check for that case
    // explicitly before calling this function.
    if (!endPoints[local.port]) return null;

    // Read datagram socket from cache.
    var endPoint = endPoints[local.port][local.address];

    // If no datagram exists, ensure that we'll be able to create one. This only
    // inspects ports that have been bound by UDT, not by other protocols, so
    // there is still an opportunity for error when the UDP bind is invoked.
    if (!endPoint) {
        if (endPoints[local.port][0]) {
            throw new Error('Already bound to all interfaces.');
        }
        if (local.address == 0) {
            throw new Error('Cannot bind to all interfaces because some interfaces are already bound.');
        }
    }

    // Return cached datagram socket or nothing.
    return endPoint;
}

exports.Server = class Server extends events.EventEmitter {

    constructor() {

        var options;

        if (typeof arguments[0] == 'function') {
            options = {};
            this.on('connection', arguments[0]);
        } else {
            options = arguments[0] || {};
            if (typeof arguments[1] == 'function') {
                this.on('connection', arguments[1]);
            }
        }

        // The Node.js `net` module uses a property for connections because the
        // connections property is disabled if the server is running in a
        // multi-process model, if it has "slaves." UDT does not support multi-process
        // model, so connections is plain-old property.

        //
        this.connections = 0;
    }

    listen() {
        var server = this;

        var lastArg = arguments[arguments.length - 1];
        if (typeof lastArg == 'function') {
            server.once('listening', lastArg);
        }

        var valid = validator(server);

        var options = {
            port: arguments[0] || 0
        };
        dns.lookup(arguments[1], valid(resolved));

        function resolved(ip, addressType) {
            options.address = ip || '0.0.0.0';

            var endPoint = server._endPoint = selectEndPoint(options);

            if (endPoint.server) {
                throw new Error('already bound to UDT server');
            }

            endPoint.server = server;
            console.log(endPoint.local);

            process.nextTick(function () {
                server.emit('listening');
            });
        }
    }

    close(callback) {
        var server = this
            , endPoint = server._endPoint;

        if (callback) server.once('close', callback);

        server._closing = true;

        if (endPoint.listeners == 0) {
            endPoint._server = null;
            server.emit('close');
        }
    }

}

// TODO: Consolidate.
function selectEndPoint(local) {
    var endPoint;
    // Use an existing datagram socket if one exists.
    if (local.port == 0) {
        endPoint = createEndPoint(local);
    } else if (!(endPoint = lookupEndPoint(local))) {
        endPoint = createEndPoint(local);
    }
    return endPoint;
}

const SYN_COOKIE_SALT = crypto.randomBytes(64).toString('binary');

function synCookie(address, timestamp) {
    var hash = crypto.createHash('sha1');
    hash.update(SYN_COOKIE_SALT + ':' + address.host + ':' + address.port + ':' + timestamp);
    return parseInt(hash.digest('hex').substring(0, 8), 16);
}

function toArray(buffer) {
    return buffer.toString('hex').replace(/(..)/g, ':$1')
        .replace(/(.{12})/g, '\n$1')
        .replace(/\n:/g, '\n');
}