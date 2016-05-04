var events = require('events');

module.exports = class CongestionControl extends events.EventEmitter {

    constructor() {
        super();
        this.roundTripTime = 0;
        this.maximumSegmentSize = 0;
        this.estimatedBandwidth = 0;
        this.latestPacketSequenceNo = 0;
        this.windowSize = 16;
    }

}
