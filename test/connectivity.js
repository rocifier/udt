var assert = require('chai').assert;
var Server = require('../server');
var server = new Server();
var EndPoint = require('../endpoint');
var Socket = require('../socket');
var udt = require('../udt');

describe('Server', function () {

    it('should listen and handshake on port 4000', function (done) {
        // The only way to really test whether a port is listening properly is to connect to it.
        // Here we connect from port 4001 to 4000 on localhost.
        server.listen({
                port: 4000
                , address: '127.0.0.1'
            }
            , function () {
                console.log("(Server: Got local connection)");
                server.close();
            }
            , function () {
                console.log("(Server: Listening on " + server.address.address + ":" + server.address.port + ")");
                var socket = udt.createConnection(4000, '127.0.0.1', function () {
                    console.log('(Client: connected)');
                    done();
                    socket._endPoint.shutdown(socket, false);
                });
            });
    });

    it('should timeout correctly', function (done) {

        var start = new Date();
        var gotTimeout = false;
        var gotConnect = false;
        var T_err = 100;
        var T = 250; // minimum timeout

        // 192.0.2.1 is part of subnet assigned as "TEST-NET" in RFC 5737.
        // For use solely in documentation and example source code.
        // In short, it should be unreachable.
        // In practice, it's a network black hole.
        var socket = udt.createConnection(9999, '192.0.2.1', () => {
            assert(false);
            console.error('connect');
            socket.destroy();
            done();
        });

        var rejectsLowTimeout = false;
        try {
            socket.setTimeout(T_err);
        } catch(error) {
            rejectsLowTimeout = true;
            console.log('\t(Client: low timeout correctly rejected)');
        }
        assert(rejectsLowTimeout);
        
        socket.setTimeout(T);
        socket.on('timeout', function () {
            console.log('(Client: timed out as expected)');
            gotTimeout = true;
            var now = new Date();
            assert.ok(now - start < T + 500);
            socket.destroy();
            done();
        });

        socket.on('error', function () {
            console.log('error');
            done();
        });

    });

    it('should send and receive files uncorrupted', function(done) {
        server.listen({
                port: 4001
                , address: '127.0.0.1'
            }
            , function () {
                console.log("(Server: Sending file)");
                
            }
            , function () {
                var socket = udt.createConnection(4000, '127.0.0.1', function () {
                    console.log('(Client: connected)');
                });
            });
    });
    
});