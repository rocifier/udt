const dgram = require('dgram')
    , packet = require('packet')
    , crypto = require('crypto')
    , Helpers = require('./helpers')
    , events = require('events')
    , Socket = require('./socket')
    , common = require('./packetdefs');

const CONTROL_TYPES = 'handshake keep-alive acknowledgement'.split(/\s+/);


// Reference counted cache of UDP datagram sockets.
var endPoints = {};

/*
// Create a new UDT socket from the user specified port and IPV4 address.
function createEndPoint(local, onCreated) {

    // Use an existing datagram socket if one exists.
    var endPoint = lookupEndPoint(local);
    if (endPoint) {
        onCreated(endPoint);
        return;
    }

    var endPoint = new EndPoint(local, function (socketResult) {
        if (!endPoints[socketResult.port]) endPoints[socketResult.port] = {};
        endPoints[socketResult.port][socketResult.address] = endPoint;
        onCreated(endPoint);
    });
}

// Look up an UDP datagram socket in the cache of bound UDP datagram sockets by
// the user specified port and address.
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
*/

// An endpoint is one end of a two-way socket; it controls the socket from that end.
// This class uses a UDP datagram socket and provides additional functionality such as
// handshaking, persistent connections, reliability, sequencing, flow control, and congestion compensation.
module.exports = class EndPoint extends events.EventEmitter {

    // address: object containing address and port
    constructor(address, onBind, onError) {
        super();
        var endpoint = this;
        this.listeners = 0;
        this.packet = new Buffer(2048);
        this.sockets = {};
        this.dgram = dgram.createSocket('udp4');
        this.dgram.on('message', EndPoint.prototype.receive.bind(this));
        this.dgram.on('error', onError);
        // TODO: pool and reuse endpoints as in bigeasy/udt
        // But is that necessary?
        if (!endPoints[address.port]) endPoints[address.port] = {};
        endPoints[address.port][address.address] = endpoint;
        this.dgram.bind(address.port, address.address, () => {
            endpoint.address = endpoint.dgram.address();
            process.nextTick(() => {
                onBind(endpoint.address);
            });
        });
    }

    shakeHands(socket) {
        // Stash the socket so we can track it by the socket identifier.
        this.sockets[socket._socketId] = socket;

        // Start of client handshake.
        socket._status = "syn";

        // Send a handshake. Use hard-coded defaults for packet and window size.
        this.sendHandshake(socket, {
            control: 1
            , type: 0
            , additional: 0
            , timestamp: 0
            , destination: 0
            , version: 4
            , socketType: 1
            , sequence: socket._sequence
            , maxPacketSize: 1500
            , windowSize: 8192
            , connectionType: 1
            , socketId: socket._socketId
            , synCookie: 0
            , address: Helpers.parseDotDecimal(socket._peer.address)
        });
    }

    control(socket, pattern, message, callback) {
        var serializer = common.serializer
            , dgram = this.dgram
            , packet = new Buffer(64)
            , peer = socket._peer;

        message.control = 1;
        message.destination = peer.socketId;
        // TODO: Implement timestamp.
        message.timestamp = 0;

        // Format a shutdown packet, simply a header packet of type shutdown.
        serializer.reset();
        serializer.serialize(pattern, message);
        serializer.write(packet);

        dgram.send(packet, 0, serializer.length, peer.port, peer.address, callback);
    }

    shutdown(socket, send) {
        // Remove the socket from the stash.
        delete this.sockets[socket._socketId];

        // Zero the status.
        delete socket._status;

        var endPoint = this
            , dgram = endPoint.dgram;

        if (send) {
            var serializer = common.serializer
                , packet = endPoint.packet
                , peer = socket._peer;

            // Format a shutdown packet, simply a header packet of type shutdown.
            serializer.reset();
            serializer.serialize('header', {
                control: 1
                , type: 0x5
                , additional: 0
                , timestamp: 0
                , destination: peer.socketId
            });
            serializer.write(packet);

            dgram.send(packet, 0, serializer.length, peer.port, peer.address, finalize);
        } else {
            finalize();
        }

        function finalize() {
            // If we were a bound listening socket, see if we ought to close.
            //if (socket._listener && !--endPoint.listeners && endPoint.server._closing) {
                // This will unassign `endPoint.server`.
            //    endPoint.server.close();
            //}
            // Dispose of the end point and UDP socket if it is no longer referenced.
            if (Object.keys(endPoint.sockets).length == 0) {
                delete endPoints[endPoint.address.port][endPoint.address.address];
                if (Object.keys(endPoints[endPoint.address.port]).length == 0) {
                    delete endPoints[endPoint.address.port];
                }
                dgram.close();
            }
        }
    }

    // Send the handshake twice a second until we get a response, or until 8
    // seconds is up.
    sendHandshake(socket, handshake) {
        var endPoint = this
            , count = 0
            , peer = socket._peer;
        socket._handshakeInterval = setInterval(function () {
            if (++count == 16) {
                clearInterval(socket._handshakeInterval);
                socket.emit('error', new Error('connection timeout'));
            } else {
                endPoint.send('handshake', handshake, socket._peer);
            }
        }, 500);
    }

    send(packetType, object, peer) {
        var serializer = common.serializer
            , packet = this.packet
            , dgram = this.dgram;

        serializer.reset();
        serializer.serialize(packetType, object);
        serializer.write(packet);

        //console.log("Sending packet " + packetType + " to " + peer.address + ":" + peer.port);
        dgram.send(packet, 0, serializer.length, peer.port, peer.address);
    }

    receive(msg, rinfo) {
        var endPoint = this
            , parser = common.parser
            , handler;
        parser.reset();
        parser.extract('header', function (header) {
            header.rinfo = rinfo;
            header.length = msg.length;
            if (header.control) {
                if (header.destination) {
                    // TODO: Socket not found...
                    var socket = endPoint.sockets[header.destination];
                    switch (header.type) {
                        // Keep-alive.
                    case 0x1:
                        break;
                        // Shutdown.
                    case 0x5:
                        endPoint.shutdown(socket, false);
                        break;
                        // Notifications from Bill the Cat. (Ack-ack.)
                    case 0x6:
                        break;
                        // Everything else
                    default:
                        var name = CONTROL_TYPES[header.type];
                        //console.log(name, header);
                        parser.extract(name, endPoint[name].bind(endPoint, parser, socket, header));
                    }
                    // Todo: Make only the server socket accept handshakes.
                    // Todo: Rendezvous mode.
                } else if (header.type == 0) {
                    parser.extract('handshake', endPoint.connect.bind(endPoint, rinfo, header));
                }
            } else {}
        });
        parser.parse(msg);
    }

    handshake(parser, socket, header, handshake) {
        switch (socket._status) {
        case 'syn':
            // Only respond to an initial handshake.
            if (handshake.connectionType != 1) break;

            clearInterval(socket._handshakeInterval);

            socket._status = 'syn-ack';

            // Unify the packet object for serialization.
            handshake = Helpers.extend(handshake, header);

            // Set the destination to nothing.
            handshake.destination = 0;

            // Select the lesser of the negotiated values.
            // TODO: Constants are a bad thing...
            handshake.maxPacketSize = Math.min(handshake.maxPacketSize, 1500);
            handshake.windowSize = Math.min(handshake.windowSize, 8192);
            handshake.connectionType = -1;

            this.sendHandshake(socket, handshake);
            break;
        case 'syn-ack':
            // Only respond to an follow-up handshake.
            if (handshake.connectionType != -1) break;

            clearInterval(socket._handshakeInterval);

            socket._status = 'connected';
            socket._handshake = handshake;
            socket._peer.socketId = handshake.socketId;

            socket.emit('connect');
            break;
        }
    }

    acknowledgement(parser, socket, header, ack) {
        // All parsing in one fell swoop so we don't do something that causes a next
        // tick which might cause the parser to be reused.
        if (header.length == 40) {
            parser.extract('statistics', this.fullAcknowledgement.bind(this, socket, header, ack));
        } else {
            this.lightAcknowledgement(socket, header, ack);
        }
    };

    // Remove the sent packets that have been received.
    fullAcknowledgement(socket, header, ack, stats) {
        this.lightAcknowledgement(socket, header, ack);
        say(socket._flowWindowSize, socket._sent[0].length, header, ack, stats);
    }

    lightAcknowledgement(socket, header, ack) {
        var endPoint = this
            , sent = socket._sent
            , sequence = sent[0]
            , index;
        index = binarySearch(bySequence, sequence, ack);
        if (index != -1 && sent.length == 2) {
            socket._flowWindowSize -= sent[1].length;
            sent.length = 1;
        }
        if (sent.length == 2) {
            sequence = sent[1];
            index = binarySearch(bySequence, sequence, ack);
        }
        socket._flowWindowSize -= sequence.splice(0, index).length;
        endPoint.control(socket, 'header', {
            type: 0x6
            , additional: header.additional
        });
    }

    connect(rinfo, header, handshake) {
        var endPoint = this;
        var timestamp = Math.floor(Date.now() / 6e4);

        // Do not accept new connections if the server is closing.
        //if (server._closing) return;

        handshake = Helpers.extend(handshake, header);

        if (handshake.connectionType == 1) {
            handshake.destination = handshake.socketId;
            handshake.synCookie = synCookie(rinfo, timestamp);
            endPoint.send('handshake', handshake, rinfo);
        } else if (handshakeWithValidCookie(handshake, timestamp)) {
            // Create the socket and initialize it as a listener.
            // At this point we're on a server.
            // Todo: this is fucked up, a socket shouldn't be made here
            // and an endpoint made in socket!
            // could I solve this by creating the socket on the server handling the connection event?
            var socket = new Socket();

            socket._peer = rinfo;
            socket._endPoint = endPoint;
            socket._listener = true;
            socket._status = 'connected';

            // Increase the count of end point listeners.
            endPoint.listeners++;

            endPoint.sockets[socket._socketId] = socket;

            handshake.destination = handshake.socketId;
            handshake.socketId = socket._socketId;

            endPoint.send('handshake', handshake, rinfo);

            endPoint.emit('connection', socket);
        }

        function handshakeWithValidCookie(handshake, timestamp) {
            if (handshake.connectionType != -1) return false;
            if (synCookie(rinfo, timestamp) == handshake.synCookie) return true;
            if (synCookie(rinfo, timestamp - 1) == handshake.synCookie) return true;
            return false;
        }
    }

    transmit(socket) {
        var serializer = common.serializer
            , dgram = this.dgram
            , pending = socket._pending
            , peer = socket._peer
            , enqueue;

        // If we have data packets to retransmit, they go first, otherwise send a new
        // data packet.
        if (false) {

        } else {
            if (pending.length && !pending[0].length) {
                pending.shift();
            }

            if (pending.length) {
                // TODO: Is pop faster?
                message = pending[0].shift();

                // Set the sequence number.
                message.sequence = socket._sequence;

                // We will stash the message and increment the seqeunce number.
                enqueue = true;
            }
        }

        if (message) {
            serializer.reset();
            serializer.serialize('header', Helpers.extend({
                control: 0
                , timestamp: 0
            }, message));
            serializer.write(message.buffer);

            dgram.send(message.buffer, 0, message.buffer.length, peer.port, peer.address);
        }

        if (enqueue) {
            socket._flowWindowSize++;
            // Advance to the socket's next sequence number. The manipulation of the
            // sent list occurs in both the `Socket` and the `EndPoint`.
            socket._sequence = socket._sequence + 1 & MAX_SEQ_NO;
            // When our sequence number wraps, we use a new array of sent packets. This
            // helps us handle acknowledgements of packets whose squence number is in
            // the vicinity of a wrap.
            if (socket._sequence == 0) {
                socket._sent.unshift([]);
            }
            socket._sent[0].push(message);
        }

        // TODO: Something like this, but after actually calculating the time of the
        // next packet using the congestion control algorithm.
        if (pending.length > 1 || pending[0].length) {
            sendQueue.schedule(socket, 0);
        }
    }

};


// Binary search, implemented, as always, by taking a [peek at
// Sedgewick](http://algs4.cs.princeton.edu/11model/BinarySearch.java.html).
function binarySearch(comparator, array, key) {
    var low = 0
        , high = array.length - 1
        , partition, compare;
    while (low <= high) {
        partition = Math.floor(low + (high - low) / 2);
        compare = comparator(key, array[partition]);
        if (compare < 0) high = partition - 1;
        else if (compare > 0) low = partition + 1;
        else return partition;
    }
    return low;
}

// Compare two objects by their sequence property.
function bySequence(left, right) {
    return left.sequence - right.sequence;
}

const SYN_COOKIE_SALT = crypto.randomBytes(64).toString('binary');
function synCookie(address, timestamp) {
    var hash = crypto.createHash('sha1');
    hash.update(SYN_COOKIE_SALT + ':' + address.host + ':' + address.port + ':' + timestamp);
    return parseInt(hash.digest('hex').substring(0, 8), 16);
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
