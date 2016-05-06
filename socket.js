const Stream = require('stream')
    , crypto = require('crypto')
    , Helpers = require('./helpers')
    , sendQueue = require('./sendqueue')
    , CongestionControl = require('./congestioncontrol');

// Total size of UDT data packet overhead, UDP header plus UDT data header.
const UDP_HEADER_SIZE = 28;
const UDT_DATA_HEADER_SIZE = 16;
const MAX_MSG_NO = 0x1FFFFFFF;
const MAX_SEQ_NO = Math.pow(2, 31) - 1;

// Socket reference ID
var socketId = crypto.randomBytes(4).readUInt32BE(0);

function nextSocketId() {
    if (socketId == 1) socketId = Math.pow(2, 32);
    return --socketId;
}

// This is a UDT socket established after endpoints have shaken hands.
module.exports = class Socket extends Stream {

    constructor() {
        super();
        this._socketId = nextSocketId();
        this._messageNumber = 1;
        this._flowWindowSize = 0;
        this._ccc = new CongestionControl;
        this._packet = new Buffer(1500);
        this._pending = [];
        this._sent = [[]];
        this._timeout = 12000; // ms
    }

    _nextSequence() {
        var socket = this;
        if (socket._sequence == MAX_SEQ_NO) {
            return socket._sequence = 0;
        } else {
            return ++socket._sequence;
        }
    }
    
    setTimeout(timeout) {
        if (timeout < 250) {
            throw new Error('timeout must be greater than 250ms');
        }
        this._timeout = timeout;
    }
    getTimeout() {
        return this._timeout;
    }

    connect(options, endPoint) {
        var socket = this;

        if (socket._dgram) throw new Error('Already connected');

        if (options.path) throw new Error('UNIX domain sockets are not supported.');
        if (!options.address) throw new Error('remoteAddress must be set in options');
        if (!options.port) throw new Error('remotePort must be set in options');
        if (!endPoint.address.address) throw new Error('localAddress must be set in options');
        if (!endPoint.address.port) throw new Error('localPort must be set in options');

        this._peer = {
            address: options.address
            , port: options.port
        };
        this.local = {
            address: endPoint.address.address
            , port: endPoint.address.port
        };

        socket._connecting = true;
        socket._endPoint = endPoint;

        var valid = Helpers.validator(socket);
        // Generate random bytes used to set randomized socket properties.
        // `crypto.randomBytes` calls OpenSSL `RAND_bytes` to generate the bytes.
        //
        //  * [RAND_bytes](http://www.openssl.org/docs/crypto/RAND_bytes.html).
        //  * [node_crypto.cc](https://github.com/joyent/node/blob/v0.8/src/node_crypto.cc#L4517)
        crypto.randomBytes(4, valid(randomzied));

        // Initialize the randomized socket properies.
        function randomzied(buffer) {
            // Randomly generated randomness.
            socket._sequence = buffer.readUInt32BE(0) % MAX_SEQ_NO;

            // The end point sends a packet on our behalf.
            socket._endPoint.shakeHands(socket);
        }
    }

    // There is no way to send the UDP packets without copying the user buffer into
    // new buffers. The UDP packets need a header before a chunk of the user data,
    // so we need to write the header, which means we need a buffer we can alter. We
    // cannot borrow the user's buffer.
    // 
    // According to documentation, write returns false if the buffer cannot be
    // written to kernel, if it is queued in user memory, so we can hold onto it for
    // a while if we like. We pushback when the UDT send buffer, as defined by the
    // count of packets, is full. 
    //
    // All this copying and allocation is disheartening. This is a place that needs
    // the attention of some benchmarks. If you can think of a way to avoid the
    // copying, please let me know. Nothing's occurring to me.

    //
    write(buffer) {
        var socket = this
            , handshake = socket._handshake
            , size = handshake.maxPacketSize - (UDT_DATA_HEADER_SIZE + UDT_DATA_HEADER_SIZE)
            , packet, count, i, message = [];

        count = Math.floor(buffer.length / size);
        if (buffer.length % size) count++;

        for (i = 0; i < count; i++) {
            packet = {
                control: 0
                , position: 0
                , inOrder: 1
                , number: socket._messageNumber
                , destination: handshake.socketId
                , buffer: new Buffer(UDT_DATA_HEADER_SIZE + Math.min(buffer.length - i * size, size))
            };
            // TODO: Does `Buffer.copy` choose the lesser of source length and
            // destination length?
            buffer.copy(packet.buffer, UDT_DATA_HEADER_SIZE, i * size);
            if (i == 0) packet.position |= 0x2;
            if (i == count - 1) packet.position |= 0x1;
            message.push(packet);
        }

        socket._messageNumber++;
        if (socket._messageNumber > MAX_MSG_NO) socket._messageNumber = 1;

        socket._pending.push(message);

        sendQueue.schedule(socket, [0, 0]);

        return true;
    }
    destroy() {
        this._endPoint.shutdown(this);
    }
    _destroy() {
        this._endPoint.shutdown(this);
    }
};