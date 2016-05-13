var Heap = require('./heap')
    , Helpers = require('./helpers');

// Send queue for sockets
var before = Helpers.sooner('_sendTime')
    , queue = new Heap(before)
    , sending = false;
class SendQueue {

    constructor() {}
    
    schedule(socket, timestamp) {
        socket._sendTime = timestamp; // Todo: use getter method
        queue.push(socket);
        if (!sending) this.poll();
    }

    poll() {
        sending = true;
        if (!queue.length) {
            sending = false;
        } else {
            this.send();
        }
    }

    send() {
        var socket;
        if (before(queue.peek(), {
                _sendTime: process.hrtime()
            })) {
            socket = queue.pop();
            socket._endPoint.transmit(socket);
        }
        process.nextTick(this.poll);
    }
    
};

// singleton
module.exports = new SendQueue();