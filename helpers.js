var __slice = [].slice;

module.exports = class Helpers {

    static _check(ee, forward) {
        return function (error) {
            if (error) {
                process.nextTick(function () {
                    ee.emit('error', error);
                    ee._destroy();
                });
            } else {
                try {
                    forward.apply(null, __slice.call(arguments, 1));
                } catch (error) {
                    ee.emit('error', error);
                }
            } 
        };
    }
    
    static validator(ee) {
        return function (forward) {
            return Helpers._check(ee, forward);
        };
    }

    static die() {
        console.log.apply(console, __slice.call(arguments, 0));
        return process.exit(1);
    }

    static say() {
        return console.log.apply(console, __slice.call(arguments, 0));
    }

    static extend(to, from) {
        for (var key in from) to[key] = from[key];
        return to;
    }

    static parseDotDecimal(quad) {
        quad = quad.split('.');
        for (var i = 3, address = 0; i >= 0; i--) {
            address = address + quad[i] * Math.pow(256, i);
        }
        return address;
    }

    // Comparison operator generator for high-resolution time for use with heap.
    static sooner(property) {
        return function (a, b) {
            if (a[property][0] < b[property][0]) return true;
            if (a[property][0] > b[property][0]) return false;
            return a[property][1] < b[property][1];
        };
    }

};