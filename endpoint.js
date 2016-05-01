var dgram = require('dgram')
    , packet = require('packet')
    , common = require('./packetdefs');

const CONTROL_TYPES = 'handshake keep-alive acknowledgement'.split(/\s+/);

// Builds upon a UDP datagram socket by providing additional functionality such as
// handshaking, persistent connections, reliability, sequencing, flow control, and congestion compensation.
module.exports = class EndPoint {

    // local: object containing address and port
    constructor(local) {
        this.listeners = 0;
        this.dgram = dgram.createSocket('udp4');
        this.dgram.on('message', EndPoint.prototype.receive.bind(this));
        this.dgram.bind(local.port, local.address);
        this.local = this.dgram.address();
        this.packet = new Buffer(2048);
        this.sockets = {};
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
            , address: parseDotDecimal(socket._peer.address)
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
            if (socket._listener && !--endPoint.listeners && endPoint.server._closing) {
                // This will unassign `endPoint.server`.
                endPoint.server.close();
            }
            // Dispose of the end point and UDP socket if it is no longer referenced.
            if (Object.keys(endPoint.sockets).length == 0) {
                delete endPoints[endPoint.local.port][endPoint.local.address];
                if (Object.keys(endPoints[endPoint.local.port]).length == 0) {
                    delete endPoints[endPoint.local.port];
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
            if (++count == 12) {
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
                        console.log(name, header);
                        parser.extract(name, endPoint[name].bind(endPoint, parser, socket, header))
                    }
                    // Hmm... Do you explicitly enable rendezvous?
                } else if (header.type == 0 && endPoint.server) {
                    parser.extract('handshake', endPoint.connect.bind(endPoint, rinfo, header))
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
            handshake = extend(handshake, header);

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
        var endPoint = this
            , server = endPoint.server
            , timestamp = Math.floor(Date.now() / 6e4);

        // Do not accept new connections if the server is closing.
        if (server._closing) return;

        handshake = extend(handshake, header);

        if (handshake.connectionType == 1) {
            handshake.destination = handshake.socketId;
            handshake.synCookie = synCookie(rinfo, timestamp);
            endPoint.send('handshake', handshake, rinfo);
        } else if (handshakeWithValidCookie(handshake, timestamp)) {
            // Create the socket and initialize it as a listener.
            var socket = new Socket;

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

            endPoint.server.emit('connection', socket);
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
            serializer.serialize('header', extend({
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

}


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
    return left.sequence - right.sequence
}