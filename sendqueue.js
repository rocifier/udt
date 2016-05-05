var Heap = require('./heap')
    , Helpers = require('./helpers');

// Send queue for sockets
class SendQueue {
    var before = Helpers.sooner('_sendTime')
        , queue = new Heap(before)
        , sending = false;

    function schedule(socket, timestamp) {
        socket._sendTime = timestamp; // Todo: use getter method
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
};

// singleton
module.exports = new SendQueue();