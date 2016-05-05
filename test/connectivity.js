var assert = require('chai').assert;
var Server = require('../server');
var server = new Server();
var EndPoint = require('../endpoint');
var Socket = require('../socket');

describe('Server', function() {
   
    it('should listen and handshake on port 4000', function(done) {
        // The only way to really test whether a port is listening properly is to connect to it.
        // Here we connect from port 4001 to 4000 on localhost.
        server.listen({port: 4000, address: '127.0.0.1'}
        , function() {
            console.log("(Server: Got local connection)");
            server.close();
        }, function() {
            console.log("(Server: Listening on " + server.address.address + ":" + server.address.port + ")");
            var socket = new Socket();

            // Set up this end of the socket
            // Kinda sucks having to create and endpoint and a socket - the endpoint should be internal.
            // But for now I've done it to stop cyclic requires and keep everything modular.
            // Open to suggestions for how to improve this - perhaps create a client class to wrap it?
            var endPoint = new EndPoint({port: 4001, address: '127.0.0.1'}, (address) => {
                socket.connect({port: 4000, address: '127.0.0.1'}, endPoint);
                socket.on('connect', function () {
                  console.log('(Client: connected)');
                  done();
                  endPoint.shutdown(socket, false);
                });
            }, (err) => {});
            
        });
        
    });
    
});